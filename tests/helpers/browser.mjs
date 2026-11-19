/**
 * Minimal test harness: starts the static server and drives headless
 * Chrome/Edge through the Chrome DevTools Protocol (Node's built-in WebSocket).
 * No npm dependencies.
 *
 * Browser lookup: $CHROME_PATH, then common Chrome/Edge/Chromium install paths.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

export function findBrowser() {
  const found = CANDIDATES.find((p) => existsSync(p));
  if (!found) throw new Error("No Chrome/Edge/Chromium found. Set CHROME_PATH to a Chromium-based browser executable.");
  return found;
}

/** Start server.js on a free-ish port. Resolves with { url, stop }. */
export async function startServer(port = 5199) {
  const proc = spawn(process.execPath, [join(ROOT, "server.js")], { env: { ...process.env, PORT: String(port) }, stdio: "pipe" });
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(url)).ok) break; } catch { /* not up yet */ }
    await sleep(100);
  }
  return { url, stop: () => proc.kill() };
}

/**
 * Launch a headless browser with a fresh profile.
 * @returns API with eval/goto/reload/viewport/dark/shot/close and an `errors` array of console errors.
 */
export async function launchBrowser({ port = 9400 + Math.floor(Math.random() * 400) } = {}) {
  const profile = mkdtempSync(join(tmpdir(), "organizo-test-"));
  const proc = spawn(findBrowser(), [
    "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars", "about:blank",
  ], { stdio: "ignore" });

  let targets = [];
  for (let i = 0; i < 75 && !targets.length; i++) {
    try { targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((t) => t.type === "page"); } catch { /* starting */ }
    if (!targets.length) await sleep(200);
  }
  if (!targets.length) throw new Error("Browser did not start.");

  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
  let nextId = 0;
  const pending = new Map();
  const errors = [];
  const eventWaiters = [];
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    for (let i = eventWaiters.length - 1; i >= 0; i--) {
      if (eventWaiters[i].method === msg.method) { eventWaiters[i].resolve(msg.params); eventWaiters.splice(i, 1); }
    }
    if (msg.method === "Runtime.exceptionThrown") errors.push(`exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
    if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params.type)) {
      errors.push(`console.${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(" ")}`);
    }
    if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") errors.push(`log: ${msg.params.entry.text} ${msg.params.entry.url ?? ""}`);
  });
  /** Resolve on the next CDP event with this method (or after `timeout` ms). */
  const nextEvent = (method, timeout = 15000) => new Promise((resolve) => {
    const waiter = { method, resolve };
    eventWaiters.push(waiter);
    setTimeout(() => { const i = eventWaiters.indexOf(waiter); if (i >= 0) { eventWaiters.splice(i, 1); resolve(null); } }, timeout);
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++nextId;
    pending.set(id, (msg) => (msg.error ? rej(new Error(`${method}: ${msg.error.message}`)) : res(msg.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");

  const api = {
    send,
    errors,
    /** Evaluate an async function body in the page and return its (JSON) result. */
    async eval(body) {
      const r = await send("Runtime.evaluate", { expression: `(async () => { ${body} })()`, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`page eval failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return r.result.value;
    },
    /** Navigate and wait for the load event, then let the app settle. */
    async goto(url, settle = 400) { const loaded = nextEvent("Page.loadEventFired"); await send("Page.navigate", { url }); await loaded; await sleep(settle); },
    async reload(settle = 400) { const loaded = nextEvent("Page.loadEventFired"); await send("Page.reload", { ignoreCache: true }); await loaded; await sleep(settle); },
    /** Run a script before any page script on every navigation (test instrumentation). */
    async onNewDocument(source) { await send("Page.addScriptToEvaluateOnNewDocument", { source }); },
    async viewport(width, height, mobile = false) {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
      await send("Emulation.setTouchEmulationEnabled", { enabled: mobile });
    },
    async dark(on) { await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: on ? "dark" : "light" }] }); },
    async grantNotifications(origin) {
      await send("Browser.grantPermissions", { origin, permissions: ["notifications"] });
    },
    async mouse(type, x, y) {
      await send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
    },
    async touch(type, x, y) {
      await send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
    },
    async shot(path, fullPage = false) {
      const params = { format: "png" };
      if (fullPage) {
        const { cssContentSize } = await send("Page.getLayoutMetrics");
        params.clip = { x: 0, y: 0, width: cssContentSize.width, height: Math.min(cssContentSize.height, 3000), scale: 1 };
        params.captureBeyondViewport = true;
      }
      const { data } = await send("Page.captureScreenshot", params);
      mkdirSync(resolve(path, ".."), { recursive: true });
      writeFileSync(path, Buffer.from(data, "base64"));
    },
    async close() {
      try { ws.close(); } catch { /* closed */ }
      proc.kill();
      await sleep(300);
      try { rmSync(profile, { recursive: true, force: true }); } catch { /* still locked on Windows; harmless temp dir */ }
    },
  };
  return api;
}

/** In-page helpers injected before each test step. */
export const PAGE_HELPERS = `
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const click = (s) => { const el = typeof s === "string" ? $(s) : s; if (!el) throw new Error("No element: " + s); el.click(); };
  const fill = (s, v) => { const el = typeof s === "string" ? $(s) : s; if (!el) throw new Error("No element: " + s); el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
  const press = (el, key, opts = {}) => el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts }));
  const topDialog = () => $$("dialog[open]").at(-1);
  const data = () => JSON.parse(localStorage.getItem("organizo:data")).data;
  const toasts = () => $$(".toast .toast-message").map((e) => e.textContent);
  const waitFor = async (fn, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await wait(50); } return fn(); };
  const key = (n = 0) => { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
`;

/** Tiny assertion reporter shared by browser test scripts. */
export function reporter() {
  const results = [];
  return {
    check(cond, name, detail = "") {
      results.push({ ok: !!cond, name });
      console.log(`${cond ? "  ✓" : "  ✗"} ${name}${!cond && detail ? `\n      ${detail}` : ""}`);
    },
    section(title) { console.log(`\n${title}`); },
    summary() {
      const failed = results.filter((r) => !r.ok);
      console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? `, ${failed.length} failed` : ""}`);
      return failed.length;
    },
  };
}
