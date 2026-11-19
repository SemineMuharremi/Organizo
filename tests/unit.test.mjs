/**
 * Unit tests for pure logic (no browser needed): dates, recurrence, validation,
 * sanitising, migrations, selectors and storage (with an in-memory localStorage).
 *
 *   node --test tests/unit.test.mjs
 */
import test, { describe } from "node:test";
import assert from "node:assert/strict";

// In-memory localStorage so storage.js can be tested in Node.
const memory = new Map();
globalThis.localStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k),
  clear: () => memory.clear(),
};

const dates = await import("../js/core/dates.js");
const rec = await import("../js/core/recurrence.js");
const model = await import("../js/core/model.js");
const sel = await import("../js/core/selectors.js");
const { migrate, SCHEMA_VERSION } = await import("../js/core/migrations.js");
const storage = await import("../js/storage.js");

const today = dates.todayKey();
const T = (fields) => model.createTask({ title: "t", priority: "medium", status: "todo", ...fields });

describe("dates", () => {
  test("validates calendar dates and date-times", () => {
    assert.ok(dates.isValidKey("2028-02-29"));
    assert.ok(!dates.isValidKey("2027-02-29"));
    assert.ok(dates.isValidDateTime("2026-11-11T09:30"));
    assert.ok(!dates.isValidDateTime("2026-11-11T24:00"));
    assert.ok(!dates.isValidDateTime("2026-11-11"));
  });
  test("start of week honours Monday and Sunday", () => {
    assert.equal(dates.startOfWeek("2026-11-11", 1), "2026-11-09"); // Wed -> Mon
    assert.equal(dates.startOfWeek("2026-11-11", 0), "2026-11-08"); // Wed -> Sun
    assert.equal(dates.startOfWeek("2026-11-08", 0), "2026-11-08");
  });
  test("date-time round trip", () => {
    const d = dates.parseDateTime("2026-03-29T02:30");
    assert.equal(dates.toDateTime(new Date(2026, 0, 5, 7, 4)), "2026-01-05T07:04");
    assert.equal(d.getDate(), 29);
  });
});

describe("recurrence", () => {
  const rule = (freq, interval = 1, anchorDay = null) => ({ freq, interval, anchorDay });
  test("daily / weekly / custom intervals", () => {
    assert.equal(rec.stepDate("2026-12-31", rule("daily")), "2027-01-01");
    assert.equal(rec.stepDate("2026-11-11", rule("weekly", 2)), "2026-11-25");
    assert.equal(rec.stepDate("2026-11-11", rule("daily", 3)), "2026-11-14");
  });
  test("monthly clamps to month end and returns to the anchor day", () => {
    const r = rule("monthly", 1, 31);
    assert.equal(rec.stepDate("2027-01-31", r), "2027-02-28");
    assert.equal(rec.stepDate("2027-02-28", r), "2027-03-31");
    assert.equal(rec.stepDate("2027-04-30", r), "2027-05-31");
  });
  test("yearly on Feb 29 falls back to Feb 28 and back to 29 in leap years", () => {
    const r = rule("yearly", 1, 29);
    assert.equal(rec.stepDate("2028-02-29", r), "2029-02-28");
    assert.equal(rec.stepDate("2031-02-28", r), "2032-02-29");
  });
  test("completing late skips past occurrences but never returns a past date", () => {
    const due = dates.addDays(today, -10);
    const next = rec.nextOccurrence(rule("weekly"), due, today);
    assert.ok(next >= today, `${next} should be >= ${today}`);
    assert.equal(dates.diffDays(due, next) % 7, 0);
    assert.equal(rec.nextOccurrence(rule("daily"), today, today), dates.addDays(today, 1));
  });
  test("reminders shift with the due date, keeping the time", () => {
    assert.equal(rec.shiftReminder("2026-11-10T08:15", "2026-11-11", "2026-11-18"), "2026-11-17T08:15");
    assert.equal(rec.shiftReminder(null, "2026-11-11", "2026-11-18"), null);
  });
  test("descriptions", () => {
    assert.equal(rec.describeRecurrence(rule("weekly")), "Weekly");
    assert.equal(rec.describeRecurrence(rule("monthly", 3)), "Every 3 months");
  });
});

