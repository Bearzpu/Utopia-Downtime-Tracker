#!/usr/bin/env node
/**
 * check-site.mjs
 *
 * Checks a website's status, appends the result to data/uptime_log.json
 * (and regenerates data/uptime_log.csv from it), and tries to extract any
 * "under maintenance" text + stated duration from the page.
 *
 * Designed to run as a GitHub Actions scheduled job (see
 * .github/workflows/monitor.yml) so it works without your PC being on.
 * Uses only Node's built-in fetch (Node 18+) - no npm install required.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const JSON_PATH = path.join(DATA_DIR, "uptime_log.json");
const CSV_PATH = path.join(DATA_DIR, "uptime_log.csv");

const TARGET_URL = process.env.MONITOR_URL || "https://utopia-game.com";
const TIMEOUT_MS = 10000;

// Keywords that show up on maintenance / "server update" pages.
// Tuned to match Utopia's actual maintenance screen wording as well as
// generic phrasing other sites use.
const MAINTENANCE_KEYWORDS = [
  "maintenance",
  "server update in progress",
  "routine maintenance",
  "temporarily unavailable",
  "temporarily down",
  "be right back",
  "scheduled downtime",
  "undergoing upgrades",
];

// Patterns that capture a stated duration / start time / ETA.
// Includes Utopia's specific phrasing: "Maintenance started at 04:01 GMT"
// and "expected to take 15 minutes".
const DURATION_PATTERNS = [
  /maintenance started at\s+[^.\n]{1,40}/i,
  /expected to take\s+[^.\n]{1,40}/i,
  /back (?:up )?(?:at|by|around|in)\s+[^.\n]{1,40}/i,
  /until\s+[^.\n]{1,40}/i,
  /down for\s+[^.\n]{1,40}/i,
  /should be (?:back|resolved)[^.\n]{1,40}/i,
  /reason:\s*[^.\n]{1,80}/i,
];

function stripHtml(html) {
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<[^>]+>/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

function extractMaintenanceInfo(html) {
  const empty = { detected: false, context: "", statedMinutes: null, startedAtRaw: "" };
  if (!html) return empty;
  const text = stripHtml(html);
  const lower = text.toLowerCase();

  const hasKeyword = MAINTENANCE_KEYWORDS.some((kw) => lower.includes(kw));
  if (!hasKeyword) return empty;

  const sentences = text.split(/(?<=[.!?])\s+/);
  const relevant = sentences
    .filter((s) => MAINTENANCE_KEYWORDS.some((kw) => s.toLowerCase().includes(kw)))
    .slice(0, 3);

  const durationHits = [];
  for (const pattern of DURATION_PATTERNS) {
    const m = text.match(pattern);
    if (m) durationHits.push(m[0].trim());
  }

  let context = relevant.join(" | ");
  if (durationHits.length) {
    context += "  [details: " + durationHits.slice(0, 4).join("; ") + "]";
  }

  // Pull the *number* out of "expected to take 15 minutes" so it's a real
  // data column (maintenance_stated_minutes) instead of just being buried
  // in a text blob - this is what lets the dashboard actually compare
  // "what they promised" against "what really happened."
  const statedMinutes = parseStatedMinutes(text);

  // Also grab just the clock time from "started at HH:MM [GMT/UTC]" for
  // display purposes (stops at the time+zone, not the rest of the sentence).
  const startedAtMatch = text.match(/maintenance started at\s+(\d{1,2}:\d{2}\s*[A-Za-z]{0,4})/i);
  const startedAtRaw = startedAtMatch ? startedAtMatch[1].trim() : "";

  return {
    detected: true,
    context: context.slice(0, 500),
    statedMinutes,
    startedAtRaw,
  };
}

// Parses "expected to take 15 minutes" / "expected to take 2 hours" into a
// plain number of minutes. Returns null if no such phrase is present -
// this is a pattern match against whatever number/unit actually appears
// on the page, not a search for a fixed string like "15 minutes".
function parseStatedMinutes(text) {
  const m = text.match(/expected to take\s+(\d+)\s*(minute|hour)/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return /hour/i.test(m[2]) ? n * 60 : n;
}

async function checkSite(url, timeoutMs = TIMEOUT_MS) {
  const row = {
    timestamp: new Date().toISOString(),
    status: "DOWN",
    http_status_code: null,
    response_time_ms: null,
    maintenance_detected: false,
    maintenance_text: "",
    maintenance_stated_minutes: null,
    maintenance_started_at_raw: "",
    error_message: "",
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "utopia-uptime-monitor/1.0" },
      redirect: "follow",
    });
    row.response_time_ms = Date.now() - start;
    row.http_status_code = res.status;
    // A 502/503/504 (or any non-2xx) counts as DOWN, matching the
    // "hard down" nginx error screen as well as app-level errors.
    row.status = res.ok ? "UP" : "DOWN";

    const text = await res.text();
    const { detected, context, statedMinutes, startedAtRaw } = extractMaintenanceInfo(text);
    row.maintenance_detected = detected;
    row.maintenance_text = context;
    row.maintenance_stated_minutes = statedMinutes;
    row.maintenance_started_at_raw = startedAtRaw;
  } catch (err) {
    row.response_time_ms = Date.now() - start;
    row.status = "DOWN";
    row.error_message = String(err && err.message ? err.message : err).slice(0, 300);
  } finally {
    clearTimeout(timer);
  }

  return row;
}

function loadExisting() {
  if (!existsSync(JSON_PATH)) return [];
  try {
    const raw = readFileSync(JSON_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function csvEscape(val) {
  const s = val === null || val === undefined ? "" : String(val);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeOutputs(rows) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(JSON_PATH, JSON.stringify(rows, null, 2) + "\n", "utf-8");

  const header = [
    "timestamp",
    "status",
    "http_status_code",
    "response_time_ms",
    "maintenance_detected",
    "maintenance_text",
    "maintenance_stated_minutes",
    "maintenance_started_at_raw",
    "error_message",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(header.map((h) => csvEscape(r[h])).join(","));
  }
  writeFileSync(CSV_PATH, lines.join("\n") + "\n", "utf-8");
}

async function main() {
  const rows = loadExisting();
  const row = await checkSite(TARGET_URL);
  rows.push(row);
  writeOutputs(rows);

  const maintFlag = row.maintenance_detected ? " [MAINTENANCE TEXT FOUND]" : "";
  console.log(
    `${row.timestamp}  ${row.status.padEnd(4)}  code=${String(row.http_status_code).padEnd(4)}  ${row.response_time_ms}ms${maintFlag}`
  );
  if (row.maintenance_detected) {
    console.log(`  -> ${row.maintenance_text}`);
  }
  if (row.error_message) {
    console.log(`  -> error: ${row.error_message}`);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}

export { extractMaintenanceInfo, checkSite };
