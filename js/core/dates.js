/**
 * Date helpers. All due dates are stored as local calendar keys ("YYYY-MM-DD")
 * so that a task due "today" stays due today regardless of time zone offsets.
 */

const pad = (n) => String(n).padStart(2, "0");

/** Local calendar key for a Date (defaults to now). */
export function toKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Parse a "YYYY-MM-DD" key into a local Date at midnight. */
export function fromKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function isValidKey(key) {
  if (typeof key !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  return toKey(fromKey(key)) === key; // rejects 2026-02-31 etc.
}

export function isValidTime(time) {
  return typeof time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}

export function addDays(key, days) {
  const d = fromKey(key);
  d.setDate(d.getDate() + days);
  return toKey(d);
}

/** Whole-day difference b - a between two keys. */
export function diffDays(a, b) {
  return Math.round((fromKey(b) - fromKey(a)) / 86_400_000);
}

export const todayKey = () => toKey();

/**
 * Start of the week containing `key`.
 * @param {number} weekStart 0 = Sunday, 1 = Monday (default).
 */
export function startOfWeek(key, weekStart = 1) {
  const d = fromKey(key);
  const offset = (d.getDay() - weekStart + 7) % 7;
  return addDays(key, -offset);
}

/* Local date-times ("YYYY-MM-DDTHH:MM", the datetime-local input format) are
   used for reminders: wall-clock times, independent of time zone offsets. */

export function isValidDateTime(value) {
  if (typeof value !== "string") return false;
  const [date, time] = value.split("T");
  return isValidKey(date) && isValidTime(time);
}

export function parseDateTime(value) {
  const [date, time] = value.split("T");
  const d = fromKey(date);
  const [h, m] = time.split(":").map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}

export function toDateTime(date) {
  return `${toKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "Today · 9:00 AM", "Mar 4 · 2:30 PM". */
export function formatDateTimeShort(value) {
  const [date, time] = value.split("T");
  return `${formatRelative(date)} · ${formatTime(time)}`;
}

const fmt = (opts) => new Intl.DateTimeFormat(undefined, opts);
const shortFmt = fmt({ month: "short", day: "numeric" });
const shortYearFmt = fmt({ month: "short", day: "numeric", year: "numeric" });
const weekdayFmt = fmt({ weekday: "long" });
const shortWeekdayFmt = fmt({ weekday: "short" });
const longFmt = fmt({ weekday: "long", month: "long", day: "numeric" });
const monthYearFmt = fmt({ month: "long", year: "numeric" });

export const formatLong = (key) => longFmt.format(fromKey(key));
export const formatMonthYear = (date) => monthYearFmt.format(date);
export const formatWeekdayShort = (key) => shortWeekdayFmt.format(fromKey(key));

/** Human label relative to today: "Today", "Tomorrow", "Friday", "Mar 4". */
export function formatRelative(key, today = todayKey()) {
  const diff = diffDays(today, key);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff < 7) return weekdayFmt.format(fromKey(key));
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  return (sameYear ? shortFmt : shortYearFmt).format(fromKey(key));
}

/** "14:30" -> locale time string such as "2:30 PM". */
export function formatTime(time) {
  const [h, m] = time.split(":").map(Number);
  return fmt({ hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, h, m));
}

/** Relative timestamp for ISO strings: "just now", "5m ago", "Mar 4". */
export function formatAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`;
  return formatRelative(toKey(new Date(iso)));
}

export function formatDateTime(iso) {
  return fmt({ dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}
