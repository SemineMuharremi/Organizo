/**
 * Application store: a single source of truth with explicit actions.
 *
 * - `data` is persisted (tasks, projects, notifications, activity log, settings).
 * - `ui` is ephemeral (search query, filters).
 *
 * Every data mutation goes through `commit`, which saves to storage and rolls
 * back if saving fails, so the UI never shows changes that were not persisted.
 */
import * as storage from "./storage.js";
import {
  createTask, validateTaskInput, validateProjectInput, normalizeTag, normalizeOrder, sanitizeSettings, uid, LIMITS,
} from "./core/model.js";
import { DEFAULT_FILTERS, isDone, hasPendingReminder } from "./core/selectors.js";
import { nextOccurrence, shiftReminder } from "./core/recurrence.js";
import { toKey, toDateTime, parseDateTime } from "./core/dates.js";

const listeners = new Set();
const loaded = storage.load();

let state = {
  data: loaded.data,
  ui: { query: "", filters: { ...DEFAULT_FILTERS } },
};

export const startupWarning = loaded.warning ?? null;

export const getState = () => state;

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit() {
  for (const listener of listeners) listener(state);
}

/** Result helpers so callers can show precise feedback. */
const ok = (extra = {}) => ({ ok: true, ...extra });
const fail = (error, errors = {}) => ({ ok: false, error, errors });

function commit(mutate) {
  const previous = state.data;
  const next = structuredClone(previous);
  const extra = mutate(next);
  try {
    storage.save(next);
  } catch (err) {
    state = { ...state, data: previous };
    return fail(err.message);
  }
  state = { ...state, data: next };
  emit();
  return ok(extra ?? {});
}

function setUI(patch) {
  state = { ...state, ui: { ...state.ui, ...patch } };
  emit();
}

const projectIds = () => new Set(state.data.projects.map((p) => p.id));
const findTask = (data, id) => data.tasks.find((t) => t.id === id);
const nowIso = () => new Date().toISOString();
const nextOrder = (data) => data.tasks.reduce((max, t) => Math.max(max, t.order), -1) + 1;

/* ------------------------ Completion & recurrence ------------------------ */
/* The activity log powers streaks and history, and is kept separately so
   deleting old completed tasks does not erase your streak. */

function markCompleted(data, task) {
  task.completedAt = nowIso();
  const key = toKey(new Date(task.completedAt));
  data.activity[key] = (data.activity[key] ?? 0) + 1;
  spawnNextOccurrence(data, task);
}

function markReopened(data, task) {
  if (task.completedAt) {
    const key = toKey(new Date(task.completedAt));
    if (data.activity[key] > 1) data.activity[key]--;
    else delete data.activity[key];
  }
  task.completedAt = null;
  removeUntouchedOccurrence(data, task);
}

/**
 * Create the next occurrence of a recurring task inside the same commit that
 * completes it. `spawnedId` links the two so completing again (or reloading)
 * can never create a duplicate.
 */
function spawnNextOccurrence(data, task) {
  if (!task.recurrence || !task.dueDate) return;
  if (task.spawnedId && findTask(data, task.spawnedId)) return;
  const dueDate = nextOccurrence(task.recurrence, task.dueDate);
  const next = createTask({
    title: task.title,
    description: task.description,
    priority: task.priority,
    status: "todo",
    dueDate,
    dueTime: task.dueTime,
    projectId: task.projectId,
    tags: [...task.tags],
    recurrence: { ...task.recurrence },
    reminderAt: shiftReminder(task.reminderAt, task.dueDate, dueDate),
    subtasks: task.subtasks.map((s) => ({ id: uid(), title: s.title, done: false })),
    order: task.order + 0.5,
  });
  data.tasks.push(next);
  normalizeOrder(data.tasks);
  task.spawnedId = next.id;
}

/** Undoing a completion removes the generated occurrence if the user has not touched it yet. */
function removeUntouchedOccurrence(data, task) {
  const spawned = task.spawnedId && findTask(data, task.spawnedId);
  if (!spawned) { task.spawnedId = null; return; }
  if (spawned.updatedAt === spawned.createdAt && !isDone(spawned) && !spawned.spawnedId) {
    data.tasks = data.tasks.filter((t) => t.id !== spawned.id);
    task.spawnedId = null;
  }
}

function applyStatus(data, task, status) {
  const wasDone = isDone(task);
  task.status = status;
  if (!wasDone && status === "completed") markCompleted(data, task);
  if (wasDone && status !== "completed") markReopened(data, task);
}

