/**
 * Unified tracking layer for Facebook Pixel, Meta CAPI, GTM, and GA4.
 * All tracking calls are fire-and-forget with error swallowing.
 */

// ─── Facebook Pixel ──────────────────────────────────────────────

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    dataLayer?: Record<string, unknown>[];
  }
}

export const trackFBEvent = (event: string, data?: Record<string, unknown>): void => {
  try {
    if (window.fbq) {
      if (data) {
        window.fbq("track", event, data);
      } else {
        window.fbq("track", event);
      }
    }
  } catch {
    // silent
  }
};

// ─── Google Tag Manager / GA4 ────────────────────────────────────

export const pushToDataLayer = (event: string, data?: Record<string, unknown>): void => {
  try {
    window.dataLayer = window.dataLayer ?? [];
    window.dataLayer.push({ event, ...data });
  } catch {
    // silent
  }
};

// ─── Unified Events ──────────────────────────────────────────────

export const trackPageView = (path: string): void => {
  trackFBEvent("PageView");
  pushToDataLayer("page_view", { page_path: path });
};

export const trackLeadGenerated = (source: string, data?: Record<string, unknown>): void => {
  trackFBEvent("Lead", { content_name: source, ...data });
  pushToDataLayer("generate_lead", { lead_source: source, ...data });
};

export const trackBeginCheckout = (value: number, currency = "INR"): void => {
  trackFBEvent("InitiateCheckout", { value, currency });
  pushToDataLayer("begin_checkout", { value, currency });
};

export const trackPurchase = (value: number, transactionId: string, currency = "INR"): void => {
  trackFBEvent("Purchase", { value, currency });
  pushToDataLayer("purchase", { value, currency, transaction_id: transactionId });
};
