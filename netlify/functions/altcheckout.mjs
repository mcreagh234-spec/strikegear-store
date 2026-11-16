// AltCheckout inbound endpoints: POST /api/altcheckout/{status|catalog|quote|order|order_find|refund|cart_clear}
import { altCheckoutConfig } from "./_shared/config.mjs";
import { verifyAltCheckoutRequest } from "./_shared/signing.mjs";
import { handleAltCheckout } from "./_shared/endpoints.mjs";
import { shop } from "./_shared/shop.mjs";

export const config = { path: "/api/altcheckout/:method" };

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed", message: "POST only." }, 405);
  const cfg = altCheckoutConfig();
  if (!cfg) return json({ error: "not_configured", message: "ALTCHECKOUT_* variables are missing." }, 503);

  const rawBody = await req.text(); // RAW body: verify signature first, parse later
  const ok = verifyAltCheckoutRequest({
    storeId: cfg.storeId, secret: cfg.secret, rawBody,
    getHeader: (name) => req.headers.get(name),
  });
  if (!ok) return json({ error: "signature" }, 401);

  const method = new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "";
  const result = await handleAltCheckout(method, rawBody, shop);
  return json(result.body, result.status);
};
