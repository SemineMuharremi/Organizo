/**
 * Render the PNG app icons from the SVG sources in assets/icons/ using headless
 * Chrome/Edge (no image libraries needed).
 *
 *   npm run icons:png
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { launchBrowser, ROOT } from "../tests/helpers/browser.mjs";

const DIR = join(ROOT, "assets", "icons");
const OUTPUTS = [
  { svg: "icon.svg", file: "icon-192.png", size: 192 },
  { svg: "icon.svg", file: "icon-512.png", size: 512 },
  { svg: "icon-maskable.svg", file: "icon-maskable-512.png", size: 512 },
  // iOS rounds the corners itself, so the touch icon uses the full-bleed artwork.
  { svg: "icon-maskable.svg", file: "apple-touch-icon.png", size: 180 },
];

const b = await launchBrowser();
try {
  for (const { svg, file, size } of OUTPUTS) {
    await b.viewport(size, size);
    await b.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
    const source = readFileSync(join(DIR, svg), "utf8");
    const page = `<html><body style="margin:0;background:transparent">${source.replace("<svg ", `<svg width="${size}" height="${size}" style="display:block" `)}</body></html>`;
    await b.goto(`data:text/html;base64,${Buffer.from(page).toString("base64")}`, 100);
    await b.shot(join(DIR, file));
    console.log(`assets/icons/${file} (${size}×${size})`);
  }
} finally {
  await b.close();
}
