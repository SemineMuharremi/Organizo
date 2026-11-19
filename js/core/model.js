/**
 * Domain model: constants, factories and validation for tasks, projects,
 * notifications and settings. Every write into the store passes through these
 * functions, so persisted data is always well-formed.
 */
import { isValidKey, isValidTime, isValidDateTime, fromKey } from "./dates.js";
import { frequencyById, MAX_INTERVAL } from "./recurrence.js";

export const PRIORITIES = [
  { id: "urgent", label: "Urgent", rank: 4, icon: "priority_high" },
  { id: "high", label: "High", rank: 3, icon: "keyboard_double_arrow_up" },
  { id: "medium", label: "Medium", rank: 2, icon: "drag_handle" },
  { id: "low", label: "Low", rank: 1, icon: "keyboard_arrow_down" },
];

export const STATUSES = [
  { id: "todo", label: "To Do", icon: "radio_button_unchecked" },
  { id: "in_progress", label: "In Progress", icon: "clock_loader_40" },
  { id: "completed", label: "Completed", icon: "check_circle" },
];

/** Muted project colors that work on light and dark surfaces. */
export const PROJECT_COLORS = [
  { id: "indigo", label: "Indigo", value: "#6366f1" },
  { id: "blue", label: "Blue", value: "#3b82f6" },
  { id: "teal", label: "Teal", value: "#14b8a6" },
  { id: "green", label: "Green", value: "#22c55e" },
  { id: "amber", label: "Amber", value: "#f59e0b" },
  { id: "orange", label: "Orange", value: "#f97316" },
  { id: "rose", label: "Rose", value: "#f43f5e" },
  { id: "violet", label: "Violet", value: "#a855f7" },
  { id: "slate", label: "Slate", value: "#64748b" },
];

export const LIMITS = {
  title: 200,
  description: 5000,
  tag: 30,
  tags: 10,
  projectName: 40,
  subtasks: 50,
  notifications: 100,
};

export const DEFAULT_SETTINGS = Object.freeze({
  theme: "system",
  defaultPriority: "medium",
  weekStart: 1, // 0 = Sunday, 1 = Monday
  notifications: Object.freeze({ inApp: true, browser: false }),
});

export const priorityById = Object.fromEntries(PRIORITIES.map((p) => [p.id, p]));
export const statusById = Object.fromEntries(STATUSES.map((s) => [s.id, s]));
export const colorById = Object.fromEntries(PROJECT_COLORS.map((c) => [c.id, c]));

export function uid() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Normalise a tag: trimmed, lowercase, inner whitespace collapsed to "-". */
export function normalizeTag(tag) {
  return String(tag).trim().replace(/^#/, "").toLowerCase().replace(/\s+/g, "-").slice(0, LIMITS.tag);
}

export function parseTags(input) {
  const list = Array.isArray(input) ? input : String(input ?? "").split(",");
  return [...new Set(list.map(normalizeTag).filter(Boolean))];
}

/** Clean a subtask list: trimmed titles, ids, booleans, no blanks. */
export function normalizeSubtasks(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const s of list) {
    const title = String(s?.title ?? "").trim().slice(0, LIMITS.title);
    if (!title) continue;
    const id = typeof s?.id === "string" && s.id && !seen.has(s.id) ? s.id : uid();
    seen.add(id);
    out.push({ id, title, done: s?.done === true });
  }
  return out;
}

/** Validate a recurrence rule; returns the clean rule, null for "none", or an error string. */
export function normalizeRecurrence(input, dueDate) {
  if (!input || !input.freq || input.freq === "none") return { rule: null };
  if (!frequencyById[input.freq]) return { error: "Choose how often the task repeats." };
  const interval = Number(input.interval ?? 1);
  if (!Number.isInteger(interval) || interval < 1 || interval > MAX_INTERVAL) {
    return { error: `Enter a whole number between 1 and ${MAX_INTERVAL}.` };
  }
  if (!dueDate) return { error: "Repeating tasks need a due date." };
  return { rule: { freq: input.freq, interval, anchorDay: fromKey(dueDate).getDate() } };
}

/**
 * Validate a task draft coming from the UI.
 * @returns {{ value?: object, errors: Record<string,string> }}
 */
