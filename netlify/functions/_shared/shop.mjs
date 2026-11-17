// ShopAdapter for the Strike Beam static store: products from catalog.json, orders/refunds in Netlify Blobs.
import { createHash } from "node:crypto";
import { CAT, resolveVariant } from "./catalog.mjs";
import { siteUrl } from "./config.mjs";
import { sendOrderConfirmation as sendEmail } from "./email.mjs";

// Lazy-load the storage library so the read endpoints (status/catalog/quote) don't
// pay to evaluate it on a cold start — only order/refund/session paths touch Blobs.
let _getStore;
async function store(name) {
  if (!_getStore) ({ getStore: _getStore } = await import("@netlify/blobs"));
  return _getStore(name);
}
const ordersStore = () => store("altcheckout-orders");
const refundsStore = () => store("altcheckout-refunds");
const sessionsStore = () => store("altcheckout-sessions");

const rand = (n) => Math.random().toString(36).slice(2, 2 + n).toUpperCase();
// Deterministic order id derived from the altcheckout_order_id, so re-sending the same
// order can never mint a second id — even if two calls race before the first write lands.
const orderIdFor = (aid) => "SG" + parseInt(createHash("sha256").update(String(aid)).digest("hex").slice(0, 11), 16).toString(36).toUpperCase();
const orderUrl = (order_id) => siteUrl() + "/success.html?order=" + encodeURIComponent(order_id);
const toAnswer = (rec) => ({ order_id: rec.order_id, order_number: rec.order_number, order_url: rec.order_url });

export const shop = {
  async status() {
    return {
      shop_name: CAT.store?.name ?? "StrikeGear",
      currency: CAT.store?.currency ?? "USD",
      country: "US",
      prices_include_tax: true,
      tax: "included",
      home_url: siteUrl() + "/",
      cart_url: siteUrl() + "/",
      own_checkout_url: null,
      order_admin_url: null,
    };
  },

  async catalog({ query, cursor, product_ids, limit }) {
    let products = CAT.products ?? [];
    if (product_ids && product_ids.length) {
      const set = new Set(product_ids);
      products = products.filter((p) => set.has(p.handle));
    } else if (query) {
      const q = query.toLowerCase();
      products = products.filter((p) => (p.title ?? "").toLowerCase().includes(q));
    }
    const mapped = products.slice(0, limit).map((p) => {
      const tiers = p.bundles?.tiers ?? [];
      const variants = tiers.length
        ? tiers.map((t) => ({
            variant_id: t.id, title: t.title, sku: null,
            price: t.price_cents, compare_at_price: t.compare_at_cents ?? null,
            available: true, requires_shipping: true,
          }))
        : [{ variant_id: null, title: null, sku: null, price: p.price_cents, compare_at_price: p.compare_at_cents ?? null, available: true, requires_shipping: true }];
      return { product_id: p.handle, title: p.title, image: p.images?.[0] ?? null, variants };
    });
    return { products: mapped, next_cursor: null };
  },

  async findVariant(product_id, variant_id, quantity, address, subscription) {
    const v = resolveVariant(product_id, variant_id);
    if (!v) return null;
    return {
      for_sale: true,
      stock: null, // not tracked
      name: v.name, variant_title: v.variant_title, sku: v.sku, image: v.image,
      requires_shipping: v.requires_shipping,
      unit_price: v.unit_price, compare_at_unit_price: v.compare_at_unit_price,
      tax_rate_percent: 0,
      subscription: null, // the shop itself sells no subscriptions
    };
  },

  async applyCoupons(codes, lines) {
    // No shop discount codes. (AltCheckout's own codes are handled on its side.)
    return codes.map((code) => ({ code, valid: false, discount: 0, error: "No discount codes available." }));
  },

  async shippingTaxRatePercent(address) { return 0; },

  async findOrder(altcheckout_order_id) {
    const orders = await ordersStore();
    const rec = await orders.get(altcheckout_order_id, { type: "json" });
    return rec ? toAnswer(rec) : null;
  },

  async createPaidOrder(order) {
    const orders = await ordersStore();
    const existing = await orders.get(order.altcheckout_order_id, { type: "json" });
    if (existing) return toAnswer(existing);
    const order_id = orderIdFor(order.altcheckout_order_id);
    const rec = {
      order_id, order_number: order_id, order_url: orderUrl(order_id),
      altcheckout_order_id: order.altcheckout_order_id,
      test: !!order.test, is_renewal: !!order.is_renewal, subscription_id: order.subscription_id ?? null,
      session_ref: order.session_ref ?? null,
      currency: order.currency, prices_include_tax: order.prices_include_tax,
      email: order.email ?? "", phone: order.phone ?? "",
      billing: order.billing ?? null, shipping: order.shipping ?? null,
      lines: order.lines ?? [], shipping_line: order.shipping_line ?? null,
      discounts: order.discounts ?? [],
      subtotal: order.subtotal, shipping_total: order.shipping_total,
      discount_total: order.discount_total, tax_total: order.tax_total, total: order.total,
      payment: order.payment ?? null, note: order.note ?? "", manage_url: order.manage_url ?? null,
      created_at: Math.floor(Date.now() / 1000),
      refunded_amount: 0, refund_status: "none", refunds: [],
    };
    await orders.setJSON(order.altcheckout_order_id, rec);
    await orders.setJSON("byid_" + order_id, { altcheckout_order_id: order.altcheckout_order_id });
    if (order.session_ref) {
      try { const sessions = await sessionsStore(); await sessions.setJSON(order.session_ref, { paid: true, order_id }); } catch {}
    }
    return toAnswer(rec);
  },

  async sendOrderConfirmation(order_id, order) {
    await sendEmail(order_id, order);
  },

  async clearCart(session_ref) {
    try { const sessions = await sessionsStore(); await sessions.setJSON(session_ref, { paid: true, cleared: true }); } catch {}
  },

  async findRefund(refund_ref) {
    const refunds = await refundsStore();
    const rec = await refunds.get(refund_ref, { type: "json" });
    return rec ? rec.refund_id : null;
  },

  async recordRefund(refund) {
    const orders = await ordersStore();
    let key = refund.altcheckout_order_id || null;
    let rec = key ? await orders.get(key, { type: "json" }) : null;
    if (!rec && refund.order_id) {
      const idx = await orders.get("byid_" + refund.order_id, { type: "json" });
      if (idx) { key = idx.altcheckout_order_id; rec = await orders.get(key, { type: "json" }); }
    }
    if (!rec) return null;
    const refund_id = "rf_" + Date.now().toString(36).toUpperCase() + rand(3);
    const refunds = await refundsStore();
    await refunds.setJSON(refund.refund_ref, { refund_id, order_key: key, amount: refund.amount });
    rec.refunded_amount = (rec.refunded_amount ?? 0) + refund.amount;
    rec.refunds = rec.refunds ?? [];
    rec.refunds.push({ refund_ref: refund.refund_ref, refund_id, amount: refund.amount, reason: refund.reason ?? "", at: Math.floor(Date.now() / 1000) });
    rec.refund_status = rec.refunded_amount >= rec.total ? "refunded" : "partially_refunded";
    await orders.setJSON(key, rec);
    return refund_id;
  },
};
