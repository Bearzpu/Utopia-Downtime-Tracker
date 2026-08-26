(function () {
  const cfg = window.MONITOR_CONFIG || {};
  const refreshSeconds = cfg.refreshSeconds || 60;

  const els = {
    seal: document.getElementById("seal"),
    sealWord: document.getElementById("seal-word"),
    lastChecked: document.getElementById("stat-last-checked"),
    responseTime: document.getElementById("stat-response-time"),
    uptimePct: document.getElementById("stat-uptime-pct"),
    count: document.getElementById("stat-count"),
    timelineWrap: document.getElementById("timeline-wrap"),
    responseWrap: document.getElementById("response-wrap"),
    outageList: document.getElementById("outage-list"),
    footerRepo: document.getElementById("footer-repo"),
    footerRefresh: document.getElementById("footer-refresh"),
  };

  els.footerRefresh.textContent = String(refreshSeconds);

  function dataUrl() {
    return `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${cfg.branch}/${cfg.dataPath}?t=${Date.now()}`;
  }

  function isConfigured() {
    return cfg.owner && cfg.owner !== "YOUR_GITHUB_USERNAME" && cfg.repo && cfg.repo !== "YOUR_REPO_NAME";
  }

  function fmtTime(iso) {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  }

  function fmtDuration(ms) {
    const totalMin = Math.round(ms / 60000);
    if (totalMin < 1) return "under a minute";
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h === 0) return `${m}m`;
    return `${h}h ${m}m`;
  }

  // Pull a stated duration (in minutes) out of maintenance text like
  // "expected to take 15 minutes" or "expected to take 2 hours".
  // Prefers the structured field logged by check-site.mjs; falls back to
  // parsing the raw text for older log entries that predate that field.
  function parseStatedMinutes(row) {
    if (row && typeof row.maintenance_stated_minutes === "number") return row.maintenance_stated_minutes;
    const text = row && row.maintenance_text;
    if (!text) return null;
    const m = text.match(/expected to take\s+(\d+)\s*(minute|hour)/i);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return /hour/i.test(m[2]) ? n * 60 : n;
  }

  // Cheap deterministic hash so the same outage always gets the same joke
  // on every refresh, instead of the punchline changing every 60 seconds.
  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }
  function pick(list, seed) {
    return list[hashStr(seed) % list.length];
  }

  function computeStreaks(rows) {
    const streaks = [];
    let current = null;
    for (const row of rows) {
      if (row.status === "DOWN") {
        if (!current) {
          current = { start: row, end: row, maintRows: [], firstMaintRow: null };
        } else {
          current.end = row;
        }
        if (row.maintenance_detected && row.maintenance_text) {
          current.maintRows.push(row);
          if (!current.firstMaintRow) current.firstMaintRow = row;
        }
      } else if (current) {
        streaks.push(current);
        current = null;
      }
    }
    if (current) streaks.push(current);
    return streaks;
  }

  function renderSeal(latest) {
    if (!latest) return;
    const up = latest.status === "UP";
    els.seal.className = "seal " + (up ? "seal--up" : "seal--down");
    els.sealWord.textContent = up ? "The Gate Holds" : "Breach";
    els.lastChecked.textContent = fmtTime(latest.timestamp);
    els.responseTime.textContent = latest.response_time_ms != null ? `${latest.response_time_ms} ms` : "—";
  }

  function renderStats(rows) {
    const upCount = rows.filter((r) => r.status === "UP").length;
    const pct = rows.length ? ((upCount / rows.length) * 100).toFixed(1) : "—";
    els.uptimePct.textContent = rows.length ? `${pct}%` : "—";
    els.count.textContent = String(rows.length);
  }

  function renderTimeline(rows) {
    const w = Math.max(rows.length * 6, 600);
    const h = 56;
    const barH = 28;
    const y = (h - barH) / 2;

    if (!rows.length) {
      els.timelineWrap.innerHTML = '<p class="empty-state">No checks logged yet. Once the watcher runs, its findings will appear here.</p>';
      return;
    }

    const bars = rows.map((r, i) => {
      const x = i * 6;
      const color = r.status === "UP" ? "var(--up)" : "var(--down)";
      const title = `${fmtTime(r.timestamp)} · ${r.status}${r.http_status_code ? " · " + r.http_status_code : ""}`;
      return `<rect x="${x}" y="${y}" width="5" height="${barH}" fill="${color}" rx="1"><title>${escapeXml(title)}</title></rect>`;
    }).join("");

    els.timelineWrap.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMinYMid meet" role="img" aria-label="Uptime timeline">${bars}</svg>`;
  }

  // Rounds a max value up to a "nice" number (multiple of 1/2/5 * 10^n) so
  // axis ticks read as sane round numbers instead of e.g. "437.3ms".
  function niceCeil(value) {
    if (value <= 0) return 10;
    const exp = Math.floor(Math.log10(value));
    const magnitude = Math.pow(10, exp);
    const frac = value / magnitude;
    let niceFrac;
    if (frac <= 1) niceFrac = 1;
    else if (frac <= 2) niceFrac = 2;
    else if (frac <= 5) niceFrac = 5;
    else niceFrac = 10;
    return niceFrac * magnitude;
  }

  function renderResponseChart(rows) {
    const withTimes = rows.filter((r) => typeof r.response_time_ms === "number");
    if (!withTimes.length) {
      els.responseWrap.innerHTML = '<p class="empty-state">No response-time data yet.</p>';
      return;
    }

    const leftPad = 56;
    const rightPad = 12;
    const topPad = 14;
    const bottomPad = 26;
    const plotW = Math.max(rows.length * 6, 600);
    const plotH = 160;
    const w = plotW + leftPad + rightPad;
    const h = plotH + topPad + bottomPad;

    const rawMax = Math.max(...withTimes.map((r) => r.response_time_ms), 10);
    const max = niceCeil(rawMax * 1.05);
    const avg = withTimes.reduce((sum, r) => sum + r.response_time_ms, 0) / withTimes.length;

    const xFor = (i) => leftPad + i * 6 + 2;
    const yFor = (val) => topPad + plotH - (val / max) * plotH;

    const points = rows.map((r, i) => {
      const val = typeof r.response_time_ms === "number" ? r.response_time_ms : 0;
      return { x: xFor(i), y: yFor(val), status: r.status };
    });

    const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y.toFixed(1)}`).join(" ");
    const dots = points.map((p) =>
      `<circle cx="${p.x}" cy="${p.y.toFixed(1)}" r="2.2" fill="${p.status === "UP" ? "var(--up)" : "var(--down)"}" />`
    ).join("");

    // Y axis: 5 evenly spaced gridlines/labels from 0 to max, in ms.
    const yTickCount = 4;
    const yTicks = Array.from({ length: yTickCount + 1 }, (_, i) => Math.round((max / yTickCount) * i));
    const yAxis = yTicks.map((val) => {
      const y = yFor(val);
      return `
        <line x1="${leftPad}" y1="${y.toFixed(1)}" x2="${leftPad + plotW}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="1" opacity="0.6" />
        <text x="${leftPad - 8}" y="${y.toFixed(1)}" text-anchor="end" dominant-baseline="middle" class="chart-axis-label">${val}ms</text>`;
    }).join("");

    // X axis: up to ~7 evenly spaced timestamp labels along the bottom.
    const xTickCount = Math.min(7, rows.length);
    const xAxis = Array.from({ length: xTickCount }, (_, i) => {
      const idx = xTickCount === 1 ? 0 : Math.round((i * (rows.length - 1)) / (xTickCount - 1));
      const x = xFor(idx);
      return `<text x="${x}" y="${topPad + plotH + 18}" text-anchor="middle" class="chart-axis-label">${escapeXml(fmtTime(rows[idx].timestamp))}</text>`;
    }).join("");

    const avgY = yFor(avg);
    const avgLine = `
      <line x1="${leftPad}" y1="${avgY.toFixed(1)}" x2="${leftPad + plotW}" y2="${avgY.toFixed(1)}" stroke="var(--gold-bright)" stroke-width="1" stroke-dasharray="4 3" opacity="0.8" />
      <text x="${leftPad + plotW - 4}" y="${(avgY - 5).toFixed(1)}" text-anchor="end" class="chart-axis-label chart-axis-label--avg">avg ${Math.round(avg)}ms</text>`;

    els.responseWrap.innerHTML = `
      <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMinYMid meet" role="img" aria-label="Response time over time, in milliseconds">
        ${yAxis}
        <line x1="${leftPad}" y1="${topPad}" x2="${leftPad}" y2="${topPad + plotH}" stroke="var(--border)" stroke-width="1" />
        <line x1="${leftPad}" y1="${topPad + plotH}" x2="${leftPad + plotW}" y2="${topPad + plotH}" stroke="var(--border)" stroke-width="1" />
        <path d="${path}" fill="none" stroke="var(--gold)" stroke-width="1.2" opacity="0.55" />
        ${avgLine}
        ${dots}
        ${xAxis}
      </svg>`;
  }

  // --- Joke banks -----------------------------------------------------
  // Picked deterministically per-outage (see pick()/hashStr()) so the same
  // breach always shows the same punchline rather than reshuffling on
  // every 60s refresh. Flavor is drawn from Utopia's own self-aware
  // maintenance-page humor ("Big Plans. Zero Deadlines.", "Coming
  // tomorrow... probably.") and the kingdom's long, storied history of
  // roasting the devs about it themselves.

  const JOKES_ACCURATE = [
    "The estimate held. Mark the calendar — some say it happens once an age.",
    "On time, as promised. Suspicious. Possibly a clerical error in our favor.",
    "A correct estimate. We checked twice. It's real.",
    "Deadlines met. Somewhere, a kingdom is renaming a province in disbelief.",
  ];
  const JOKES_MILD = (over, stated) => [
    `"${stated}m," they said. It ran ${over}m over. A modest exaggeration, by Utopia standards.`,
    `${over}m past the promise. Rounding error, presumably, on a scale of minutes.`,
    `The herald said ${stated}m. Reality billed ${over}m extra. No refunds issued.`,
    `Big plans, ${over} extra minutes of deadline. Business as usual.`,
  ];
  const JOKES_MODERATE = (over, stated, actual) => [
    `Promised ${stated}m, delivered ${actual}m. The estimate and the outcome have never met.`,
    `${over}m over the stated ${stated}m. "Routine maintenance" is doing a lot of lifting here.`,
    `The gap between promise and reality is now large enough to have its own weather.`,
    `"Coming tomorrow... probably" energy, but for a ${stated}-minute window.`,
  ];
  const JOKES_SEVERE = (over, stated, actual) => [
    `Promised ${stated}m. Delivered ${actual}m. At this rate "brief maintenance" should be redefined as a geological era.`,
    `${over}m past the estimate. The Developers' Almanac lists this under "optimism, catastrophic."`,
    `A ${stated}-minute promise stretched to ${actual} minutes. The kingdom has aged visibly.`,
    `Big Plans. Zero Deadlines. As advertised, apparently.`,
    `"We tried (sorta)" — an increasingly literal banner.`,
  ];
  const JOKES_LEGENDARY = (actual) => [
    `The record for this sort of thing is still "10 hours" that ran five days. This one's a contender at ${actual}.`,
    `${actual} down. Somewhere, "10hrs" is laughing from its place in the history books.`,
    `A new entry for the almanac, filed right next to the age's infamous "10 hours" — which, as every province name reminds us, was also a lie.`,
  ];
  const JOKES_SILENT_SHORT = [
    "No official word. The gate simply closed and reopened, unremarked upon.",
    "No herald, no explanation. The silent treatment, apparently, is a maintenance strategy.",
  ];
  const JOKES_SILENT_LONG = (hrs) => [
    `No official word for ${hrs}. The kingdom vanished without so much as a raven sent ahead.`,
    `Down for ${hrs} with zero explanation. Silence, it seems, is also a form of communication.`,
    `${hrs} of nothing. Not even a "coming tomorrow... probably."`,
  ];
  const JOKES_RETROACTIVE = (silent) => [
    `The gate sat broken for ${silent} before anyone called it "maintenance." A miraculous rebrand.`,
    `${silent} of unexplained 502s, quietly reclassified as "routine maintenance" once someone noticed.`,
    `First it was just broken. After ${silent}, it became "planned." Retroactive continuity at its finest.`,
    `${silent} of silence, then a banner appeared as if it had been the plan all along.`,
  ];
  const JOKES_GOALPOSTS = (values) => [
    `The estimate crept from ${values} live on the page — a real-time downgrade of expectations.`,
    `The promise evolved mid-outage: ${values}. Confidence, much like the estimate, was not fixed.`,
    `${values} — the estimate aged worse than the outage itself.`,
  ];

  function buildOutageCommentary(s, actualMs, stated, distinctStatedValues, silentMs) {
    const seed = s.start.timestamp;
    const actualMin = Math.round(actualMs / 60000);
    const bits = [];

    // Retroactive-maintenance gag: it sat as a hard, unexplained error for
    // over an hour before a maintenance message ever showed up.
    if (s.firstMaintRow && silentMs >= 60 * 60 * 1000) {
      bits.push({
        text: pick(JOKES_RETROACTIVE(fmtDuration(silentMs)), seed + "retro"),
        cls: "over",
        badge: "Retroactive Maintenance?",
      });
    }

    if (stated != null) {
      const diff = actualMin - stated;
      const ratio = stated > 0 ? actualMin / stated : Infinity;
      let joke, cls;
      if (ratio <= 1.15) {
        joke = pick(JOKES_ACCURATE, seed + "acc");
        cls = "on-time";
      } else if (ratio <= 2) {
        joke = pick(JOKES_MILD(diff, stated), seed + "mild");
        cls = "over";
      } else if (ratio <= 5) {
        joke = pick(JOKES_MODERATE(diff, stated, actualMin), seed + "mod");
        cls = "over";
      } else {
        joke = pick(JOKES_SEVERE(diff, stated, actualMin), seed + "sev");
        cls = "over";
      }
      bits.push({ text: joke, cls });
    } else if (!s.firstMaintRow) {
      // Never got any maintenance message at all this whole streak.
      if (actualMs >= 60 * 60 * 1000) {
        bits.push({ text: pick(JOKES_SILENT_LONG(fmtDuration(actualMs)), seed + "sl"), cls: "over" });
      } else {
        bits.push({ text: pick(JOKES_SILENT_SHORT, seed + "ss"), cls: "over" });
      }
    }

    // Legendary-tier easter egg: this one's keeping company with the
    // age's infamous "10 hours" that ran five days. Triggers on either a
    // huge stated/actual ratio or just a genuinely enormous outage,
    // regardless of whether a duration was ever stated.
    const massivelyOverstated = stated != null && stated > 0 && actualMin / stated >= 15;
    const genuinelyEnormous = actualMs >= 24 * 60 * 60 * 1000;
    if (massivelyOverstated || genuinelyEnormous) {
      bits.push({ text: pick(JOKES_LEGENDARY(fmtDuration(actualMs)), seed + "leg"), cls: "over" });
    }

    if (distinctStatedValues.length > 1) {
      const values = distinctStatedValues.map((v) => `${v}m`).join(" → ");
      bits.push({ text: pick(JOKES_GOALPOSTS(values), seed + "gp"), cls: "over" });
    }

    return bits;
  }

  function renderOutages(streaks) {
    if (!streaks.length) {
      els.outageList.innerHTML = '<p class="empty-state">No breaches recorded. The gate has held for the entire watch.</p>';
      return;
    }

    const cards = streaks.slice().reverse().map((s, idx) => {
      const n = streaks.length - idx;
      const startT = new Date(s.start.timestamp);
      const endT = new Date(s.end.timestamp);
      const actualMs = Math.max(endT - startT, 0);

      const stated = s.firstMaintRow ? parseStatedMinutes(s.firstMaintRow) : null;
      const distinctStatedValues = [];
      for (const r of s.maintRows) {
        const v = parseStatedMinutes(r);
        if (v != null && !distinctStatedValues.includes(v)) distinctStatedValues.push(v);
      }
      const silentMs = s.firstMaintRow
        ? new Date(s.firstMaintRow.timestamp) - startT
        : actualMs;

      const commentary = buildOutageCommentary(s, actualMs, stated, distinctStatedValues, silentMs);

      const badge = commentary.find((c) => c.badge);
      const badgeHtml = badge
        ? `<span class="outage-card__badge">${escapeXml(badge.badge)}</span>`
        : "";

      const quipsHtml = commentary
        .map((c) => `<p class="outage-card__verdict outage-card__verdict--${c.cls === "on-time" ? "on-time" : "over"}">${escapeXml(c.text)}</p>`)
        .join("");

      const heraldHtml = s.firstMaintRow
        ? `<div class="outage-card__herald"><span class="outage-card__herald-label">Herald's message</span>${escapeXml(s.firstMaintRow.maintenance_text)}</div>`
        : `<div class="outage-card__herald"><span class="outage-card__herald-label">Herald's message</span>None found — the kingdom offered no explanation.</div>`;

      return `
        <div class="outage-card">
          <div class="outage-card__head">
            <span class="outage-card__title">Breach #${n}</span>
            ${badgeHtml}
            <span class="outage-card__duration">${fmtDuration(actualMs)} observed</span>
          </div>
          <p class="outage-card__range">${fmtTime(s.start.timestamp)} → ${fmtTime(s.end.timestamp)}</p>
          ${heraldHtml}
          ${quipsHtml}
        </div>`;
    }).join("");

    els.outageList.innerHTML = cards;
  }

  function escapeXml(s) {
    return String(s).replace(/[<>&"']/g, (c) => ({
      "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;",
    }[c]));
  }

  function renderError(message) {
    els.timelineWrap.innerHTML = `<p class="error-state">${escapeXml(message)}</p>`;
    els.responseWrap.innerHTML = "";
    els.outageList.innerHTML = "";
  }

  async function load() {
    els.footerRepo.textContent = `${cfg.owner || "?"}/${cfg.repo || "?"}`;

    if (!isConfigured()) {
      renderError("config.js still has placeholder values. Edit config.js with your GitHub username and repo name, then redeploy (or just push — Vercel will pick it up).");
      return;
    }

    try {
      const res = await fetch(dataUrl(), { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 404) {
          renderError("No data file found yet at that path. Make sure the GitHub Actions workflow has run at least once (check the Actions tab in your repo), and that config.js points at the right owner/repo/branch.");
        } else {
          renderError(`Could not load data (HTTP ${res.status}).`);
        }
        return;
      }
      const rows = await res.json();
      if (!Array.isArray(rows) || !rows.length) {
        renderError("The data file is empty. The watcher hasn't logged a check yet — give the scheduled workflow a few minutes, or trigger it manually from the Actions tab.");
        return;
      }

      renderSeal(rows[rows.length - 1]);
      renderStats(rows);
      renderTimeline(rows);
      renderResponseChart(rows);
      renderOutages(computeStreaks(rows));
    } catch (err) {
      renderError("Failed to fetch or parse the data file: " + (err && err.message ? err.message : err));
    }
  }

  load();
  setInterval(load, refreshSeconds * 1000);
})();
