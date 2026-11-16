// Order confirmation email via Resend. Inert until RESEND_API_KEY + ORDER_FROM_EMAIL are set.
import { CAT } from "./catalog.mjs";

const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function money(cents, currency) {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format((cents || 0) / 100); }
  catch { return ((cents || 0) / 100).toFixed(2) + " " + (currency || "USD"); }
}

export async function sendOrderConfirmation(order_id, order) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.ORDER_FROM_EMAIL;
  if (!key || !from) {
    console.log("[altcheckout] order " + order_id + " placed; confirmation email skipped (set RESEND_API_KEY and ORDER_FROM_EMAIL to enable)");
    return;
  }
  if (!order.email) return;
  const cur = order.currency || "USD";
  const shopName = CAT.store?.name ?? "Strike Beam";
  const rows = (order.lines || []).map((l) =>
    `<tr><td style="padding:4px 0">${escapeHtml(l.name)}${l.variant_title ? " &ndash; " + escapeHtml(l.variant_title) : ""} &times; ${l.quantity}</td><td style="padding:4px 0;text-align:right">${money(l.total, cur)}</td></tr>`
  ).join("");
  const manage = order.manage_url ? `<p><a href="${escapeHtml(order.manage_url)}">Manage your subscription</a></p>` : "";
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;color:#111">
    <h2>Thanks for your order</h2>
    <p>Order <strong>${escapeHtml(order_id)}</strong></p>
    <table style="width:100%;border-collapse:collapse">${rows}
      <tr><td style="padding:4px 0">Shipping</td><td style="padding:4px 0;text-align:right">${money(order.shipping_total, cur)}</td></tr>
      <tr><td style="padding:8px 0;border-top:1px solid #ddd"><strong>Total</strong></td><td style="padding:8px 0;border-top:1px solid #ddd;text-align:right"><strong>${money(order.total, cur)}</strong></td></tr>
    </table>
    ${manage}
    <p style="color:#555">&mdash; ${escapeHtml(shopName)}</p></div>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: order.email, subject: `${shopName} — order ${order_id}`, html }),
  });
  if (!res.ok) console.error("[altcheckout] email send failed", res.status, await res.text().catch(() => ""));
}
