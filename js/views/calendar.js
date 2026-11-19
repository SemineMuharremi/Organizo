/** Month calendar showing tasks on their due dates. */
import * as store from "../store.js";
import { html, icon, render, plural } from "../ui/html.js";
import { registerActions } from "../ui/actions.js";
import { taskList, emptyState } from "../ui/taskItem.js";
import { toKey, fromKey, todayKey, formatLong, formatMonthYear, isValidKey } from "../core/dates.js";
import { sortTasks, deadlineState, isDone } from "../core/selectors.js";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_CHIPS = 3;
/** Weekday headers rotated to the user's start-of-week preference. */
const weekdayHeaders = (weekStart) => [...WEEKDAYS.slice(weekStart), ...WEEKDAYS.slice(0, weekStart)];

const calendar = {
  month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  selected: todayKey(),
  showCompleted: true,
};

/** Day keys covering the visible month in whole weeks, starting on `weekStart` (0 = Sunday, 1 = Monday). */
function monthGrid(month, weekStart) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const lead = (first.getDay() - weekStart + 7) % 7;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Math.ceil((lead + daysInMonth) / 7) * 7;
  return Array.from({ length: cells }, (_, i) => toKey(new Date(month.getFullYear(), month.getMonth(), i - lead + 1)));
}

function dayCell(key, tasks, { inMonth, today }) {
  const selected = key === calendar.selected;
  const open = tasks.filter((t) => !isDone(t)).length;
  const label = `${formatLong(key)}${tasks.length ? `, ${plural(tasks.length, "task")}` : ""}`;
  return html`
    <div class="cal-cell ${inMonth ? "" : "is-outside"} ${key === today ? "is-today" : ""} ${selected ? "is-selected" : ""}"
      data-action="select-date" data-date="${key}">
      <button type="button" class="cal-day" data-action="select-date" data-date="${key}" aria-label="${label}" aria-pressed="${String(selected)}">
        ${fromKey(key).getDate()}
      </button>
      <div class="cal-chips">
        ${tasks.slice(0, MAX_CHIPS).map((t) => html`
          <button type="button" class="cal-chip prio-${t.priority} ${isDone(t) ? "is-done" : ""} ${deadlineState(t) === "overdue" ? "is-overdue" : ""}"
            data-action="open-task" data-id="${t.id}" title="${t.title}">${t.title}</button>`)}
        ${tasks.length > MAX_CHIPS ? html`<span class="cal-more">+${tasks.length - MAX_CHIPS} more</span>` : ""}
      </div>
      ${tasks.length ? html`<span class="cal-dots" aria-hidden="true">${open ? html`<i class="dot-open"></i>` : ""}${tasks.length - open ? html`<i class="dot-done"></i>` : ""}<b>${tasks.length}</b></span>` : ""}
    </div>`;
}

export function renderCalendar(el, state) {
  const { data } = state;
  const projectsById = Object.fromEntries(data.projects.map((p) => [p.id, p]));
  const visible = data.tasks.filter((t) => t.dueDate && (calendar.showCompleted || !isDone(t)));
  const byDate = new Map();
  for (const t of sortTasks(visible)) {
    if (!byDate.has(t.dueDate)) byDate.set(t.dueDate, []);
    byDate.get(t.dueDate).push(t);
  }
  const month = calendar.month;
  const grid = monthGrid(month, data.settings.weekStart);
  const today = todayKey();
  const monthPrefix = toKey(month).slice(0, 7);
  const monthCount = visible.filter((t) => t.dueDate.startsWith(monthPrefix)).length;
  const selectedTasks = byDate.get(calendar.selected) ?? [];

  render(el, html`
    <header class="page-header">
      <div class="page-heading">
        <h1 class="page-title">${icon("calendar_month", "title-icon")}Calendar</h1>
        <p class="page-subtitle">${plural(monthCount, "task")} due in ${formatMonthYear(month)}</p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-action="cal-toggle-completed" aria-pressed="${String(calendar.showCompleted)}">
          ${icon(calendar.showCompleted ? "visibility" : "visibility_off")}${calendar.showCompleted ? "Hide completed" : "Show completed"}
        </button>
      </div>
    </header>

    <div class="calendar-layout">
      <section class="card cal-card">
        <div class="cal-toolbar">
          <h2 class="cal-month">${formatMonthYear(month)}</h2>
          <div class="cal-nav">
            <button type="button" class="btn btn-secondary btn-sm" data-action="cal-today">Today</button>
            <button type="button" class="icon-btn" data-action="cal-shift" data-delta="-1" aria-label="Previous month" data-focus="cal-prev">${icon("chevron_left")}</button>
            <button type="button" class="icon-btn" data-action="cal-shift" data-delta="1" aria-label="Next month" data-focus="cal-next">${icon("chevron_right")}</button>
          </div>
        </div>
        <div class="cal-grid">
          <div class="cal-weekdays" aria-hidden="true">${weekdayHeaders(data.settings.weekStart).map((d) => html`<span>${d}</span>`)}</div>
          <div class="cal-days">
            ${grid.map((key) => dayCell(key, byDate.get(key) ?? [], { inMonth: key.startsWith(monthPrefix), today }))}
          </div>
        </div>
      </section>

      <aside class="card cal-agenda" aria-live="polite">
        <div class="card-header">
          <div>
            <h2 class="card-title">${calendar.selected === today ? "Today" : formatLong(calendar.selected)}</h2>
            ${calendar.selected === today ? html`<p class="card-meta">${formatLong(today)}</p>` : ""}
          </div>
          <button type="button" class="btn btn-primary btn-sm" data-action="new-task" data-date="${calendar.selected}">${icon("add")}Add</button>
        </div>
        ${selectedTasks.length
          ? taskList(selectedTasks, { projectsById, showProject: true, showDate: false, compact: true })
          : emptyState({ iconName: "event_available", title: "No tasks on this day", hint: "Add a task with this due date using the button above." })}
      </aside>
    </div>
  `);
}

registerActions({
  "select-date": (el) => {
    const key = el.dataset.date;
    if (!isValidKey(key)) return;
    calendar.selected = key;
    const d = fromKey(key);
    if (d.getMonth() !== calendar.month.getMonth() || d.getFullYear() !== calendar.month.getFullYear()) {
      calendar.month = new Date(d.getFullYear(), d.getMonth(), 1);
    }
    store.refresh();
  },
  "cal-shift": (el) => {
    const delta = Number(el.dataset.delta);
    calendar.month = new Date(calendar.month.getFullYear(), calendar.month.getMonth() + delta, 1);
    store.refresh();
  },
  "cal-today": () => {
    const now = new Date();
    calendar.month = new Date(now.getFullYear(), now.getMonth(), 1);
    calendar.selected = todayKey();
    store.refresh();
  },
  "cal-toggle-completed": () => {
    calendar.showCompleted = !calendar.showCompleted;
    store.refresh();
  },
});
