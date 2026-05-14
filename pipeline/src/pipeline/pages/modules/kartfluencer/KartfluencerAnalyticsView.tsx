import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Users,
  Film,
  Eye,
  Wallet,
  TrendingDown,
  Clock,
  BarChart3,
  Trophy,
  ArrowDown,
  RefreshCw,
} from "lucide-react";
import { useAuth } from "../../../features/auth/auth-context";
import { kartfluencerApi } from "../../../api/kartfluencer";
import { logger } from "../../../../lib/logger";
import { VIEW_PAYMENT_TIERS } from "../../../api/kartfluencer-firestore";
import type {
  KartfluencerStats,
  KartfluencerRecord,
  KartfluencerReel,
  KartfluencerViewTier,
} from "../../../api/types";

const FUNNEL_STEPS = [
  { key: "detailed", label: "Registration" },
  { key: "visited", label: "Visit" },
  { key: "reel_submitted", label: "Reel" },
  { key: "verified", label: "Verified" },
  { key: "active", label: "Active" },
] as const;

const TIER_COLORS: Record<KartfluencerViewTier, string> = {
  below_threshold: "bg-gray-200",
  starter: "bg-sky-400",
  bronze_views: "bg-orange-400",
  silver_views: "bg-slate-400",
  gold_views: "bg-yellow-400",
  viral: "bg-purple-500",
};

