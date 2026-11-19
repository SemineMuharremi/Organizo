/**
 * Reusable subtask checklist. Rendering is pure; behaviour is bound once to a
 * stable root element with `bindSubtasks`, so it survives re-renders. The
 * detail panel persists each change immediately, the task form keeps a local
 * list until the form is saved.
 */
import { html, icon } from "./html.js";
import { LIMITS } from "../core/model.js";

export function subtaskProgressBar(subtasks) {
  const done = subtasks.filter((s) => s.done).length;
  const pct = subtasks.length ? Math.round((done / subtasks.length) * 100) : 0;
  return html`
    <div class="subtask-progress">
      <span class="subtask-progress-label">${done}/${subtasks.length} completed</span>
      <div class="bar" role="progressbar" aria-label="Subtask progress" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
    </div>`;
}

/**
 * @param {object[]} subtasks
 * @param {object} opts
 * @param {string} opts.focusKey  data-focus key for the add input (keeps focus across re-renders).
 */
export function subtaskSection(subtasks, { focusKey }) {
  return html`
    <div class="subtasks" data-subtasks>
      ${subtasks.length ? subtaskProgressBar(subtasks) : ""}
      ${subtasks.length ? html`
        <ul class="subtask-list" role="list">
          ${subtasks.map((s) => html`
            <li class="subtask ${s.done ? "is-done" : ""}" data-sub-id="${s.id}">
              <button type="button" class="subtask-check" data-sub="toggle" role="checkbox" aria-checked="${String(s.done)}"
                aria-label="${s.done ? "Mark as not done" : "Mark as done"}: ${s.title}">${icon("check")}</button>
              <span class="subtask-title" data-sub="edit" tabindex="0" role="button" aria-label="Edit subtask: ${s.title}">${s.title}</span>
              <button type="button" class="icon-btn xs danger subtask-delete" data-sub="delete" aria-label="Delete subtask: ${s.title}" title="Delete">${icon("close")}</button>
            </li>`)}
        </ul>` : ""}
      ${subtasks.length < LIMITS.subtasks ? html`
        <div class="subtask-add">
          ${icon("add")}
          <input type="text" data-sub-input data-focus="${focusKey}" maxlength="${LIMITS.title}" placeholder="Add a subtask and press Enter" aria-label="New subtask" autocomplete="off">
        </div>` : html`<p class="muted">Subtask limit reached (${LIMITS.subtasks}).</p>`}
    </div>`;
}

/**
 * @param {HTMLElement} root  Stable ancestor of the rendered section.
 * @param {object} h  { onAdd(title), onToggle(id), onRename(id, title), onDelete(id), refresh() }
 */
export function bindSubtasks(root, h) {
  const startEdit = (li) => {
    const span = li.querySelector(".subtask-title");
    if (!span) return;
    const original = span.textContent;
    const input = Object.assign(document.createElement("input"), {
      type: "text", className: "subtask-edit", value: original, maxLength: LIMITS.title,
    });
    input.setAttribute("aria-label", "Subtask title");
    span.replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    const finish = (save) => {
      if (finished) return;
      finished = true;
      const value = input.value.trim();
      if (save && value && value !== original) h.onRename(li.dataset.subId, value);
      else h.refresh();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); finish(true); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); }
    });
    input.addEventListener("blur", () => finish(true));
  };

  root.addEventListener("click", (e) => {
    const target = e.target.closest("[data-sub]");
    if (!target || !root.contains(target)) return;
    const li = target.closest("[data-sub-id]");
    const id = li?.dataset.subId;
    if (target.dataset.sub === "toggle") h.onToggle(id);
    else if (target.dataset.sub === "delete") h.onDelete(id);
    else if (target.dataset.sub === "edit") startEdit(li);
  });

  root.addEventListener("keydown", (e) => {
    const input = e.target.closest?.("[data-sub-input]");
    if (input && e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault(); // never submit the surrounding form
      const title = input.value.trim();
      if (!title) return;
      input.value = "";
      h.onAdd(title);
      return;
    }
    const title = e.target.closest?.(".subtask-title");
    if (title && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); startEdit(title.closest("[data-sub-id]")); }
  });
}
