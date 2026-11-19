/**
 * Generic task list view used by Inbox, Today, Upcoming, All Tasks, Completed
 * and individual projects. Each view differs only in its base set, grouping
 * and the defaults applied to quickly-added tasks.
 */
import * as store from "../store.js";
import { html, icon, render, plural } from "../ui/html.js";
import { registerActions } from "../ui/actions.js";
import { report } from "../ui/toast.js";
import { taskList, emptyState, colorDot } from "../ui/taskItem.js";
import { PRIORITIES, STATUSES } from "../core/model.js";
import {
  VIEWS, DATE_FILTERS, SORTS, tasksForView, applyFilters, sortTasks, sortByCompletedDesc,
  countActiveFilters, groupByDate, tagCounts, isDone,
} from "../core/selectors.js";
import { todayKey, addDays, formatRelative, formatLong, toKey } from "../core/dates.js";
import { confirmDialog } from "../ui/dialog.js";
import { currentRoute } from "../router.js";

const expandedCompleted = new Set(); // views whose "Completed" section is expanded

/** Defaults for tasks created while a given route is active. */
export function defaultsForRoute(route) {
  switch (route.name) {
    case "today": return { dueDate: todayKey() };
    case "upcoming": return { dueDate: addDays(todayKey(), 1) };
    case "project": return { projectId: route.param };
    default: return {};
  }
}

const option = (value, label, current) => html`<option value="${value}" ${value === current ? "selected" : ""}>${label}</option>`;

function toolbar(view, filters, data, tags) {
  const active = countActiveFilters(filters);
  return html`
    <div class="toolbar" role="toolbar" aria-label="Filter and sort tasks">
      <div class="filters">
        <label class="select-pill ${filters.priority !== "all" ? "is-set" : ""}">
          <span class="sr-only">Priority</span>${icon("flag")}
          <select data-change="filter" data-key="priority" data-focus="f-priority">
            ${option("all", "All priorities", filters.priority)}
            ${PRIORITIES.map((p) => option(p.id, p.label, filters.priority))}
          </select>
        </label>
        ${view !== "completed" ? html`
          <label class="select-pill ${filters.status !== "all" ? "is-set" : ""}">
            <span class="sr-only">Status</span>${icon("radio_button_checked")}
            <select data-change="filter" data-key="status" data-focus="f-status">
              ${option("all", "Any status", filters.status)}
              ${view === "all" || view === "project" ? option("open", "Not completed", filters.status) : ""}
              ${STATUSES.filter((s) => s.id !== "completed" || view === "all" || view === "project").map((s) => option(s.id, s.label, filters.status))}
            </select>
          </label>` : ""}
        ${view !== "project" && view !== "inbox" ? html`
          <label class="select-pill ${filters.projectId !== "all" ? "is-set" : ""}">
            <span class="sr-only">Project</span>${icon("folder")}
            <select data-change="filter" data-key="projectId" data-focus="f-project">
              ${option("all", "All projects", filters.projectId)}
              ${option("inbox", "Inbox", filters.projectId)}
              ${data.projects.map((p) => option(p.id, p.name, filters.projectId))}
            </select>
          </label>` : ""}
        <label class="select-pill ${filters.date !== "all" ? "is-set" : ""}">
          <span class="sr-only">Due date</span>${icon("event")}
          <select data-change="filter" data-key="date" data-focus="f-date">
            ${DATE_FILTERS.map((d) => option(d.id, d.label, filters.date))}
          </select>
        </label>
        ${tags.length ? html`
          <label class="select-pill ${filters.tag !== "all" ? "is-set" : ""}">
            <span class="sr-only">Tag</span>${icon("sell")}
            <select data-change="filter" data-key="tag" data-focus="f-tag">
              ${option("all", "All tags", filters.tag)}
              ${tags.map(({ tag }) => option(tag, `#${tag}`, filters.tag))}
            </select>
          </label>` : ""}
        ${active ? html`<button type="button" class="btn btn-ghost btn-sm" data-action="reset-filters">${icon("filter_alt_off")}Clear ${plural(active, "filter")}</button>` : ""}
      </div>
      <label class="select-pill sort">
        <span class="sr-only">Sort by</span>${icon("swap_vert")}
        <select data-change="filter" data-key="sort" data-focus="f-sort">
          ${SORTS.filter((s) => s.id !== "manual" || view !== "completed").map((s) => option(s.id, `Sort: ${s.label}`, filters.sort))}
        </select>
      </label>
    </div>`;
}

