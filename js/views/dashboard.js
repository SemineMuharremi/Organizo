/** Dashboard: live overview computed from the store on every render. */
import { html, icon, render, plural } from "../ui/html.js";
import { taskList, emptyState, colorDot } from "../ui/taskItem.js";
import {
  computeStats, computeStreak, recentActivity, sortTasks, sortByCompletedDesc, isDone, deadlineState,
} from "../core/selectors.js";
import { todayKey, addDays, formatLong, formatWeekdayShort, formatRelative } from "../core/dates.js";

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Working late";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function statTile({ label, value, sub, iconName, tone = "", route, filters }) {
  return html`
    <button type="button" class="stat-tile ${tone}" data-action="open-filtered" data-route="${route}"
      data-filters="${filters ? JSON.stringify(filters) : ""}">
      <span class="stat-label">${icon(iconName)}${label}</span>
      <span class="stat-value">${value}</span>
      <span class="stat-sub">${sub}</span>
    </button>`;
}

function progressRing(pct) {
  const r = 34;
  const c = 2 * Math.PI * r;
  return html`
    <svg class="ring" viewBox="0 0 80 80" role="img" aria-label="${pct}% of today's tasks completed">
      <circle class="ring-track" cx="40" cy="40" r="${r}" />
      <circle class="ring-fill" cx="40" cy="40" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct / 100)}" />
      <text x="40" y="40" class="ring-label" dominant-baseline="central" text-anchor="middle">${pct}%</text>
    </svg>`;
}

function weekChart(days) {
  const max = Math.max(1, ...days.map((d) => d.count));
  const total = days.reduce((sum, d) => sum + d.count, 0);
  const today = todayKey();
  return html`
    <div class="card-header">
      <h2 class="card-title">Completed · last 7 days</h2>
      <span class="card-meta">${plural(total, "task")}</span>
    </div>
    <div class="week-chart" aria-hidden="true">
      ${days.map((d) => html`
        <div class="week-col ${d.key === today ? "is-today" : ""}">
          <div class="week-bar-area">
            <div class="week-bar ${d.count ? "" : "is-zero"}" style="height:${d.count ? Math.max(6, (d.count / max) * 100) : 0}%"></div>
            <span class="week-tip">${plural(d.count, "task")} · ${formatRelative(d.key)}</span>
          </div>
          <span class="week-day">${formatWeekdayShort(d.key)}</span>
        </div>`)}
    </div>
    <table class="sr-only">
      <caption>Tasks completed per day, last 7 days</caption>
      <tbody>${days.map((d) => html`<tr><th scope="row">${formatLong(d.key)}</th><td>${d.count}</td></tr>`)}</tbody>
    </table>`;
}

function listCard({ title, tasks, link, linkLabel, empty, ctx }) {
  return html`
    <section class="card">
      <div class="card-header">
        <h2 class="card-title">${title}</h2>
        ${link ? html`<a class="card-link" href="${link}">${linkLabel}${icon("arrow_forward")}</a>` : ""}
      </div>
      ${tasks.length ? taskList(tasks, { ...ctx, compact: true }) : html`<p class="card-empty">${icon(empty.icon)}${empty.text}</p>`}
    </section>`;
}

function projectsCard(projects, tasks) {
  return html`
    <section class="card">
      <div class="card-header">
        <h2 class="card-title">Projects</h2>
        <button type="button" class="card-link" data-action="new-project">${icon("add")}New</button>
      </div>
      ${projects.length ? html`
        <ul class="project-progress" role="list">
          ${projects.map((p) => {
            const list = tasks.filter((t) => t.projectId === p.id);
            const done = list.filter(isDone).length;
            const pct = list.length ? Math.round((done / list.length) * 100) : 0;
            return html`
              <li>
                <a href="#/project/${p.id}" class="project-progress-row">
                  <span class="project-progress-name">${colorDot(p.color)}${p.name}</span>
                  <span class="project-progress-count">${list.length ? `${done}/${list.length}` : "No tasks"}</span>
                </a>
                <div class="bar" style="--bar:var(--accent)" role="progressbar" aria-label="${p.name} progress"
                  aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
              </li>`;
          })}
        </ul>` : html`<p class="card-empty">${icon("folder")}Create a project to group related tasks.</p>`}
    </section>`;
}

