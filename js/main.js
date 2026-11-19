/**
 * Entry point: wires the store, router, views and global interactions together.
 */
import * as store from "./store.js";
import { parseRoute, onRouteChange, navigate, currentRoute } from "./router.js";
import { initActions, registerActions } from "./ui/actions.js";
import { toast, report } from "./ui/toast.js";
import { renderSidebar, closeSidebar } from "./ui/sidebar.js";
import { openTaskForm } from "./ui/taskForm.js";
import { closeTaskDetail } from "./ui/taskDetail.js";
import { onExternalChange } from "./storage.js";
import { VIEWS, defaultSortFor } from "./core/selectors.js";
import { renderNotificationCenter, openNotificationCenter, closeNotificationCenter } from "./ui/notificationCenter.js";
import { initDragSort } from "./ui/dragSort.js";
import { startReminders } from "./reminders.js";
import { initPwa, onPwaChange, handleLaunchParams, promptInstall } from "./pwa.js";
import { renderDashboard } from "./views/dashboard.js";
import { renderListView, defaultsForRoute } from "./views/list.js";
import { renderCalendar } from "./views/calendar.js";
import { renderSettings } from "./views/settings.js";
import "./ui/taskCommands.js";
import "./ui/projectCommands.js";

const sidebarEl = document.getElementById("sidebar");
const viewEl = document.getElementById("view");
const searchEl = document.getElementById("search");
const themeBtn = document.querySelector("[data-action=toggle-theme]");

const RENDERERS = {
  dashboard: renderDashboard,
  calendar: renderCalendar,
  settings: renderSettings,
};
const SEARCHABLE = new Set(["inbox", "today", "upcoming", "all", "completed", "project"]);

let route = parseRoute();
let pendingFilters = null;
let renderDeferred = false;

/* ---------------------------------- Theme -------------------------------- */

const darkQuery = matchMedia("(prefers-color-scheme: dark)");

function applyTheme() {
  const pref = store.getState().data.settings.theme;
  const resolved = pref === "system" ? (darkQuery.matches ? "dark" : "light") : pref;
  document.documentElement.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolved === "dark" ? "#111113" : "#f7f7f8");
  if (themeBtn) {
    themeBtn.querySelector(".icon").textContent = resolved === "dark" ? "light_mode" : "dark_mode";
    themeBtn.setAttribute("aria-label", `Switch to ${resolved === "dark" ? "light" : "dark"} mode`);
    themeBtn.title = themeBtn.getAttribute("aria-label");
  }
}
darkQuery.addEventListener("change", applyTheme);

/* --------------------------------- Render -------------------------------- */

function pageTitle(state) {
  if (route.name === "project") return state.data.projects.find((p) => p.id === route.param)?.name ?? "Project";
  if (route.name === "dashboard") return "Dashboard";
  if (route.name === "calendar") return "Calendar";
  if (route.name === "settings") return "Settings";
  return VIEWS[route.name]?.title ?? "Organizo";
}

function renderApp() {
  // Never replace the DOM under an active drag; render once it ends.
  if (document.body.classList.contains("is-dragging")) { renderDeferred = true; return; }
  renderDeferred = false;
  const state = store.getState();
  applyTheme();
  renderSidebar(sidebarEl, state, route);
  const renderer = RENDERERS[route.name] ?? renderListView;
  try {
    renderer(viewEl, state, route);
  } catch (err) {
    console.error(err);
    viewEl.innerHTML = `<div class="empty-state"><p class="empty-title">Something went wrong</p>
      <p class="empty-hint">This view could not be displayed. Try reloading the page.</p></div>`;
  }
  renderNotificationCenter(state);
  if (searchEl.value !== state.ui.query) searchEl.value = state.ui.query;
  document.title = `${pageTitle(state)} · Organizo`;
}

store.subscribe(renderApp);
document.addEventListener("dragsort:end", () => { if (renderDeferred) renderApp(); });

onRouteChange((next) => {
  route = next;
  closeSidebar();
  closeTaskDetail();
  closeNotificationCenter();
  store.resetFilters({ sort: defaultSortFor(route.name) });
  if (pendingFilters) {
    store.setFilters(pendingFilters);
    pendingFilters = null;
  }
  if (!SEARCHABLE.has(route.name) && store.getState().ui.query) store.setQuery("");
  renderApp();
  window.scrollTo({ top: 0 });
  viewEl.focus({ preventScroll: true });
});

/* --------------------------------- Search -------------------------------- */

searchEl.addEventListener("input", () => {
  store.setQuery(searchEl.value);
  // Searching from a non-list page jumps to All Tasks with the query applied.
  if (searchEl.value.trim() && !SEARCHABLE.has(route.name)) navigate("all");
});
searchEl.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    store.setQuery("");
    searchEl.blur();
  }
});

/* ------------------------------ Global actions --------------------------- */

registerActions({
  "new-task-contextual": () => openTaskForm({ defaults: defaultsForRoute(currentRoute()) }),
  "toggle-theme": () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    report(store.setTheme(next));
  },
  "install-app": async () => {
    const outcome = await promptInstall();
    if (outcome === "accepted") toast("Organizo was installed", { type: "success" });
    else if (outcome === "unavailable") toast("Use your browser's menu to install Organizo.", { type: "info" });
  },
  "open-filtered": (el) => {
    pendingFilters = el.dataset.filters ? JSON.parse(el.dataset.filters) : null;
    navigate(el.dataset.route);
  },
});

/* ---------------------------- Keyboard shortcuts ------------------------- */

document.addEventListener("keydown", (e) => {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
  const target = e.target;
  const typing = target.closest("input, textarea, select, [contenteditable=true]");
  const dialogOpen = document.querySelector("dialog[open]");
  if (e.key === "Escape" && document.body.classList.contains("sidebar-open")) return closeSidebar();
  if (typing || dialogOpen) return;
  if (e.key === "n" || e.key === "N") {
    e.preventDefault();
    openTaskForm({ defaults: defaultsForRoute(currentRoute()) });
  } else if (e.key === "/") {
    e.preventDefault();
    searchEl.focus();
  }
});

/* --------------------------------- Startup ------------------------------- */

initActions();
initDragSort();
initPwa({
  onOffline: () => toast("You're offline. Organizo keeps working and saves your changes on this device.", { type: "info", duration: 6000 }),
});
onPwaChange(() => store.refresh());
onExternalChange(() => store.reloadFromStorage());

// Deadlines are time-based ("overdue" after 17:00, "Today" after midnight), so
// re-render periodically. Skip while the user is interacting with a control.
setInterval(() => {
  const active = document.activeElement;
  if (document.hidden || document.querySelector("dialog[open]") || active?.matches("select, input, textarea")) return;
  store.refresh();
}, 60_000);
store.resetFilters({ sort: defaultSortFor(route.name) }); // also performs the first render
document.body.classList.remove("is-loading");
startReminders({ openNotificationCenter });
handleLaunchParams({ newTask: () => openTaskForm({ defaults: defaultsForRoute(currentRoute()) }) });
if (store.startupWarning) toast(store.startupWarning, { type: "error", duration: 10000 });
