// AltCheckout protocol logic (v1) — the seven methods AltCheckout calls.
// Runtime-neutral: no imports. Everything that touches the shop's own data goes through `shop`.

export const PROTOCOL_VERSION = 1;
export const CONNECTOR_VERSION = "1.0.0";

class ProtocolError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const fail = (status, error, message) => ({ status, body: { error, message } });

function str(value, field, { optional = false, max = 2000 } = {}) {
  if ((value === undefined || value === null || value === "") && optional) return "";
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new ProtocolError(400, "invalid_request", field + " must be a non-empty string");
  return value;
}
function int(value, field, min = 0) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min)
    throw new ProtocolError(400, "invalid_request", field + " must be an integer >= " + min);
  return value;
}

/** Handles one call. `method` is the last path segment; `rawBody`'s signature is already verified. */
export async function handleAltCheckout(method, rawBody, shop) {
  let body;
  try { body = rawBody.trim() ? JSON.parse(rawBody) : {}; } catch { return fail(400, "invalid_json", "The body is not JSON."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail(400, "invalid_request", "The body must be a JSON object.");
  try {
    switch (method) {
      case "status": return { status: 200, body: await statusAnswer(shop) };
      case "catalog": return { status: 200, body: await catalog(shop, body) };
      case "quote": return { status: 200, body: await quote(shop, body) };
      case "order": return { status: 200, body: await order(shop, body) };
      case "order_find": {
        const found = await shop.findOrder(str(body.altcheckout_order_id, "altcheckout_order_id", { max: 100 }));
        return found ? { status: 200, body: { ...found, existing: true } } : fail(404, "not_found", "No order with this altcheckout_order_id.");
      }
      case "refund": return await refund(shop, body);
      case "cart_clear": {
        if (typeof body.session_ref === "string" && body.session_ref) await shop.clearCart(body.session_ref);
        return { status: 200, body: { cleared: true } };
      }
      default: return fail(404, "unknown_method", "Unknown method: " + method);
    }
  } catch (error) {
    if (error instanceof ProtocolError) return fail(error.status, error.code, error.message);
    console.error("[altcheckout] " + method + " failed", error);
    return fail(500, "internal", "The shop could not process " + method + ".");
  }
}

/** The `status` answer — also the body of the optional `ping` event. */
export async function statusAnswer(shop) {
  return {
    ok: true, connector_version: CONNECTOR_VERSION, protocol: PROTOCOL_VERSION,
    ...(await shop.status()),
    sends_order_emails: true,
    subscriptions: true,
  };
}

/** Accept the handoff's checkoutUrl only when it is https:// or exactly ALTCHECKOUT_ORIGIN's origin. */
export function acceptedCheckoutUrl(raw, altcheckoutOrigin) {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    if (url.username || url.password) return null;
    if (url.protocol === "https:" || url.origin === new URL(altcheckoutOrigin).origin) return url.href;
  } catch {
    // not a URL: fall back
  }
  return null;
}

async function catalog(shop, body) {
  const limit = Number.isInteger(body.limit) ? Math.min(Math.max(body.limit, 1), 100) : 50;
  const product_ids = Array.isArray(body.product_ids) ? body.product_ids.filter((id) => typeof id === "string") : [];
  const page = await shop.catalog({
    query: typeof body.query === "string" ? body.query.trim() : "",
    cursor: typeof body.cursor === "string" && body.cursor ? body.cursor : null,
    product_ids, limit,
  });
  return { products: page.products.slice(0, limit), next_cursor: page.next_cursor };
}

async function quote(shop, body) {
  if (!Array.isArray(body.items)) throw new ProtocolError(400, "invalid_request", "items must be an array");
  const facts = await shop.status();
  const a = body.address ?? {};
  const text = (v) => (typeof v === "string" ? v.trim() : "");
  const address = { country: text(a.country).toUpperCase() || facts.country, state: text(a.state), postcode: text(a.postcode), city: text(a.city) };
  const lines = [];
  for (const [i, item] of body.items.entries()) {
    const product_id = str(item?.product_id, "items[" + i + "].product_id", { max: 100 });
    const variant_id = item?.variant_id == null ? null : str(item.variant_id, "items[" + i + "].variant_id", { max: 100 });
    const quantity = int(item?.quantity, "items[" + i + "].quantity", 1);
    const wanted = item?.subscription && typeof item.subscription === "object"
      ? { interval_count: Number(item.subscription.interval_count), interval_unit: item.subscription.interval_unit } : null;
    const v = await shop.findVariant(product_id, variant_id, quantity, address, wanted);
    const purchasable = v !== null && v.for_sale;
    const unit = purchasable ? v.unit_price : 0;
    lines.push({
      product_id, variant_id, quantity, purchasable,
      in_stock: purchasable && (v.stock === null || v.stock >= quantity),
      name: v?.name ?? null, variant_title: v?.variant_title ?? null, sku: v?.sku ?? null, image: v?.image ?? null,
      requires_shipping: v?.requires_shipping ?? true,
      unit_price: unit, compare_at_unit_price: purchasable ? v.compare_at_unit_price : null,
      line_subtotal: unit * quantity, line_total: unit * quantity,
      ...(facts.tax === "store" ? { tax_rate_percent: v?.tax_rate_percent ?? 0 } : {}),
      subscription: purchasable && wanted && v.subscription ? v.subscription : null,
    });
  }
  const codes = Array.isArray(body.coupons) ? body.coupons.filter((c) => typeof c === "string" && c.trim() !== "") : [];
  const coupons = codes.length ? await shop.applyCoupons(codes, lines.filter((line) => line.purchasable)) : [];
  return {
    currency: facts.currency, prices_include_tax: facts.prices_include_tax, items: lines, coupons,
    ...(facts.tax === "store" ? { shipping_tax_rate_percent: await shop.shippingTaxRatePercent(address) } : {}),
  };
}

async function order(shop, body) {
  const input = body;
  const id = str(input.altcheckout_order_id, "altcheckout_order_id", { max: 100 });
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new ProtocolError(400, "invalid_request", "lines must be a non-empty array");
  for (const field of ["subtotal", "shipping_total", "discount_total", "tax_total", "total"]) int(input[field], field);
  const existing = await shop.findOrder(id);
  if (existing) return { ...existing, existing: true };
  let created;
  try { created = await shop.createPaidOrder(input); }
  catch (error) {
    const raced = await shop.findOrder(id);
    if (raced) return { ...raced, existing: true };
    throw error;
  }
  if (input.session_ref) await shop.clearCart(input.session_ref).catch((e) => console.error("[altcheckout] cart_clear", e));
  if (!input.test) await shop.sendOrderConfirmation(created.order_id, input).catch((e) => console.error("[altcheckout] email", e));
  return { ...created, existing: false };
}

async function refund(shop, body) {
  const input = {
    order_id: str(body.order_id, "order_id", { max: 100 }),
    altcheckout_order_id: str(body.altcheckout_order_id, "altcheckout_order_id", { optional: true, max: 100 }),
    refund_ref: str(body.refund_ref, "refund_ref", { max: 100 }),
    amount: int(body.amount, "amount", 1),
    reason: typeof body.reason === "string" ? body.reason : "",
  };
  const known = await shop.findRefund(input.refund_ref);
  if (known) return { status: 200, body: { refund_id: known, existing: true } };
  try {
    const refund_id = await shop.recordRefund(input);
    return refund_id ? { status: 200, body: { refund_id, existing: false } } : fail(404, "not_found", "No such order.");
  } catch (error) {
    const raced = await shop.findRefund(input.refund_ref);
    if (raced) return { status: 200, body: { refund_id: raced, existing: true } };
    throw error;
  }
}

/** Helper for applyCoupons: spread `discount` across lines by line_total; returns what was taken off. */
export function allocateDiscount(discount, lines) {
  const base = lines.reduce((sum, line) => sum + line.line_total, 0);
  const total = Math.max(0, Math.min(Math.round(discount), base));
  if (total === 0) return 0;
  let left = total;
  for (const line of lines) { const share = Math.floor((total * line.line_total) / base); line.line_total -= share; left -= share; }
  for (const line of lines) { const extra = Math.min(left, line.line_total); line.line_total -= extra; left -= extra; }
  return total;
}
