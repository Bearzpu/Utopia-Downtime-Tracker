// Reliable 5-minute trigger for the Uptime Monitor workflow.
//
// GitHub's own `schedule:` cron is not honoured at 5-minute granularity —
// under load, GitHub silently spaces out high-frequency scheduled workflows
// (observed gaps of 2-5 hours instead of 5 minutes). Cloudflare's Cron
// Triggers run on Cloudflare's own clock, so this Worker calls GitHub's
// workflow_dispatch API directly on a real 5-minute schedule instead of
// relying on GitHub's scheduler to fire on time.
export default {
  async scheduled(event, env, ctx) {
    const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_WORKFLOW_FILE}/dispatches`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_PAT}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "utopia-uptime-trigger-worker",
      },
      body: JSON.stringify({ ref: env.GITHUB_REF || "main" }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`GitHub workflow_dispatch failed: ${res.status} ${body}`);
      throw new Error(`GitHub workflow_dispatch failed: ${res.status}`);
    }
  },
};
