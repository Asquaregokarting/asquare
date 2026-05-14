/** Per-item details within a combo */
export interface ComboItem {
  activityId: string;
  itemName: string;
  originalPrice: number;
  adjustedPrice: number;
  vendorId?: string;
  gameId?: string;
  subGameId?: string;
  variantId?: string;
}

/** Combo record stored in Firestore `combos` collection */
export interface ComboRecord {
  id: string;
  name: string;
  locationKey: string;
  items: ComboItem[];
  pricingMode: "discount" | "fixed";
  discountPercent?: number;
  comboPrice: number;
  originalTotal: number;
  status: "Active" | "Inactive";
  createdAt: string;
  updatedAt: string;
}

/** Calculate adjusted prices for combo items */
export function calculateCombo(
  items: { originalPrice: number }[],
  mode: "discount" | "fixed",
  discountPercent?: number,
  fixedPrice?: number
): { adjustedPrices: number[]; comboPrice: number } {
  const originalTotal = items.reduce((s, i) => s + i.originalPrice, 0);
  if (originalTotal <= 0) return { adjustedPrices: items.map(() => 0), comboPrice: 0 };

  if (mode === "discount" && discountPercent != null) {
    const factor = 1 - Math.max(0, Math.min(100, discountPercent)) / 100;
    const target = Math.round(originalTotal * factor);
    const adjusted = items.map((i) => Math.round(i.originalPrice * factor));
    const sum = adjusted.reduce((s, a) => s + a, 0);
    if (adjusted.length > 0) adjusted[adjusted.length - 1] += target - sum;
    return { adjustedPrices: adjusted, comboPrice: target };
  }

  const target = Math.max(0, fixedPrice ?? originalTotal);
  const adjusted = items.map((i) => Math.round((target * i.originalPrice) / originalTotal));
  const sum = adjusted.reduce((s, a) => s + a, 0);
  if (adjusted.length > 0) adjusted[adjusted.length - 1] += target - sum;
  return { adjustedPrices: adjusted, comboPrice: target };
}
