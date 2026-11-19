/**
 * Hash router. Routes look like "#/today" or "#/project/<id>" so the app works
 * from any static host without server-side rewrites.
 */
const listeners = new Set();
export const ROUTES = ["dashboard", "inbox", "today", "upcoming", "all", "completed", "calendar", "settings", "project"];

export function parseRoute(hash = location.hash) {
  const [name, param] = hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  if (!ROUTES.includes(name) || (name === "project" && !param)) return { name: "dashboard", param: null };
  return { name, param: param ?? null };
}

export const currentRoute = () => parseRoute();

export function navigate(name, param) {
  const hash = `#/${name}${param ? `/${encodeURIComponent(param)}` : ""}`;
  if (location.hash === hash) listeners.forEach((fn) => fn(parseRoute()));
  else location.hash = hash;
}

export function onRouteChange(fn) {
  listeners.add(fn);
}

window.addEventListener("hashchange", () => listeners.forEach((fn) => fn(parseRoute())));
