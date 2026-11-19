/** Sidebar navigation with live counts, projects and today's progress. */
import { html, icon, render } from "./html.js";
import { colorDot } from "./taskItem.js";
import { tasksForView, computeStats, isDone } from "../core/selectors.js";
import { registerActions } from "./actions.js";
import { canInstall } from "../pwa.js";

const NAV = [
  { route: "dashboard", label: "Dashboard", icon: "space_dashboard" },
  { route: "inbox", label: "Inbox", icon: "inbox", count: true },
  { route: "today", label: "Today", icon: "today", count: true },
  { route: "upcoming", label: "Upcoming", icon: "event_upcoming", count: true },
  { route: "calendar", label: "Calendar", icon: "calendar_month" },
];
const LIBRARY = [
  { route: "all", label: "All Tasks", icon: "stacks" },
  { route: "completed", label: "Completed", icon: "task_alt" },
];

const navItem = (item, active, count) => html`
  <a href="#/${item.route}" class="nav-item ${active ? "is-active" : ""}" ${active ? html`aria-current="page"` : ""}>
    ${icon(item.icon)}<span class="nav-label">${item.label}</span>
    ${count ? html`<span class="nav-count">${count}</span>` : ""}
  </a>`;

export function renderSidebar(el, state, route) {
  const { tasks, projects } = state.data;
  const stats = computeStats(tasks);
  const isActive = (name, param = null) => route.name === name && (param === null || route.param === param);
  const todayPct = stats.dueToday ? Math.round((stats.dueTodayDone / stats.dueToday) * 100) : 0;

  render(el, html`
    <div class="sidebar-inner">
      <div class="brand">
        <span class="brand-mark">${icon("network_node")}</span>
        <span class="brand-name">Organizo</span>
        <button type="button" class="icon-btn sidebar-close" data-action="close-sidebar" aria-label="Close menu">${icon("close")}</button>
      </div>

      <nav class="nav" aria-label="Main">
        ${NAV.map((item) => navItem(item, isActive(item.route), item.count ? tasksForView(tasks, item.route).length : 0))}
        <div class="nav-divider"></div>
        ${LIBRARY.map((item) => navItem(item, isActive(item.route)))}
      </nav>

      <div class="nav-section">
        <div class="nav-section-header">
          <span>Projects</span>
          <button type="button" class="icon-btn xs" data-action="new-project" aria-label="New project" title="New project">${icon("add")}</button>
        </div>
        <nav class="nav" aria-label="Projects">
          ${projects.length
            ? projects.map((p) => {
                const open = tasks.filter((t) => t.projectId === p.id && !isDone(t)).length;
                const active = isActive("project", p.id);
                return html`
                  <a href="#/project/${p.id}" class="nav-item ${active ? "is-active" : ""}" ${active ? html`aria-current="page"` : ""}>
                    <span class="nav-dot">${colorDot(p.color)}</span><span class="nav-label">${p.name}</span>
                    ${open ? html`<span class="nav-count">${open}</span>` : ""}
                  </a>`;
              })
            : html`<button type="button" class="nav-item nav-empty" data-action="new-project">${icon("add")}<span class="nav-label">Create a project</span></button>`}
        </nav>
      </div>

      <div class="sidebar-footer">
        ${stats.dueToday ? html`
          <a href="#/today" class="mini-progress" title="Today's progress">
            <div class="mini-progress-row"><span>Today</span><span>${stats.dueTodayDone}/${stats.dueToday} done</span></div>
            <div class="bar"><span style="width:${todayPct}%"></span></div>
          </a>` : ""}
        ${canInstall() ? html`
          <button type="button" class="nav-item install-item" data-action="install-app">
            ${icon("install_desktop")}<span class="nav-label">Install app</span>
          </button>` : ""}
        ${navItem({ route: "settings", label: "Settings", icon: "settings" }, isActive("settings"))}
      </div>
    </div>`);
}

/* Mobile off-canvas behaviour */
export function openSidebar() {
  document.body.classList.add("sidebar-open");
  document.querySelector(".sidebar .nav-item")?.focus();
}
export function closeSidebar() {
  document.body.classList.remove("sidebar-open");
}

registerActions({
  "open-sidebar": openSidebar,
  "close-sidebar": closeSidebar,
});