/* --------------------------------- Tasks --------------------------------- */

export function addTask(input) {
  const { value, errors } = validateTaskInput(input, { projectIds: projectIds() });
  if (!value) return fail("Please fix the highlighted fields.", errors);
  const task = createTask({ ...value, order: nextOrder(state.data) });
  const result = commit((data) => {
    data.tasks.push(task);
    if (task.completedAt) data.activity[toKey()] = (data.activity[toKey()] ?? 0) + 1;
  });
  return result.ok ? ok({ task }) : result;
}

export function updateTask(id, input) {
  const existing = findTask(state.data, id);
  if (!existing) return fail("This task no longer exists.");
  const { value, errors } = validateTaskInput(input, { projectIds: projectIds() });
  if (!value) return fail("Please fix the highlighted fields.", errors);
  return commit((data) => {
    const task = findTask(data, id);
    const { status, ...rest } = value;
    // Keep the original day-of-month anchor while the due date is unchanged (e.g. a "31st" task now on the 30th).
    if (rest.recurrence && task.recurrence && task.dueDate === rest.dueDate && task.recurrence.freq === rest.recurrence.freq) {
      rest.recurrence.anchorDay = task.recurrence.anchorDay;
    }
    if (rest.reminderAt !== task.reminderAt) task.reminderSent = false;
    Object.assign(task, rest, { updatedAt: nowIso() });
    applyStatus(data, task, status);
  });
}

export function setTaskStatus(id, status) {
  if (!findTask(state.data, id)) return fail("This task no longer exists.");
  return commit((data) => {
    const task = findTask(data, id);
    applyStatus(data, task, status);
    task.updatedAt = nowIso();
    return { spawnedId: status === "completed" ? task.spawnedId : null };
  });
}

export function toggleTask(id) {
  const task = findTask(state.data, id);
  if (!task) return fail("This task no longer exists.");
  const completing = !isDone(task);
  const result = setTaskStatus(id, completing ? "completed" : "todo");
  return result.ok ? ok({ completed: completing, spawnedId: result.spawnedId }) : result;
}

export function duplicateTask(id) {
  const source = findTask(state.data, id);
  if (!source) return fail("This task no longer exists.");
  const reminderInFuture = source.reminderAt && parseDateTime(source.reminderAt) > new Date();
  const copy = createTask({
    ...source,
    title: `${source.title} (copy)`.slice(0, LIMITS.title),
    status: "todo",
    tags: [...source.tags],
    recurrence: source.recurrence ? { ...source.recurrence } : null,
    reminderAt: reminderInFuture ? source.reminderAt : null,
    subtasks: source.subtasks.map((s) => ({ id: uid(), title: s.title, done: false })),
    order: source.order + 0.5,
  });
  const result = commit((data) => {
    data.tasks.push(copy);
    normalizeOrder(data.tasks);
  });
  return result.ok ? ok({ task: copy }) : result;
}

export function deleteTask(id) {
  const task = findTask(state.data, id);
  if (!task) return fail("This task no longer exists.");
  const result = commit((data) => {
    data.tasks = data.tasks.filter((t) => t.id !== id);
  });
  return result.ok ? ok({ task }) : result;
}

/** Undo a deletion (activity is untouched by delete, so nothing else to restore). */
export function restoreTask(task) {
  return commit((data) => {
    const restored = { ...task };
    if (restored.projectId && !data.projects.some((p) => p.id === restored.projectId)) restored.projectId = null;
    data.tasks.push(restored);
    normalizeOrder(data.tasks);
  });
}

export function clearCompleted() {
  const count = state.data.tasks.filter(isDone).length;
  if (!count) return fail("There are no completed tasks to clear.");
  const result = commit((data) => {
    data.tasks = normalizeOrder(data.tasks.filter((t) => !isDone(t)));
  });
  return result.ok ? ok({ count }) : result;
}

/**
 * Manual ordering: move a task directly before `beforeId`, or directly after
 * `afterId` (used when dropping at the end of a list). Works on the global
 * order, so moving within a filtered list keeps hidden tasks in place.
 */