export function validateTaskInput(input, { projectIds }) {
  const errors = {};
  const title = String(input.title ?? "").trim();
  const description = String(input.description ?? "").trim();
  const tags = parseTags(input.tags);
  const dueDate = input.dueDate || null;
  const dueTime = input.dueTime || null;
  const projectId = input.projectId || null;
  const reminderAt = input.reminderAt || null;
  const subtasks = normalizeSubtasks(input.subtasks);

  if (!title) errors.title = "Give the task a title.";
  else if (title.length > LIMITS.title) errors.title = `Keep the title under ${LIMITS.title} characters.`;
  if (description.length > LIMITS.description) errors.description = `Description is limited to ${LIMITS.description} characters.`;
  if (!priorityById[input.priority]) errors.priority = "Choose a priority.";
  if (!statusById[input.status]) errors.status = "Choose a status.";
  if (dueDate && !isValidKey(dueDate)) errors.dueDate = "Enter a valid date.";
  if (dueTime && !isValidTime(dueTime)) errors.dueTime = "Enter a valid time.";
  if (dueTime && !dueDate) errors.dueTime = "Add a due date to set a time.";
  if (projectId && !projectIds.has(projectId)) errors.projectId = "That project no longer exists.";
  if (tags.length > LIMITS.tags) errors.tags = `Use at most ${LIMITS.tags} tags.`;
  if (reminderAt && !isValidDateTime(reminderAt)) errors.reminderAt = "Enter a valid reminder date and time.";
  if (subtasks.length > LIMITS.subtasks) errors.subtasks = `Use at most ${LIMITS.subtasks} subtasks.`;
  const { rule: recurrence, error: recurrenceError } = normalizeRecurrence(input.recurrence, errors.dueDate ? null : dueDate);
  if (recurrenceError) errors.recurrence = recurrenceError;

  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    value: { title, description, priority: input.priority, status: input.status, dueDate, dueTime, projectId, tags, reminderAt, recurrence, subtasks },
  };
}

export function createTask(fields) {
  const now = new Date().toISOString();
  return {
    title: "",
    description: "",
    priority: "medium",
    status: "todo",
    dueDate: null,
    dueTime: null,
    projectId: null,
    tags: [],
    reminderAt: null,
    recurrence: null,
    subtasks: [],
    order: 0,
    ...fields,
    id: uid(),
    reminderSent: false,
    spawnedId: null,
    createdAt: now,
    updatedAt: now,
    completedAt: fields.status === "completed" ? now : null,
  };
}

export function validateProjectInput(input, { existingNames }) {
  const errors = {};
  const name = String(input.name ?? "").trim();
  if (!name) errors.name = "Give the project a name.";
  else if (name.length > LIMITS.projectName) errors.name = `Keep the name under ${LIMITS.projectName} characters.`;
  else if (existingNames.has(name.toLowerCase())) errors.name = "A project with this name already exists.";
  if (!colorById[input.color]) errors.color = "Pick a color.";
  if (Object.keys(errors).length) return { errors };
  return { errors, value: { name, color: input.color } };
}

export function sanitizeSettings(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const n = s.notifications && typeof s.notifications === "object" ? s.notifications : {};
  return {
    theme: ["light", "dark", "system"].includes(s.theme) ? s.theme : DEFAULT_SETTINGS.theme,
    defaultPriority: priorityById[s.defaultPriority] ? s.defaultPriority : DEFAULT_SETTINGS.defaultPriority,
    weekStart: s.weekStart === 0 || s.weekStart === 1 ? s.weekStart : DEFAULT_SETTINGS.weekStart,
    notifications: {
      inApp: typeof n.inApp === "boolean" ? n.inApp : DEFAULT_SETTINGS.notifications.inApp,
      browser: typeof n.browser === "boolean" ? n.browser : DEFAULT_SETTINGS.notifications.browser,
    },
  };
}

/* ---------- Sanitising data read from storage or imported files ---------- */

const isStr = (v) => typeof v === "string";
const isIso = (v) => isStr(v) && !Number.isNaN(Date.parse(v));

function sanitizeRecurrence(raw, dueDate) {
  if (!raw || !dueDate || !frequencyById[raw.freq]) return null;
  const interval = Number.isInteger(raw.interval) && raw.interval >= 1 && raw.interval <= MAX_INTERVAL ? raw.interval : 1;
  const anchorDay = Number.isInteger(raw.anchorDay) && raw.anchorDay >= 1 && raw.anchorDay <= 31 ? raw.anchorDay : fromKey(dueDate).getDate();
  return { freq: raw.freq, interval, anchorDay };
}

