// EDIT THESE THREE VALUES to point at your own GitHub repo.
// The dashboard fetches the live data file directly from GitHub's raw
// content CDN, so it always shows the latest data without needing a
// Vercel redeploy every time a new check runs.
window.MONITOR_CONFIG = {
  owner: "Bearzpu",
  repo: "Utopia-Downtime-Tracker",
  branch: "main",
  dataPath: "data/uptime_log.json",
  refreshSeconds: 60, // how often the open dashboard page re-fetches data
};
