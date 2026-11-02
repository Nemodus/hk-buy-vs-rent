#!/usr/bin/env node
/**
 * Inject data/market.json into index.html.
 *
 * The page is a single self-contained file, so the market data is embedded in
 * a <script type="application/json" id="mkt"> block. That way it works when
 * opened from disk, when published as an artifact (which cannot fetch at all),
 * and when served from GitHub Pages. Served over http(s) the page additionally
 * tries data/market.json and upgrades itself if that copy is newer, so a data
 * refresh shows up without anyone having to rebuild the HTML.
 *
 * Run:  node scripts/build.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = resolve(ROOT, "index.html");
const DATA = resolve(ROOT, "data/market.json");

const OPEN = '<script type="application/json" id="mkt">';
const CLOSE = "</script>";

const json = await readFile(DATA, "utf8");
JSON.parse(json);                                  // fail loudly on bad data
if (json.includes("</script")) throw new Error("data contains a script close tag");

let html = await readFile(PAGE, "utf8");
const i = html.indexOf(OPEN);
if (i < 0) throw new Error(`${PAGE} has no ${OPEN} block to fill`);
const j = html.indexOf(CLOSE, i + OPEN.length);
if (j < 0) throw new Error("unterminated data block");

const before = html.slice(i + OPEN.length, j);
if (before === json) { console.log("index.html already current, nothing to do"); process.exit(0); }

html = html.slice(0, i + OPEN.length) + json + html.slice(j);
await writeFile(PAGE, html);

const d = JSON.parse(json);
console.log(`embedded ${(json.length / 1024).toFixed(1)} kB  vintage ${d.vintage}`);
for (const f of d.files) console.log(`  ${f.key.padEnd(7)} ${f.span}`);
