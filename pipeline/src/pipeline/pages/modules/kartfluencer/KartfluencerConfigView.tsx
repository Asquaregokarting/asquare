import { KARTFLUENCER_TIERS, VIEW_PAYMENT_TIERS } from "../../../api/kartfluencer-firestore";
import { Award, TrendingUp, ArrowRight, Instagram, Shield, Eye } from "lucide-react";
import type { KartfluencerStatus } from "../../../api/types";

const STATUS_FLOW: Array<{ status: KartfluencerStatus; label: string; description: string; color: string }> = [
  { status: "detailed", label: "Registered", description: "Influencer has submitted their proposal", color: "bg-blue-500" },
  { status: "visited", label: "Visited", description: "Influencer visited the go-karting location", color: "bg-amber-500" },
  { status: "reel_submitted", label: "Reel Submitted", description: "Instagram reel has been submitted for review", color: "bg-purple-500" },
  { status: "verified", label: "Verified", description: "Admin verified the reel meets requirements", color: "bg-emerald-500" },
  { status: "active", label: "Active", description: "Influencer is active and earning via view milestones", color: "bg-green-600" },
];

const KartfluencerConfigView = () => {
  return (
    <div className="max-w-3xl ui-section-stack">
      {/* Tier Configuration (Eligibility) */}
      <div className="rounded-xl border border-border/50 bg-surface/80 p-5">
        <h3 className="text-sm font-semibold text-text mb-4 flex items-center gap-2">
          <Award size={16} /> Follower Tier Eligibility
        </h3>
        <p className="text-[10px] text-muted mb-3">
          Follower-based tiers determine eligibility and the initial access pass reward. Cash payouts are handled separately via view milestones.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/50">
                <th className="px-3 py-2 text-left font-medium text-muted">Tier</th>
                <th className="px-3 py-2 text-left font-medium text-muted">Followers Range</th>
                <th className="px-3 py-2 text-left font-medium text-muted">Reward</th>
              </tr>
            </thead>
            <tbody>
              {KARTFLUENCER_TIERS.map((tier) => (
                <tr key={tier.tier} className="border-b border-border/30">
                  <td className="px-3 py-2.5">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      tier.tier === "not_eligible" ? "bg-gray-100 text-gray-600" :
                      tier.tier === "access_10k" ? "bg-sky-100 text-sky-700" :
                      tier.tier === "access_25k" ? "bg-indigo-100 text-indigo-700" :
                      tier.tier === "bronze" ? "bg-orange-100 text-orange-700" :
                      tier.tier === "silver" ? "bg-slate-200 text-slate-700" :
                      tier.tier === "gold" ? "bg-yellow-100 text-yellow-700" :
                      "bg-purple-100 text-purple-700"
                    }`}>
                      {tier.label}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-muted">
                    {tier.tier === "not_eligible"
                      ? "< 10,000"
                      : tier.maxFollowers === Infinity
                      ? `${(tier.minFollowers / 1000).toFixed(0)}K+`
                      : `${(tier.minFollowers / 1000).toFixed(0)}K – ${((tier.maxFollowers + 1) / 1000).toFixed(0)}K`}
                  </td>
                  <td className="px-3 py-2.5 text-text font-medium">{tier.reward}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Views-Based Payment Tiers */}
      <div className="rounded-xl border border-border/50 bg-surface/80 p-5">
        <h3 className="text-sm font-semibold text-text mb-4 flex items-center gap-2">
          <Eye size={16} /> Views-Based Payment Tiers
        </h3>
        <p className="text-[10px] text-muted mb-3">
          Cash payouts are earned incrementally as reels hit view milestones. Each tier pays the difference from the previous tier already paid.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/50">
                <th className="px-3 py-2 text-left font-medium text-muted">Tier</th>
                <th className="px-3 py-2 text-left font-medium text-muted">Views Range</th>
                <th className="px-3 py-2 text-right font-medium text-muted">Cumulative Payout</th>
              </tr>
            </thead>
            <tbody>
              {VIEW_PAYMENT_TIERS.map((vt) => (
                <tr key={vt.tier} className="border-b border-border/30">
                  <td className="px-3 py-2.5">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      vt.tier === "below_threshold" ? "bg-gray-100 text-gray-600" :
                      vt.tier === "starter" ? "bg-sky-100 text-sky-700" :
                      vt.tier === "bronze_views" ? "bg-orange-100 text-orange-700" :
                      vt.tier === "silver_views" ? "bg-slate-200 text-slate-700" :
                      vt.tier === "gold_views" ? "bg-yellow-100 text-yellow-700" :
                      "bg-purple-100 text-purple-700"
                    }`}>
                      {vt.label}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-muted">
                    {vt.tier === "below_threshold"
                      ? "< 50,000"
                      : vt.maxViews === Infinity
                      ? `${(vt.minViews / 1000).toLocaleString()}K+`
                      : `${(vt.minViews / 1000).toLocaleString()}K – ${((vt.maxViews + 1) / 1000).toLocaleString()}K`}
                  </td>
                  <td className="px-3 py-2.5 text-right text-text font-medium">
                    {vt.payout > 0 ? `₹${vt.payout.toLocaleString()}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Status Flow */}
      <div className="rounded-xl border border-border/50 bg-surface/80 p-5">
        <h3 className="text-sm font-semibold text-text mb-4 flex items-center gap-2">
          <TrendingUp size={16} /> Influencer Journey
        </h3>
        <div className="flex flex-col gap-3">
          {STATUS_FLOW.map((s, i) => (
            <div key={s.status} className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-full ${s.color} flex items-center justify-center text-white text-xs font-bold`}>
                {i + 1}
              </div>
              <div className="flex-1">
                <div className="text-xs font-semibold text-text">{s.label}</div>
                <div className="text-[10px] text-muted">{s.description}</div>
              </div>
              {i < STATUS_FLOW.length - 1 && <ArrowRight size={14} className="text-muted/40" />}
            </div>
          ))}
          <div className="flex items-center gap-3 mt-2 pt-2 border-t border-border/30">
            <div className="w-8 h-8 rounded-full bg-red-500 flex items-center justify-center text-white text-xs font-bold">
              !
            </div>
            <div className="flex-1">
              <div className="text-xs font-semibold text-red-600">Disqualified</div>
              <div className="text-[10px] text-muted">Can be applied at any stage with a reason</div>
            </div>
          </div>
        </div>
      </div>

      {/* Instagram API Info */}
      <div className="rounded-xl border border-border/50 bg-surface/80 p-5">
        <h3 className="text-sm font-semibold text-text mb-4 flex items-center gap-2">
          <Instagram size={16} /> Instagram Integration
        </h3>
        <div className="space-y-3 text-xs">
          <div className="flex justify-between py-2 border-b border-border/30">
            <span className="text-muted">API Version</span>
            <span className="text-text font-medium">v18.0 (Graph API)</span>
          </div>
          <div className="flex justify-between py-2 border-b border-border/30">
            <span className="text-muted">Verification Method</span>
            <span className="text-text font-medium">Follower count via Business Account</span>
          </div>
          <div className="flex justify-between py-2 border-b border-border/30">
            <span className="text-muted">Fallback</span>
            <span className="text-text font-medium">Manual verification by admin</span>
          </div>
          <div className="flex items-center gap-2 py-2 text-muted">
            <Shield size={12} />
            <span>API tokens are stored securely in environment variables</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default KartfluencerConfigView;