export function renderDashboard(el, state) {
  const { tasks, projects, activity } = state.data;
  const stats = computeStats(tasks);
  const streak = computeStreak(activity);
  const today = todayKey();
  const projectsById = Object.fromEntries(projects.map((p) => [p.id, p]));
  const ctx = { projectsById, showProject: true };

  const todayTasks = sortTasks(tasks.filter((t) => !isDone(t) && t.dueDate && t.dueDate <= today));
  const upcoming = sortTasks(tasks.filter((t) => !isDone(t) && t.dueDate > today && t.dueDate <= addDays(today, 7)));
  const recent = sortByCompletedDesc(tasks.filter(isDone));
  const todayPct = stats.dueToday ? Math.round((stats.dueTodayDone / stats.dueToday) * 100) : 0;
  const completedToday = activity[today] ?? 0;
  const dueSoon = tasks.filter((t) => ["today", "soon"].includes(deadlineState(t))).length;

  render(el, html`
    <header class="page-header">
      <div class="page-heading">
        <h1 class="page-title">${greeting()}</h1>
        <p class="page-subtitle">${formatLong(today)}${stats.pending ? ` · ${plural(stats.pending, "open task")}` : ""}</p>
      </div>
    </header>

    ${!tasks.length ? html`
      <section class="card welcome">
        ${emptyState({
          iconName: "rocket_launch",
          title: "Welcome to Organizo",
          hint: "Your workspace is ready. Create your first task. Press N anywhere to add one, or / to search.",
          action: html`<button type="button" class="btn btn-primary" data-action="new-task">${icon("add")}Create your first task</button>`,
        })}
      </section>` : ""}

    <div class="stat-grid">
      ${statTile({ label: "Total tasks", value: stats.total, sub: `${stats.inProgress} in progress`, iconName: "stacks", route: "all" })}
      ${statTile({ label: "Completed", value: stats.completed, sub: `${stats.completionRate}% completion rate`, iconName: "task_alt", route: "completed" })}
      ${statTile({ label: "Pending", value: stats.pending, sub: dueSoon ? `${dueSoon} due within 2 days` : "Nothing due soon", iconName: "pending_actions", route: "all", filters: { status: "open" } })}
      ${statTile({
        label: "Overdue", value: stats.overdue, sub: stats.overdue ? "Needs attention" : "All on track",
        iconName: stats.overdue ? "error" : "verified", tone: stats.overdue ? "is-danger" : "", route: "all", filters: { date: "overdue" },
      })}
    </div>

    <div class="grid-insights">
      <section class="card progress-card">
        <div class="card-header"><h2 class="card-title">Today's progress</h2><a class="card-link" href="#/today">Today${icon("arrow_forward")}</a></div>
        <div class="progress-body">
          ${progressRing(todayPct)}
          <div class="progress-text">
            <p class="progress-headline">${stats.dueToday
              ? stats.dueTodayDone === stats.dueToday ? "Everything due today is done" : `${stats.dueTodayDone} of ${stats.dueToday} done`
              : "Nothing due today"}</p>
            <p class="muted">${plural(completedToday, "task")} completed today in total</p>
          </div>
        </div>
        <div class="bar"><span style="width:${todayPct}%"></span></div>
      </section>

      <section class="card streak-card">
        <div class="card-header"><h2 class="card-title">Streak</h2></div>
        <div class="streak-body">
          <span class="streak-icon ${streak.current ? "is-active" : ""}">${icon("local_fire_department")}</span>
          <div>
            <p class="streak-value">${plural(streak.current, "day")}</p>
            <p class="muted">${streak.current
              ? streak.extendedToday ? "Streak extended today. Nice work." : "Complete a task today to keep it going."
              : "Complete a task to start a streak."}</p>
          </div>
        </div>
        <p class="streak-best">${icon("emoji_events")}Best: ${plural(streak.best, "day")}</p>
      </section>

      <section class="card chart-card">${weekChart(recentActivity(activity, 7))}</section>
    </div>

    <div class="grid-lists">
      ${listCard({
        title: html`Today${todayTasks.length ? html` <span class="group-count">${todayTasks.length}</span>` : ""}`,
        tasks: todayTasks.slice(0, 6), link: "#/today", linkLabel: "View all", ctx,
        empty: { icon: "wb_sunny", text: "Nothing due today." },
      })}
      ${listCard({
        title: "Upcoming deadlines", tasks: upcoming.slice(0, 6), link: "#/upcoming", linkLabel: "View all", ctx,
        empty: { icon: "event_available", text: "No deadlines in the next 7 days." },
      })}
      ${listCard({
        title: "Recently completed", tasks: recent.slice(0, 5), link: "#/completed", linkLabel: "View all", ctx: { ...ctx, showDate: false },
        empty: { icon: "task_alt", text: "Completed tasks will show up here." },
      })}
      ${projectsCard(projects, tasks)}
    </div>
  `);
}
