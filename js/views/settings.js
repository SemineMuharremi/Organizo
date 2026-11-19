/** Settings: appearance, app install and offline status, task defaults, notifications, projects, tags, data management. */
import * as store from "../store.js";
import { html, icon, render, plural } from "../ui/html.js";
import { registerActions } from "../ui/actions.js";
import { toast, report } from "../ui/toast.js";
import { confirmDialog, openDialog, bindClose } from "../ui/dialog.js";
import { colorDot } from "../ui/taskItem.js";
import { tagCounts, isDone } from "../core/selectors.js";
import { PRIORITIES } from "../core/model.js";
import { SCHEMA_VERSION } from "../core/migrations.js";
import { exportJSON, parseBackup, storageUsage } from "../storage.js";
import { todayKey, formatDateTime } from "../core/dates.js";
import { browserPermission, requestBrowserPermission, sendTestNotification } from "../reminders.js";
import { canInstall, isInstalled, isIOS, offlineReady, serviceWorkerSupported } from "../pwa.js";

const THEMES = [
  { id: "light", label: "Light", icon: "light_mode" },
  { id: "dark", label: "Dark", icon: "dark_mode" },
  { id: "system", label: "System", icon: "contrast" },
];

const SHORTCUTS = [
  ["N", "New task"],
  ["/", "Search tasks"],
  ["Ctrl / ⌘ + Enter", "Save task form"],
  ["↑ / ↓ on a drag handle", "Reorder task"],
  ["Esc", "Close dialog or panel"],
];

const PERMISSION_TEXT = {
  granted: "Allowed by your browser.",
  denied: "Blocked in your browser's site settings. In-app notifications are used instead.",
  default: "Your browser will ask for permission when you turn this on.",
  unsupported: "Not supported in this browser. In-app notifications are used instead.",
};

let importing = false;

const status = (ok, text) => html`<span class="setting-status ${ok ? "is-ok" : ""}">${icon(ok ? "check_circle" : "info")}${text}</span>`;

function installRow() {
  if (isInstalled()) return settingRow("Install Organizo", "You're using the installed app.", status(true, "Installed"));
  if (canInstall()) {
    return settingRow("Install Organizo", "Open Organizo in its own window from your desktop, Start menu or home screen, even offline.", html`
      <button type="button" class="btn btn-primary btn-sm" data-action="install-app">${icon("install_desktop")}Install</button>`);
  }
  if (isIOS()) return settingRow("Install Organizo", html`In Safari, tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.`, "");
  return settingRow("Install Organizo",
    "Your browser hasn't offered installation here. In Chrome or Edge, use the install icon in the address bar or the browser menu. Installing needs HTTPS or localhost.", "");
}

function offlineRow() {
  if (offlineReady()) return settingRow("Offline use", "Organizo, its fonts and its icons are saved on this device, so it opens without an internet connection.", status(true, "Ready"));
  if (serviceWorkerSupported()) return settingRow("Offline use", "Saving the app for offline use. This finishes in a moment while you're online.", status(false, "Preparing"));
  return settingRow("Offline use", "Not available in this browser or on this address. Offline use needs HTTPS or localhost.", status(false, "Unavailable"));
}

const settingRow = (title, desc, control) => html`
  <div class="setting-row">
    <div class="setting-text"><p class="setting-title">${title}</p>${desc ? html`<p class="setting-desc">${desc}</p>` : ""}</div>
    <div class="setting-control">${control}</div>
  </div>`;

const toggle = (action, checked, label, { disabled = false } = {}) => html`
  <button type="button" class="switch" role="switch" aria-checked="${String(checked)}" aria-label="${label}"
    data-action="${action}" ${disabled ? "disabled" : ""}><span class="switch-thumb"></span></button>`;

