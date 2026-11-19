/**
 * Recurrence rules. Pure functions: given a rule and a date, compute the next
 * occurrence. A rule is { freq, interval, anchorDay } where anchorDay keeps
 * monthly/yearly tasks on their original day (Jan 31 -> Feb 28 -> Mar 31).
 */
import { addDays, diffDays, fromKey, toKey, todayKey } from "./dates.js";

export const FREQUENCIES = [
  { id: "daily", label: "Daily", unit: "day" },
  { id: "weekly", label: "Weekly", unit: "week" },
  { id: "monthly", label: "Monthly", unit: "month" },
  { id: "yearly", label: "Yearly", unit: "year" },
];
export const frequencyById = Object.fromEntries(FREQUENCIES.map((f) => [f.id, f]));
export const MAX_INTERVAL = 365;

function addMonthsClamped(key, months, anchorDay) {
  const d = fromKey(key);
  const day = anchorDay ?? d.getDate();
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return toKey(target);
}

/** One step forward from `key` according to the rule. */
export function stepDate(key, { freq, interval = 1, anchorDay = null }) {
  switch (freq) {
    case "daily": return addDays(key, interval);
    case "weekly": return addDays(key, 7 * interval);
    case "monthly": return addMonthsClamped(key, interval, anchorDay);
    case "yearly": return addMonthsClamped(key, 12 * interval, anchorDay);
    default: throw new Error(`Unknown frequency: ${freq}`);
  }
}

/**
 * The next due date after `dueKey`. If the task was completed late, skip
 * occurrences that are already in the past so the next one is today or later.
 */
export function nextOccurrence(rule, dueKey, today = todayKey()) {
  let next = stepDate(dueKey, rule);
  for (let guard = 0; next < today && guard < 10_000; guard++) next = stepDate(next, rule);
  return next;
}

/** Move a reminder ("YYYY-MM-DDTHH:MM") by the same number of days the due date moved. */
export function shiftReminder(reminderAt, fromDue, toDue) {
  if (!reminderAt) return null;
  const [date, time] = reminderAt.split("T");
  return `${addDays(date, diffDays(fromDue, toDue))}T${time}`;
}

export function describeRecurrence(rule) {
  if (!rule) return "";
  const f = frequencyById[rule.freq];
  return rule.interval === 1 ? f.label : `Every ${rule.interval} ${f.unit}s`;
}
