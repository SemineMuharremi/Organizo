/** Non-blocking notifications with optional actions (e.g. "Undo", "Snooze"). */
import { html, icon, render } from "./html.js";

const ICONS = { success: "check_circle", error: "error", info: "info", reminder: "notifications_active" };
const MAX_TOASTS = 3;

/**
 * @param {string} message
 * @param {object} [opts]
 * @param {"success"|"error"|"info"|"reminder"} [opts.type]
 * @param {{label: string, onClick: Function}} [opts.action]     Single action (shorthand).
 * @param {{label: string, onClick: Function}[]} [opts.actions]  Several actions.
 * @param {number} [opts.duration] ms; 0 keeps it open until dismissed.
 */
export function toast(message, { type = "success", action, actions = action ? [action] : [], duration } = {}) {
  const container = document.getElementById("toasts");
  if (!container) return;
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.setAttribute("role", type === "error" ? "alert" : "status");
  render(el, html`
    ${icon(ICONS[type] ?? ICONS.info, "toast-icon")}
    <span class="toast-message">${message}</span>
    ${actions.map((a, i) => html`<button type="button" class="toast-action" data-index="${i}">${a.label}</button>`)}
    <button type="button" class="toast-close" aria-label="Dismiss">${icon("close")}</button>
  `);

  let timer;
  const dismiss = () => {
    clearTimeout(timer);
    el.classList.add("is-leaving");
    el.addEventListener("animationend", () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 400); // fallback if animations are disabled
  };
  const ms = duration ?? (actions.length || type === "error" ? 6000 : 3500);
  const schedule = () => { if (ms > 0) timer = setTimeout(dismiss, ms); };

  el.addEventListener("click", (e) => {
    if (e.target.closest(".toast-close")) return dismiss();
    const btn = e.target.closest(".toast-action");
    if (btn) { actions[Number(btn.dataset.index)].onClick(); dismiss(); }
  });
  el.addEventListener("mouseenter", () => clearTimeout(timer));
  el.addEventListener("mouseleave", schedule);

  container.append(el);
  while (container.children.length > MAX_TOASTS) container.firstElementChild.remove();
  schedule();
}

/** Show the outcome of a store action; returns whether it succeeded. */
export function report(result, successMessage, options) {
  if (result.ok) {
    if (successMessage) toast(successMessage, options);
    return true;
  }
  toast(result.error ?? "Something went wrong.", { type: "error" });
  return false;
}
