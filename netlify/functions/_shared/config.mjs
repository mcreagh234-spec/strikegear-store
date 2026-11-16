// Server-side configuration. Never import into browser code.

/** null while any of the three variables is missing: checkout falls back, endpoints answer 503. */
export function altCheckoutConfig() {
  const storeId = process.env.ALTCHECKOUT_STORE_ID?.trim();
  const secret = process.env.ALTCHECKOUT_SECRET?.trim();
  const origin = process.env.ALTCHECKOUT_ORIGIN?.trim().replace(/\/+$/, "");
  return storeId && secret && origin ? { storeId, secret, origin } : null;
}

/** The shop's public production origin (Netlify provides URL automatically). */
export function siteUrl() {
  return (process.env.SITE_URL || process.env.URL || "").replace(/\/+$/, "") || "https://thestrikegear.store";
}
