// The shop's catalog is its catalog.json (bundled into the function at build time).
// Prices always come from here — never from the browser.
import catalog from "../../../data/catalog.json";

export const CAT = catalog;

/**
 * Resolve one product/variant from catalog.json.
 * A "variant" here is a bundle tier (e.g. solo / squad / battalion); variant_id null = the base product.
 * Returns null when the product or tier does not exist.
 */
export function resolveVariant(product_id, variant_id) {
  const p = (CAT.products ?? []).find((x) => x.handle === product_id);
  if (!p) return null;
  const tiers = p.bundles?.tiers ?? [];
  let unit_price, compare_at_unit_price, variant_title;
  if (variant_id == null) {
    unit_price = p.price_cents;
    compare_at_unit_price = p.compare_at_cents ?? null;
    variant_title = null;
  } else {
    const t = tiers.find((x) => x.id === variant_id);
    if (!t) return null;
    unit_price = t.price_cents;
    compare_at_unit_price = t.compare_at_cents ?? null;
    variant_title = t.title;
  }
  return {
    product: p,
    name: p.title,
    variant_title,
    sku: null,
    image: p.images?.[0] ?? null,
    requires_shipping: true,
    unit_price,
    compare_at_unit_price,
  };
}
