/**
 * Task commands shared by every view (rows, detail panel, calendar...).
 * Registered once as delegated actions.
 */
import * as store from "../store.js";
import { registerActions } from "./actions.js";
import { toast, report } from "./toast.js";
import { confirmDialog } from "./dialog.js";
import { openTaskForm } from "./taskForm.js";
import { openTaskDetail } from "./taskDetail.js";
import { formatRelative } from "../core/dates.js";

const findTask = (id) => store.getState().data.tasks.find((t) => t.id === id);
const COMPLETE_ANIMATION_MS = 220;

export function toggleTask(id, sourceEl) {
  const task = findTask(id);
  if (!task) return;
  const completing = task.status !== "completed";
  const run = () => {
    const result = store.toggleTask(id);
    if (!report(result)) return;
    if (completing) {
      const next = result.spawnedId && findTask(result.spawnedId);
      const message = next ? `Task completed. Next one is due ${formatRelative(next.dueDate)}.` : "Task completed";
      toast(message, { action: { label: "Undo", onClick: () => report(store.toggleTask(id)) } });
    }
  };
  // Let the check animation play before the row moves or disappears.
  const row = sourceEl?.closest(".task-row");
  if (completing && row && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    row.classList.add("is-checking");
    setTimeout(run, COMPLETE_ANIMATION_MS);
  } else run();
}

export async function deleteTask(id) {
  const task = findTask(id);
  if (!task) return;
  const confirmed = await confirmDialog({
    title: "Delete task?",
    message: `“${task.title}” will be permanently deleted.`,
    confirmLabel: "Delete",
    danger: true,
  });
  if (!confirmed) return;
  const result = store.deleteTask(id);
  if (!report(result)) return;
  toast("Task deleted", {
    action: { label: "Undo", onClick: () => report(store.restoreTask(result.task), "Task restored") },
  });
}

export function duplicateTask(id) {
  const result = store.duplicateTask(id);
  if (report(result, "Task duplicated", { action: { label: "Open", onClick: () => openTaskDetail(result.task.id) } })) {
    return result.task;
  }
}

registerActions({
  "toggle-task": (el) => toggleTask(el.dataset.id, el),
  "open-task": (el) => openTaskDetail(el.dataset.id),
  "edit-task": (el) => {
    const task = findTask(el.dataset.id);
    if (task) openTaskForm({ task });
  },
  "duplicate-task": (el) => duplicateTask(el.dataset.id),
  "delete-task": (el) => deleteTask(el.dataset.id),
  "clear-reminder": (el) => report(store.clearReminder(el.dataset.id), "Reminder removed"),
  "set-status": (el) => {
    const result = store.setTaskStatus(el.dataset.id, el.dataset.status);
    const next = result.spawnedId && findTask(result.spawnedId);
    report(result, next ? `Next occurrence created for ${formatRelative(next.dueDate)}` : undefined);
  },
  "new-task": (el) => openTaskForm({
    defaults: { dueDate: el.dataset.date || undefined, projectId: el.dataset.project || undefined },
  }),
});
