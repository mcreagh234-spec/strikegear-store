// Checkout handoff: the browser POSTs which items (never prices); this builds the signed handoff
// from catalog.json and returns { url } to redirect to, or { unavailable: true } to fall back.
import { altCheckoutConfig } from "./_shared/config.mjs";
import { resolveVariant, CAT } from "./_shared/catalog.mjs";
import { signedHeaders } from "./_shared/signing.mjs";
import { acceptedCheckoutUrl, CONNECTOR_VERSION, PROTOCOL_VERSION } from "./_shared/endpoints.mjs";

export const config = { path: "/api/checkout" };

const FAIL_MS = 10 * 60 * 1000;
let failedUntil = 0; // per instance: remember a failure for 10 minutes

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export default async (req, context) => {
  const unavailable = () => json({ unavailable: true });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const cfg = altCheckoutConfig();
  if (!cfg || Date.now() < failedUntil) return unavailable();

  let payload;
  try { payload = await req.json(); } catch { return unavailable(); }

  const rawItems = Array.isArray(payload?.items) ? payload.items : [];
  if (!rawItems.length) return unavailable();

  const items = [];
  for (const it of rawItems) {
    const product_id = String(it.product_id ?? "");
    const variant_id = it.variant_id == null || it.variant_id === "" ? null : String(it.variant_id);
    const quantity = Math.max(1, Math.min(1000, parseInt(it.quantity, 10) || 1));
    const v = resolveVariant(product_id, variant_id);
    if (!v) continue;
    items.push({
      product_id, variant_id,
      name: v.name, variant_title: v.variant_title, sku: v.sku, image: v.image,
      quantity,
      unit_price: v.unit_price, compare_at_unit_price: v.compare_at_unit_price,
      line_total: v.unit_price * quantity,
      requires_shipping: v.requires_shipping,
      properties: null, subscription: null,
    });
  }
  if (!items.length) return unavailable();

  const session_ref = String(payload.session_ref ?? ("sess_" + Date.now() + Math.random().toString(36).slice(2, 8)));
  const rawBody = JSON.stringify({
    v: PROTOCOL_VERSION,
    request_id: globalThis.crypto?.randomUUID?.() ?? ("req_" + Date.now() + Math.random().toString(36).slice(2)),
    session_ref,
    connector_version: CONNECTOR_VERSION,
    locale: (req.headers.get("accept-language") || "").split(",")[0].trim().slice(0, 20),
    country: context?.geo?.country?.code || "",
    landing_url: req.headers.get("referer") || "",
    referrer: "",
    customer: { email: String(payload.email ?? "") },
    cart: {
      currency: CAT.store?.currency ?? "USD",
      prices_include_tax: true,
      items,
      coupons: Array.isArray(payload.coupons) ? payload.coupons : [],
      note: String(payload.note ?? ""),
    },
  });

  try {
    const res = await fetch(cfg.origin + "/api/custom-store/handoff", {
      method: "POST",
      headers: signedHeaders(cfg.storeId, cfg.secret, rawBody),
      body: rawBody,
      signal: AbortSignal.timeout(5000),
    });
    const answer = res.ok ? await res.json() : null;
    const url = acceptedCheckoutUrl(answer?.checkoutUrl, cfg.origin);
    if (url) return json({ url });
    if (answer?.standDown === true) {
      console.warn("[altcheckout] standDown:", answer.reason);
      return unavailable();
    }
    throw new Error("unexpected answer, HTTP " + res.status);
  } catch (e) {
    failedUntil = Date.now() + FAIL_MS;
    console.error("[altcheckout] handoff failed:", e);
    return unavailable();
  }
};
