/** Presentational building blocks for tasks: badges, rows and lists. */
import { html, icon } from "./html.js";
import { priorityById, statusById, colorById } from "../core/model.js";
import { deadlineState, isDone, subtaskProgress, hasPendingReminder } from "../core/selectors.js";
import { formatRelative, formatTime, diffDays, todayKey, formatDateTimeShort } from "../core/dates.js";
import { describeRecurrence } from "../core/recurrence.js";

export function subtaskBadge(task) {
  const p = subtaskProgress(task);
  if (!p) return "";
  return html`<span class="badge subtask-badge ${p.done === p.total ? "is-complete" : ""}" title="${p.done} of ${p.total} subtasks completed">${icon("checklist")}${p.done}/${p.total}</span>`;
}

export function repeatBadge(task) {
  if (!task.recurrence) return "";
  const label = describeRecurrence(task.recurrence);
  return html`<span class="badge repeat-badge" title="Repeats: ${label}">${icon("repeat")}${label}</span>`;
}

export function reminderBadge(task) {
  if (!hasPendingReminder(task)) return "";
  return html`<span class="badge reminder-badge" title="Reminder: ${formatDateTimeShort(task.reminderAt)}">${icon("notifications")}${formatDateTimeShort(task.reminderAt)}</span>`;
}

const DEADLINE_ICONS = { overdue: "error", today: "today", soon: "schedule", later: "calendar_today" };

export function dueBadge(task, { withTime = true } = {}) {
  if (!task.dueDate) return "";
  const state = deadlineState(task) ?? "done";
  let label = formatRelative(task.dueDate);
  if (state === "overdue" && task.dueDate < todayKey()) {
    const days = diffDays(task.dueDate, todayKey());
    label = days === 1 ? "Yesterday" : `${days} days overdue`;
  }
  if (withTime && task.dueTime) label += ` · ${formatTime(task.dueTime)}`;
  const title = state === "overdue" ? "Overdue" : state === "today" ? "Due today" : state === "soon" ? "Due tomorrow" : "Due date";
  return html`<span class="badge due due-${state}" title="${title}">${icon(DEADLINE_ICONS[state] ?? "event")}${label}</span>`;
}

export function priorityBadge(priority, { quiet = false } = {}) {
  const p = priorityById[priority];
  if (quiet && (priority === "low" || priority === "medium")) return "";
  return html`<span class="badge prio prio-${p.id}" title="${p.label} priority">${icon("flag")}${p.label}</span>`;
}

export function statusBadge(status) {
  const s = statusById[status];
  return html`<span class="badge status status-${s.id}">${icon(s.icon)}${s.label}</span>`;
}

export const colorDot = (colorId, extra = "") =>
  html`<span class="dot ${extra}" style="--dot:${colorById[colorId]?.value ?? "#64748b"}" aria-hidden="true"></span>`;

export function projectChip(project) {
  if (!project) return html`<span class="chip chip-project">${icon("inbox")}Inbox</span>`;
  return html`<span class="chip chip-project">${colorDot(project.color)}${project.name}</span>`;
}

export const tagChips = (tags) => tags.map((t) => html`<span class="chip chip-tag">#${t}</span>`);

/**
 * A single task row.
 * @param {object} task
 * @param {object} ctx { projectsById, showProject, showDate, compact }
 */
export function taskRow(task, { projectsById = {}, showProject = true, showDate = true, compact = false, draggable = false } = {}) {
  const done = isDone(task);
  const project = projectsById[task.projectId];
  const state = deadlineState(task);
  const firstLine = task.description.split("\n").find((l) => l.trim()) ?? "";
  const meta = [
    showDate ? dueBadge(task) : "",
    task.status === "in_progress" ? statusBadge("in_progress") : "",
    subtaskBadge(task),
    repeatBadge(task),
    compact ? "" : reminderBadge(task),
    priorityBadge(task.priority, { quiet: true }),
    ...tagChips(compact ? task.tags.slice(0, 2) : task.tags),
    showProject ? projectChip(project) : "",
  ].filter(Boolean);

  return html`
    <li class="task-row ${done ? "is-done" : ""} ${state === "overdue" ? "is-overdue" : ""} ${compact ? "is-compact" : ""} ${draggable ? "is-draggable" : ""}" data-task-id="${task.id}">
      ${draggable ? html`<button type="button" class="drag-handle" data-drag-handle data-focus="drag-${task.id}"
        aria-label="Reorder ${task.title}. Use the arrow keys to move up or down." title="Drag to reorder">${icon("drag_indicator")}</button>` : ""}
      <button type="button" class="task-check prio-${task.priority}" data-action="toggle-task" data-id="${task.id}"
        role="checkbox" aria-checked="${String(done)}" aria-label="${done ? "Mark as not completed" : "Complete"}: ${task.title}">
        ${icon("check")}
      </button>
      <div class="task-main">
        <button type="button" class="task-title" data-action="open-task" data-id="${task.id}">${task.title}</button>
        ${!compact && firstLine ? html`<p class="task-desc">${firstLine}</p>` : ""}
        ${meta.length ? html`<div class="task-meta">${meta}</div>` : ""}
      </div>
      ${compact ? "" : html`
      <div class="task-actions">
        <button type="button" class="icon-btn sm" data-action="edit-task" data-id="${task.id}" aria-label="Edit task" title="Edit">${icon("edit")}</button>
        <button type="button" class="icon-btn sm" data-action="duplicate-task" data-id="${task.id}" aria-label="Duplicate task" title="Duplicate">${icon("content_copy")}</button>
        <button type="button" class="icon-btn sm danger" data-action="delete-task" data-id="${task.id}" aria-label="Delete task" title="Delete">${icon("delete")}</button>
      </div>`}
    </li>`;
}

export const taskList = (tasks, ctx) => html`<ul class="task-list" role="list">${tasks.map((t) => taskRow(t, ctx))}</ul>`;

/** Illustrated empty state with an optional call to action. */
export function emptyState({ iconName = "task_alt", title, hint, action }) {
  return html`
    <div class="empty-state">
      <div class="empty-icon">${icon(iconName)}</div>
      <p class="empty-title">${title}</p>
      ${hint ? html`<p class="empty-hint">${hint}</p>` : ""}
      ${action ?? ""}
    </div>`;
}
