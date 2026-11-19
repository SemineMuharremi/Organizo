/** Notification center: bell with unread badge and a popover list. */
import * as store from "../store.js";
import { html, icon, render } from "./html.js";
import { registerActions } from "./actions.js";
import { report, toast } from "./toast.js";
import { openTaskDetail } from "./taskDetail.js";
import { unreadCount, isDone } from "../core/selectors.js";
import { formatAgo } from "../core/dates.js";

let open = false;
const button = () => document.querySelector("[data-action=toggle-notifications]");
const panel = () => document.getElementById("notif-panel");

function panelContent({ notifications, tasks }) {
  const unread = unreadCount(notifications);
  return html`
    <div class="notif-header">
      <div>
        <h2 class="notif-title">Notifications</h2>
        <p class="notif-sub">${unread ? `${unread} unread` : "All caught up"}</p>
      </div>
      <div class="notif-header-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-action="read-all-notifications" ${unread ? "" : "disabled"}>${icon("done_all")}Mark all read</button>
        ${notifications.length ? html`<button type="button" class="icon-btn sm" data-action="clear-notifications" aria-label="Clear all notifications" title="Clear all">${icon("delete_sweep")}</button>` : ""}
      </div>
    </div>
    ${notifications.length ? html`
      <ul class="notif-list" role="list">
        ${notifications.map((n) => {
          const task = n.taskId ? tasks.find((t) => t.id === n.taskId) : null;
          const canSnooze = n.type === "reminder" && task && !isDone(task);
          return html`
            <li class="notif-item ${n.read ? "" : "is-unread"}">
              <span class="notif-icon ${n.type}">${icon(n.type === "reminder" ? "alarm" : "info")}</span>
              <button type="button" class="notif-main" data-action="open-notification" data-id="${n.id}">
                <span class="notif-item-title">${n.title}</span>
                <span class="notif-item-msg">${n.message}</span>
                <span class="notif-time">${formatAgo(n.createdAt)}</span>
              </button>
              <div class="notif-item-actions">
                ${canSnooze ? html`<button type="button" class="icon-btn xs" data-action="snooze-from-notification" data-id="${n.id}" aria-label="Snooze 10 minutes" title="Snooze 10 min">${icon("snooze")}</button>` : ""}
                <button type="button" class="icon-btn xs" data-action="toggle-notification-read" data-id="${n.id}"
                  aria-label="${n.read ? "Mark as unread" : "Mark as read"}" title="${n.read ? "Mark as unread" : "Mark as read"}">${icon(n.read ? "mark_email_unread" : "mark_email_read")}</button>
                <button type="button" class="icon-btn xs danger" data-action="delete-notification" data-id="${n.id}" aria-label="Delete notification" title="Delete">${icon("close")}</button>
              </div>
              ${n.read ? "" : html`<span class="unread-dot" aria-label="Unread"></span>`}
            </li>`;
        })}
      </ul>` : html`
      <div class="notif-empty">
        <span class="empty-icon">${icon("notifications_off")}</span>
        <p class="empty-title">No notifications</p>
        <p class="empty-hint">Add a reminder to a task and it will show up here when it is due.</p>
      </div>`}
    <a href="#/settings" class="notif-footer">${icon("tune")}Notification settings</a>`;
}

/** Update the bell badge and, if open, the panel. Called on every app render. */
export function renderNotificationCenter(state) {
  const count = unreadCount(state.data.notifications);
  const btn = button();
  if (btn) {
    const badge = btn.querySelector(".notif-badge");
    badge.hidden = count === 0;
    badge.textContent = count > 99 ? "99+" : String(count);
    btn.setAttribute("aria-label", count ? `Notifications, ${count} unread` : "Notifications");
    btn.setAttribute("aria-expanded", String(open));
  }
  const p = panel();
  if (p) {
    p.hidden = !open;
    if (open) render(p, panelContent(state.data));
  }
}

export function openNotificationCenter() {
  open = true;
  renderNotificationCenter(store.getState());
  panel()?.querySelector("button:not([disabled]), a")?.focus();
}

export function closeNotificationCenter({ restoreFocus = false } = {}) {
  if (!open) return;
  open = false;
  renderNotificationCenter(store.getState());
  if (restoreFocus) button()?.focus();
}

document.addEventListener("pointerdown", (e) => {
  if (open && !e.target.closest(".notif-anchor") && !e.target.closest(".toast") && !e.target.closest("dialog")) closeNotificationCenter();
});
document.addEventListener("keydown", (e) => {
  if (open && e.key === "Escape" && !document.querySelector("dialog[open]")) closeNotificationCenter({ restoreFocus: true });
});

const findNotification = (id) => store.getState().data.notifications.find((n) => n.id === id);

registerActions({
  "toggle-notifications": () => (open ? closeNotificationCenter() : openNotificationCenter()),
  "read-all-notifications": () => report(store.markAllNotificationsRead()),
  "clear-notifications": () => report(store.clearNotifications(), "Notifications cleared"),
  "toggle-notification-read": (el) => {
    const n = findNotification(el.dataset.id);
    if (n) report(store.setNotificationRead(n.id, !n.read));
  },
  "delete-notification": (el) => report(store.deleteNotification(el.dataset.id)),
  "open-notification": (el) => {
    const n = findNotification(el.dataset.id);
    if (!n) return;
    store.setNotificationRead(n.id, true);
    if (!n.taskId) return;
    if (!store.getState().data.tasks.some((t) => t.id === n.taskId)) return toast("That task no longer exists.", { type: "info" });
    closeNotificationCenter();
    openTaskDetail(n.taskId);
  },
  "snooze-from-notification": (el) => {
    const n = findNotification(el.dataset.id);
    if (!n?.taskId) return;
    store.setNotificationRead(n.id, true);
    report(store.snoozeReminder(n.taskId, 10), "Snoozed for 10 minutes");
  },
});
