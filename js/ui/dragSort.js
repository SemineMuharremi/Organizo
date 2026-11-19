/**
 * Drag-and-drop reordering for task lists.
 *
 * - Pointer Events cover mouse, pen and touch. Dragging starts only from the
 *   grip handle (which has `touch-action: none`), so scrolling on phones is
 *   unaffected.
 * - The dragged row follows the pointer; neighbours slide out of the way (FLIP).
 * - Moves are constrained to the row's own list and persisted with
 *   `store.moveTask`, relative to the neighbour it was dropped next to.
 * - Keyboard: focus a handle and press ArrowUp / ArrowDown.
 *
 * While a drag is active, `body.is-dragging` is set; the app defers
 * re-rendering until the "dragsort:end" event.
 */
import * as store from "../store.js";
import { report } from "./toast.js";

const EDGE = 72;        // px from the viewport edge where auto-scroll starts
const MAX_SCROLL = 14;  // px per frame
let drag = null;

const rowsOf = (list) => [...list.children].filter((el) => el.classList.contains("task-row"));
const sibling = (row, dir) => {
  let el = dir < 0 ? row.previousElementSibling : row.nextElementSibling;
  while (el && !el.classList.contains("task-row")) el = dir < 0 ? el.previousElementSibling : el.nextElementSibling;
  return el;
};

function announce(message) {
  const region = document.getElementById("sr-status");
  if (region) region.textContent = message;
}

/** Animate an element from its previous top position to its new one. */
function flip(el, previousTop) {
  const delta = previousTop - el.getBoundingClientRect().top;
  if (!delta) return;
  el.style.transition = "none";
  el.style.transform = `translateY(${delta}px)`;
  el.getBoundingClientRect(); // force reflow
  el.style.transition = "transform 160ms cubic-bezier(0.2, 0, 0, 1)";
  el.style.transform = "";
}

function position() {
  const { row, list, grabOffset } = drag;
  const y = drag.pointerY;
  // Swap with neighbours while the pointer has crossed their midpoint. Always move
  // the neighbour, never the dragged row: detaching the row would release pointer capture.
  for (let guard = 0; guard < 50; guard++) {
    const next = sibling(row, 1);
    const prev = sibling(row, -1);
    if (next) {
      const r = next.getBoundingClientRect();
      if (y > r.top + r.height / 2) { list.insertBefore(next, row); flip(next, r.top); continue; }
    }
    if (prev) {
      const r = prev.getBoundingClientRect();
      if (y < r.top + r.height / 2) { list.insertBefore(prev, row.nextSibling); flip(prev, r.top); continue; }
    }
    break;
  }
  // Keep the dragged row under the pointer, clamped to its list.
  row.style.transform = "";
  const natural = row.getBoundingClientRect();
  const bounds = list.getBoundingClientRect();
  const top = Math.min(Math.max(y - grabOffset, bounds.top - 4), bounds.bottom - natural.height + 4);
  row.style.transform = `translateY(${top - natural.top}px)`;
}

function autoScroll() {
  if (!drag) return;
  const y = drag.pointerY;
  const topEdge = (document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 0) + EDGE;
  let dy = 0;
  if (y < topEdge) dy = -Math.ceil(((topEdge - y) / EDGE) * MAX_SCROLL);
  else if (y > innerHeight - EDGE) dy = Math.ceil(((y - (innerHeight - EDGE)) / EDGE) * MAX_SCROLL);
  if (dy) {
    const before = scrollY;
    scrollBy(0, dy);
    if (scrollY !== before) position();
  }
  drag.frame = requestAnimationFrame(autoScroll);
}

function onPointerMove(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  e.preventDefault();
  drag.pointerY = e.clientY;
  if (!drag.started) {
    if (Math.abs(e.clientY - drag.startY) < 4) return; // ignore tiny jitter / taps
    drag.started = true;
    drag.row.classList.add("is-dragging");
    drag.list.classList.add("is-sorting");
    drag.frame = requestAnimationFrame(autoScroll);
  }
  position();
}

function finish(commit) {
  if (!drag) return;
  const { row, list, handle, pointerId, originalNext, started, frame } = drag;
  cancelAnimationFrame(frame);
  handle.removeEventListener("pointermove", onPointerMove);
  handle.removeEventListener("pointerup", onPointerUp);
  handle.removeEventListener("pointercancel", onPointerCancel);
  handle.removeEventListener("lostpointercapture", onPointerUp);
  try { handle.releasePointerCapture(pointerId); } catch { /* already released */ }

  const next = sibling(row, 1);
  const prev = sibling(row, -1);
  const changed = started && row.nextElementSibling !== originalNext;
  if (started && !commit && changed) list.insertBefore(row, originalNext); // cancelled: put it back

  row.classList.remove("is-dragging");
  list.classList.remove("is-sorting");
  for (const el of rowsOf(list)) { el.style.transform = ""; el.style.transition = ""; }
  drag = null;
  document.body.classList.remove("is-dragging");

  if (commit && changed) {
    const id = row.dataset.taskId;
    const result = store.moveTask(id, next ? { beforeId: next.dataset.taskId } : { afterId: prev?.dataset.taskId });
    if (report(result)) announce(`Moved to position ${rowsOf(list).indexOf(row) + 1} of ${rowsOf(list).length}`);
  }
  document.dispatchEvent(new CustomEvent("dragsort:end"));
}

const onPointerUp = (e) => { if (drag && e.pointerId === drag.pointerId) finish(true); };
const onPointerCancel = (e) => { if (drag && e.pointerId === drag.pointerId) finish(false); };

function onPointerDown(e) {
  const handle = e.target.closest("[data-drag-handle]");
  if (!handle || drag || (e.pointerType === "mouse" && e.button !== 0)) return;
  const row = handle.closest(".task-row");
  if (!row) return;
  e.preventDefault();
  handle.setPointerCapture(e.pointerId);
  const rect = row.getBoundingClientRect();
  drag = {
    row, handle, list: row.parentElement, pointerId: e.pointerId,
    startY: e.clientY, pointerY: e.clientY, grabOffset: e.clientY - rect.top,
    originalNext: row.nextElementSibling, started: false, frame: 0,
  };
  handle.addEventListener("pointermove", onPointerMove);
  handle.addEventListener("pointerup", onPointerUp);
  handle.addEventListener("pointercancel", onPointerCancel);
  handle.addEventListener("lostpointercapture", onPointerUp);
  // Defer app re-renders from the first touch so the dragged DOM stays intact.
  document.body.classList.add("is-dragging");
}

function onKeyDown(e) {
  if (drag && e.key === "Escape") { e.preventDefault(); finish(false); return; }
  const handle = e.target.closest?.("[data-drag-handle]");
  if (!handle || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
  e.preventDefault();
  const row = handle.closest(".task-row");
  const target = sibling(row, e.key === "ArrowUp" ? -1 : 1);
  if (!target) return announce(e.key === "ArrowUp" ? "Already at the top" : "Already at the bottom");
  const result = store.moveTask(row.dataset.taskId, e.key === "ArrowUp" ? { beforeId: target.dataset.taskId } : { afterId: target.dataset.taskId });
  if (report(result)) {
    const list = document.querySelector(`[data-task-id="${CSS.escape(row.dataset.taskId)}"]`)?.parentElement;
    const rows = list ? rowsOf(list) : [];
    announce(`Moved to position ${rows.findIndex((r) => r.dataset.taskId === row.dataset.taskId) + 1} of ${rows.length}`);
  }
}

export function initDragSort() {
  document.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("keydown", onKeyDown);
}

export const isDragging = () => drag?.started === true;
