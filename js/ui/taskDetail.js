/** Task detail side panel. Stays in sync with the store while open. */
import * as store from "../store.js";
import { html, icon } from "./html.js";
import { openDialog, bindClose } from "./dialog.js";
import { dueBadge, priorityBadge, projectChip, tagChips } from "./taskItem.js";
import { subtaskSection, bindSubtasks } from "./subtasks.js";
import { report } from "./toast.js";
import { STATUSES } from "../core/model.js";
import { formatDateTime, formatLong, formatTime, formatDateTimeShort } from "../core/dates.js";
import { deadlineState, hasPendingReminder } from "../core/selectors.js";
import { describeRecurrence, nextOccurrence } from "../core/recurrence.js";

let current = null; // { id, api, unsubscribe }

function findTask(id) {
  return store.getState().data.tasks.find((t) => t.id === id);
}

function detailContent(task) {
  const { data } = store.getState();
  const project = data.projects.find((p) => p.id === task.projectId);
  const state = deadlineState(task);
  const row = (label, value) => html`<div class="prop"><dt>${label}</dt><dd>${value}</dd></div>`;

  return html`
    <div class="dialog-panel detail">
      <header class="detail-header">
        ${projectChip(project)}
        <div class="detail-header-actions">
          <button type="button" class="icon-btn" data-action="duplicate-task" data-id="${task.id}" aria-label="Duplicate task" title="Duplicate">${icon("content_copy")}</button>
          <button type="button" class="icon-btn danger" data-action="delete-task" data-id="${task.id}" aria-label="Delete task" title="Delete">${icon("delete")}</button>
          <button type="button" class="icon-btn" data-close aria-label="Close details" title="Close">${icon("close")}</button>
        </div>
      </header>

      <div class="detail-body">
        ${state === "overdue" ? html`<div class="notice notice-danger">${icon("error")}This task is overdue.</div>` : ""}
        ${state === "today" ? html`<div class="notice notice-warning">${icon("schedule")}Due today${task.dueTime ? ` at ${formatTime(task.dueTime)}` : ""}.</div>` : ""}
        <h2 class="detail-title ${task.status === "completed" ? "is-done" : ""}">${task.title}</h2>

        <div class="segmented status-picker" role="radiogroup" aria-label="Status">
          ${STATUSES.map((s) => html`
            <button type="button" role="radio" aria-checked="${String(s.id === task.status)}" class="segment-btn ${s.id === task.status ? "is-active" : ""}"
              data-action="set-status" data-id="${task.id}" data-status="${s.id}">${icon(s.icon)}${s.label}</button>`)}
        </div>

        <dl class="props">
          ${row("Priority", priorityBadge(task.priority))}
          ${row("Due", task.dueDate ? html`${dueBadge(task)}<span class="prop-sub">${formatLong(task.dueDate)}</span>` : html`<span class="muted">No due date</span>`)}
          ${row("Repeat", task.recurrence
            ? html`<span class="badge repeat-badge">${icon("repeat")}${describeRecurrence(task.recurrence)}</span>
                <span class="prop-sub">${task.status === "completed" ? "Next occurrence created" : `Next: ${formatLong(nextOccurrence(task.recurrence, task.dueDate))}`}</span>`
            : html`<span class="muted">Does not repeat</span>`)}
          ${row("Reminder", task.reminderAt
            ? html`<span class="badge reminder-badge ${hasPendingReminder(task) ? "" : "is-sent"}">${icon(hasPendingReminder(task) ? "notifications" : "notifications_off")}${formatDateTimeShort(task.reminderAt)}</span>
                ${task.reminderSent ? html`<span class="prop-sub">Delivered</span>` : ""}
                <button type="button" class="link-btn" data-action="clear-reminder" data-id="${task.id}">Remove</button>`
            : html`<span class="muted">No reminder</span>`)}
          ${row("Tags", task.tags.length ? html`<div class="chip-row">${tagChips(task.tags)}</div>` : html`<span class="muted">No tags</span>`)}
          ${row("Created", formatDateTime(task.createdAt))}
          ${task.updatedAt !== task.createdAt ? row("Updated", formatDateTime(task.updatedAt)) : ""}
          ${task.completedAt ? row("Completed", formatDateTime(task.completedAt)) : ""}
        </dl>

        <section class="detail-section">
          <h3 class="section-label">Subtasks</h3>
          ${subtaskSection(task.subtasks, { focusKey: `detail-subtask-${task.id}` })}
        </section>

        <section class="detail-section">
          <h3 class="section-label">Description</h3>
          ${task.description
            ? html`<p class="detail-desc">${task.description}</p>`
            : html`<p class="muted">No description. <button type="button" class="link-btn" data-action="edit-task" data-id="${task.id}">Add one</button></p>`}
        </section>
      </div>

      <footer class="dialog-footer">
        <button type="button" class="btn btn-secondary" data-action="toggle-task" data-id="${task.id}">
          ${icon(task.status === "completed" ? "undo" : "check")}${task.status === "completed" ? "Reopen" : "Mark complete"}
        </button>
        <button type="button" class="btn btn-primary" data-action="edit-task" data-id="${task.id}">${icon("edit")}Edit</button>
      </footer>
    </div>`;
}

export function openTaskDetail(id) {
  const task = findTask(id);
  if (!task) return;
  if (current) {
    if (current.id === id) return;
    current.api.close({ force: true });
  }
  const entry = { id };
  entry.api = openDialog({
    label: `Task: ${task.title}`,
    className: "drawer",
    content: detailContent(task),
    onMount(el, { close }) {
      bindClose(el, close);
      // Subtask changes are saved immediately; the store update re-renders this panel.
      bindSubtasks(el, {
        onAdd: (title) => report(store.addSubtask(id, title)),
        onToggle: (subId) => report(store.toggleSubtask(id, subId)),
        onRename: (subId, title) => report(store.updateSubtask(id, subId, { title })),
        onDelete: (subId) => report(store.deleteSubtask(id, subId)),
        refresh: () => store.refresh(),
      });
    },
    onClose() {
      entry.unsubscribe();
      if (current === entry) current = null;
    },
  });
  entry.unsubscribe = store.subscribe(() => {
    const latest = findTask(id);
    if (!latest) return entry.api.close({ force: true });
    entry.api.update(detailContent(latest));
  });
  current = entry;
}

export function closeTaskDetail() {
  current?.api.close({ force: true });
}