describe("task validation", () => {
  const ctx = { projectIds: new Set() };
  const base = { title: "Pay rent", priority: "high", status: "todo" };
  test("rejects bad input with field messages", () => {
    const { errors, value } = model.validateTaskInput({ title: " ", priority: "x", status: "todo", reminderAt: "tomorrow" }, ctx);
    assert.ok(!value);
    assert.ok(errors.title && errors.priority && errors.reminderAt);
  });
  test("recurrence needs a due date and a sane interval", () => {
    assert.ok(model.validateTaskInput({ ...base, recurrence: { freq: "weekly", interval: 1 } }, ctx).errors.recurrence);
    assert.ok(model.validateTaskInput({ ...base, dueDate: today, recurrence: { freq: "weekly", interval: 0 } }, ctx).errors.recurrence);
    assert.ok(model.validateTaskInput({ ...base, dueDate: today, recurrence: { freq: "weekly", interval: 1.5 } }, ctx).errors.recurrence);
    const ok = model.validateTaskInput({ ...base, dueDate: "2027-01-31", recurrence: { freq: "monthly", interval: 2 } }, ctx);
    assert.deepEqual(ok.value.recurrence, { freq: "monthly", interval: 2, anchorDay: 31 });
    assert.equal(model.validateTaskInput({ ...base, recurrence: { freq: "none" } }, ctx).value.recurrence, null);
  });
  test("subtasks are trimmed, blanks dropped, duplicate ids replaced", () => {
    const { value } = model.validateTaskInput({ ...base, subtasks: [{ id: "a", title: " One " }, { id: "a", title: "Two" }, { title: "  " }] }, ctx);
    assert.equal(value.subtasks.length, 2);
    assert.equal(value.subtasks[0].title, "One");
    assert.notEqual(value.subtasks[0].id, value.subtasks[1].id);
  });
  test("createTask always generates a fresh id and resets delivery flags", () => {
    const a = T({ reminderAt: "2030-01-01T09:00" });
    const b = model.createTask({ ...a, reminderSent: true, spawnedId: "x" });
    assert.notEqual(a.id, b.id);
    assert.equal(b.reminderSent, false);
    assert.equal(b.spawnedId, null);
  });
});

describe("sanitising and migrations", () => {
  test("rejects data that is not Organizo data", () => {
    assert.throws(() => model.sanitizeData({ foo: 1 }), /does not contain Organizo data/);
    assert.throws(() => model.sanitizeData(null));
  });
  test("repairs fields and reports skipped records", () => {
    const { data, issues } = model.sanitizeData({
      tasks: [
        { id: "1", title: "ok", priority: "bogus", projectId: "missing", reminderAt: "nope", recurrence: { freq: "weekly" }, subtasks: "x", spawnedId: "ghost" },
        { id: "1", title: "duplicate id" },
        { title: "no id" },
      ],
      projects: [{ id: "p", name: "" }],
      notifications: [{ id: "n", title: "x", createdAt: "bad" }],
      settings: { theme: "neon", weekStart: 3, notifications: { inApp: "yes" } },
    });
    const [t] = data.tasks;
    assert.equal(data.tasks.length, 1);
    assert.equal(t.priority, "medium");
    assert.equal(t.projectId, null);
    assert.equal(t.reminderAt, null);
    assert.equal(t.recurrence, null, "recurrence without due date is dropped");
    assert.deepEqual(t.subtasks, []);
    assert.equal(t.spawnedId, null, "dangling spawnedId cleared");
    assert.deepEqual(data.settings, model.DEFAULT_SETTINGS);
    assert.ok(issues.some((i) => i.includes("2 tasks")));
    assert.ok(issues.some((i) => i.includes("1 project")));
  });
  test("v1 data migrates to the current schema with manual order preserved", () => {
    const v1 = { tasks: [{ id: "a", title: "A" }, { id: "b", title: "B" }], projects: [], activity: {}, settings: { theme: "dark" } };
    const migrated = migrate(v1, 1);
    const { data } = model.sanitizeData(migrated);
    assert.deepEqual(data.tasks.map((t) => [t.id, t.order]), [["a", 0], ["b", 1]]);
    assert.deepEqual(data.tasks[0].subtasks, []);
    assert.equal(data.settings.theme, "dark");
    assert.deepEqual(data.notifications, []);
  });
  test("newer or unknown versions are refused", () => {
    assert.throws(() => migrate({}, SCHEMA_VERSION + 1), /newer version/);
    assert.throws(() => migrate({}, 0), /unknown format/);
  });
});

