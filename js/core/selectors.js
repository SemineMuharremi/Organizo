/**
 * Pure, derived-data functions: view membership, filtering, sorting and
 * statistics. Nothing here mutates state, so it is safe to call on every render.
 */
import { addDays, diffDays, toKey, todayKey, startOfWeek } from "./dates.js";
import { priorityById } from "./model.js";

export const isDone = (task) => task.status === "completed";

/**
 * Deadline state of an open task:
 * "overdue" | "today" | "soon" (tomorrow) | "later" | null (no date / done).
 */
export function deadlineState(task, now = new Date()) {
  if (isDone(task) || !task.dueDate) return null;
  const today = toKey(now);
  const diff = diffDays(today, task.dueDate);
  if (diff < 0) return "overdue";
  if (diff === 0) {
    if (task.dueTime) {
      const [h, m] = task.dueTime.split(":").map(Number);
      if (now.getHours() * 60 + now.getMinutes() > h * 60 + m) return "overdue";
    }
    return "today";
  }
  return diff === 1 ? "soon" : "later";
}

export const isOverdue = (task, now) => deadlineState(task, now) === "overdue";

/* ------------------------------- Views ---------------------------------- */

export const VIEWS = {
  inbox: { title: "Inbox", icon: "inbox", empty: "Your inbox is clear", emptyHint: "Tasks without a project land here. Capture anything on your mind." },
  today: { title: "Today", icon: "today", empty: "Nothing due today", emptyHint: "Enjoy the free time, or plan something for today." },
  upcoming: { title: "Upcoming", icon: "event_upcoming", empty: "No upcoming deadlines", emptyHint: "Tasks with future due dates will appear here, grouped by day." },
  all: { title: "All Tasks", icon: "stacks", empty: "No tasks yet", emptyHint: "Create your first task to get started." },
  completed: { title: "Completed", icon: "task_alt", empty: "Nothing completed yet", emptyHint: "Completed tasks are kept here so you can review your progress." },
  project: { title: "Project", icon: "folder", empty: "This project is empty", emptyHint: "Add a task to start organising this project." },
};

/** Base task set for a view, before user filters. */
export function tasksForView(tasks, view, projectId) {
  const today = todayKey();
  switch (view) {
    case "inbox": return tasks.filter((t) => !t.projectId && !isDone(t));
    case "today": return tasks.filter((t) => !isDone(t) && t.dueDate && t.dueDate <= today);
    case "upcoming": return tasks.filter((t) => !isDone(t) && t.dueDate && t.dueDate > today);
    case "completed": return tasks.filter(isDone);
    case "project": return tasks.filter((t) => t.projectId === projectId);
    default: return tasks.slice();
  }
}

/* ------------------------------ Filtering -------------------------------- */

export const DEFAULT_FILTERS = Object.freeze({
  priority: "all",
  status: "all",
  projectId: "all",
  date: "all",
  tag: "all",
  sort: "deadline",
});

export const DATE_FILTERS = [
  { id: "all", label: "Any date" },
  { id: "overdue", label: "Overdue" },
  { id: "today", label: "Due today" },
  { id: "week", label: "This week" },
  { id: "next7", label: "Next 7 days" },
  { id: "none", label: "No due date" },
];

export const SORTS = [
  { id: "manual", label: "Manual order" },
  { id: "deadline", label: "Deadline" },
  { id: "priority", label: "Priority" },
  { id: "created", label: "Newest first" },
  { id: "title", label: "Title (A–Z)" },
];

function matchesDate(task, filter, today, weekStart) {
  switch (filter) {
    case "overdue": return isOverdue(task);
    case "today": return task.dueDate === today;
    case "week": {
      const start = startOfWeek(today, weekStart);
      return !!task.dueDate && task.dueDate >= start && task.dueDate <= addDays(start, 6);
    }
    case "next7": return !!task.dueDate && task.dueDate >= today && task.dueDate <= addDays(today, 7);
    case "none": return !task.dueDate;
    default: return true;
  }
}

