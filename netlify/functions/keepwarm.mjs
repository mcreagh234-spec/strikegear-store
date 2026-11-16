// Keeps the AltCheckout function warm so cold starts don't trip AltCheckout's per-call timeout.
// Scheduled every minute; pings the status route (a GET returns 405 but still warms the container).
// After you're connected and stable you can relax this to e.g. "*/5 * * * *" or delete the file.
export const config = { schedule: "* * * * *" };

export default async () => {
  const base = (process.env.SITE_URL || process.env.URL || "").replace(/\/+$/, "");
  if (base) {
    try { await fetch(base + "/api/altcheckout/status", { method: "GET" }); } catch {}
  }
  return new Response("warmed");
};