export function moveTask(id, { beforeId = null, afterId = null }) {
  if (!findTask(state.data, id)) return fail("This task no longer exists.");
  if (id === beforeId || id === afterId) return ok();
  return commit((data) => {
    const sorted = data.tasks.slice().sort((a, b) => a.order - b.order);
    const moving = sorted.find((t) => t.id === id);
    const rest = sorted.filter((t) => t.id !== id);
    let index = rest.length;
    if (beforeId) index = Math.max(0, rest.findIndex((t) => t.id === beforeId));
    else if (afterId) index = rest.findIndex((t) => t.id === afterId) + 1;
    rest.splice(index, 0, moving);
    rest.forEach((t, i) => { t.order = i; });
  });
}

/* -------------------------------- Subtasks ------------------------------- */

function mutateSubtasks(taskId, fn) {
  if (!findTask(state.data, taskId)) return fail("This task no longer exists.");
  return commit((data) => {
    const task = findTask(data, taskId);
    const extra = fn(task);
    task.updatedAt = nowIso();
    return extra;
  });
}

export function addSubtask(taskId, title) {
  const clean = String(title ?? "").trim().slice(0, LIMITS.title);
  if (!clean) return fail("Subtask title cannot be empty.");
  if (findTask(state.data, taskId)?.subtasks.length >= LIMITS.subtasks) return fail(`A task can have at most ${LIMITS.subtasks} subtasks.`);
  return mutateSubtasks(taskId, (task) => {
    const subtask = { id: uid(), title: clean, done: false };
    task.subtasks.push(subtask);
    return { subtask };
  });
}

export function updateSubtask(taskId, subtaskId, patch) {
  const task = findTask(state.data, taskId);
  if (!task?.subtasks.some((s) => s.id === subtaskId)) return fail("This subtask no longer exists.");
  if ("title" in patch && !String(patch.title).trim()) return fail("Subtask title cannot be empty.");
  return mutateSubtasks(taskId, (t) => {
    const s = t.subtasks.find((x) => x.id === subtaskId);
    if ("title" in patch) s.title = String(patch.title).trim().slice(0, LIMITS.title);
    if ("done" in patch) s.done = !!patch.done;
  });
}

export const toggleSubtask = (taskId, subtaskId) => {
  const s = findTask(state.data, taskId)?.subtasks.find((x) => x.id === subtaskId);
  return s ? updateSubtask(taskId, subtaskId, { done: !s.done }) : fail("This subtask no longer exists.");
};

export function deleteSubtask(taskId, subtaskId) {
  if (!findTask(state.data, taskId)?.subtasks.some((s) => s.id === subtaskId)) return fail("This subtask no longer exists.");
  return mutateSubtasks(taskId, (t) => { t.subtasks = t.subtasks.filter((s) => s.id !== subtaskId); });
}

/* ------------------------- Reminders & notifications --------------------- */

function pushNotification(data, fields) {
  const notification = { id: uid(), type: "info", taskId: null, message: "", read: false, createdAt: nowIso(), ...fields };
  data.notifications.unshift(notification);
  data.notifications.length = Math.min(data.notifications.length, LIMITS.notifications);
  return notification;
}

/**
 * Deliver every reminder that is due. Marking `reminderSent` happens in the
 * same commit as creating the notification, so a reminder fires exactly once.
 * @returns {object[]} the created notifications (empty when nothing was due).
 */
export function fireDueReminders(now = new Date()) {
  const due = state.data.tasks.filter((t) => hasPendingReminder(t) && parseDateTime(t.reminderAt) <= now);
  if (!due.length) return [];
  const result = commit((data) => ({
    notifications: due.map((d) => {
      const task = findTask(data, d.id);
      task.reminderSent = true;
      const late = now - parseDateTime(task.reminderAt) > 5 * 60_000;
      return pushNotification(data, {
        type: "reminder",
        taskId: task.id,
        title: task.title,
        message: late ? "Missed reminder: Organizo was closed or asleep at the reminder time." : "Reminder",
      });
    }),
  }));
  return result.ok ? result.notifications : [];
}

/** Earliest pending reminder time (ms since epoch) or null. */
export function nextReminderTime() {
  let next = null;
  for (const t of state.data.tasks) {
    if (!hasPendingReminder(t)) continue;
    const at = parseDateTime(t.reminderAt).getTime();
    if (next === null || at < next) next = at;
  }
  return next;
}

export function snoozeReminder(taskId, minutes = 10) {
  if (!findTask(state.data, taskId)) return fail("This task no longer exists.");
  const at = new Date(Date.now() + minutes * 60_000);
  at.setSeconds(0, 0);
  if (at <= new Date()) at.setMinutes(at.getMinutes() + 1);
  return commit((data) => {
    const task = findTask(data, taskId);
    task.reminderAt = toDateTime(at);
    task.reminderSent = false;
    task.updatedAt = nowIso();
    return { reminderAt: task.reminderAt };
  });
}

