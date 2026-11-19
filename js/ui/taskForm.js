/** Create / edit task modal. One form serves both, so behaviour stays consistent. */
import * as store from "../store.js";
import { html, icon, render } from "./html.js";
import { openDialog, dialogHeader, bindClose, confirmDialog } from "./dialog.js";
import { toast } from "./toast.js";
import { subtaskSection, bindSubtasks } from "./subtasks.js";
import { PRIORITIES, STATUSES, LIMITS, parseTags, normalizeTag, uid } from "../core/model.js";
import { FREQUENCIES, MAX_INTERVAL } from "../core/recurrence.js";
import { tagCounts } from "../core/selectors.js";
import { todayKey, addDays, startOfWeek, parseDateTime, toDateTime } from "../core/dates.js";

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * @param {object} [opts]
 * @param {object} [opts.task]      Existing task to edit.
 * @param {object} [opts.defaults]  Prefill for new tasks: { dueDate, projectId, priority }.
 * @param {(task) => void} [opts.onSaved]
 */
export function openTaskForm({ task, defaults = {}, onSaved } = {}) {
  const { data } = store.getState();
  const { settings } = data;
  const editing = !!task;
  const initial = {
    title: task?.title ?? "",
    description: task?.description ?? "",
    priority: task?.priority ?? defaults.priority ?? settings.defaultPriority,
    status: task?.status ?? "todo",
    dueDate: task?.dueDate ?? defaults.dueDate ?? "",
    dueTime: task?.dueTime ?? "",
    projectId: task?.projectId ?? defaults.projectId ?? "",
    tags: task?.tags ?? [],
    reminderAt: task?.reminderAt ?? "",
    recurrence: { freq: task?.recurrence?.freq ?? "none", interval: task?.recurrence?.interval ?? 1 },
    subtasks: task?.subtasks ?? [],
  };
  let tags = [...initial.tags];
  let subtasks = structuredClone(initial.subtasks);
  const knownTags = tagCounts(data.tasks).map((t) => t.tag);
  const today = todayKey();
  const quickDates = [
    { label: "Today", value: today },
    { label: "Tomorrow", value: addDays(today, 1) },
    { label: "Next week", value: addDays(startOfWeek(today, settings.weekStart), 7) },
  ];
  const repeating = initial.recurrence.freq !== "none";

  const content = html`
    <form class="dialog-panel task-form" novalidate>
      ${dialogHeader(editing ? "Edit task" : "New task")}
      <div class="dialog-body">
        <div class="field">
          <label class="sr-only" for="tf-title">Title</label>
          <input id="tf-title" name="title" class="input input-title" placeholder="What needs to be done?"
            maxlength="${LIMITS.title}" value="${initial.title}" autocomplete="off" required aria-describedby="err-title">
          <p class="field-error" id="err-title" data-error="title"></p>
        </div>
        <div class="field">
          <label class="sr-only" for="tf-desc">Description</label>
          <textarea id="tf-desc" name="description" class="input textarea" rows="3" maxlength="${LIMITS.description}"
            placeholder="Add details, notes or links…">${initial.description}</textarea>
          <p class="field-error" data-error="description"></p>
        </div>

        <fieldset class="field">
          <legend class="label">Priority</legend>
          <div class="segmented prio-picker">
            ${PRIORITIES.slice().reverse().map((p) => html`
              <label class="segment">
                <input type="radio" name="priority" value="${p.id}" ${p.id === initial.priority ? "checked" : ""}>
                <span>${icon("flag", `prio-text-${p.id}`)}${p.label}</span>
              </label>`)}
          </div>
        </fieldset>

        <div class="form-grid">
          <div class="field">
            <label class="label" for="tf-status">Status</label>
            <select id="tf-status" name="status" class="input select">
              ${STATUSES.map((s) => html`<option value="${s.id}" ${s.id === initial.status ? "selected" : ""}>${s.label}</option>`)}
            </select>
          </div>
          <div class="field">
            <label class="label" for="tf-project">Project</label>
            <select id="tf-project" name="projectId" class="input select">
              <option value="">Inbox</option>
              ${data.projects.map((p) => html`<option value="${p.id}" ${p.id === initial.projectId ? "selected" : ""}>${p.name}</option>`)}
            </select>
            <p class="field-error" data-error="projectId"></p>
          </div>
          <div class="field">
            <label class="label" for="tf-date">Due date</label>
            <input id="tf-date" type="date" name="dueDate" class="input" value="${initial.dueDate}">
            <p class="field-error" data-error="dueDate"></p>
          </div>
          <div class="field">
            <label class="label" for="tf-time">Time <span class="label-hint">optional</span></label>
            <input id="tf-time" type="time" name="dueTime" class="input" value="${initial.dueTime}">
            <p class="field-error" data-error="dueTime"></p>
          </div>
        </div>
        <div class="quick-dates" role="group" aria-label="Quick due dates">
          ${quickDates.map((q) => html`<button type="button" class="chip-btn" data-date="${q.value}">${q.label}</button>`)}
          <button type="button" class="chip-btn" data-date="">No date</button>
        </div>

        <div class="form-grid">
          <div class="field">
            <label class="label" for="tf-repeat">${icon("repeat", "label-icon")}Repeat</label>
            <div class="repeat-row">
              <select id="tf-repeat" name="freq" class="input select">
                <option value="none" ${!repeating ? "selected" : ""}>Does not repeat</option>
                ${FREQUENCIES.map((f) => html`<option value="${f.id}" ${f.id === initial.recurrence.freq ? "selected" : ""}>${f.label}</option>`)}
              </select>
            </div>
            <p class="field-error" data-error="recurrence"></p>
          </div>
          <div class="field repeat-interval" ${repeating ? "" : "hidden"}>
            <label class="label" for="tf-interval">Every</label>
            <div class="interval-input">
              <input id="tf-interval" type="number" name="interval" class="input" min="1" max="${MAX_INTERVAL}" step="1" value="${initial.recurrence.interval}">
              <span class="interval-unit"></span>
            </div>
          </div>
        </div>

        <div class="field">
          <label class="label" for="tf-reminder">${icon("notifications", "label-icon")}Reminder <span class="label-hint">optional</span></label>
          <input id="tf-reminder" type="datetime-local" name="reminderAt" class="input" value="${initial.reminderAt}">
          <p class="field-error" data-error="reminderAt"></p>
          <div class="quick-dates" role="group" aria-label="Quick reminders">
            <button type="button" class="chip-btn" data-remind="due">At due time</button>
            <button type="button" class="chip-btn" data-remind="60">In 1 hour</button>
            <button type="button" class="chip-btn" data-remind="tomorrow">Tomorrow 9:00</button>
            <button type="button" class="chip-btn" data-remind="">No reminder</button>
          </div>
        </div>

        <div class="field">
          <label class="label" for="tf-tags">Tags <span class="label-hint">press Enter or comma to add</span></label>
          <div class="tag-input input">
            <div class="tag-list"></div>
            <input id="tf-tags" list="tf-tag-options" placeholder="Add a tag" autocomplete="off" maxlength="${LIMITS.tag}">
            <datalist id="tf-tag-options">${knownTags.map((t) => html`<option value="${t}"></option>`)}</datalist>
          </div>
          <p class="field-error" data-error="tags"></p>
        </div>

        <div class="field">
          <span class="label">${icon("checklist", "label-icon")}Subtasks</span>
          <div class="form-subtasks"></div>
          <p class="field-error" data-error="subtasks"></p>
        </div>
      </div>
      <footer class="dialog-footer">
        <span class="kbd-hint"><kbd>${isMac ? "⌘" : "Ctrl"}</kbd><kbd>Enter</kbd> to save</span>
        <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary">${editing ? "Save changes" : "Create task"}</button>
      </footer>
    </form>`;

  let form;
  const readForm = () => {
    const fd = new FormData(form);
    const pendingSubtask = form.querySelector("[data-sub-input]")?.value.trim();
    return {
      title: fd.get("title"),
      description: fd.get("description"),
      priority: fd.get("priority"),
      status: fd.get("status"),
      dueDate: fd.get("dueDate"),
      dueTime: fd.get("dueTime"),
      projectId: fd.get("projectId"),
      tags: [...tags, ...parseTags(form.querySelector("#tf-tags").value)],
      reminderAt: fd.get("reminderAt"),
      recurrence: { freq: fd.get("freq"), interval: Number(fd.get("interval") || 1) },
      subtasks: pendingSubtask ? [...subtasks, { id: uid(), title: pendingSubtask, done: false }] : subtasks,
    };
  };
  const isDirty = () => JSON.stringify(readForm()) !== JSON.stringify(initial);

  openDialog({
    label: editing ? "Edit task" : "New task",
    content,
    beforeClose: () => !isDirty() || confirmDialog({ title: "Discard changes?", message: "Your unsaved changes will be lost.", confirmLabel: "Discard", danger: true }),
    onMount(el, { close }) {
      form = el.querySelector("form");
      bindClose(el, close);
      const $ = (sel) => form.querySelector(sel);
      const tagInput = $("#tf-tags");
      const tagList = $(".tag-list");
      const dateInput = $("#tf-date");
      const timeInput = $("#tf-time");
      const repeatSelect = $("#tf-repeat");
      const intervalField = $(".repeat-interval");
      const intervalInput = $("#tf-interval");
      const reminderInput = $("#tf-reminder");
      const subtaskRoot = $(".form-subtasks");

      /* Tags */
      const renderTags = () => {
        tagList.innerHTML = tags.map((t) => html`
          <span class="chip chip-tag removable">#${t}<button type="button" data-remove-tag="${t}" aria-label="Remove tag ${t}">${icon("close")}</button></span>`).join("");
      };
      const commitTag = () => {
        const tag = normalizeTag(tagInput.value);
        tagInput.value = "";
        if (!tag || tags.includes(tag)) return;
        if (tags.length >= LIMITS.tags) return showErrors({ tags: `Use at most ${LIMITS.tags} tags.` });
        tags.push(tag);
        renderTags();
      };
      renderTags();
      tagInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); commitTag(); }
        else if (e.key === ",") { e.preventDefault(); commitTag(); }
        else if (e.key === "Backspace" && !tagInput.value && tags.length) { tags.pop(); renderTags(); }
      });
      // Selecting a datalist suggestion fires "input" with the full value.
      tagInput.addEventListener("input", () => { if (knownTags.includes(tagInput.value)) commitTag(); });
      tagList.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-remove-tag]");
        if (!btn) return;
        tags = tags.filter((t) => t !== btn.dataset.removeTag);
        renderTags();
        tagInput.focus();
      });
      $(".tag-input").addEventListener("click", (e) => { if (e.target === e.currentTarget || e.target === tagList) tagInput.focus(); });

      /* Subtasks (local until saved) */
      const renderSubtasks = () => render(subtaskRoot, subtaskSection(subtasks, { focusKey: "form-subtask" }));
      bindSubtasks(subtaskRoot, {
        onAdd: (title) => {
          if (subtasks.length >= LIMITS.subtasks) return;
          subtasks.push({ id: uid(), title, done: false });
          renderSubtasks();
        },
        onToggle: (id) => { const s = subtasks.find((x) => x.id === id); if (s) s.done = !s.done; renderSubtasks(); },
        onRename: (id, title) => { const s = subtasks.find((x) => x.id === id); if (s) s.title = title; renderSubtasks(); },
        onDelete: (id) => { subtasks = subtasks.filter((x) => x.id !== id); renderSubtasks(); },
        refresh: renderSubtasks,
      });
      renderSubtasks();

      /* Dates, repeat and reminder */
      $(".quick-dates").addEventListener("click", (e) => {
        const btn = e.target.closest("[data-date]");
        if (!btn) return;
        dateInput.value = btn.dataset.date;
        if (!btn.dataset.date) timeInput.value = "";
        clearError("dueDate"); clearError("dueTime"); clearError("recurrence");
      });
      const updateRepeat = () => {
        const freq = repeatSelect.value;
        intervalField.hidden = freq === "none";
        const unit = FREQUENCIES.find((f) => f.id === freq)?.unit ?? "";
        $(".interval-unit").textContent = `${unit}${Number(intervalInput.value) === 1 ? "" : "s"}`;
      };
      repeatSelect.addEventListener("change", () => {
        // A repeating task needs an anchor date: default to today.
        if (repeatSelect.value !== "none" && !dateInput.value) dateInput.value = today;
        updateRepeat();
      });
      intervalInput.addEventListener("input", updateRepeat);
      updateRepeat();

      form.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-remind]");
        if (!btn) return;
        const kind = btn.dataset.remind;
        clearError("reminderAt");
        if (!kind) { reminderInput.value = ""; return; }
        if (kind === "60") {
          const d = new Date(Date.now() + 60 * 60_000);
          reminderInput.value = toDateTime(d);
        } else if (kind === "tomorrow") {
          reminderInput.value = `${addDays(today, 1)}T09:00`;
        } else if (kind === "due") {
          if (!dateInput.value) return showErrors({ reminderAt: "Set a due date first." });
          reminderInput.value = `${dateInput.value}T${timeInput.value || "09:00"}`;
        }
      });

      /* Validation & submit */
      const showErrors = (errors) => {
        form.querySelectorAll("[data-error]").forEach((p) => {
          const msg = errors[p.dataset.error] ?? "";
          p.textContent = msg;
          p.closest(".field")?.classList.toggle("has-error", !!msg);
        });
        const first = Object.keys(errors)[0];
        const targets = { tags: tagInput, recurrence: repeatSelect, subtasks: form.querySelector("[data-sub-input]") };
        const target = targets[first] ?? form.elements[first];
        (target instanceof RadioNodeList ? target[0] : target)?.focus();
      };
      const clearError = (name) => {
        const p = form.querySelector(`[data-error="${name}"]`);
        if (p) { p.textContent = ""; p.closest(".field")?.classList.remove("has-error"); }
      };
      form.addEventListener("input", (e) => {
        const name = { freq: "recurrence", interval: "recurrence" }[e.target.name] ?? e.target.name;
        if (name) clearError(name);
      });

      form.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); }
      });

      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const input = readForm();
        // A newly chosen reminder must be in the future (an existing past reminder can be kept).
        if (input.reminderAt && input.reminderAt !== initial.reminderAt) {
          try {
            if (parseDateTime(input.reminderAt) <= new Date()) return showErrors({ reminderAt: "Choose a reminder time in the future." });
          } catch { /* format errors are reported by the model */ }
        }
        if (input.recurrence.freq === "none") input.recurrence = null;
        const result = editing ? store.updateTask(task.id, input) : store.addTask(input);
        if (!result.ok) {
          if (Object.keys(result.errors ?? {}).length) showErrors(result.errors);
          else toast(result.error, { type: "error" });
          return;
        }
        close({ force: true });
        toast(editing ? "Changes saved" : "Task created");
        onSaved?.(result.task ?? task);
      });

      $("#tf-title").focus();
    },
  });
}
