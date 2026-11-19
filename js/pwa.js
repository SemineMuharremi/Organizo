/**
 * Progressive Web App support: service worker registration (offline use and
 * service-worker notifications), the install prompt, and launch parameters
 * from app shortcuts and notification clicks.
 *
 * Everything here is progressive: if a browser lacks a feature, the app works
 * exactly as before and Settings explains what is unavailable.
 */

const listeners = new Set();
let installPrompt = null; // BeforeInstallPromptEvent, Chromium only
let registration = null;
let notificationClickHandler = () => {};

const emit = () => listeners.forEach((fn) => fn());

/** Re-render when install or offline status changes. */
export const onPwaChange = (fn) => listeners.add(fn);

export const serviceWorkerSupported = () => "serviceWorker" in navigator && window.isSecureContext;

/** True when the page is running as an installed app. */
export const isInstalled = () =>
  matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: minimal-ui)").matches || navigator.standalone === true;

/** True when the browser offered to install the app and the prompt can be shown. */
export const canInstall = () => installPrompt !== null;

/** iPhone/iPad Safari has no install prompt; users add the app from the Share menu. */
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** True once the service worker controls this page, i.e. the app shell is cached and works offline. */
export const offlineReady = () => serviceWorkerSupported() && navigator.serviceWorker.controller !== null;

/** Show the browser's install dialog. Resolves "accepted", "dismissed" or "unavailable". */
export async function promptInstall() {
  if (!installPrompt) return "unavailable";
  const prompt = installPrompt;
  installPrompt = null; // a prompt can only be used once
  try {
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    return outcome;
  } catch {
    return "unavailable";
  } finally {
    emit();
  }
}

/**
 * The active service worker registration, or null if there isn't one
 * (unsupported browser, insecure origin, or registration failed).
 */
export async function serviceWorkerRegistration() {
  if (!serviceWorkerSupported()) return null;
  if (registration?.active) return registration;
  // `ready` never settles without a registration, so don't wait forever.
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 1500));
  return (await Promise.race([navigator.serviceWorker.ready, timeout])) ?? null;
}

/** Called with { notificationId, taskId } when the user clicks a notification shown by the service worker. */
export function onNotificationClick(fn) {
  notificationClickHandler = fn;
}

/**
 * Handle URL parameters from app shortcuts (?action=new-task) and from
 * notifications clicked while no Organizo window was open (?notification=…&task=…),
 * then remove them from the address bar so a reload doesn't repeat them.
 */
export function handleLaunchParams({ newTask }) {
  const params = new URLSearchParams(location.search);
  const action = params.get("action");
  const notificationId = params.get("notification");
  const taskId = params.get("task");
  if (!action && !notificationId && !taskId) return;
  history.replaceState(history.state, "", location.pathname + location.hash);
  if (action === "new-task") newTask();
  if (notificationId || taskId) notificationClickHandler({ notificationId, taskId });
}

export function initPwa({ onOffline } = {}) {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // show our own Install button instead of the mini-infobar
    installPrompt = e;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    emit();
  });
  window.addEventListener("offline", () => onOffline?.());

  if (!serviceWorkerSupported()) return;
  navigator.serviceWorker.addEventListener("controllerchange", emit);
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.type === "notification-click") notificationClickHandler(e.data);
  });
  navigator.serviceWorker.register("sw.js", { scope: "./" })
    .then((reg) => { registration = reg; emit(); })
    .catch(() => { /* offline support stays unavailable; Settings says so */ });
}