export function clearReminder(taskId) {
  if (!findTask(state.data, taskId)) return fail("This task no longer exists.");
  return commit((data) => {
    const task = findTask(data, taskId);
    task.reminderAt = null;
    task.reminderSent = false;
    task.updatedAt = nowIso();
  });
}

export function addNotification(fields) {
  return commit((data) => ({ notification: pushNotification(data, fields) }));
}

export function setNotificationRead(id, read = true) {
  if (!state.data.notifications.some((n) => n.id === id)) return fail("This notification no longer exists.");
  return commit((data) => { data.notifications.find((n) => n.id === id).read = read; });
}

export function markAllNotificationsRead() {
  if (!state.data.notifications.some((n) => !n.read)) return ok();
  return commit((data) => { for (const n of data.notifications) n.read = true; });
}

export function deleteNotification(id) {
  return commit((data) => { data.notifications = data.notifications.filter((n) => n.id !== id); });
}

export function clearNotifications() {
  return commit((data) => { data.notifications = []; });
}

/* -------------------------------- Projects ------------------------------- */

const otherProjectNames = (exceptId) =>
  new Set(state.data.projects.filter((p) => p.id !== exceptId).map((p) => p.name.toLowerCase()));

export function addProject(input) {
  const { value, errors } = validateProjectInput(input, { existingNames: otherProjectNames() });
  if (!value) return fail("Please fix the highlighted fields.", errors);
  const project = { id: uid(), ...value, createdAt: nowIso() };
  const result = commit((data) => { data.projects.push(project); });
  return result.ok ? ok({ project }) : result;
}

export function updateProject(id, input) {
  if (!state.data.projects.some((p) => p.id === id)) return fail("This project no longer exists.");
  const { value, errors } = validateProjectInput(input, { existingNames: otherProjectNames(id) });
  if (!value) return fail("Please fix the highlighted fields.", errors);
  return commit((data) => { Object.assign(data.projects.find((p) => p.id === id), value); });
}

/** Delete a project. Its tasks are moved to the Inbox, or deleted when `deleteTasks` is true. */
export function deleteProject(id, { deleteTasks = false } = {}) {
  if (!state.data.projects.some((p) => p.id === id)) return fail("This project no longer exists.");
  return commit((data) => {
    data.projects = data.projects.filter((p) => p.id !== id);
    if (deleteTasks) data.tasks = normalizeOrder(data.tasks.filter((t) => t.projectId !== id));
    else for (const t of data.tasks) if (t.projectId === id) t.projectId = null;
  });
}

/* ---------------------------------- Tags --------------------------------- */

export function removeTag(tag) {
  const target = normalizeTag(tag);
  return commit((data) => {
    for (const t of data.tasks) t.tags = t.tags.filter((x) => x !== target);
  });
}

/* ------------------------------ Settings/data ---------------------------- */

export function updateSettings(patch) {
  return commit((data) => {
    data.settings = sanitizeSettings({
      ...data.settings,
      ...patch,
      notifications: { ...data.settings.notifications, ...(patch.notifications ?? {}) },
    });
  });
}

export const setTheme = (theme) => updateSettings({ theme });

/** Replace everything with already-sanitised data (import / reset). Returns the previous data for undo. */
export function replaceData(data) {
  const previous = state.data;
  const result = commit((draft) => {
    Object.keys(draft).forEach((key) => delete draft[key]);
    Object.assign(draft, structuredClone(data));
  });
  return result.ok ? ok({ previous }) : result;
}

/** Delete all tasks, projects, notifications, history and settings. */
export function resetAll() {
  return replaceData({ ...storage.initialData(), projects: [] });
}

/** Reload after another tab changed storage. */
export function reloadFromStorage() {
  state = { ...state, data: storage.load().data };
  emit();
}

/* ------------------------------- UI state -------------------------------- */

/** Re-render subscribers after view-local UI state (e.g. a collapsed section) changes. */
export const refresh = () => emit();
export const setQuery = (query) => setUI({ query });
export const setFilters = (patch) => setUI({ filters: { ...state.ui.filters, ...patch } });
export const resetFilters = ({ sort = state.ui.filters.sort } = {}) => setUI({ filters: { ...DEFAULT_FILTERS, sort } });