describe("storage", () => {
  test("first run seeds and persists the workspace", () => {
    memory.clear();
    const { data } = storage.load();
    assert.equal(data.projects.length, 3);
    assert.equal(JSON.parse(memory.get(storage.STORAGE_KEY)).version, SCHEMA_VERSION);
    assert.deepEqual(storage.load().data.projects.map((p) => p.id), data.projects.map((p) => p.id), "ids are stable across loads");
  });
  test("v1 payload upgrades in place and keeps a pre-migration backup", () => {
    memory.clear();
    const v1 = JSON.stringify({ version: 1, data: { tasks: [{ id: "x", title: "Old" }], projects: [], activity: {}, settings: { theme: "light" } } });
    memory.set(storage.STORAGE_KEY, v1);
    const { data, warning } = storage.load();
    assert.equal(warning, undefined);
    assert.equal(data.tasks[0].title, "Old");
    assert.equal(JSON.parse(memory.get(storage.STORAGE_KEY)).version, SCHEMA_VERSION);
    assert.equal(memory.get("organizo:pre-migration-backup"), v1);
  });
  test("corrupted storage starts fresh without destroying the payload", () => {
    memory.clear();
    memory.set(storage.STORAGE_KEY, "{broken");
    const { data, warning } = storage.load();
    assert.ok(warning);
    assert.equal(data.tasks.length, 0);
    assert.equal(memory.get("organizo:corrupt-backup"), "{broken");
  });
  test("backup parsing validates before anything is replaced", () => {
    assert.throws(() => storage.parseBackup(""), /empty/);
    assert.throws(() => storage.parseBackup("{nope"), /not valid JSON/);
    assert.throws(() => storage.parseBackup("[1,2]"), /does not contain/);
    assert.throws(() => storage.parseBackup(JSON.stringify({ app: "other", data: {} })), /different application/);
    assert.throws(() => storage.parseBackup(JSON.stringify({ app: "organizo", version: 99, data: { tasks: [], projects: [] } })), /newer version/);
    const exported = storage.exportJSON({ tasks: [T({ subtasks: [{ id: "s", title: "Sub", done: true }] })], projects: [], notifications: [], activity: {}, settings: model.DEFAULT_SETTINGS });
    const parsed = storage.parseBackup(exported);
    assert.equal(parsed.version, SCHEMA_VERSION);
    assert.equal(parsed.data.tasks[0].subtasks[0].title, "Sub");
    assert.deepEqual(parsed.issues, []);
  });
});

describe("selectors", () => {
  test("manual sort follows order; default sort depends on the view", () => {
    const tasks = [T({ title: "b", order: 1 }), T({ title: "a", order: 0 })];
    assert.deepEqual(sel.sortTasks(tasks, "manual").map((t) => t.title), ["a", "b"]);
    assert.equal(sel.defaultSortFor("inbox"), "manual");
    assert.equal(sel.defaultSortFor("today"), "deadline");
  });
  test("subtask progress and pending reminders", () => {
    assert.equal(sel.subtaskProgress(T()), null);
    assert.deepEqual(sel.subtaskProgress(T({ subtasks: [{ id: "1", title: "a", done: true }, { id: "2", title: "b", done: false }] })), { done: 1, total: 2, pct: 50 });
    assert.ok(sel.hasPendingReminder(T({ reminderAt: "2030-01-01T09:00" })));
    assert.ok(!sel.hasPendingReminder(T({ reminderAt: "2030-01-01T09:00", status: "completed" })));
  });
  test("'this week' filter respects the start of week", () => {
    const sunday = dates.startOfWeek(today, 0);
    const task = T({ dueDate: sunday });
    const f = { ...sel.DEFAULT_FILTERS, date: "week" };
    assert.equal(sel.applyFilters([task], f, "", {}, 0).length, 1);
    // With Monday weeks, that Sunday belongs to this week only if today is Sunday.
    const expected = new Date().getDay() === 0 ? 1 : 0;
    assert.equal(sel.applyFilters([task], f, "", {}, 1).length, expected);
  });
  test("streaks", () => {
    const act = { [today]: 1, [dates.addDays(today, -1)]: 2, [dates.addDays(today, -3)]: 1 };
    assert.deepEqual(sel.computeStreak(act), { current: 2, best: 2, extendedToday: true });
  });
});