const group = (title, tasks, ctx, extra = "") => html`
  <section class="task-group">
    <h2 class="group-title">${title}<span class="group-count">${tasks.length}</span>${extra}</h2>
    ${taskList(tasks, ctx)}
  </section>`;

function completedGroup(key, tasks, ctx) {
  const open = expandedCompleted.has(key);
  return html`
    <section class="task-group">
      <button type="button" class="group-toggle" data-action="toggle-completed-group" data-key="${key}" aria-expanded="${String(open)}">
        ${icon(open ? "expand_more" : "chevron_right")}Completed<span class="group-count">${tasks.length}</span>
      </button>
      ${open ? taskList(sortByCompletedDesc(tasks), ctx) : ""}
    </section>`;
}

function renderBody(view, key, tasks, ctx, filters) {
  const today = todayKey();
  // An explicit status filter means the user wants one flat list.
  if (filters.status !== "all") return taskList(tasks, ctx);

  switch (view) {
    case "today": {
      const overdue = tasks.filter((t) => t.dueDate < today);
      const dueToday = tasks.filter((t) => t.dueDate === today);
      return html`
        ${overdue.length ? group("Overdue", overdue, ctx) : ""}
        ${dueToday.length ? group(formatLong(today), dueToday, { ...ctx, showDate: true }) : ""}`;
    }
    case "upcoming":
      return groupByDate(tasks).map(([date, list]) =>
        group(html`${formatRelative(date)} <span class="group-sub">${formatLong(date)}</span>`, list, ctx));
    case "completed": {
      const byDay = new Map();
      for (const t of sortByCompletedDesc(tasks)) {
        const day = toKey(new Date(t.completedAt));
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day).push(t);
      }
      return [...byDay].map(([day, list]) => group(formatRelative(day), list, ctx));
    }
    default: {
      const open = tasks.filter((t) => !isDone(t));
      const done = tasks.filter(isDone);
      return html`
        ${open.length ? taskList(open, ctx) : html`<p class="all-done">${icon("celebration")}All open tasks are done.</p>`}
        ${done.length ? completedGroup(key, done, ctx) : ""}`;
    }
  }
}

