/** Project create / edit / delete flows. */
import * as store from "../store.js";
import { html, icon, plural } from "./html.js";
import { openDialog, dialogHeader, bindClose } from "./dialog.js";
import { registerActions } from "./actions.js";
import { toast, report } from "./toast.js";
import { PROJECT_COLORS, LIMITS } from "../core/model.js";
import { navigate, currentRoute } from "../router.js";

const findProject = (id) => store.getState().data.projects.find((p) => p.id === id);

export function openProjectForm(project) {
  const editing = !!project;
  const selected = project?.color ?? PROJECT_COLORS[store.getState().data.projects.length % PROJECT_COLORS.length].id;

  openDialog({
    label: editing ? "Edit project" : "New project",
    className: "modal modal-sm",
    content: html`
      <form class="dialog-panel" novalidate>
        ${dialogHeader(editing ? "Edit project" : "New project")}
        <div class="dialog-body">
          <div class="field">
            <label class="label" for="pf-name">Name</label>
            <input id="pf-name" name="name" class="input" maxlength="${LIMITS.projectName}" value="${project?.name ?? ""}"
              placeholder="e.g. Marketing, Home, Thesis" autocomplete="off" required>
            <p class="field-error" data-error="name"></p>
          </div>
          <fieldset class="field">
            <legend class="label">Color</legend>
            <div class="color-picker">
              ${PROJECT_COLORS.map((c) => html`
                <label class="swatch" title="${c.label}" style="--swatch:${c.value}">
                  <input type="radio" name="color" value="${c.id}" ${c.id === selected ? "checked" : ""} aria-label="${c.label}">
                  <span>${icon("check")}</span>
                </label>`)}
            </div>
          </fieldset>
        </div>
        <footer class="dialog-footer">
          <button type="button" class="btn btn-ghost" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary">${editing ? "Save" : "Create project"}</button>
        </footer>
      </form>`,
    onMount(el, { close }) {
      bindClose(el, close);
      const form = el.querySelector("form");
      const error = form.querySelector("[data-error=name]");
      form.elements.name.addEventListener("input", () => { error.textContent = ""; error.closest(".field").classList.remove("has-error"); });
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const input = { name: form.elements.name.value, color: form.elements.color.value };
        const result = editing ? store.updateProject(project.id, input) : store.addProject(input);
        if (!result.ok) {
          if (result.errors?.name) {
            error.textContent = result.errors.name;
            error.closest(".field").classList.add("has-error");
            form.elements.name.focus();
          } else toast(result.error, { type: "error" });
          return;
        }
        close({ force: true });
        toast(editing ? "Project updated" : "Project created");
        if (!editing) navigate("project", result.project.id);
      });
      form.elements.name.focus();
    },
  });
}

export function deleteProject(id) {
  const project = findProject(id);
  if (!project) return;
  const taskCount = store.getState().data.tasks.filter((t) => t.projectId === id).length;

  openDialog({
    label: "Delete project",
    className: "modal modal-sm",
    content: html`
      <form class="dialog-panel">
        <div class="confirm-body">
          <div class="confirm-icon is-danger">${icon("delete")}</div>
          <div>
            <h2 class="dialog-title">Delete “${project.name}”?</h2>
            <p class="confirm-message">${taskCount ? `This project contains ${plural(taskCount, "task")}. What should happen to them?` : "This project has no tasks."}</p>
            ${taskCount ? html`
              <div class="radio-list">
                <label class="radio-option"><input type="radio" name="mode" value="move" checked>
                  <span><strong>Move tasks to Inbox</strong><small>Keep the tasks, remove only the project.</small></span></label>
                <label class="radio-option"><input type="radio" name="mode" value="delete">
                  <span><strong>Delete tasks too</strong><small>Permanently delete the project and its tasks.</small></span></label>
              </div>` : ""}
          </div>
        </div>
        <footer class="dialog-footer">
          <button type="button" class="btn btn-ghost" data-close>Cancel</button>
          <button type="submit" class="btn btn-danger">Delete project</button>
        </footer>
      </form>`,
    onMount(el, { close }) {
      bindClose(el, close);
      const form = el.querySelector("form");
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const deleteTasks = form.elements.mode?.value === "delete";
        const result = store.deleteProject(id, { deleteTasks });
        if (!report(result, "Project deleted")) return;
        close({ force: true });
        const route = currentRoute();
        if (route.name === "project" && route.param === id) navigate("inbox");
      });
    },
  });
}

registerActions({
  "new-project": () => openProjectForm(),
  "edit-project": (el) => {
    const project = findProject(el.dataset.id);
    if (project) openProjectForm(project);
  },
  "delete-project": (el) => deleteProject(el.dataset.id),
});