const KartfluencerAnalyticsView = ({ branchFilter = "" }: { branchFilter?: string }) => {
  const { session } = useAuth();
  const token = session?.token ?? "";

  const [stats, setStats] = useState<KartfluencerStats | null>(null);
  const [records, setRecords] = useState<KartfluencerRecord[]>([]);
  const [reels, setReels] = useState<KartfluencerReel[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const filter = branchFilter ? { branchId: branchFilter } : undefined;
      const [statsData, recordsData, reelsData] = await Promise.all([
        kartfluencerApi.getStats(token, branchFilter || undefined),
        kartfluencerApi.list(token, filter as never),
        kartfluencerApi.listReels(token),
      ]);
      setStats(statsData);
      setRecords(recordsData);
      setReels(reelsData);
    } catch (err) {
      logger.error('kartfluencer.load_analytics_failed', err);
    } finally {
      setLoading(false);
    }
  }, [token, branchFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  // Funnel data: cumulative counts (each step includes all further steps)
  const funnel = useMemo(() => {
    if (!stats) return [];
    const statusOrder = ["detailed", "visited", "reel_submitted", "verified", "active"] as const;
    // Cumulative: "visited" count = visited + reel_submitted + verified + active
    const counts: number[] = [];
    for (let i = 0; i < statusOrder.length; i++) {
      let count = 0;
      for (let j = i; j < statusOrder.length; j++) {
        count += stats.byStatus[statusOrder[j]] ?? 0;
      }
      counts.push(count);
    }
    const total = counts[0] || 1;
    return FUNNEL_STEPS.map((step, i) => ({
      ...step,
      count: counts[i],
      pct: Math.round((counts[i] / total) * 100),
      conversionFromPrev:
        i === 0
          ? 100
          : counts[i - 1] > 0
            ? Math.round((counts[i] / counts[i - 1]) * 100)
            : 0,
    }));
  }, [stats]);

  // Top performers by totalEarned
  const topPerformers = useMemo(() => {
    return [...records]
      .sort((a, b) => (b.totalEarned ?? 0) - (a.totalEarned ?? 0))
      .slice(0, 10);
  }, [records]);

  // View tier distribution from reels
  const tierDistribution = useMemo(() => {
    const counts: Record<KartfluencerViewTier, number> = {
      below_threshold: 0,
      starter: 0,
      bronze_views: 0,
      silver_views: 0,
      gold_views: 0,
      viral: 0,
    };
    for (const reel of reels) {
      counts[reel.currentViewTier] = (counts[reel.currentViewTier] ?? 0) + 1;
    }
    const totalReels = reels.length || 1;
    return VIEW_PAYMENT_TIERS.map((t) => ({
      tier: t.tier,
      label: t.label,
      payout: t.payout,
      count: counts[t.tier],
      pct: Math.round((counts[t.tier] / totalReels) * 100),
    }));
  }, [reels]);

  // KPI calculations
  const kpis = useMemo(() => {
    if (!stats) return null;
    const totalViews = stats.totalViews;
    const costPer1k = totalViews > 0 ? (stats.totalPaidOut / (totalViews / 1000)) : 0;
    return {
      totalInfluencers: stats.total,
      activeReels: reels.filter((r) => r.status === "verified").length,
      totalViews,
      totalPaidOut: stats.totalPaidOut,
      costPer1k: Math.round(costPer1k * 100) / 100,
      pendingWithdrawals: stats.pendingWithdrawals,
    };
  }, [stats, reels]);

  if (loading) {
    return <div className="py-16 text-center text-sm text-muted">Loading analytics...</div>;
  }

  return (
    <div className="ui-section-stack">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text">Kartfluencer Analytics</h2>
          <p className="text-xs text-muted mt-0.5">Program performance overview</p>
        </div>
        <button onClick={() => void load()} className="ui-btn ui-btn-neutral text-xs gap-1">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* KPI Cards */}
      {kpis && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard
            label="Total Influencers"
            value={kpis.totalInfluencers}
            icon={<Users size={16} className="text-blue-500" />}
          />
          <KpiCard
            label="Active Reels"
            value={kpis.activeReels}
            icon={<Film size={16} className="text-purple-500" />}
          />
          <KpiCard
            label="Total Views"
            value={formatCompact(kpis.totalViews)}
            icon={<Eye size={16} className="text-sky-500" />}
          />
          <KpiCard
            label="Total Paid Out"
            value={`₹${kpis.totalPaidOut.toLocaleString()}`}
            icon={<Wallet size={16} className="text-emerald-500" />}
          />
          <KpiCard
            label="Avg Cost / 1K Views"
            value={`₹${kpis.costPer1k.toLocaleString()}`}
            icon={<TrendingDown size={16} className="text-orange-500" />}
          />
          <KpiCard
            label="Pending Withdrawals"
            value={kpis.pendingWithdrawals}
            icon={<Clock size={16} className="text-yellow-500" />}
          />
        </div>
      )}

      {/* Funnel Visualization */}
      <div className="rounded-xl border border-border/50 bg-surface/80 p-4">
        <h3 className="text-sm font-semibold text-text mb-4 flex items-center gap-1.5">
          <BarChart3 size={14} className="text-muted" /> Conversion Funnel
        </h3>
        <div className="space-y-2">
          {funnel.map((step, i) => {
            const maxCount = funnel[0]?.count || 1;
            const barWidth = Math.max(8, (step.count / maxCount) * 100);
            return (
              <div key={step.key}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-text">{step.label}</span>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-semibold text-text">{step.count}</span>
                    <span className="text-muted">({step.pct}%)</span>
                    {i > 0 && (
                      <span className="text-[10px] text-muted flex items-center gap-0.5">
                        <ArrowDown size={10} /> {step.conversionFromPrev}%
                      </span>
                    )}
                  </div>
                </div>
                <div className="h-6 rounded-lg bg-border/30 overflow-hidden">
                  <div
                    className="h-full rounded-lg bg-accent/80 transition-all duration-500"
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top Performers */}
        <div className="rounded-xl border border-border/50 bg-surface/80 p-4">
          <h3 className="text-sm font-semibold text-text mb-3 flex items-center gap-1.5">
            <Trophy size={14} className="text-yellow-500" /> Top Performers
          </h3>
          {topPerformers.length === 0 ? (
            <p className="text-xs text-muted py-4 text-center">No data yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="px-2 py-2 text-left font-medium text-muted">#</th>
                    <th className="px-2 py-2 text-left font-medium text-muted">Handle</th>
                    <th className="px-2 py-2 text-left font-medium text-muted">Branch</th>
                    <th className="px-2 py-2 text-right font-medium text-muted">Earned</th>
                  </tr>
                </thead>
                <tbody>
                  {topPerformers.map((r, i) => (
                    <tr key={r.id} className="border-b border-border/20 hover:bg-surface/60 transition-colors">
                      <td className="px-2 py-2 text-muted">{i + 1}</td>
                      <td className="px-2 py-2 font-medium text-text">{r.instagramHandle}</td>
                      <td className="px-2 py-2 text-muted">{r.branchName}</td>
                      <td className="px-2 py-2 text-right font-semibold text-emerald-600">
                        ₹{(r.totalEarned ?? 0).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* View Tier Distribution */}
        <div className="rounded-xl border border-border/50 bg-surface/80 p-4">
          <h3 className="text-sm font-semibold text-text mb-3 flex items-center gap-1.5">
            <Eye size={14} className="text-muted" /> View Tier Distribution
          </h3>
          {reels.length === 0 ? (
            <p className="text-xs text-muted py-4 text-center">No reels data yet.</p>
          ) : (
            <div className="space-y-3">
              {tierDistribution.map((t) => {
                const maxPct = Math.max(...tierDistribution.map((d) => d.pct), 1);
                const barWidth = Math.max(4, (t.pct / maxPct) * 100);
                return (
                  <div key={t.tier}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-text">{t.label}</span>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-semibold text-text">{t.count}</span>
                        <span className="text-muted">({t.pct}%)</span>
                        {t.payout > 0 && (
                          <span className="text-[10px] text-emerald-600">₹{t.payout.toLocaleString()}</span>
                        )}
                      </div>
                    </div>
                    <div className="h-4 rounded-md bg-border/30 overflow-hidden">
                      <div
                        className={`h-full rounded-md transition-all duration-500 ${TIER_COLORS[t.tier]}`}
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>
                );
              })}
              <div className="pt-2 border-t border-border/30 text-xs text-muted text-right">
                Total reels: {reels.length}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Helpers ────────────────────────────────────────────────────

const formatCompact = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
};

const KpiCard = ({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
}) => (
  <div className="rounded-xl border border-border/50 bg-surface/80 px-4 py-3">
    <div className="flex items-center gap-1.5 mb-1">
      {icon}
      <span className="text-[10px] text-muted uppercase tracking-wide">{label}</span>
    </div>
    <div className="text-xl font-bold text-text">{value}</div>
  </div>
);

export default KartfluencerAnalyticsView;
