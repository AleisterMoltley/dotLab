#!/usr/bin/env node
// Recapture README chrome shots from the HTML mocks.
import { pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../../playtest/node_modules/playwright/index.mjs";

const dir = dirname(fileURLToPath(import.meta.url));
const names = ["studio", "play", "zoo"];

const browser = await chromium.launch();
for (const name of names) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 2,
  });
  await page.goto(pathToFileURL(resolve(dir, `${name}.html`)).href);
  await page.screenshot({ path: resolve(dir, `${name}.png`), type: "png" });
  await page.close();
  console.log(`wrote ${name}.png`);
}
await browser.close();
