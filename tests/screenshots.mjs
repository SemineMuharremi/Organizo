/**
 * Regenerates the screenshots in docs/screenshots from a seeded demo workspace.
 * The demo data exists only in this script; the app itself ships with no sample tasks.
 *
 *   node tests/screenshots.mjs        (or: npm run screenshots)
 */
import { join } from "node:path";
import { launchBrowser, startServer, ROOT, sleep } from "./helpers/browser.mjs";

const OUT = join(ROOT, "docs", "screenshots");
const server = await startServer(5198);
const b = await launchBrowser();
const APP = `${server.url}/index.html`;

const SEED = `
  const key = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0"); };
  const iso = (mins) => new Date(Date.now() + mins * 60000).toISOString();
  const P = [{ id: "w", name: "Work", color: "indigo", createdAt: iso(-9e3) }, { id: "f", name: "Family", color: "green", createdAt: iso(-9e3) }, { id: "m", name: "Meetings", color: "amber", createdAt: iso(-9e3) }];
  let order = 0;
  const T = (id, title, o) => ({ id, title, description: "", priority: "medium", status: "todo", dueDate: null, dueTime: null, projectId: null, tags: [],
    subtasks: [], recurrence: null, reminderAt: null, reminderSent: false, spawnedId: null, order: order++, createdAt: iso(-5000), updatedAt: iso(-5000), completedAt: null, ...o });
  const S = (...items) => items.map(([title, done], i) => ({ id: "s" + i + title.length, title, done }));
  const tasks = [
    T("1", "Finish monthly reporting", { priority: "urgent", dueDate: key(0), dueTime: "17:00", projectId: "w", tags: ["finance"],
      description: "Pull numbers from the dashboard and write the executive summary.",
      subtasks: S(["Export revenue numbers", true], ["Write executive summary", true], ["Review with Sam", false], ["Send to leadership", false]),
      reminderAt: key(0) + "T16:30" }),
    T("2", "Contract signing with Acme", { priority: "high", dueDate: key(-2), projectId: "w" }),
    T("3", "Weekly team sync", { dueDate: key(1), dueTime: "10:00", projectId: "m", tags: ["team"], recurrence: { freq: "weekly", interval: 1, anchorDay: 1 }, reminderAt: key(1) + "T09:45" }),
    T("4", "Project research", { status: "in_progress", dueDate: key(2), projectId: "w", tags: ["research"], subtasks: S(["Competitor list", true], ["User interviews", false]) }),
    T("5", "Water the plants", { priority: "low", dueDate: key(0), recurrence: { freq: "daily", interval: 2, anchorDay: 1 } }),
    T("6", "Book dentist appointment", { priority: "low", dueDate: key(4), projectId: "f" }),
    T("7", "Pay rent", { priority: "high", dueDate: key(6), projectId: "f", recurrence: { freq: "monthly", interval: 1, anchorDay: 1 } }),
    T("8", "Read design systems article", { priority: "low" }),
    T("9", "Update portfolio", { status: "completed", completedAt: iso(-60), dueDate: key(0) }),
    T("10", "Reply to client emails", { status: "completed", completedAt: iso(-1500), projectId: "w" }),
  ];
  const notifications = [
    { id: "n1", type: "reminder", taskId: "1", title: "Finish monthly reporting", message: "Reminder", createdAt: iso(-12), read: false },
    { id: "n2", type: "reminder", taskId: "2", title: "Contract signing with Acme", message: "Missed reminder: Organizo was closed or asleep at the reminder time.", createdAt: iso(-180), read: false },
    { id: "n3", type: "info", taskId: null, title: "Test notification", message: "Notifications are working.", createdAt: iso(-2000), read: true },
  ];
  const activity = { [key(0)]: 1, [key(-1)]: 3, [key(-2)]: 2, [key(-3)]: 1, [key(-5)]: 2 };
  localStorage.setItem("organizo:data", JSON.stringify({ version: 2, data: { tasks, projects: P, notifications, activity,
    settings: { theme: "system", defaultPriority: "medium", weekStart: 1, notifications: { inApp: true, browser: false } } } }));
`;

async function page(hash, setup = "") {
  await b.goto(`${APP}?s=${Math.random()}${hash}`, 900);
  if (setup) await b.eval(setup);
  await sleep(450);
}
const openTask = (id) => `document.querySelector('.task-title[data-id="${id}"]').click(); await new Promise(r => setTimeout(r, 450));`;
const openBell = `document.querySelector('[data-action="toggle-notifications"]').click(); await new Promise(r => setTimeout(r, 300));`;
const openForm = `document.querySelector('.new-task-btn').click(); await new Promise(r => setTimeout(r, 300));
  const d = [...document.querySelectorAll('dialog[open]')].at(-1);
  const rep = d.querySelector('#tf-repeat'); rep.value = 'weekly'; rep.dispatchEvent(new Event('change', { bubbles: true }));
  d.querySelector('#tf-title').value = 'Plan sprint goals'; await new Promise(r => setTimeout(r, 300));`;

try {
  await b.viewport(1440, 900);
  await b.goto(APP);
  await b.eval(SEED);

  for (const dark of [false, true]) {
    await b.dark(dark);
    const t = dark ? "dark" : "light";
    await page("#/dashboard"); await b.shot(join(OUT, `desktop-${t}-dashboard.png`), true);
    await page("#/all", openTask("1")); await b.shot(join(OUT, `desktop-${t}-task-detail.png`));
    if (dark) continue;
    await page("#/inbox"); await b.shot(join(OUT, "desktop-light-inbox-manual-order.png"));
    await page("#/all", openForm); await b.shot(join(OUT, "desktop-light-task-form.png"));
    await page("#/today", openBell); await b.shot(join(OUT, "desktop-light-notifications.png"));
    await page("#/calendar"); await b.shot(join(OUT, "desktop-light-calendar.png"));
    await page("#/settings"); await b.shot(join(OUT, "desktop-light-settings.png"), true);
  }
  await b.dark(false);
  await b.viewport(820, 1180, true);
  await page("#/dashboard"); await b.shot(join(OUT, "tablet-dashboard.png"));
  await b.viewport(390, 844, true);
  await page("#/dashboard"); await b.shot(join(OUT, "mobile-dashboard.png"));
  await page("#/inbox"); await b.shot(join(OUT, "mobile-inbox.png"));
  await page("#/all", openTask("1")); await b.shot(join(OUT, "mobile-task-detail.png"));
  await page("#/today", openBell); await b.shot(join(OUT, "mobile-notifications.png"));
  console.log(`Screenshots written to ${OUT}`);
  if (b.errors.length) console.log("Console errors:", b.errors);
} finally {
  await b.close();
  server.stop();
}