function sanitizeTask(raw, projectIds, index) {
  if (!raw || !isStr(raw.id) || !isStr(raw.title) || !raw.title.trim()) return null;
  const status = statusById[raw.status] ? raw.status : "todo";
  const createdAt = isIso(raw.createdAt) ? raw.createdAt : new Date().toISOString();
  const dueDate = isValidKey(raw.dueDate) ? raw.dueDate : null;
  const reminderAt = isValidDateTime(raw.reminderAt) ? raw.reminderAt : null;
  return {
    id: raw.id,
    title: raw.title.trim().slice(0, LIMITS.title),
    description: isStr(raw.description) ? raw.description.slice(0, LIMITS.description) : "",
    priority: priorityById[raw.priority] ? raw.priority : "medium",
    status,
    dueDate,
    dueTime: dueDate && isValidTime(raw.dueTime) ? raw.dueTime : null,
    projectId: projectIds.has(raw.projectId) ? raw.projectId : null,
    tags: parseTags(Array.isArray(raw.tags) ? raw.tags : []).slice(0, LIMITS.tags),
    reminderAt,
    reminderSent: reminderAt ? raw.reminderSent === true : false,
    recurrence: sanitizeRecurrence(raw.recurrence, dueDate),
    spawnedId: isStr(raw.spawnedId) ? raw.spawnedId : null,
    subtasks: normalizeSubtasks(raw.subtasks).slice(0, LIMITS.subtasks),
    order: Number.isFinite(raw.order) ? raw.order : index,
    createdAt,
    updatedAt: isIso(raw.updatedAt) ? raw.updatedAt : createdAt,
    completedAt: status === "completed" ? (isIso(raw.completedAt) ? raw.completedAt : createdAt) : null,
  };
}

function sanitizeProject(raw) {
  if (!raw || !isStr(raw.id) || !isStr(raw.name) || !raw.name.trim()) return null;
  return {
    id: raw.id,
    name: raw.name.trim().slice(0, LIMITS.projectName),
    color: colorById[raw.color] ? raw.color : "slate",
    createdAt: isIso(raw.createdAt) ? raw.createdAt : new Date().toISOString(),
  };
}

function sanitizeNotification(raw) {
  if (!raw || !isStr(raw.id) || !isStr(raw.title) || !isIso(raw.createdAt)) return null;
  return {
    id: raw.id,
    type: raw.type === "reminder" ? "reminder" : "info",
    taskId: isStr(raw.taskId) ? raw.taskId : null,
    title: raw.title.slice(0, LIMITS.title),
    message: isStr(raw.message) ? raw.message.slice(0, 500) : "",
    createdAt: raw.createdAt,
    read: raw.read === true,
  };
}

function dedupeById(list) {
  const seen = new Set();
  return list.filter((item) => !seen.has(item.id) && seen.add(item.id));
}

/** Renumber task.order to 0..n-1, keeping the current relative order. */
export function normalizeOrder(tasks) {
  tasks
    .map((t, i) => [t, i])
    .sort(([a, i], [b, j]) => a.order - b.order || i - j)
    .forEach(([t], i) => { t.order = i; });
  return tasks;
}

/**
 * Turn untrusted data into a valid state object.
 * Throws if it is not app data at all.
 * @returns {{ data: object, issues: string[] }} issues describe skipped/repaired records.
 */
export function sanitizeData(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.tasks) || !Array.isArray(raw.projects)) {
    throw new Error("This file does not contain Organizo data.");
  }
  const issues = [];
  const note = (count, what) => { if (count > 0) issues.push(`${count} ${what} skipped because ${count === 1 ? "it was" : "they were"} invalid or duplicated.`); };

  const projects = dedupeById(raw.projects.map(sanitizeProject).filter(Boolean));
  note(raw.projects.length - projects.length, raw.projects.length - projects.length === 1 ? "project" : "projects");
  const projectIds = new Set(projects.map((p) => p.id));

  const tasks = normalizeOrder(dedupeById(raw.tasks.map((t, i) => sanitizeTask(t, projectIds, i)).filter(Boolean)));
  note(raw.tasks.length - tasks.length, raw.tasks.length - tasks.length === 1 ? "task" : "tasks");
  const taskIds = new Set(tasks.map((t) => t.id));
  for (const t of tasks) if (t.spawnedId && !taskIds.has(t.spawnedId)) t.spawnedId = null;

  const rawNotes = Array.isArray(raw.notifications) ? raw.notifications : [];
  const notifications = dedupeById(rawNotes.map(sanitizeNotification).filter(Boolean))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, LIMITS.notifications);
  note(Math.min(rawNotes.length, LIMITS.notifications) - notifications.length, "notifications");

  const activity = {};
  if (raw.activity && typeof raw.activity === "object") {
    for (const [key, count] of Object.entries(raw.activity)) {
      if (isValidKey(key) && Number.isInteger(count) && count > 0) activity[key] = count;
    }
  }
  return { data: { tasks, projects, notifications, activity, settings: sanitizeSettings(raw.settings) }, issues };
}