const segmented = (label, action, options, current) => html`
  <div class="segmented" role="radiogroup" aria-label="${label}">
    ${options.map((o) => html`
      <button type="button" role="radio" aria-checked="${String(o.id === current)}" class="segment-btn ${o.id === current ? "is-active" : ""}"
        data-action="${action}" data-value="${o.id}">${o.icon ? icon(o.icon) : ""}${o.label}</button>`)}
  </div>`;

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function renderSettings(el, state) {
  const { tasks, projects, settings, notifications } = state.data;
  const tags = tagCounts(tasks);
  const completed = tasks.filter(isDone).length;
  const permission = browserPermission();
  const browserOn = settings.notifications.browser && permission === "granted";

  render(el, html`
    <header class="page-header">
      <div class="page-heading">
        <h1 class="page-title">${icon("settings", "title-icon")}Settings</h1>
        <p class="page-subtitle">Personalise Organizo and manage your data</p>
      </div>
    </header>

    <div class="settings">
      <section class="card settings-card">
        <h2 class="card-title">Appearance</h2>
        ${settingRow("Theme", "System follows your operating system preference.",
          segmented("Theme", "set-theme", THEMES, settings.theme))}
      </section>

      <section class="card settings-card">
        <h2 class="card-title">App</h2>
        ${installRow()}
        ${offlineRow()}
      </section>

      <section class="card settings-card">
        <h2 class="card-title">Tasks</h2>
        ${settingRow("Default priority", "Used for new tasks and quick add.", html`
          <label class="select-pill">
            <span class="sr-only">Default priority</span>${icon("flag")}
            <select data-change="set-default-priority" data-focus="s-priority">
              ${PRIORITIES.map((p) => html`<option value="${p.id}" ${p.id === settings.defaultPriority ? "selected" : ""}>${p.label}</option>`)}
            </select>
          </label>`)}
        ${settingRow("Start of week", "Affects the calendar and the “This week” filter.",
          segmented("Start of week", "set-week-start", [{ id: 1, label: "Monday" }, { id: 0, label: "Sunday" }], settings.weekStart))}
      </section>

      <section class="card settings-card">
        <h2 class="card-title">Notifications</h2>
        ${settingRow("In-app notifications", "Show a pop-up inside Organizo when a reminder is due.",
          toggle("toggle-inapp-notifications", settings.notifications.inApp, "In-app notifications"))}
        ${settingRow("Browser notifications", PERMISSION_TEXT[permission],
          toggle("toggle-browser-notifications", browserOn, "Browser notifications", { disabled: permission === "unsupported" }))}
        ${settingRow("Test notifications", "Sends a test notification using the settings above.", html`
          <button type="button" class="btn btn-secondary btn-sm" data-action="test-notification">${icon("notifications_active")}Send test</button>`)}
        <div class="notice notice-info">${icon("info")}
          <span>Reminders are checked while Organizo is open in at least one tab, including background tabs. Browsers do not let a
          web page run while it is closed, so a reminder that comes due while Organizo is closed appears as a <strong>missed reminder</strong>
          the next time you open it. If a browser notification can't be shown, an in-app notification is shown instead.
          On iPhone and iPad, browser notifications only work after Organizo is added to the Home Screen.</span>
        </div>
      </section>

      <section class="card settings-card">
        <div class="card-header">
          <h2 class="card-title">Projects</h2>
          <button type="button" class="btn btn-secondary btn-sm" data-action="new-project">${icon("add")}New project</button>
        </div>
        ${projects.length ? html`
          <ul class="manage-list" role="list">
            ${projects.map((p) => {
              const count = tasks.filter((t) => t.projectId === p.id).length;
              return html`
                <li class="manage-item">
                  <a href="#/project/${p.id}" class="manage-name">${colorDot(p.color)}${p.name}</a>
                  <span class="manage-meta">${plural(count, "task")}</span>
                  <button type="button" class="icon-btn sm" data-action="edit-project" data-id="${p.id}" aria-label="Edit ${p.name}">${icon("edit")}</button>
                  <button type="button" class="icon-btn sm danger" data-action="delete-project" data-id="${p.id}" aria-label="Delete ${p.name}">${icon("delete")}</button>
                </li>`;
            })}
          </ul>` : html`<p class="card-empty">${icon("folder")}No projects yet.</p>`}
      </section>

      <section class="card settings-card">
        <h2 class="card-title">Tags</h2>
        ${tags.length ? html`
          <ul class="tag-manage" role="list">
            ${tags.map(({ tag, count }) => html`
              <li class="chip chip-tag removable">#${tag}<span class="chip-count">${count}</span>
                <button type="button" data-action="remove-tag" data-tag="${tag}" aria-label="Remove tag ${tag} from all tasks">${icon("close")}</button></li>`)}
          </ul>` : html`<p class="card-empty">${icon("sell")}Tags you add to tasks will appear here.</p>`}
      </section>

      <section class="card settings-card">
        <h2 class="card-title">Data &amp; backup</h2>
        <div class="notice notice-info">${icon("info")}
          <span>Your data is stored <strong>only in this browser</strong> (localStorage, ${formatBytes(storageUsage())} used).
          It does not sync across devices or browsers, and clearing your browser's site data deletes it. Export a backup regularly.</span>
        </div>
        ${settingRow("Export backup", `Download everything as JSON: ${plural(tasks.length, "task")} with subtasks, ${plural(projects.length, "project")}, ${plural(notifications.length, "notification")}, history and settings.`, html`
          <button type="button" class="btn btn-secondary btn-sm" data-action="export-data">${icon("download")}Export</button>`)}
        ${settingRow("Restore from backup", "Choose a backup file. You'll see a summary and confirm before anything is replaced.", html`
          <label class="btn btn-secondary btn-sm file-btn ${importing ? "is-loading" : ""}">
            ${importing ? html`<span class="spinner" aria-hidden="true"></span>Reading file…` : html`${icon("upload")}Import`}
            <input type="file" accept="application/json,.json" data-change="import-data" class="sr-only" ${importing ? "disabled" : ""}>
          </label>`)}
        ${settingRow("Clear completed tasks", completed ? `Permanently delete ${plural(completed, "completed task")}.` : "There are no completed tasks.", html`
          <button type="button" class="btn btn-secondary btn-sm" data-action="clear-completed" ${completed ? "" : "disabled"}>${icon("delete_sweep")}Clear</button>`)}
        ${settingRow("Reset all data", "Delete all tasks, projects, notifications, history and settings.", html`
          <button type="button" class="btn btn-danger btn-sm" data-action="reset-all">${icon("restart_alt")}Reset</button>`)}
      </section>

      <section class="card settings-card">
        <h2 class="card-title">Keyboard shortcuts</h2>
        <ul class="shortcut-list" role="list">
          ${SHORTCUTS.map(([keys, label]) => html`<li><span>${label}</span><kbd>${keys}</kbd></li>`)}
        </ul>
      </section>
    </div>
  `);
}