function matchesQuery(task, terms, projectsById) {
  if (!terms.length) return true;
  const haystack = [task.title, task.description, task.tags.join(" "), projectsById[task.projectId]?.name ?? "inbox"]
    .join(" ")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export function applyFilters(tasks, filters, query, projectsById, weekStart = 1) {
  const today = todayKey();
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return tasks.filter((t) =>
    (filters.priority === "all" || t.priority === filters.priority) &&
    (filters.status === "all" || (filters.status === "open" ? !isDone(t) : t.status === filters.status)) &&
    (filters.projectId === "all" || (filters.projectId === "inbox" ? !t.projectId : t.projectId === filters.projectId)) &&
    (filters.tag === "all" || t.tags.includes(filters.tag)) &&
    matchesDate(t, filters.date, today, weekStart) &&
    matchesQuery(t, terms, projectsById),
  );
}

export const countActiveFilters = (filters) =>
  Object.entries(filters).filter(([key, value]) => key !== "sort" && value !== "all").length;

/* ------------------------------- Sorting --------------------------------- */

const dueValue = (t) => (t.dueDate ? `${t.dueDate}T${t.dueTime ?? "99:99"}` : "9999");
const byDeadline = (a, b) => dueValue(a).localeCompare(dueValue(b));
const byPriority = (a, b) => priorityById[b.priority].rank - priorityById[a.priority].rank;
const byCreated = (a, b) => b.createdAt.localeCompare(a.createdAt);
const byTitle = (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" });

const COMPARATORS = {
  deadline: [byDeadline, byPriority, byCreated],
  priority: [byPriority, byDeadline, byCreated],
  created: [byCreated],
  title: [byTitle, byCreated],
  manual: [(a, b) => a.order - b.order],
};

/** Views where tasks are ordered by hand by default; date-based views sort by deadline. */
export const defaultSortFor = (view) => (["inbox", "all", "project"].includes(view) ? "manual" : "deadline");

export function sortTasks(tasks, sort = "deadline") {
  const chain = COMPARATORS[sort] ?? COMPARATORS.deadline;
  return tasks.slice().sort((a, b) => {
    for (const cmp of chain) {
      const r = cmp(a, b);
      if (r) return r;
    }
    return 0;
  });
}

export const sortByCompletedDesc = (tasks) =>
  tasks.slice().sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));

/* -------------------------------- Stats ---------------------------------- */

export function computeStats(tasks) {
  const now = new Date();
  const today = toKey(now);
  let completed = 0, inProgress = 0, overdue = 0;
  let dueToday = 0, dueTodayDone = 0;
  for (const t of tasks) {
    if (isDone(t)) completed++;
    else if (t.status === "in_progress") inProgress++;
    if (deadlineState(t, now) === "overdue") overdue++;
    if (t.dueDate === today) {
      dueToday++;
      if (isDone(t)) dueTodayDone++;
    }
  }
  const total = tasks.length;
  return {
    total,
    completed,
    pending: total - completed,
    inProgress,
    overdue,
    completionRate: total ? Math.round((completed / total) * 100) : 0,
    dueToday,
    dueTodayDone,
  };
}

/** Current and best streak of consecutive days with at least one completion. */
export function computeStreak(activity) {
  const today = todayKey();
  // A streak is still alive today if yesterday counted, even before today's first completion.
  let cursor = activity[today] ? today : addDays(today, -1);
  let current = 0;
  while (activity[cursor]) {
    current++;
    cursor = addDays(cursor, -1);
  }
  const keys = Object.keys(activity).sort();
  let best = 0, run = 0, prev = null;
  for (const key of keys) {
    run = prev && diffDays(prev, key) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = key;
  }
  return { current, best, extendedToday: !!activity[today] };
}

/** Completions per day for the last `days` days, oldest first. */
export function recentActivity(activity, days = 7) {
  const today = todayKey();
  return Array.from({ length: days }, (_, i) => {
    const key = addDays(today, i - (days - 1));
    return { key, count: activity[key] ?? 0 };
  });
}

/** All tags in use, with counts, most used first. */
export function tagCounts(tasks) {
  const counts = new Map();
  for (const t of tasks) for (const tag of t.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag, count]) => ({ tag, count }));
}

/** Group tasks by due date key (assumes they all have one), sorted ascending. */
export function groupByDate(tasks) {
  const groups = new Map();
  for (const t of tasks) {
    if (!groups.has(t.dueDate)) groups.set(t.dueDate, []);
    groups.get(t.dueDate).push(t);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b));
}

/* ------------------------- Subtasks & reminders -------------------------- */

/** { done, total, pct } for a task's checklist, or null when it has none. */
export function subtaskProgress(task) {
  const total = task.subtasks?.length ?? 0;
  if (!total) return null;
  const done = task.subtasks.filter((s) => s.done).length;
  return { done, total, pct: Math.round((done / total) * 100) };
}

/** A reminder is pending when it is set, not yet delivered and the task is open. */
export const hasPendingReminder = (task) => !!task.reminderAt && !task.reminderSent && !isDone(task);

export const unreadCount = (notifications) => notifications.filter((n) => !n.read).length;
