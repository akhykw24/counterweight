/**
 * Print the results document to PDF using the Chromium that Playwright already
 * installs for the end-to-end suite.
 *
 * The alternative was pandoc plus a LaTeX distribution, which is roughly two
 * gigabytes of image for one document whose only real requirement is that it
 * paginates. Chromium is already a dependency, so this is free.
 *
 *   node scripts/html-to-pdf.mjs paper/results.html paper/results.pdf
 */

import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const [input, output] = process.argv.slice(2);

if (!input || !output) {
  console.error("usage: node scripts/html-to-pdf.mjs <input.html> <output.pdf>");
  process.exit(2);
}

const inputPath = resolve(input);
if (!existsSync(inputPath)) {
  console.error(`${inputPath} does not exist. Run pipeline/report.py first.`);
  process.exit(2);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  // file:// rather than setContent, so the base64-embedded figure resolves the
  // same way it does when the HTML is opened by hand.
  await page.goto(pathToFileURL(inputPath).href, { waitUntil: "networkidle" });
  await page.pdf({
    path: resolve(output),
    format: "A4",
    printBackground: true,
    margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" },
  });
  console.log(`-> ${output}`);
} finally {
  await browser.close();
}