/* ------------------------------ PWA & assets ------------------------------ */

const { readFileSync, readdirSync, existsSync } = await import("node:fs");
const { join, relative } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const filesIn = (dir) => readdirSync(join(ROOT, dir), { withFileTypes: true, recursive: true })
  .filter((e) => e.isFile())
  .map((e) => relative(ROOT, join(e.parentPath ?? e.path, e.name)).replaceAll("\\", "/"));

describe("PWA", () => {
  const precache = JSON.parse(read("sw.js").match(/const PRECACHE = (\[[\s\S]*?\]);/)[1].replace(/,\s*\]$/, "]"));

  test("service worker precaches every app file, and every precached file exists", () => {
    const appFiles = [
      "index.html", "manifest.webmanifest",
      ...filesIn("css"), ...filesIn("js"),
      ...filesIn("assets").filter((f) => /\.(woff2|png)$/.test(f)),
      "assets/icons/icon.svg", // icon-maskable.svg is only the source for the PNGs
    ];
    const missing = appFiles.filter((f) => !precache.includes(f));
    assert.deepEqual(missing, [], "add these files to PRECACHE in sw.js");
    const stale = precache.filter((f) => f !== "./" && !existsSync(join(ROOT, f)));
    assert.deepEqual(stale, [], "remove these files from PRECACHE in sw.js");
  });

  test("manifest has what browsers need to install the app", () => {
    const m = JSON.parse(read("manifest.webmanifest"));
    for (const key of ["name", "short_name", "start_url", "scope", "display", "icons"]) assert.ok(m[key], `manifest.${key}`);
    const pngSize = (file) => { const b = readFileSync(join(ROOT, file)); return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`; };
    for (const icon of m.icons.filter((i) => i.type === "image/png")) {
      assert.equal(pngSize(icon.src), icon.sizes, `${icon.src} is ${icon.sizes}`);
    }
    const sizes = m.icons.map((i) => i.sizes);
    assert.ok(sizes.includes("192x192") && sizes.includes("512x512"));
    assert.ok(m.icons.some((i) => i.purpose === "maskable"));
    for (const s of m.shortcuts ?? []) assert.ok(s.name && s.url);
  });

  test("the app loads nothing from other origins", () => {
    const external = [read("index.html"), ...filesIn("css").map(read)]
      .flatMap((src) => [...src.matchAll(/(?:href|src)=["'](https?:)?\/\/[^"']+|url\(["']?(https?:)?\/\/[^)]+/g)].map((m) => m[0]));
    assert.deepEqual(external, []);
  });

  test("every icon used in the code is in the self-hosted icon font", () => {
    const available = new Set(read("assets/fonts/icon-names.txt").split("\n").filter(Boolean));
    const used = new Set();
    for (const file of filesIn("js")) {
      const src = read(file);
      // icon("name"), icon(cond ? "a" : "b"), { icon: "name" } and ICONS/…_ICONS lookup tables
      for (const [, args] of src.matchAll(/\bicon\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) {
        // skip compared values such as status === "completed"
        for (const [, n] of args.matchAll(/(?<![=!]==?\s*)"([a-z][a-z0-9_]*)"/g)) used.add(n);
      }
      for (const [, n] of src.matchAll(/\bicon: "([a-z][a-z0-9_]*)"/g)) used.add(n);
      for (const [, body] of src.matchAll(/ICONS = \{([^}]*)\}/g)) {
        for (const [, n] of body.matchAll(/: "([a-z][a-z0-9_]*)"/g)) used.add(n);
      }
    }
    for (const [, n] of read("index.html").matchAll(/class="icon"[^>]*>([a-z_]+)</g)) used.add(n);
    assert.ok(used.size > 40, `found ${used.size} icon names`);
    const missing = [...used].filter((n) => !available.has(n));
    assert.deepEqual(missing, [], "run `npm run icons:font` to add these icons to the font");
  });
});