export function renderListView(el, state, route) {
  const { data, ui } = state;
  const view = route.name;
  const project = view === "project" ? data.projects.find((p) => p.id === route.param) : null;
  if (view === "project" && !project) {
    return render(el, emptyState({
      iconName: "folder_off", title: "Project not found", hint: "It may have been deleted.",
      action: html`<a class="btn btn-secondary" href="#/inbox">Go to Inbox</a>`,
    }));
  }

  const meta = VIEWS[view];
  const projectsById = Object.fromEntries(data.projects.map((p) => [p.id, p]));
  const base = tasksForView(data.tasks, view, route.param);
  const filtered = applyFilters(base, ui.filters, ui.query, projectsById, data.settings.weekStart);
  const tasks = sortTasks(filtered, ui.filters.sort);
  const key = view === "project" ? `project:${project.id}` : view;
  const ctx = { projectsById, showProject: view !== "project" && view !== "inbox", showDate: true,
    draggable: ui.filters.sort === "manual" && view !== "completed" };
  const openCount = base.filter((t) => !isDone(t)).length;
  const subtitle = view === "completed" ? plural(base.length, "completed task") : plural(openCount, "open task");

  let body;
  if (!base.length) {
    body = emptyState({
      iconName: meta.icon, title: meta.empty, hint: meta.emptyHint,
      action: view === "completed" ? "" : html`<button type="button" class="btn btn-primary" data-action="new-task"
        data-date="${defaultsForRoute(route).dueDate ?? ""}" data-project="${project?.id ?? ""}">${icon("add")}Add task</button>`,
    });
  } else if (!tasks.length) {
    body = emptyState({
      iconName: "search_off", title: "No matching tasks",
      hint: ui.query ? `Nothing matches “${ui.query}” with the current filters.` : "Try adjusting or clearing your filters.",
      action: html`<button type="button" class="btn btn-secondary" data-action="reset-filters" data-query="1">Clear search and filters</button>`,
    });
  } else {
    body = renderBody(view, key, tasks, ctx, ui.filters);
  }

  render(el, html`
    <header class="page-header">
      <div class="page-heading">
        <h1 class="page-title">
          ${project ? html`<span class="title-dot">${colorDot(project.color, "lg")}</span>` : icon(meta.icon, "title-icon")}
          ${project?.name ?? meta.title}
        </h1>
        <p class="page-subtitle">${subtitle}</p>
      </div>
      <div class="page-actions">
        ${project ? html`
          <button type="button" class="btn btn-ghost btn-sm" data-action="edit-project" data-id="${project.id}">${icon("edit")}Edit</button>
          <button type="button" class="btn btn-ghost btn-sm danger" data-action="delete-project" data-id="${project.id}">${icon("delete")}Delete</button>` : ""}
        ${view === "completed" && base.length ? html`
          <button type="button" class="btn btn-ghost btn-sm danger" data-action="clear-completed">${icon("delete_sweep")}Clear completed</button>` : ""}
      </div>
    </header>

    ${view !== "completed" ? html`
      <form class="quick-add" data-submit="quick-add" autocomplete="off">
        ${icon("add", "quick-add-icon")}
        <label class="sr-only" for="quick-add-input">Quick add task</label>
        <input id="quick-add-input" name="title" maxlength="200" data-focus="quick-add"
          placeholder="Add a task${project ? ` to ${project.name}` : view === "today" ? " for today" : view === "upcoming" ? " for tomorrow" : ""} and press Enter">
        <button type="button" class="btn btn-ghost btn-sm" data-action="new-task" data-date="${defaultsForRoute(route).dueDate ?? ""}" data-project="${project?.id ?? ""}">More options</button>
      </form>` : ""}

    ${base.length ? toolbar(view, ui.filters, data, tagCounts(base)) : ""}
    ${ui.query && base.length ? html`
      <div class="search-banner">${icon("search")}Results for <strong>“${ui.query}”</strong> · ${plural(tasks.length, "task")}
        <button type="button" class="link-btn" data-action="clear-search">Clear</button></div>` : ""}
    <div class="list-body">${body}</div>
  `);
}

registerActions({
  filter: (el) => store.setFilters({ [el.dataset.key]: el.value }),
  "reset-filters": (el) => {
    store.resetFilters();
    if (el.dataset.query) store.setQuery("");
  },
  "clear-search": () => store.setQuery(""),
  "toggle-completed-group": (el) => {
    const key = el.dataset.key;
    expandedCompleted.has(key) ? expandedCompleted.delete(key) : expandedCompleted.add(key);
    store.refresh();
  },
  "quick-add": (form) => {
    const title = form.elements.title.value.trim();
    if (!title) return form.elements.title.focus();
    const result = store.addTask({ title, priority: store.getState().data.settings.defaultPriority, status: "todo", ...defaultsForRoute(currentRoute()) });
    report(result, "Task added");
  },
  "clear-completed": async () => {
    const ok = await confirmDialog({
      title: "Clear completed tasks?",
      message: "All completed tasks will be permanently deleted. Your streak and history are kept.",
      confirmLabel: "Clear all", danger: true,
    });
    if (ok) {
      const result = store.clearCompleted();
      report(result, result.ok ? `${plural(result.count, "task")} cleared` : undefined);
    }
  },
});
