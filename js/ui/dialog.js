/**
 * Modal infrastructure built on the native <dialog> element, which gives us
 * focus trapping, Escape handling and correct stacking for free.
 */
import { html, icon, render } from "./html.js";

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * @param {object} opts
 * @param {string} opts.label        Accessible name.
 * @param {*}      opts.content      html`` content (should contain a .dialog-panel).
 * @param {string} [opts.className]  "modal" (default) or "drawer".
 * @param {(el: HTMLDialogElement, api: object) => void} [opts.onMount]
 * @param {() => void} [opts.onClose]
 */
export function openDialog({ label, content, className = "modal", onMount, onClose, beforeClose }) {
  const el = document.createElement("dialog");
  el.className = `dialog ${className}`;
  el.setAttribute("aria-label", label);
  render(el, content);
  document.body.append(el);
  el.showModal();

  let closing = false;
  let checking = false;
  /** @param {{ force?: boolean }} [opts] force skips the beforeClose guard. */
  const close = async ({ force = false } = {}) => {
    if (closing || checking) return;
    if (!force && beforeClose) {
      checking = true;
      const allowed = await beforeClose();
      checking = false;
      if (!allowed) return;
    }
    closing = true;
    if (reducedMotion()) return el.close();
    el.classList.add("is-closing");
    const done = () => el.open && el.close();
    el.addEventListener("animationend", done, { once: true });
    setTimeout(done, 300);
  };

  el.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  // Close on backdrop click (press and release both outside the panel).
  let downOnBackdrop = false;
  el.addEventListener("pointerdown", (e) => { downOnBackdrop = e.target === el; });
  el.addEventListener("click", (e) => { if (downOnBackdrop && e.target === el) close(); });
  el.addEventListener("close", () => { el.remove(); onClose?.(); });

  const api = { el, close, update: (next) => render(el, next) };
  onMount?.(el, api);
  return api;
}

export const dialogHeader = (title, subtitle) => html`
  <header class="dialog-header">
    <div>
      <h2 class="dialog-title">${title}</h2>
      ${subtitle ? html`<p class="dialog-subtitle">${subtitle}</p>` : ""}
    </div>
    <button type="button" class="icon-btn" data-close aria-label="Close">${icon("close")}</button>
  </header>`;

/** Wire up every [data-close] button inside a dialog. */
export function bindClose(el, close) {
  el.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) close(); });
}

/**
 * Promise-based confirmation dialog.
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title, message, confirmLabel = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    openDialog({
      label: title,
      className: "modal modal-sm",
      content: html`
        <div class="dialog-panel">
          <div class="confirm-body">
            <div class="confirm-icon ${danger ? "is-danger" : ""}">${icon(danger ? "delete" : "help")}</div>
            <div>
              <h2 class="dialog-title">${title}</h2>
              <p class="confirm-message">${message}</p>
            </div>
          </div>
          <footer class="dialog-footer">
            <button type="button" class="btn btn-ghost" data-close>Cancel</button>
            <button type="button" class="btn ${danger ? "btn-danger" : "btn-primary"}" data-confirm autofocus>${confirmLabel}</button>
          </footer>
        </div>`,
      onMount(el, { close }) {
        bindClose(el, close);
        el.querySelector("[data-confirm]").addEventListener("click", () => { result = true; close(); });
      },
      onClose: () => resolve(result),
    });
  });
}
