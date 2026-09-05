# Utopia Realm Status — GitHub + Vercel monitor

Runs entirely in the cloud — your PC doesn't need to be on.

**How it works:**
- A **GitHub Actions** workflow checks `utopia-game.com` every 5 minutes, logs
  the result to `data/uptime_log.json` / `.csv`, and tries to pick out any
  "under maintenance" text (tuned to Utopia's actual maintenance page — it
  catches things like *"Maintenance started at 04:01 GMT... expected to take
  15 minutes"*). Non-2xx responses, including a 502 Bad Gateway, are logged
  as DOWN.
- A small static dashboard (hosted on **Vercel**) fetches that JSON file
  live from GitHub every time it's viewed, and shows an uptime timeline, a
  response-time chart, and a "Chronicle of Outages" that compares each
  outage's actual duration against what the maintenance message promised.

No server, no database, nothing to keep running yourself.

## Setup

### 1. Create the GitHub repo

Make a **public** repo (the dashboard reads the data file over GitHub's
public raw-content CDN with no auth — nothing sensitive is in there, just
timestamps and status codes). Push everything in this folder to it:

```bash
cd utopia-monitor-web
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### 2. Let Actions write to the repo

By default GitHub restricts what the built-in `GITHUB_TOKEN` can do, and
this workflow needs to commit the updated data file back. In your repo:

**Settings → Actions → General → Workflow permissions** → select
**"Read and write permissions"** → Save.

### 3. Check the workflow runs

Go to the **Actions** tab. You should see "Uptime Monitor" listed. Click it
→ **Run workflow** to trigger a manual check right away rather than waiting
for the schedule. After it finishes, `data/uptime_log.json` in your repo
should have one entry.

**Important:** GitHub's own `schedule:` trigger is not reliable at 5-minute
granularity — under load, GitHub silently spaces out high-frequency
scheduled workflows (we observed gaps of 2–5 hours instead of 5 minutes).
The `schedule:` cron in `monitor.yml` is now just an hourly failsafe. The
real 5-minute cadence comes from a **Cloudflare Worker** — see
[`cf-trigger/`](cf-trigger/) below.

### 4. Point the dashboard at your repo

Edit **`config.js`**:

```js
window.MONITOR_CONFIG = {
  owner: "YOUR_USERNAME",
  repo: "YOUR_REPO",
  branch: "main",
  dataPath: "data/uptime_log.json",
  refreshSeconds: 60,
};
```

Commit and push that change.

### 5. Deploy to Vercel

- [vercel.com](https://vercel.com) → **Add New → Project** → import the
  GitHub repo.
- Framework preset: **Other** (it's a plain static site — no build step,
  nothing to configure).
- Deploy.

You'll get a URL like `your-repo.vercel.app`. Open it — it should show
"loading…" briefly then populate once it fetches the data file. Vercel
doesn't need to redeploy when new checks come in; the page fetches fresh
JSON straight from GitHub every time it's loaded (and every 60s while
it's open).

## Reliable 5-minute triggering (Cloudflare Worker)

GitHub's `schedule:` trigger isn't honoured reliably at 5-minute intervals —
GitHub silently throttles high-frequency scheduled workflows under load, so
checks can end up hours apart instead of minutes. To get an actual 5-minute
cadence, a small Cloudflare Worker in [`cf-trigger/`](cf-trigger/) runs on
Cloudflare's own Cron Trigger and calls GitHub's `workflow_dispatch` API
directly, bypassing GitHub's scheduler entirely. `monitor.yml`'s own
`schedule:` cron is kept as an hourly failsafe in case the Worker is down.

### One-time setup

1. **Create a GitHub PAT** scoped to just this repo:
   Settings (your GitHub account) → Developer settings → Personal access
   tokens → Fine-grained tokens → **Generate new token**. Set:
   - Repository access: only this repo
   - Permissions: **Actions → Read and write**
   Copy the token — you won't see it again.

2. **Install Wrangler** (Cloudflare's CLI) if you don't have it:
   ```bash
   npm install -g wrangler
   wrangler login
   ```

3. **Deploy the Worker**:
   ```bash
   cd cf-trigger
   wrangler secret put GITHUB_PAT
   # paste the token from step 1 when prompted
   wrangler deploy
   ```

That's it — Cloudflare's free plan includes Cron Triggers, and 5-minute
invocations are well within the free tier's daily request limit. Check
**Cloudflare dashboard → Workers & Pages → utopia-uptime-trigger → Triggers**
to confirm the cron is active, and **Cron Events** in the same dashboard to
see it firing.

If you ever move the repo or rename the workflow file, update the
`GITHUB_OWNER` / `GITHUB_REPO` / `GITHUB_WORKFLOW_FILE` values in
`cf-trigger/wrangler.toml` and redeploy.

## Changing the monitored URL

Default target is `https://utopia-game.com`. To point at something else
without editing code, add a repo variable:
**Settings → Secrets and variables → Actions → Variables** →
new variable `MONITOR_URL` with your URL.

## Files

| File | Purpose |
|---|---|
| `.github/workflows/monitor.yml` | Scheduled job that runs the checker and commits results |
| `scripts/check-site.mjs` | The actual check + maintenance-text extraction (Node, no dependencies) |
| `data/uptime_log.json` / `.csv` | The growing log — this is your "spreadsheet" |
| `index.html`, `styles.css`, `app.js` | The dashboard Vercel serves |
| `config.js` | The one file you edit — your GitHub owner/repo |
| `cf-trigger/` | Cloudflare Worker that triggers the check reliably every 5 minutes |

## Testing the checker locally (optional)

If you have Node 18+ installed:

```bash
npm run check
```

This runs a single check against the configured URL and updates the local
`data/` files, same as what Actions does — useful for testing changes to
the maintenance-keyword list before pushing.

## How the "stated duration" is captured

You asked whether the times/durations get logged as actual data or just
searched for as fixed strings — it's the former. `scripts/check-site.mjs`
uses a regex (`/expected to take\s+(\d+)\s*(minute|hour)/i`) that captures
*whatever number and unit actually appear* on the page, not a search for a
literal "15 minutes". That parsed value is written into the CSV/JSON as its
own numeric column, `maintenance_stated_minutes`, alongside the raw text in
`maintenance_text` for reference. The clock time after "started at" is
similarly captured into `maintenance_started_at_raw`. So the spreadsheet
has real, usable numbers to work with, not just a blob of prose.

## The humor

The dashboard tracks the devs' credibility over time and isn't shy about
it:

- **Understated estimates** — every outage with a stated duration gets its
  actual length compared against the promise, and a joke picked to match
  how bad the miss was (mild exaggeration → "aged visibly" territory).
- **Moved goalposts** — if the stated duration changes mid-outage (e.g. a
  page originally says 15 minutes, then later says 60), that gets called
  out too.
- **"Retroactive Maintenance?"** — if the site sits on a hard error (like
  your 502) for over an hour with *no* maintenance message, and only later
  gets relabelled as maintenance, the outage gets a red badge and a
  dedicated joke about the suspiciously convenient timing.
- The rare case where the estimate is actually correct gets its own
  (equally sarcastic) acknowledgment.

Jokes are picked deterministically per-outage (based on a hash of when it
started), so a given breach shows the same punchline every time you reload
rather than reshuffling every 60 seconds. Want more/different jokes? The
joke banks are the `JOKES_*` arrays near the top of the outage-rendering
section in `app.js` — just add more lines to any of them.

## Tuning maintenance detection

`scripts/check-site.mjs` has a `MAINTENANCE_KEYWORDS` list and a
`DURATION_PATTERNS` list of regexes. They're already tuned to Utopia's
actual maintenance page wording ("Server Update in Progress", "performing
routine maintenance", "Maintenance started at...", "expected to take...").
If the real page ever changes its phrasing, check
`data/uptime_log.json` after an outage — if `maintenance_text` came back
empty despite the page showing a message, that's your cue to add the new
wording to the keyword list.
