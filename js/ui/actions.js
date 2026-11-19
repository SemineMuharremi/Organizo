/**
 * Declarative event delegation. Elements declare `data-action="name"` and
 * modules register handlers by name, so there is one click listener for the
 * whole app and buttons never lose their handler after a re-render.
 */
const handlers = {};

export function registerActions(map) {
  for (const [name, fn] of Object.entries(map)) {
    if (handlers[name]) console.warn(`Action "${name}" registered twice`);
    handlers[name] = fn;
  }
}

export function initActions(root = document) {
  root.addEventListener("click", (event) => {
    const el = event.target.closest("[data-action]");
    if (!el || el.disabled || el.getAttribute("aria-disabled") === "true") return;
    const handler = handlers[el.dataset.action];
    if (!handler) return;
    if (el.tagName === "A") event.preventDefault();
    handler(el, event);
  });

  // Selects and other inputs use data-change="name".
  root.addEventListener("change", (event) => {
    const el = event.target.closest("[data-change]");
    if (el) handlers[el.dataset.change]?.(el, event);
  });

  // Inline forms use data-submit="name".
  root.addEventListener("submit", (event) => {
    const form = event.target.closest("form[data-submit]");
    if (!form) return;
    event.preventDefault();
    handlers[form.dataset.submit]?.(form, event);
  });
}