/* ------------------------------- Import flow ------------------------------ */

/** Show what a validated backup contains and resolve true if the user confirms the replacement. */
function confirmImport(file, backup) {
  const { data, issues, version, exportedAt } = backup;
  const current = store.getState().data;
  const subtaskCount = data.tasks.reduce((n, t) => n + t.subtasks.length, 0);
  const stat = (label, value) => html`<div class="import-stat"><span>${value}</span><small>${label}</small></div>`;

  return new Promise((resolve) => {
    let confirmed = false;
    openDialog({
      label: "Restore backup",
      className: "modal",
      content: html`
        <div class="dialog-panel">
          <div class="confirm-body">
            <div class="confirm-icon">${icon("settings_backup_restore")}</div>
            <div class="import-summary">
              <h2 class="dialog-title">Restore this backup?</h2>
              <p class="confirm-message">${file.name}${exportedAt ? ` · exported ${formatDateTime(exportedAt)}` : ""}</p>
              <div class="import-stats">
                ${stat("tasks", data.tasks.length)}
                ${stat("subtasks", subtaskCount)}
                ${stat("projects", data.projects.length)}
                ${stat("notifications", data.notifications.length)}
              </div>
              ${version < SCHEMA_VERSION ? html`<div class="notice notice-info">${icon("upgrade")}This backup uses an older format (v${version}) and will be upgraded automatically.</div>` : ""}
              ${issues.length ? html`<div class="notice notice-warning">${icon("warning")}<span>${issues.join(" ")}</span></div>` : ""}
              <div class="notice notice-danger">${icon("error")}
                <span>Your current data (${plural(current.tasks.length, "task")}, ${plural(current.projects.length, "project")}) will be replaced. You can undo right after importing.</span>
              </div>
            </div>
          </div>
          <footer class="dialog-footer">
            <button type="button" class="btn btn-ghost" data-close>Cancel</button>
            <button type="button" class="btn btn-danger" data-confirm>Replace my data</button>
          </footer>
        </div>`,
      onMount(el, { close }) {
        bindClose(el, close);
        el.querySelector("[data-confirm]").addEventListener("click", () => { confirmed = true; close(); });
        el.querySelector("[data-confirm]").focus();
      },
      onClose: () => resolve(confirmed),
    });
  });
}

