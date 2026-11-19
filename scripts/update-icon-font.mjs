/**
 * Rebuild the self-hosted Material Symbols icon font as a small subset that
 * contains only the icons the app uses.
 *
 *   npm run icons:font
 *
 * Run it after using a new icon name in the code. It:
 * 1. downloads the official list of Material Symbols names;
 * 2. finds every string literal in js/ and every text node in index.html
 *    that is a valid icon name (a few ordinary words also match, which only
 *    adds a few bytes);
 * 3. asks Google Fonts for a subset font with those icons and saves it to
 *    assets/fonts/, together with the list in assets/fonts/icon-names.txt.
 *
 * Needs network access; the app itself never contacts Google Fonts.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT = join(ROOT, "assets", "fonts");
const CODEPOINTS = "https://raw.githubusercontent.com/google/material-design-icons/master/variablefont/MaterialSymbolsRounded%5BFILL%2CGRAD%2Copsz%2Cwght%5D.codepoints";
// Keep these axes in sync with the .icon rule in css/base.css (opsz 20, FILL 0/1).
const FAMILY = "Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..24,400,0..1,0";
// Google Fonts serves WOFF2 only to browsers it recognises.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const walk = (dir) => readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

async function get(url, as = "text") {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return as === "text" ? res.text() : Buffer.from(await res.arrayBuffer());
}

const valid = new Set((await get(CODEPOINTS)).split("\n").map((l) => l.split(" ")[0]).filter(Boolean));

const candidates = new Set();
for (const file of walk(join(ROOT, "js")).filter((f) => f.endsWith(".js"))) {
  for (const [, s] of readFileSync(file, "utf8").matchAll(/["'`]([a-z][a-z0-9_]*)["'`]/g)) candidates.add(s);
}
for (const [, s] of readFileSync(join(ROOT, "index.html"), "utf8").matchAll(/>([a-z][a-z0-9_]*)</g)) candidates.add(s);

// Google Fonts requires the names in alphabetical order.
const names = [...candidates].filter((n) => valid.has(n)).sort();
const css = await get(`https://fonts.googleapis.com/css2?family=${FAMILY}&icon_names=${names.join(",")}&display=block`);
const fontUrl = css.match(/url\((https:[^)]+)\)\s*format\(['"]woff2['"]\)/)?.[1];
if (!fontUrl) throw new Error(`No WOFF2 URL in the Google Fonts response:\n${css}`);

mkdirSync(OUT, { recursive: true });
const font = await get(fontUrl, "buffer");
writeFileSync(join(OUT, "material-symbols-rounded.woff2"), font);
writeFileSync(join(OUT, "icon-names.txt"), names.join("\n") + "\n");
console.log(`Saved ${names.length} icons (${(font.length / 1024).toFixed(1)} KB) to assets/fonts/material-symbols-rounded.woff2`);
