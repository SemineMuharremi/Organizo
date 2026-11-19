/**
 * End-to-end tests in a real headless browser (Chrome/Edge via CDP).
 * Starts its own server; exits non-zero on failure.
 *
 *   node tests/e2e.test.mjs            (or: npm run test:e2e)
 *
 * Note: the real-time reminder test waits for the next wall-clock minute,
 * so a full run takes about 1–2 minutes.
 */
import { mkdtempSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchBrowser, startServer, PAGE_HELPERS, reporter, sleep } from "./helpers/browser.mjs";

let server = await startServer(5199);
const b = await launchBrowser();
const { check, section, summary } = reporter();
const APP = `${server.url}/index.html`;
const run = (body) => b.eval(PAGE_HELPERS + body);
const downloads = mkdtempSync(join(tmpdir(), "organizo-downloads-"));

// Test instrumentation: a stand-in for the Notification API so the test can see what was shown
// and simulate permission states. The permission comes from a test-only localStorage key.
await b.onNewDocument(`
  window.__shown = [];
  class TestNotification {
    static get permission() { return localStorage.getItem("__perm") || "default"; }
    static requestPermission() { return Promise.resolve(TestNotification.permission); }
    constructor(title, options) { window.__shown.push({ title, ...options }); }
    addEventListener() {} close() {}
  }
  window.Notification = TestNotification;
  // Notifications shown through the service worker (the preferred path) are recorded the same way.
  ServiceWorkerRegistration.prototype.showNotification = function (title, options) {
    window.__shown.push({ title, ...options, via: "service-worker" });
    return Promise.resolve();
  };
`);
await b.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });

async function fresh(hash = "#/dashboard") {
  await b.goto(APP);
  await run(`localStorage.clear();`);
  await b.goto(`${APP}?fresh=${Date.now()}${hash}`);
}

/** Drag a task row's handle (real mouse or touch input) so it lands before `targetTitle`. */
async function dragBefore(title, targetTitle, mode = "mouse") {
  const pos = await run(`
    const row = (t) => $$(".task-row").find((r) => $(".task-title", r).textContent === t);
    const h = $("[data-drag-handle]", row(${JSON.stringify(title)})).getBoundingClientRect();
    const target = row(${JSON.stringify(targetTitle)}).getBoundingClientRect();
    return { x: h.left + h.width / 2, y: h.top + h.height / 2, toY: target.top + 4 };`);
  const steps = 12;
  if (mode === "mouse") {
    await b.mouse("mouseMoved", pos.x, pos.y);
    await b.mouse("mousePressed", pos.x, pos.y);
    for (let i = 1; i <= steps; i++) { await b.mouse("mouseMoved", pos.x, pos.y + ((pos.toY - pos.y) * i) / steps); await sleep(16); }
    await b.mouse("mouseReleased", pos.x, pos.toY);
  } else {
    await b.touch("touchStart", pos.x, pos.y);
    for (let i = 1; i <= steps; i++) { await b.touch("touchMove", pos.x, pos.y + ((pos.toY - pos.y) * i) / steps); await sleep(16); }
    await b.touch("touchEnd", pos.x, pos.toY);
  }
  await sleep(250);
}

const titlesInList = `return $$(".list-body .task-row .task-title").map((e) => e.textContent);`;