function offerUndo(message, previous) {
  toast(message, {
    duration: 10_000,
    action: { label: "Undo", onClick: () => report(store.replaceData(previous), "Previous data restored") },
  });
}

registerActions({
  "set-theme": (el) => report(store.setTheme(el.dataset.value)),
  "set-week-start": (el) => report(store.updateSettings({ weekStart: Number(el.dataset.value) }), "Start of week updated"),
  "set-default-priority": (el) => report(store.updateSettings({ defaultPriority: el.value }), "Default priority updated"),
  "toggle-inapp-notifications": () => {
    const on = !store.getState().data.settings.notifications.inApp;
    report(store.updateSettings({ notifications: { inApp: on } }), on ? "In-app notifications on" : "In-app notifications off");
  },
  "toggle-browser-notifications": async () => {
    const { settings } = store.getState().data;
    if (settings.notifications.browser && browserPermission() === "granted") {
      return report(store.updateSettings({ notifications: { browser: false } }), "Browser notifications off");
    }
    const permission = await requestBrowserPermission();
    if (permission === "granted") {
      report(store.updateSettings({ notifications: { browser: true } }), "Browser notifications on");
    } else {
      store.updateSettings({ notifications: { browser: false } });
      toast(permission === "denied"
        ? "Notifications are blocked for this site in your browser settings. In-app notifications will be used."
        : "Browser notifications are not available. In-app notifications will be used.", { type: "error" });
    }
  },
  "test-notification": () => report(sendTestNotification()),
  "remove-tag": async (el) => {
    const tag = el.dataset.tag;
    const ok = await confirmDialog({
      title: `Remove #${tag}?`, message: "The tag will be removed from every task. The tasks themselves are kept.", confirmLabel: "Remove tag", danger: true,
    });
    if (ok) report(store.removeTag(tag), `Removed #${tag}`);
  },
  "export-data": () => {
    try {
      const blob = new Blob([exportJSON(store.getState().data)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: `organizo-backup-${todayKey()}.json` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("Backup downloaded");
    } catch {
      toast("The backup could not be created.", { type: "error" });
    }
  },
  "import-data": async (input) => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    importing = true;
    store.refresh();
    let backup;
    try {
      backup = parseBackup(await file.text());
    } catch (err) {
      toast(err.message || "The file could not be read.", { type: "error" });
      return;
    } finally {
      importing = false;
      store.refresh();
    }
    if (!(await confirmImport(file, backup))) return;
    const result = store.replaceData(backup.data);
    if (report(result)) offerUndo("Backup restored", result.previous);
  },
  "reset-all": async () => {
    const ok = await confirmDialog({
      title: "Reset all data?",
      message: "All tasks, subtasks, projects, notifications, completion history and settings will be deleted. Export a backup first if you might need them.",
      confirmLabel: "Reset everything", danger: true,
    });
    if (!ok) return;
    const result = store.resetAll();
    if (report(result)) offerUndo("All data was reset", result.previous);
  },
});
