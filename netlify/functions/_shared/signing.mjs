// AltCheckout HMAC signing — server-side only (node:crypto). Never import into browser code.
import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_WINDOW_SECONDS = 300;

/** hex HMAC-SHA256(secret, "{timestamp}.{rawBody}"). secret is used as a plain string (not hex-decoded). */
export function altcheckoutSignature(secret, timestamp, rawBody) {
  return createHmac("sha256", secret).update(timestamp + "." + rawBody, "utf8").digest("hex");
}

/** Headers for a request TO AltCheckout (handoff, events). Send exactly `rawBody` as the body. */
export function signedHeaders(storeId, secret, rawBody, nowMs = Date.now()) {
  const timestamp = String(Math.floor(nowMs / 1000));
  return {
    "Content-Type": "application/json",
    "X-AltCheckout-Store": storeId,
    "X-AltCheckout-Timestamp": timestamp,
    "X-AltCheckout-Signature": altcheckoutSignature(secret, timestamp, rawBody),
  };
}

/** Checks a request FROM AltCheckout. Pass the RAW body text, read before any JSON parsing. */
export function verifyAltCheckoutRequest({ storeId, secret, rawBody, getHeader, nowMs }) {
  const store = getHeader("x-altcheckout-store") ?? "";
  const timestamp = getHeader("x-altcheckout-timestamp") ?? "";
  const signature = (getHeader("x-altcheckout-signature") ?? "").trim().toLowerCase();
  if (!secret || store !== storeId) return false;
  if (!/^\d{1,12}$/.test(timestamp) || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const now = Math.floor((nowMs ?? Date.now()) / 1000);
  if (Math.abs(now - Number(timestamp)) > SIGNATURE_WINDOW_SECONDS) return false;
  const expected = Buffer.from(altcheckoutSignature(secret, timestamp, rawBody), "hex");
  const given = Buffer.from(signature, "hex");
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}
