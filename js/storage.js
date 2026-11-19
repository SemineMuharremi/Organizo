/**
 * Local persistence adapter.
 *
 * Organizo has no server: data lives in this browser's localStorage. This module
 * is the only place that touches storage, so swapping it for a real API later
 * means re-implementing `load`/`save` with the same contract.
 *
 * Stored payload: { version, savedAt, data }. Older payloads are migrated
 * (see core/migrations.js) and a copy of the pre-migration data is kept.
 */
import { sanitizeData, uid, DEFAULT_SETTINGS } from "./core/model.js";
import { migrate, SCHEMA_VERSION } from "./core/migrations.js";

export const STORAGE_KEY = "organizo:data";
const CORRUPT_BACKUP_KEY = "organizo:corrupt-backup";
const MIGRATION_BACKUP_KEY = "organizo:pre-migration-backup";
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/** Projects created on first launch (taken from the original prototype's categories). */
export function initialData() {
  const now = new Date().toISOString();
  return {
    tasks: [],
    projects: [
      { id: uid(), name: "Work", color: "indigo", createdAt: now },
      { id: uid(), name: "Family", color: "green", createdAt: now },
      { id: uid(), name: "Meetings", color: "amber", createdAt: now },
    ],
    notifications: [],
    activity: {},
    settings: structuredClone(DEFAULT_SETTINGS),
  };
}

const tryStore = (key, value) => { try { localStorage.setItem(key, value); } catch { /* best effort */ } };

/** Parse an envelope ({version, data}) or a bare legacy object into current-schema data. */
function decode(parsed) {
  const isEnvelope = parsed && typeof parsed === "object" && "data" in parsed;
  const version = isEnvelope ? parsed.version ?? 1 : 1;
  const { data, issues } = sanitizeData(migrate(isEnvelope ? parsed.data : parsed, version));
  return { data, issues, version };
}

/**
 * @returns {{ data: object, warning?: string }}
 */
export function load() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return { data: initialData(), warning: "Browser storage is unavailable. Changes will not be saved after you close this tab." };
  }
  if (raw === null) {
    const data = initialData();
    try { save(data); } catch { /* reported on the first real write */ }
    return { data };
  }
  try {
    const { data, version } = decode(JSON.parse(raw));
    if (version < SCHEMA_VERSION) {
      tryStore(MIGRATION_BACKUP_KEY, raw);
      try { save(data); } catch { /* keep running from memory */ }
    }
    return { data };
  } catch (err) {
    // Keep the unreadable payload so nothing is silently destroyed.
    tryStore(CORRUPT_BACKUP_KEY, raw);
    const reason = err?.message?.includes("newer version") ? err.message : "Saved data could not be read.";
    return { data: initialData(), warning: `${reason} A fresh workspace was started and the old data was backed up in this browser.` };
  }
}

/** Persist state. Throws a user-readable Error on failure. */
export function save(data) {
  const payload = JSON.stringify({ version: SCHEMA_VERSION, savedAt: new Date().toISOString(), data });
  try {
    localStorage.setItem(STORAGE_KEY, payload);
  } catch (err) {
    const quota = err?.name === "QuotaExceededError" || err?.code === 22;
    throw new Error(quota ? "Storage is full. Delete some completed tasks or export a backup." : "Your changes could not be saved.");
  }
}

/** Approximate bytes used by the saved workspace. */
export function storageUsage() {
  try {
    return new Blob([localStorage.getItem(STORAGE_KEY) ?? ""]).size;
  } catch {
    return 0;
  }
}

/** Serialise everything (tasks, subtasks, projects, notifications, activity, settings) for a backup file. */
export function exportJSON(data) {
  return JSON.stringify({ app: "organizo", version: SCHEMA_VERSION, exportedAt: new Date().toISOString(), data }, null, 2);
}

/**
 * Validate a backup file before anything is replaced. Throws a user-readable Error.
 * @returns {{ data: object, issues: string[], version: number, exportedAt: string|null }}
 */
export function parseBackup(text) {
  if (typeof text !== "string" || !text.trim()) throw new Error("The file is empty.");
  if (text.length > MAX_IMPORT_BYTES) throw new Error("That file is too large to be an Organizo backup.");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("This file does not contain Organizo data.");
  if (parsed.app !== undefined && parsed.app !== "organizo") throw new Error("This backup belongs to a different application.");
  const { data, issues, version } = decode(parsed);
  const exportedAt = typeof parsed.exportedAt === "string" && !Number.isNaN(Date.parse(parsed.exportedAt)) ? parsed.exportedAt : null;
  return { data, issues, version, exportedAt };
}

/** Subscribe to changes made in other tabs. */
export function onExternalChange(callback) {
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) callback();
  });
}
