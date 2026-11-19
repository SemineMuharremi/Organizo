/**
 * Reminder scheduler and notification delivery.
 *
 * How it works:
 * - A timer is armed for the earliest pending reminder (re-armed at least every
 *   60 s and whenever data changes), plus an immediate check when the tab
 *   becomes visible again, which catches up after sleep or throttling.
 * - `store.fireDueReminders` marks each reminder as sent in the same save that
 *   records its notification, so a reminder fires exactly once, even across
 *   reloads. Reminders that came due while the app was closed fire on the next
 *   launch, labelled as missed.
 * - With several tabs open, a Web Lock elects one tab to deliver reminders so
 *   they are not shown twice. Other tabs still see the notification center
 *   update through storage sync.
 *
 * - Browser notifications go through the service worker when one is active
 *   (required on some mobile browsers), otherwise through the page-level API.
 *
 * Limitation (browser platform, not this app): without a server and push
 * service, nothing runs while the app is closed, so reminders are delivered
 * only while at least one Organizo tab or app window is open.
 */
import * as store from "./store.js";
import { toast } from "./ui/toast.js";
import { openTaskDetail } from "./ui/taskDetail.js";
import { serviceWorkerRegistration, onNotificationClick } from "./pwa.js";

const MAX_INDIVIDUAL = 3;
let timer = null;
let notificationCenterOpener = () => {};

/** "granted" | "denied" | "default" | "unsupported" */
export function browserPermission() {
  return "Notification" in window ? Notification.permission : "unsupported";
}

export async function requestBrowserPermission() {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** Mark a notification read and open its task (from a pop-up, a browser notification or a launch link). */
export function openFromNotification({ notificationId, taskId }) {
  if (notificationId) store.setNotificationRead(notificationId, true);
  if (taskId && store.getState().data.tasks.some((t) => t.id === taskId)) openTaskDetail(taskId);
}

/**
 * Show one browser notification. Prefers the service worker, which is the only
 * way on some mobile browsers and keeps working when the tab is in the
 * background; falls back to the page-level Notification API.
 * Resolves true if the browser accepted the notification.
 */
async function showBrowserNotification(n) {
  const options = { body: n.message, tag: n.id, icon: "assets/icons/icon-192.png", data: { notificationId: n.id, taskId: n.taskId ?? null } };
  const registration = await serviceWorkerRegistration();
  if (registration) {
    try {
      await registration.showNotification(n.title, options);
      return true; // clicks arrive through the service worker (see js/pwa.js)
    } catch { /* fall through to the page-level API */ }
  }
  try {
    const note = new Notification(n.title, options);
    note.addEventListener("click", () => {
      window.focus();
      openFromNotification({ notificationId: n.id, taskId: n.taskId });
      note.close();
    });
    return true;
  } catch {
    return false; // e.g. mobile browsers that only allow notifications from a service worker
  }
}

function showInApp(notifications) {
  if (notifications.length > MAX_INDIVIDUAL) {
    toast(`${notifications.length} reminders are due`, {
      type: "reminder", duration: 10_000,
      action: { label: "View", onClick: () => notificationCenterOpener() },
    });
    return;
  }
  for (const n of notifications) {
    const task = n.taskId && store.getState().data.tasks.find((t) => t.id === n.taskId);
    toast(n.type === "reminder" ? `Reminder: ${n.title}` : n.title, {
      type: n.type === "reminder" ? "reminder" : "info",
      duration: 10_000,
      actions: task ? [
        { label: "Open", onClick: () => openFromNotification({ notificationId: n.id, taskId: task.id }) },
        { label: "Snooze 10m", onClick: () => { store.setNotificationRead(n.id, true); store.snoozeReminder(task.id, 10); } },
      ] : [],
    });
  }
}

/**
 * Deliver notifications using the user's preferences. Browser notifications
 * are used when enabled and permitted; in-app toasts are shown when enabled or
 * as a fallback whenever the browser channel is unavailable.
 */
export async function deliver(notifications) {
  if (!notifications.length) return;
  const prefs = store.getState().data.settings.notifications;
  const useBrowser = prefs.browser && browserPermission() === "granted";
  if (prefs.inApp || !useBrowser) showInApp(notifications);
  if (!useBrowser) return;
  const results = await Promise.all(notifications.slice(0, MAX_INDIVIDUAL).map(showBrowserNotification));
  if (!prefs.inApp && !results.every(Boolean)) showInApp(notifications);
}

function check() {
  deliver(store.fireDueReminders());
  schedule();
}

function schedule() {
  clearTimeout(timer);
  const next = store.nextReminderTime();
  const delay = next === null ? 60_000 : Math.min(Math.max(next - Date.now(), 250), 60_000);
  timer = setTimeout(check, delay);
}

/** Create a real notification entry and deliver it, so users can verify their settings. */
export function sendTestNotification() {
  const result = store.addNotification({ type: "info", title: "Test notification", message: "Notifications are working." });
  if (result.ok) deliver([result.notification]);
  return result;
}

export function startReminders({ openNotificationCenter } = {}) {
  if (openNotificationCenter) notificationCenterOpener = openNotificationCenter;
  onNotificationClick(openFromNotification);
  const run = () => {
    check();
    store.subscribe(schedule);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
  };
  if (navigator.locks?.request) {
    // Held until the tab closes; the next tab in line then takes over.
    navigator.locks.request("organizo-reminders", () => { run(); return new Promise(() => {}); }).catch(run);
  } else {
    run();
  }
}
