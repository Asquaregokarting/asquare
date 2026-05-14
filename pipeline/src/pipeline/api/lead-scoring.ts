import type { LeadAutomationConfig, LeadScoreFactors, LeadScoreLabel, LeadSource } from "./types";
import { DEFAULT_AUTOMATION_CONFIG } from "../features/leads/lead-constants";

interface ScoreResult {
  score: number;
  scoreLabel: LeadScoreLabel;
}

/** Channel quality score: WhatsApp > Website > Phone > Unknown */
const channelScore = (channel?: string): number => {
  switch (channel?.toLowerCase()) {
    case "whatsapp": return 100;
    case "website": return 80;
    case "phone": return 60;
    case "walk-in": return 50;
    default: return 40;
  }
};

/**
 * Compute lead score based on source type and available data.
 * Two scoring modes:
 *   1. Abandoned carts — highest intent (cart value + recency)
 *   2. Inquiries — channel quality + recency
 */
export const computeLeadScore = (
  source: LeadSource,
  factors: LeadScoreFactors,
  config?: LeadAutomationConfig
): ScoreResult => {
  const weights = config?.autoScoreWeights ?? DEFAULT_AUTOMATION_CONFIG.autoScoreWeights;
  const thresholds = config?.scoreThresholds ?? DEFAULT_AUTOMATION_CONFIG.scoreThresholds;

  let score: number;

  if (source === "abandoned_cart") {
    // Abandoned carts are high-intent: cart value and recency matter most
    const cartValueScore = Math.min(100, ((factors.abandonedCartValue ?? 0) / 5000) * 100);
    const recencyScore = Math.max(0, 100 - factors.recencyDays * 10); // drops fast
    score = Math.round(cartValueScore * 0.6 + recencyScore * 0.4);
    // Floor at 50 — abandoned carts are always at least warm
    score = Math.max(50, score);
  } else {
    // Inquiries: channel quality + recency
    const recencyScore = Math.max(0, 100 - factors.recencyDays * 5);
    const chScore = channelScore(factors.inquiryChannel);
    const frequencyScore = Math.min(100, (factors.visitCount / 3) * 100);
    const spendScore = Math.min(100, (factors.totalSpend / 3000) * 100);

    score = Math.round(
      (recencyScore * weights.recencyWeight +
        chScore * weights.channelWeight +
        frequencyScore * weights.frequencyWeight +
        spendScore * weights.spendWeight) / 100
    );
  }

  score = Math.max(0, Math.min(100, score));

  const scoreLabel: LeadScoreLabel =
    score >= thresholds.hotMin ? "hot" : score >= thresholds.warmMin ? "warm" : "cold";

  return { score, scoreLabel };
};
