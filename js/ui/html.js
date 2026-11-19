/**
 * Tiny, safe templating. `html` is a tagged template literal that escapes every
 * interpolated value unless it is itself the result of `html`/`raw`, which makes
 * user-entered text (task titles, tags...) safe from HTML injection by default.
 */
class SafeHTML {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHTML = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);

function renderValue(value) {
  if (value === null || value === undefined || value === false) return "";
  if (Array.isArray(value)) return value.map(renderValue).join("");
  if (value instanceof SafeHTML) return value.value;
  return escapeHTML(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += renderValue(values[i]) + strings[i + 1];
  return new SafeHTML(out);
}

/** Mark a trusted string as HTML. Never pass user input to this. */
export const raw = (value) => new SafeHTML(String(value));

export const icon = (name, className = "") =>
  html`<span class="icon ${className}" aria-hidden="true">${name}</span>`;

/** Render into an element while preserving focus on the element with the same data-focus key. */
export function render(target, content) {
  const active = document.activeElement;
  const focusKey = target.contains(active) ? active?.dataset?.focus : null;
  const selection = focusKey && "selectionStart" in active ? [active.selectionStart, active.selectionEnd] : null;
  target.innerHTML = renderValue(content);
  if (focusKey) {
    const next = target.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`);
    if (next) {
      next.focus({ preventScroll: true });
      if (selection) { try { next.setSelectionRange(...selection); } catch { /* not a text input */ } }
    }
  }
}

export const plural = (n, word, pluralWord = `${word}s`) => `${n} ${n === 1 ? word : pluralWord}`;
