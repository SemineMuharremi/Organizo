/**
 * Data versioning. Saved data and backup files carry a `version`. When the
 * schema changes, bump SCHEMA_VERSION and add a migration from the previous
 * version; old data is upgraded step by step (v1 -> v2 -> ...) on load or import.
 *
 * Migrations only reshape data; `sanitizeData` (model.js) validates the result.
 */
import { DEFAULT_SETTINGS } from "./model.js";

export const SCHEMA_VERSION = 2;

const MIGRATIONS = {
  /** v1 -> v2: subtasks, reminders, recurrence, manual order, notifications, richer settings. */
  1: (data) => ({
    ...data,
    tasks: (data.tasks ?? []).map((task, index) => ({
      ...task,
      subtasks: [],
      reminderAt: null,
      reminderSent: false,
      recurrence: null,
      spawnedId: null,
      order: index,
    })),
    notifications: [],
    settings: { ...DEFAULT_SETTINGS, ...(data.settings ?? {}), notifications: { ...DEFAULT_SETTINGS.notifications } },
  }),
};

/**
 * Upgrade `data` from `version` to SCHEMA_VERSION.
 * Throws a user-readable error for data written by a newer app version.
 */
export function migrate(data, version = 1) {
  if (!Number.isInteger(version) || version < 1) throw new Error("This data has an unknown format version.");
  if (version > SCHEMA_VERSION) {
    throw new Error(`This data was created by a newer version of Organizo (format v${version}). Update the app to open it.`);
  }
  let current = data;
  for (let v = version; v < SCHEMA_VERSION; v++) current = MIGRATIONS[v](current);
  return current;
}