try {
  await b.viewport(1440, 900);

  /* ------------------------------------------------------------------ */
  section("Core task management");
  await fresh();
  let r = await run(`return { projects: $$('.sidebar a[href^="#/project/"]').length, stats: $$(".stat-value").map((e) => e.textContent), bell: $(".notif-badge").hidden }`);
  check(r.projects === 3, "first run seeds 3 projects");
  check(r.stats.join() === "0,0,0,0", "dashboard stats start at zero");
  check(r.bell, "notification badge hidden when there are no notifications");

  r = await run(`
    click(".new-task-btn"); await wait(300);
    const d = topDialog(); const form = $("form", d);
    form.requestSubmit(); await wait(50);
    const err = $("[data-error=title]", d).textContent;
    fill($("#tf-title", d), "Finish monthly report");
    $("input[name=priority][value=urgent]", d).checked = true;
    click($("[data-date]", d));
    const tag = $("#tf-tags", d); tag.value = "Finance"; press(tag, "Enter");
    for (const s of ["Collect numbers", "Write summary", "Send to boss"]) { const sub = $("[data-sub-input]", d); sub.value = s; press(sub, "Enter"); await wait(20); }
    click($('.subtask [data-sub="toggle"]', d));
    form.requestSubmit(); await wait(400);
    const t = data().tasks.find((t) => t.title === "Finish monthly report");
    return { err, open: !!topDialog(), t };
  `);
  check(r.err === "Give the task a title.", "empty title is rejected with a message");
  check(!r.open && r.t?.priority === "urgent" && r.t.tags[0] === "finance", "task created from the form with fields saved");
  check(r.t?.subtasks.length === 3 && r.t.subtasks[0].done === true, "subtasks added in the form (one checked)");

  r = await run(`
    location.hash = "#/inbox"; await wait(300);
    $("#quick-add-input").focus();
    for (const t of ["Alpha", "Bravo", "Charlie"]) { const input = $("#quick-add-input"); fill(input, t); input.form.requestSubmit(); await wait(120); }
    return { rows: $$(".list-body .task-title").map((e) => e.textContent), focus: document.activeElement?.id, sort: $('select[data-key="sort"]').value };
  `);
  check(r.rows.join() === "Finish monthly report,Alpha,Bravo,Charlie", "quick add appends tasks in manual order", JSON.stringify(r));
  check(r.focus === "quick-add-input", "focus stays in quick add");
  check(r.sort === "manual", "Inbox defaults to manual order");

  r = await run(`
    const row = $$(".task-row").find((r) => $(".task-title", r).textContent === "Alpha");
    click($(".task-check", row)); await wait(450);
    const done = data().tasks.find((t) => t.title === "Alpha").status;
    $$(".toast").find((t) => t.textContent.includes("Task completed")).querySelector(".toast-action").click(); await wait(200);
    return { done, after: data().tasks.find((t) => t.title === "Alpha").status, activity: Object.keys(data().activity).length };
  `);
  check(r.done === "completed" && r.after === "todo" && r.activity === 0, "complete + undo restores status and history");

  r = await run(`
    click($$(".task-title").find((e) => e.textContent === "Bravo")); await wait(350);
    click($('[data-status="in_progress"]', topDialog())); await wait(100);
    click($('.dialog-footer [data-action="edit-task"]', topDialog())); await wait(300);
    fill($("#tf-title", topDialog()), "Bravo v2"); $("form", topDialog()).requestSubmit(); await wait(400);
    const title = $(".detail-title", topDialog()).textContent;
    click($('.detail-header [data-action="duplicate-task"]', topDialog())); await wait(200);
    click($('.detail-header [data-action="delete-task"]', topDialog())); await wait(300);
    click($("[data-confirm]", topDialog())); await wait(900);
    const afterDelete = data().tasks.map((t) => t.title);
    $$(".toast").find((t) => t.textContent.includes("Task deleted")).querySelector(".toast-action").click(); await wait(200);
    return { title, status: data().tasks.find((t) => t.title === "Bravo v2").status, afterDelete, restored: data().tasks.some((t) => t.title === "Bravo v2"), copy: data().tasks.some((t) => t.title === "Bravo v2 (copy)") };
  `);
  check(r.title === "Bravo v2" && r.status === "in_progress", "detail panel: status change and edit");
  check(r.copy, "duplicate task");
  check(!r.afterDelete.includes("Bravo v2") && r.restored, "delete with confirmation, then undo");

  r = await run(`
    location.hash = "#/all"; await wait(300);
    const sel = $('select[data-key="priority"]'); sel.focus(); sel.value = "urgent"; sel.dispatchEvent(new Event("change", { bubbles: true })); await wait(100);
    const urgent = $$(".list-body .task-title").map((e) => e.textContent);
    click('[data-action="reset-filters"]'); await wait(100);
    fill("#search", "charlie"); await wait(100);
    const search = $$(".list-body .task-title").map((e) => e.textContent);
    fill("#search", ""); await wait(100);
    const s = $('select[data-key="sort"]'); s.value = "priority"; s.dispatchEvent(new Event("change", { bubbles: true })); await wait(100);
    return { urgent, search, first: $(".list-body .task-title").textContent, handles: $$("[data-drag-handle]").length };
  `);
  check(r.urgent.join() === "Finish monthly report", "priority filter");
  check(r.search.join() === "Charlie", "search");
  check(r.first === "Finish monthly report" && r.handles === 0, "priority sort works and hides drag handles");

  await b.reload();
  r = await run(`return data().tasks.length;`);
  check(r === 5, "data persists after reload");

  /* ------------------------------------------------------------------ */
  section("Subtasks");
  r = await run(`
    location.hash = "#/inbox"; await wait(300);
    const row = $$(".task-row").find((r) => $(".task-title", r).textContent === "Finish monthly report");
    const badge = $(".subtask-badge", row)?.textContent.trim();
    click($(".task-title", row)); await wait(350);
    const d = topDialog();
    const label0 = $(".subtask-progress-label", d).textContent;
    const add = $("[data-sub-input]", d); add.focus(); add.value = "Archive files"; press(add, "Enter"); await wait(150);
    const focusKept = document.activeElement?.matches("[data-sub-input]");
    click($$('.subtask [data-sub="toggle"]', topDialog())[1]); await wait(150);
    click($$('.subtask [data-sub="edit"]', topDialog())[2]); await wait(50);
    const edit = $(".subtask-edit", topDialog()); edit.value = "Email to manager"; press(edit, "Enter"); await wait(150);
    click($$('.subtask [data-sub="delete"]', topDialog())[0]); await wait(150);
    const label1 = $(".subtask-progress-label", topDialog()).textContent;
    const subs = data().tasks.find((t) => t.title === "Finish monthly report").subtasks;
    click($("[data-close]", topDialog())); await wait(350);
    const badgeAfter = $(".subtask-badge", $$(".task-row").find((r) => $(".task-title", r).textContent === "Finish monthly report")).textContent.trim();
    return { badge, label0, focusKept, label1, subs, badgeAfter };
  `);
  check(r.badge?.endsWith("1/3"), `row shows subtask progress (${r.badge})`);
  check(r.label0 === "1/3 completed", "detail shows progress label");
  check(r.focusKept, "focus stays in the add-subtask field after adding");
  check(r.subs.map((s) => s.title).join() === "Write summary,Email to manager,Archive files", "subtasks: add, rename and delete persisted");
  check(r.label1 === "1/3 completed" && r.subs[0].done === true, "subtasks: toggle updates progress");
  check(r.badgeAfter.endsWith("1/3"), "parent row progress updates live");

  /* ------------------------------------------------------------------ */
  section("Recurring tasks");
  r = await run(`
    click(".new-task-btn"); await wait(300);
    const d = topDialog();
    fill($("#tf-title", d), "Water plants");
    const rep = $("#tf-repeat", d); rep.value = "daily"; rep.dispatchEvent(new Event("change", { bubbles: true }));
    const autoDate = $("#tf-date", d).value;
    const intervalVisible = !$(".repeat-interval", d).hidden;
    const sub = $("[data-sub-input]", d); sub.value = "Balcony"; press(sub, "Enter");
    $("form", d).requestSubmit(); await wait(400);
    const t = data().tasks.find((t) => t.title === "Water plants");
    return { autoDate, intervalVisible, t, badge: $$(".task-row").find((r) => $(".task-title", r).textContent === "Water plants") && $(".repeat-badge", $$(".task-row").find((r) => $(".task-title", r).textContent === "Water plants"))?.textContent.trim() };
  `);
  check(r.autoDate === r.t?.dueDate && r.intervalVisible, "choosing Repeat fills today's date and shows the interval");
  check(r.t?.recurrence?.freq === "daily" && r.t.recurrence.interval === 1, "recurrence saved");
  check(r.badge?.endsWith("Daily"), "row shows the repeat badge");

  const count = `return data().tasks.filter((t) => t.title === "Water plants");`;
  r = await run(`
    const row = $$(".task-row").find((r) => $(".task-title", r).textContent === "Water plants");
    click($(".task-check", row)); await wait(450);
    return { list: data().tasks.filter((t) => t.title === "Water plants"), toast: toasts().find((t) => t.startsWith("Task completed")) };
  `);
  const [orig, next] = [r.list.find((t) => t.status === "completed"), r.list.find((t) => t.status === "todo")];
  check(r.list.length === 2 && orig && next, "completing creates exactly one next occurrence");
  check(next && next.dueDate > orig.dueDate && next.subtasks[0].title === "Balcony" && next.subtasks[0].done === false, "next occurrence: later date, subtasks reset");
  check(orig?.spawnedId === next?.id, "occurrences are linked (prevents duplicates)");
  check(/Next one is due/.test(r.toast ?? ""), "completion toast names the next due date");

  await b.reload();
  r = await run(count);
  check(r.length === 2, "reloading does not create duplicates");

  r = await run(`
    location.hash = "#/completed"; await wait(300);
    const row = $$(".task-row").find((r) => $(".task-title", r).textContent === "Water plants");
    click($(".task-check", row)); await wait(300);
    const afterReopen = data().tasks.filter((t) => t.title === "Water plants").length;
    location.hash = "#/all"; await wait(300);
    const row2 = $$(".task-row").find((r) => $(".task-title", r).textContent === "Water plants");
    click($(".task-check", row2)); await wait(450);
    const afterRecomplete = data().tasks.filter((t) => t.title === "Water plants").length;
    return { afterReopen, afterRecomplete };
  `);
  check(r.afterReopen === 1, "reopening removes the untouched generated occurrence");
  check(r.afterRecomplete === 2, "completing again generates exactly one occurrence");

  r = await run(`
    const list = data().tasks.filter((t) => t.title === "Water plants");
    const spawned = list.find((t) => t.status === "todo");
    click($$(".task-title").find((e) => e.textContent === "Water plants" && e.closest(".task-row:not(.is-done)"))); await wait(350);
    click($('.dialog-footer [data-action="edit-task"]', topDialog())); await wait(300);
    fill($("#tf-desc", topDialog()), "edited"); $("form", topDialog()).requestSubmit(); await wait(400);
    click($("[data-close]", topDialog())); await wait(350);
    location.hash = "#/completed"; await wait(300);
    click($(".task-check", $$(".task-row").find((r) => $(".task-title", r).textContent === "Water plants"))); await wait(300);
    const kept = data().tasks.filter((t) => t.title === "Water plants").length;
    location.hash = "#/all"; await wait(300);
    const reopened = $$(".task-row").filter((r) => $(".task-title", r).textContent === "Water plants" && !r.classList.contains("is-done"));
    click($(".task-check", reopened.find((r) => r.dataset.taskId !== spawned.id))); await wait(450);
    return { kept, final: data().tasks.filter((t) => t.title === "Water plants").length };
  `);
  check(r.kept === 2, "an edited occurrence is kept when the original is reopened");
  check(r.final === 2, "re-completing the original does not duplicate an existing occurrence");

  r = await run(`
    click(".new-task-btn"); await wait(300);
    const d = topDialog();
    fill($("#tf-title", d), "Weekly review"); fill($("#tf-date", d), key(-10));
    const rep = $("#tf-repeat", d); rep.value = "weekly"; rep.dispatchEvent(new Event("change", { bubbles: true }));
    fill($("#tf-interval", d), "1");
    $("form", d).requestSubmit(); await wait(400);
    const t = data().tasks.find((t) => t.title === "Weekly review");
    location.hash = "#/today"; await wait(300);
    click($(".task-check", $$(".task-row").find((r) => $(".task-title", r).textContent === "Weekly review"))); await wait(450);
    const next = data().tasks.find((x) => x.title === "Weekly review" && x.status === "todo");
    return { next: next?.dueDate, today: key(0) };
  `);
  check(r.next >= r.today, `overdue recurring task skips to a future occurrence (${r.next})`);

  r = await run(`
    click(".new-task-btn"); await wait(300);
    const d = topDialog();
    fill($("#tf-title", d), "Bad repeat");
    const rep = $("#tf-repeat", d); rep.value = "monthly"; rep.dispatchEvent(new Event("change", { bubbles: true }));
    fill($("#tf-interval", d), "0"); $("form", d).requestSubmit(); await wait(100);
    const err = $("[data-error=recurrence]", d).textContent;
    topDialog().dispatchEvent(new Event("cancel", { cancelable: true })); await wait(300);
    click($("[data-confirm]", topDialog())); await wait(600);
    return err;
  `);
  check(/whole number/.test(r), "invalid repeat interval is rejected");

  /* ------------------------------------------------------------------ */
  section("Reminders & notifications");
  r = await run(`
    click(".new-task-btn"); await wait(300);
    const d = topDialog();
    fill($("#tf-title", d), "Past reminder"); fill($("#tf-reminder", d), key(-1) + "T09:00");
    $("form", d).requestSubmit(); await wait(100);
    const err = $("[data-error=reminderAt]", d).textContent;
    topDialog().dispatchEvent(new Event("cancel", { cancelable: true })); await wait(300);
    click($("[data-confirm]", topDialog())); await wait(600);
    return err;
  `);
  check(r === "Choose a reminder time in the future.", "a new reminder in the past is rejected");

  // Missed reminder: stored while the app was "closed", delivered on next launch exactly once.
  await run(`
    const raw = JSON.parse(localStorage.getItem("organizo:data"));
    raw.data.tasks.push({ id: "missed-1", title: "Call the dentist", priority: "medium", status: "todo", tags: [], subtasks: [],
      reminderAt: key(-1) + "T10:00", reminderSent: false, order: 99, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    localStorage.setItem("organizo:data", JSON.stringify(raw));
  `);
  await b.reload(1500);
  r = await run(`
    return { notes: data().notifications, badge: $(".notif-badge").textContent, hidden: $(".notif-badge").hidden,
      sent: data().tasks.find((t) => t.id === "missed-1").reminderSent, toast: toasts().find((t) => t.includes("Call the dentist")) };
  `);
  check(r.notes.length === 1 && r.notes[0].message.startsWith("Missed reminder"), "missed reminder delivered on launch and labelled as missed");
  check(!r.hidden && r.badge === "1", "notification badge shows 1 unread");
  check(r.sent && r.toast, "reminder marked as sent and shown in-app");
  await b.reload(1500);
  r = await run(`return data().notifications.length;`);
  check(r === 1, "reloading does not deliver the same reminder twice");

  // Real-time reminder through the form: due at the next wall-clock minute.
  r = await run(`
    click(".new-task-btn"); await wait(300);
    const d = topDialog();
    const at = new Date(Date.now() + 60_000); at.setSeconds(0, 0);
    const pad = (n) => String(n).padStart(2, "0");
    const value = at.getFullYear() + "-" + pad(at.getMonth() + 1) + "-" + pad(at.getDate()) + "T" + pad(at.getHours()) + ":" + pad(at.getMinutes());
    fill($("#tf-title", d), "Stand-up meeting"); fill($("#tf-reminder", d), value);
    $("form", d).requestSubmit(); await wait(400);
    const t = data().tasks.find((t) => t.title === "Stand-up meeting");
    return { value, saved: t?.reminderAt, sent: t?.reminderSent, msUntil: at - Date.now() };
  `);
  check(r.saved === r.value && r.sent === false, "reminder set via the form is saved as pending");
  console.log(`      (waiting ${Math.round(r.msUntil / 1000)}s for the reminder to come due…)`);
  r = await run(`
    const fired = await waitFor(() => data().notifications.find((n) => n.title === "Stand-up meeting"), ${r.msUntil + 15000});
    return { fired: !!fired, late: fired ? Date.now() - new Date(fired.createdAt).getTime() : null,
      toast: toasts().find((t) => t === "Reminder: Stand-up meeting"), badge: $(".notif-badge").textContent, message: fired?.message };
  `);
  check(r.fired && r.message === "Reminder", "reminder fires on time while the app is open");
  check(!!r.toast, "in-app reminder toast shown");
  check(r.badge === "2", "badge counts unread notifications");

  r = await run(`
    click('[data-action="toggle-notifications"]'); await wait(150);
    const panel = $("#notif-panel");
    const items = $$(".notif-item", panel).length; const unread = $$(".notif-item.is-unread", panel).length;
    click($('[data-action="toggle-notification-read"]', panel)); await wait(100);
    const afterOne = $$(".notif-item.is-unread", $("#notif-panel")).length;
    click($('[data-action="snooze-from-notification"]', $("#notif-panel"))); await wait(150);
    const snoozed = data().tasks.find((t) => t.title === "Stand-up meeting");
    click('[data-action="read-all-notifications"]'); await wait(100);
    const badgeHidden = $(".notif-badge").hidden;
    click($('[data-action="open-notification"]', $("#notif-panel"))); await wait(400);
    const openedDetail = $(".detail-title", topDialog())?.textContent;
    const panelClosed = $("#notif-panel").hidden;
    click($("[data-close]", topDialog())); await wait(350);
    click('[data-action="toggle-notifications"]'); await wait(150);
    click($('[data-action="delete-notification"]', $("#notif-panel"))); await wait(100);
    const afterDelete = data().notifications.length;
    click('[data-action="clear-notifications"]'); await wait(100);
    const empty = $(".notif-empty .empty-title", $("#notif-panel"))?.textContent;
    press(document.body, "Escape"); await wait(50);
    return { items, unread, afterOne, snoozedSent: snoozed.reminderSent, snoozedAt: snoozed.reminderAt, badgeHidden, openedDetail, panelClosed, afterDelete, empty, closed: $("#notif-panel").hidden };
  `);
  check(r.items === 2 && r.unread === 2, "notification center lists unread notifications");
  check(r.afterOne === 1, "mark a single notification as read");
  check(r.snoozedSent === false && !!r.snoozedAt, "snooze re-arms the reminder");
  check(r.badgeHidden, "mark all as read clears the badge");
  check(!!r.openedDetail && r.panelClosed, "opening a notification opens its task");
  check(r.afterDelete === 1 && r.empty === "No notifications", "delete one and clear all");
  check(r.closed, "Escape closes the notification panel");

  // Browser notification permission handling.
  await run(`localStorage.setItem("__perm", "denied");`);
  r = await run(`
    location.hash = "#/settings"; await wait(300);
    click('[data-action="toggle-browser-notifications"]'); await wait(200);
    const on = $('[data-action="toggle-browser-notifications"]').getAttribute("aria-checked");
    const error = toasts().find((t) => t.includes("blocked"));
    click('[data-action="test-notification"]'); await wait(200);
    return { on, error, shown: window.__shown.length, inApp: toasts().includes("Test notification") };
  `);
  check(r.on === "false" && !!r.error, "denied permission: setting stays off with an explanation", JSON.stringify(r));
  check(r.shown === 0 && r.inApp, "denied permission: falls back to in-app notifications");

  await run(`localStorage.setItem("__perm", "granted");`);
  await b.reload();
  r = await run(`
    click('[data-action="toggle-browser-notifications"]'); await wait(200);
    const on = $('[data-action="toggle-browser-notifications"]').getAttribute("aria-checked");
    click('[data-action="toggle-inapp-notifications"]'); await wait(100);
    const before = toasts().length;
    click('[data-action="test-notification"]'); await wait(200);
    const note = window.__shown.find((n) => n.title === "Test notification");
    return { on, shown: window.__shown.map((n) => n.title), via: note?.via, hasId: !!note?.data?.notificationId, saved: data().settings.notifications, inAppToast: toasts().filter((t) => t === "Test notification").length };
  `);
  check(r.on === "true" && r.saved.browser === true, "granted permission enables browser notifications");
  check(r.shown.includes("Test notification") && r.inAppToast === 0, "browser notification shown; in-app pop-up respects its setting");
  check(r.via === "service-worker" && r.hasId, "browser notifications are shown through the service worker", JSON.stringify(r));
  await run(`localStorage.removeItem("__perm"); click('[data-action="toggle-inapp-notifications"]');`);

  /* ------------------------------------------------------------------ */
  section("Drag and drop");
  await fresh("#/inbox");
  await run(`
    for (const t of ["One", "Two", "Three", "Four"]) { const input = $("#quick-add-input"); fill(input, t); input.form.requestSubmit(); await wait(100); }
  `);
  await dragBefore("Four", "One", "mouse");
  r = await run(titlesInList);
  check(r.join() === "Four,One,Two,Three", `mouse drag reorders (${r.join()})`);
  await b.reload();
  r = await run(titlesInList);
  check(r.join() === "Four,One,Two,Three", "new order persists after reload");

  r = await run(`
    const handle = $("[data-drag-handle]", $$(".task-row")[0]); handle.focus(); press(handle, "ArrowDown"); await wait(150);
    const order = $$(".list-body .task-title").map((e) => e.textContent);
    return { order, focus: document.activeElement?.closest(".task-row") && $(".task-title", document.activeElement.closest(".task-row")).textContent, sr: $("#sr-status").textContent };
  `);
  check(r.order.join() === "One,Four,Two,Three" && r.focus === "Four", "keyboard reordering keeps focus on the moved task");
  check(/position 2 of 4/.test(r.sr), "screen reader announcement");

  await b.viewport(390, 844, true);
  await b.reload();
  await dragBefore("Three", "One", "touch");
  r = await run(titlesInList);
  check(r.join() === "Three,One,Four,Two", `touch drag reorders on mobile (${r.join()})`);
  await b.viewport(1440, 900);
  await b.reload();

  r = await run(`
    // Filtered list: only "One" and "Two" are urgent; reordering them must keep the others in place.
    const ids = Object.fromEntries(data().tasks.map((t) => [t.title, t.id]));
    const raw = JSON.parse(localStorage.getItem("organizo:data"));
    for (const t of raw.data.tasks) if (["One", "Two"].includes(t.title)) t.priority = "urgent";
    localStorage.setItem("organizo:data", JSON.stringify(raw));
    return true;
  `);
  await b.reload();
  await run(`const sel = $('select[data-key="priority"]'); sel.value = "urgent"; sel.dispatchEvent(new Event("change", { bubbles: true })); await wait(150);`);
  await dragBefore("Two", "One", "mouse");
  r = await run(`return data().tasks.slice().sort((a, b) => a.order - b.order).map((t) => t.title);`);
  check(r.join() === "Three,Two,One,Four", `drag within a filtered list keeps hidden tasks in place (${r.join()})`);

  /* ------------------------------------------------------------------ */
  section("Settings");
  r = await run(`
    location.hash = "#/settings"; await wait(300);
    const sel = $('select[data-change="set-default-priority"]'); sel.value = "high"; sel.dispatchEvent(new Event("change", { bubbles: true })); await wait(100);
    click('[data-action="set-week-start"][data-value="0"]'); await wait(100);
    click('[data-action="set-theme"][data-value="dark"]'); await wait(100);
    const theme = document.documentElement.dataset.theme;
    click(".new-task-btn"); await wait(300);
    const formPriority = $("input[name=priority]:checked", topDialog()).value;
    topDialog().dispatchEvent(new Event("cancel", { cancelable: true })); await wait(400);
    location.hash = "#/calendar"; await wait(300);
    const firstHeader = $(".cal-weekdays span").textContent;
    const firstDay = new Date($(".cal-cell").dataset.date + "T00:00").getDay();
    location.hash = "#/inbox"; await wait(300);
    fill("#quick-add-input", "Prio test"); $("#quick-add-input").form.requestSubmit(); await wait(150);
    return { theme, formPriority, firstHeader, firstDay, quick: data().tasks.find((t) => t.title === "Prio test").priority, s: data().settings };
  `);
  check(r.formPriority === "high" && r.quick === "high", "default priority applies to the form and quick add");
  check(r.firstHeader === "Sun" && r.firstDay === 0, "start of week (Sunday) applies to the calendar");
  check(r.theme === "dark" && r.s.theme === "dark", "theme preference saved");
  await b.reload();
  r = await run(`return { s: data().settings, theme: document.documentElement.dataset.theme };`);
  check(r.s.weekStart === 0 && r.s.defaultPriority === "high" && r.theme === "dark", "settings persist after reload");

  /* ------------------------------------------------------------------ */
  section("Data management");
  await run(`
    const raw = JSON.parse(localStorage.getItem("organizo:data"));
    raw.data.tasks[0].subtasks = [{ id: "s1", title: "Export me", done: true }];
    raw.data.notifications = [{ id: "n1", type: "info", taskId: null, title: "Hello", message: "", createdAt: new Date().toISOString(), read: false }];
    localStorage.setItem("organizo:data", JSON.stringify(raw));
  `);
  await b.reload();
  await run(`location.hash = "#/settings"; await wait(300); click('[data-action="export-data"]');`);
  let file = null;
  for (let i = 0; i < 40 && !file; i++) { await sleep(150); file = readdirSync(downloads).find((f) => f.endsWith(".json")); }
  const exported = file ? JSON.parse(readFileSync(join(downloads, file), "utf8")) : null;
  check(exported?.app === "organizo" && exported.version === 2, "export downloads a versioned backup file");
  check(exported?.data.tasks.some((t) => t.subtasks[0]?.title === "Export me") && exported.data.notifications.length === 1
    && exported.data.settings.weekStart === 0 && exported.data.projects.length === 3, "backup contains tasks, subtasks, projects, notifications and settings");

  const importFile = (name, text) => run(`
    const file = new File([${JSON.stringify(text)}], ${JSON.stringify(name)}, { type: "application/json" });
    const dt = new DataTransfer(); dt.items.add(file);
    const input = $('input[data-change="import-data"]'); input.files = dt.files; input.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(500);
  `);

  const before = await run(`return data().tasks.length;`);
  await importFile("broken.json", "{not json");
  r = await run(`return { toast: toasts().find((t) => t.includes("not valid JSON")), n: data().tasks.length, dialog: !!topDialog() };`);
  check(r.toast && r.n === before && !r.dialog, "invalid JSON is rejected without touching data");
  await importFile("other.json", JSON.stringify({ app: "something-else", data: {} }));
  r = await run(`return toasts().some((t) => t.includes("different application"));`);
  check(r, "a backup from another app is rejected");
  await importFile("future.json", JSON.stringify({ app: "organizo", version: 7, data: { tasks: [], projects: [] } }));
  r = await run(`return toasts().some((t) => t.includes("newer version"));`);
  check(r, "a backup from a newer format version is rejected");

  const legacy = { app: "organizo", version: 1, exportedAt: new Date().toISOString(), data: {
    tasks: [{ id: "L1", title: "Legacy task", priority: "low", status: "todo" }, { id: "L1", title: "dupe" }, { title: "broken" }],
    projects: [{ id: "LP", name: "Legacy", color: "teal" }], activity: {}, settings: { theme: "light" } } };
  await importFile("legacy.json", JSON.stringify(legacy));
  r = await run(`
    const d = topDialog();
    return { stats: $$(".import-stat span", d).map((e) => e.textContent), text: d.textContent };
  `);
  check(r.stats.join() === "1,0,1,0", `import preview summarises the backup (${r.stats.join()})`);
  check(/older format \(v1\)/.test(r.text) && /2 tasks skipped/.test(r.text), "preview reports the version upgrade and skipped records");
  r = await run(`
    click($("[data-close]", topDialog())); await wait(400);
    const unchanged = data().tasks.length;
    return unchanged;
  `);
  check(r === before, "cancelling the import keeps current data");

  await importFile("backup.json", JSON.stringify(exported));
  r = await run(`
    click($("[data-confirm]", topDialog())); await wait(400);
    return { n: data().tasks.length, sub: data().tasks.some((t) => t.subtasks[0]?.title === "Export me"), toast: toasts().includes("Backup restored") };
  `);
  check(r.n === exported.data.tasks.length && r.sub && r.toast, "confirmed import restores the exported backup");

  await importFile("legacy.json", JSON.stringify(legacy));
  r = await run(`
    click($("[data-confirm]", topDialog())); await wait(400);
    const imported = data().tasks.map((t) => t.title);
    $$(".toast").find((t) => t.textContent.includes("Backup restored")).querySelector(".toast-action").click(); await wait(200);
    return { imported, restored: data().tasks.length };
  `);
  check(r.imported.join() === "Legacy task", "legacy v1 backup imports after migration");
  check(r.restored === exported.data.tasks.length, "undo after import restores the previous data");

  r = await run(`
    click('[data-action="reset-all"]'); await wait(300);
    const msg = $(".confirm-message", topDialog()).textContent;
    click($("[data-confirm]", topDialog())); await wait(400);
    const after = { t: data().tasks.length, p: data().projects.length, n: data().notifications.length, s: data().settings };
    $$(".toast").find((t) => t.textContent.includes("All data was reset")).querySelector(".toast-action").click(); await wait(200);
    return { msg, after, undone: data().tasks.length };
  `);
  check(/settings will be deleted/.test(r.msg), "reset asks for confirmation");
  check(r.after.t === 0 && r.after.p === 0 && r.after.n === 0 && r.after.s.weekStart === 1 && r.after.s.theme === "system", "reset clears all data and settings");
  check(r.undone === exported.data.tasks.length, "undo after reset restores data");

  /* ------------------------------------------------------------------ */
  section("Installable app & offline");
  await fresh("#/inbox");
  r = await run(`
    const controlled = await waitFor(() => navigator.serviceWorker.controller, 8000);
    const manifest = await (await fetch($('link[rel="manifest"]').href)).json();
    const external = performance.getEntriesByType("resource").map((e) => e.name).filter((u) => new URL(u).origin !== location.origin);
    await document.fonts.ready;
    return { controlled: !!controlled, name: manifest.name, external,
      inter: document.fonts.check('16px "Inter"'), symbols: document.fonts.check('20px "Material Symbols Rounded"') };
  `);
  check(r.controlled, "service worker installs and controls the page");
  check(r.name === "Organizo", "web app manifest is linked and valid");
  check(r.external.length === 0, "nothing is loaded from other origins (fonts are self-hosted)", r.external.join(", "));
  check(r.inter && r.symbols, "Inter and Material Symbols load from the app's own files");

  // Every icon shown in the app, and every icon in the font's list, renders as a glyph (not as letters).
  const iconNames = new Set();
  const collectIcons = `return $$(".icon").map((e) => e.textContent.trim()).filter(Boolean);`;
  for (const route of ["dashboard", "inbox", "calendar", "settings"]) {
    await run(`location.hash = "#/${route}"; await wait(250);`);
    (await run(collectIcons)).forEach((n) => iconNames.add(n));
  }
  await run(`location.hash = "#/inbox"; await wait(250); const i = $("#quick-add-input"); fill(i, "Offline task"); i.form.requestSubmit(); await wait(150);`);
  (await run(`
    const n = [];
    click(".task-row .task-title"); await wait(350); n.push(...$$(".icon").map((e) => e.textContent.trim())); click($("[data-close]", topDialog())); await wait(300);
    click(".new-task-btn"); await wait(300); n.push(...$$(".icon").map((e) => e.textContent.trim())); click($("[data-close]", topDialog())); await wait(300);
    click('[data-action="toggle-notifications"]'); await wait(150); n.push(...$$(".icon").map((e) => e.textContent.trim())); click('[data-action="toggle-notifications"]');
    return n.filter(Boolean);
  `)).forEach((n) => iconNames.add(n));
  r = await run(`
    await document.fonts.ready;
    const fontList = (await (await fetch("assets/fonts/icon-names.txt")).text()).split("\\n").filter(Boolean);
    const probe = document.createElement("span");
    probe.className = "icon";
    probe.style.cssText = "position:absolute;visibility:hidden;width:auto;overflow:visible";
    document.body.append(probe);
    const asText = (n) => { probe.textContent = n; return probe.getBoundingClientRect().width > 28; }; // a glyph is 20px wide
    const ui = ${JSON.stringify([...iconNames])};
    const result = { ui: ui.length, uiBad: ui.filter(asText), font: fontList.length, fontBad: fontList.filter(asText) };
    probe.remove();
    return result;
  `);
  check(r.ui > 30 && r.uiBad.length === 0, `all ${r.ui} icons on screen render from the local font`, r.uiBad.join(", "));
  check(r.fontBad.length === 0, `all ${r.font} icons in the subset font render`, r.fontBad.join(", "));

  r = await run(`
    location.hash = "#/settings"; await wait(300);
    const rows = $$(".setting-row").map((row) => row.textContent.replace(/\\s+/g, " ").trim());
    return { offline: rows.find((t) => t.startsWith("Offline use")), install: rows.find((t) => t.startsWith("Install Organizo")) };
  `);
  check(/Ready/.test(r.offline ?? ""), "Settings reports offline use as ready", r.offline);
  check(!!r.install, "Settings explains how to install the app", r.install);

  // Install flow, using a stand-in for Chromium's beforeinstallprompt event.
  r = await run(`
    window.__prompted = 0;
    const e = new Event("beforeinstallprompt", { cancelable: true });
    e.prompt = () => { window.__prompted++; return Promise.resolve(); };
    e.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(e); await wait(150);
    const sidebar = !!$('.sidebar [data-action="install-app"]');
    const button = $('.settings [data-action="install-app"]');
    click(button); await wait(250);
    return { prevented: e.defaultPrevented, sidebar, button: !!button, prompted: window.__prompted, toast: toasts().includes("Organizo was installed"),
      gone: !$('[data-action="install-app"]') };
  `);
  check(r.prevented && r.sidebar && r.button, "install prompt shows Install buttons in the sidebar and Settings");
  check(r.prompted === 1 && r.toast && r.gone, "Install opens the browser prompt once and confirms", JSON.stringify(r));

  // Notification clicks: from the service worker (window open) and as a launch link (no window open).
  const ids = await run(`
    const store = await import("./js/store.js");
    const taskId = data().tasks.find((t) => t.title === "Offline task").id;
    const a = store.addNotification({ type: "reminder", taskId, title: "Offline task", message: "Due now" }).notification.id;
    const b = store.addNotification({ type: "reminder", taskId, title: "Offline task", message: "Due again" }).notification.id;
    return { taskId, a, b };
  `);
  r = await run(`
    navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "notification-click", notificationId: ${JSON.stringify(ids.a)}, taskId: ${JSON.stringify(ids.taskId)} } }));
    await wait(400);
    const d = topDialog();
    const text = d?.textContent ?? "";
    const read = data().notifications.find((n) => n.id === ${JSON.stringify(ids.a)}).read;
    if (d) { click($("[data-close]", d)); await wait(300); }
    return { open: !!d, hasTitle: text.includes("Offline task"), read };
  `);
  check(r.open && r.hasTitle && r.read, "clicking a service-worker notification opens its task and marks it read", JSON.stringify(r));

  await b.goto(`${server.url}/?notification=${ids.b}&task=${ids.taskId}#/dashboard`, 600);
  r = await run(`const d = topDialog(); return { open: !!d && d.textContent.includes("Offline task"), read: data().notifications.find((n) => n.id === ${JSON.stringify(ids.b)}).read, search: location.search, hash: location.hash };`);
  check(r.open && r.read && r.search === "" && r.hash === "#/dashboard", "notification launch link opens the task, then cleans the URL", JSON.stringify(r));
  await run(`const d = topDialog(); if (d) { click($("[data-close]", d)); await wait(300); }`);

  await b.goto(`${server.url}/?action=new-task#/inbox`, 600);
  r = await run(`const d = topDialog(); const form = !!(d && $("form", d)); if (d) { click($("[data-close]", d)); await wait(300); } return { form, search: location.search };`);
  check(r.form && r.search === "", "“New task” app shortcut opens the task form", JSON.stringify(r));

  r = await run(`window.dispatchEvent(new Event("offline")); await wait(100); return toasts().some((t) => t.startsWith("You're offline"));`);
  check(r, "going offline shows a reassuring message");

  // Real offline: stop the server and reload. The service worker must serve everything.
  server.stop();
  await sleep(500);
  await b.goto(`${server.url}/index.html?offline=1#/inbox`, 800);
  r = await run(`
    await document.fonts.ready;
    const probe = document.createElement("span"); probe.className = "icon"; probe.style.cssText = "position:absolute;width:auto;overflow:visible"; probe.textContent = "inbox";
    document.body.append(probe); const glyph = probe.getBoundingClientRect().width <= 28; probe.remove();
    return { titles: $$(".task-title").map((e) => e.textContent), glyph, inter: document.fonts.check('16px "Inter"'), rendered: !!$(".sidebar .nav-item") };
  `);
  check(r.rendered && r.titles.includes("Offline task"), "with the server stopped, the app opens from the cache with its data", JSON.stringify(r));
  check(r.glyph && r.inter, "offline, fonts and icons still render");
  server = await startServer(5199);
  await b.goto(APP);

  /* ------------------------------------------------------------------ */
  section("Responsive & stability");
  await b.viewport(390, 844, true);
  const overflow = {};
  for (const route of ["dashboard", "inbox", "today", "upcoming", "all", "completed", "calendar", "settings"]) {
    await run(`location.hash = "#/${route}"; await wait(250);`);
    overflow[route] = await run(`return document.documentElement.scrollWidth - innerWidth;`);
  }
  check(Object.values(overflow).every((v) => v <= 0), `no horizontal overflow on mobile ${JSON.stringify(overflow)}`);
  r = await run(`
    click('[data-action="toggle-notifications"]'); await wait(150);
    const p = $("#notif-panel").getBoundingClientRect();
    click('[data-action="toggle-notifications"]');
    return p.left >= 0 && p.right <= innerWidth;
  `);
  check(r, "notification panel fits the mobile screen");
  await b.viewport(1440, 900);

  r = await run(`
    const ids = data().tasks.map((t) => t.id);
    return ids.length === new Set(ids).size;
  `);
  check(r, "no duplicate task ids");
  check(b.errors.length === 0, "no console errors", b.errors.join("\n      "));
} catch (err) {
  check(false, `test run crashed: ${err.message}`, b.errors.join("\n      "));
} finally {
  await b.close();
  server.stop();
}

process.exit(summary() ? 1 : 0);
