#!/usr/bin/env node
/**
 * Pull the Rating and Valuation Department's property market statistics and
 * flatten them into one compact JSON file the page can read.
 *
 * Run:  node scripts/fetch-rvd.mjs            -> writes data/market.json
 *       node scripts/fetch-rvd.mjs --check    -> fetch and report, write nothing
 *
 * Why this exists rather than fetching from the browser: rvd.gov.hk serves the
 * CSVs without an Access-Control-Allow-Origin header, so a page on another
 * origin cannot read them. Fetching here, at build time, also means the page
 * loads one small file, works offline, and leaves a git history of the monthly
 * revisions (RVD marks recent periods "P" for provisional and restates them).
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "data/market.json");
const CHECK = process.argv.includes("--check");

/* The catalogue lists many of these over plain http, which a page served over
   https would refuse to load. The same files are served over https, so every
   URL here is https and stays that way. */
const BASE = "https://www.rvd.gov.hk/datagovhk/";
const SOURCES = [
  { key: "pxQ",    file: "1.4Q.csv", freq: "Q", label: "Private domestic price index by class, quarterly" },
  { key: "rentQ",  file: "1.3Q.csv", freq: "Q", label: "Private domestic rental index by class, quarterly" },
  { key: "pxM",    file: "1.4M.csv", freq: "M", label: "Private domestic price index by class, monthly" },
  { key: "rentM",  file: "1.3M.csv", freq: "M", label: "Private domestic rental index by class, monthly" },
  { key: "yieldM", file: "5.1M.csv", freq: "M", label: "Private domestic gross yields by class, monthly" },
];

/* ---------- CSV ---------- */
function parseCsv(text) {
  return text.split(/\r?\n/).filter(l => l.trim() !== "").map(line => {
    const out = [];
    let cell = "", quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === "," && !quoted) { out.push(cell); cell = ""; }
      else cell += ch;
    }
    out.push(cell);
    return out.map(s => s.trim());
  });
}

/* RVD files open with a title row, then the header, then the data. Each value
   column is followed by its own "… - Remarks" column, which carries P for
   provisional and R for revised. */
const CLASS_COLS = [
  [/^(Domestic )?Class A$/i,     "A"],
  [/^(Domestic )?Class B$/i,     "B"],
  [/^(Domestic )?Class C$/i,     "C"],
  [/^(Domestic )?Class D$/i,     "D"],
  [/^(Domestic )?Class E$/i,     "E"],
  [/^Classes A, B & C$/i,        "ABC"],
  [/^Classes D & E$/i,           "DE"],
  [/^All Classes$/i,             "All"],
];

const PERIOD = {
  // "01-1993"
  M: { re: /^(\d{2})-(\d{4})$/, key: m => `${m[2]}-${m[1]}` },
  // "10-12/1979"
  Q: { re: /^(\d{2})-(\d{2})\/(\d{4})$/, key: m => `${m[3]}Q${Math.ceil(Number(m[2]) / 3)}` },
};

function extract(text, freq) {
  const rows = parseCsv(text);
  const header = rows[1] || [];
  const cols = [];
  for (const [re, name] of CLASS_COLS) {
    const i = header.findIndex(h => re.test(h));
    if (i >= 0) cols.push({ name, i });
  }
  if (!cols.length) throw new Error("no recognised class columns");

  const { re, key } = PERIOD[freq];
  const periods = [], values = [];
  let provFrom = null;
  for (const row of rows.slice(2)) {
    const m = re.exec(row[0] || "");
    if (!m) continue;
    periods.push(key(m));
    values.push(cols.map(c => {
      const raw = (row[c.i] ?? "").trim();
      const n = Number(raw);
      return raw === "" || raw === "-" || !Number.isFinite(n) ? null : n;
    }));
    // the remarks column sits immediately after each value column
    const flags = cols.map(c => (row[c.i + 1] ?? "").trim().toUpperCase());
    if (provFrom === null && flags.some(f => f === "P")) provFrom = periods.length - 1;
  }
  if (!periods.length) throw new Error("no data rows");
  return { freq, start: periods[0], end: periods[periods.length - 1],
           cols: cols.map(c => c.name), v: values,
           provFrom: provFrom === null ? values.length : provFrom };
}

/* The publication day of a Last-Modified header, in UTC. */
const pubDate = h => {
  const t = h ? Date.parse(h) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
};

/* ---------- fetch ---------- */
async function get(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "hk-buy-vs-rent/1.0 (data refresh)" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { text: await res.text(), modified: res.headers.get("last-modified") };
    } catch (e) {
      last = e;
      if (i < tries - 1) await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw new Error(`${url}: ${last.message}`);
}

const main = async () => {
  const series = {}, meta = [];
  for (const s of SOURCES) {
    const url = BASE + s.file;
    const { text, modified } = await get(url);
    const parsed = extract(text, s.freq);
    series[s.key] = parsed;
    meta.push({ key: s.key, label: s.label, url, modified: pubDate(modified),
                span: `${parsed.start} to ${parsed.end}`, rows: parsed.v.length });
    console.log(`  ${s.key.padEnd(7)} ${String(parsed.v.length).padStart(4)} rows  `
      + `${parsed.start} to ${parsed.end}  cols ${parsed.cols.join(",")}`
      + (parsed.provFrom < parsed.v.length
          ? `  ${parsed.v.length - parsed.provFrom} provisional` : ""));
  }

  /* The vintage is the day the newest source file was published, not the time
     this ran, so a fetch that finds nothing new writes a byte-identical file
     and the workflow stays silent. Dates, not timestamps: rvd.gov.hk sits
     behind something that reports Last-Modified a second either side of the
     real value between requests, which was enough to produce a commit a month
     with no change in any figure. These files are published once a day. */
  const days = meta.map(m => m.modified).filter(Boolean).sort();
  const out = {
    vintage: days.length ? days[days.length - 1] : "",
    source: {
      name: "Rating and Valuation Department, Hong Kong SAR Government",
      via: "https://data.gov.hk/en-data/dataset/hk-rvd-tsinfo_rvd-property-market-statistics",
      terms: "https://data.gov.hk/en/terms-and-conditions",
      note: "Indices are quality-adjusted territory-wide averages. Recent periods are "
          + "provisional and get revised. Class A is under 40 m2 saleable, B 40-69.9, "
          + "C 70-99.9, D 100-159.9, E 160 m2 and over.",
    },
    files: meta,
    series,
  };

  if (CHECK) { console.log("\n--check: nothing written"); return; }
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out));
  const kb = (JSON.stringify(out).length / 1024).toFixed(1);
  console.log(`\nwrote data/market.json  ${kb} kB  vintage ${out.vintage}`);
};

main().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
