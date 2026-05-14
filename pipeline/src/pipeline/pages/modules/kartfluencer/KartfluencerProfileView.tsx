import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import {
  Instagram,
  Film,
  Eye,
  IndianRupee,
  MapPin,
  RefreshCw,
  QrCode,
  Clock,
  ExternalLink,
  Wallet,
  Calendar,
  TrendingUp,
  ArrowLeft,
} from "lucide-react";
import { useAuth } from "../../../features/auth/auth-context";
import { kartfluencerApi } from "../../../api/kartfluencer";
import { VIEW_PAYMENT_TIERS, KARTFLUENCER_TIERS, calculateIncrementalPayout } from "../../../api/kartfluencer-firestore";
import { logger } from "../../../../lib/logger";
import type {
  KartfluencerProfileData,
  KartfluencerViewTier,
  KartfluencerStatus,
  KartfluencerTier,
} from "../../../api/types";

/* ── Colour maps ─────────────────────────────────────────────── */

const STATUS_COLORS: Record<KartfluencerStatus, string> = {
  detailed: "bg-blue-100 text-blue-700",
  visited: "bg-amber-100 text-amber-700",
  reel_submitted: "bg-purple-100 text-purple-700",
  verified: "bg-emerald-100 text-emerald-700",
  active: "bg-green-100 text-green-800",
  disqualified: "bg-red-100 text-red-700",
};

const STATUS_LABELS: Record<KartfluencerStatus, string> = {
  detailed: "Registered",
  visited: "Visited",
  reel_submitted: "Reel Submitted",
  verified: "Verified",
  active: "Active",
  disqualified: "Disqualified",
};

const TIER_COLORS: Record<KartfluencerTier, string> = {
  not_eligible: "bg-gray-100 text-gray-600",
  access_10k: "bg-sky-100 text-sky-700",
  access_25k: "bg-indigo-100 text-indigo-700",
  bronze: "bg-orange-100 text-orange-700",
  silver: "bg-slate-200 text-slate-700",
  gold: "bg-yellow-100 text-yellow-700",
  elite: "bg-purple-100 text-purple-700",
};

const VIEW_TIER_COLORS: Record<KartfluencerViewTier, string> = {
  below_threshold: "bg-gray-100 text-gray-600",
  starter: "bg-sky-100 text-sky-700",
  bronze_views: "bg-orange-100 text-orange-700",
  silver_views: "bg-slate-200 text-slate-700",
  gold_views: "bg-yellow-100 text-yellow-700",
  viral: "bg-purple-100 text-purple-700",
};

const REEL_STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  verified: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
};

/* ── Helpers ─────────────────────────────────────────────────── */

const fmtNum = (n: number): string =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
      ? `${(n / 1_000).toFixed(1)}K`
      : String(n);

const fmtCurrency = (n: number): string =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

const fmtDate = (d: string | undefined): string => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return d;
  }
};

const fmtDateTime = (d: string | undefined): string => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return d;
  }
};

const tierLabel = (tier: KartfluencerTier): string =>
  KARTFLUENCER_TIERS.find((t) => t.tier === tier)?.label ?? tier;

const viewTierLabel = (tier: KartfluencerViewTier): string =>
  VIEW_PAYMENT_TIERS.find((t) => t.tier === tier)?.label ?? tier;

/* ── Score Ring ──────────────────────────────────────────────── */

const ScoreRing = ({ score }: { score: number }) => {
  const clamped = Math.max(0, Math.min(100, score));
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  const color = clamped < 30 ? "#ef4444" : clamped < 60 ? "#f97316" : "#22c55e";

  return (
    <div className="relative flex flex-col items-center gap-1">
      <svg width="88" height="88" className="-rotate-90">
        <circle cx="44" cy="44" r={radius} fill="none" stroke="currentColor" strokeWidth="6" className="text-border/30" />
        <motion.circle
          cx="44"
          cy="44"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1, ease: "easeOut" }}
        />
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center font-display text-xl font-bold"
        style={{ color }}
      >
        {clamped}
      </span>
      <span className="text-[11px] uppercase tracking-[0.08em] text-muted">Score</span>
    </div>
  );
};

/* ── Timeline Item ──────────────────────────────────────────── */

interface TimelineEntry {
  date: string;
  label: string;
  icon: React.ReactNode;
}

const TimelineItem = ({ entry, isLast }: { entry: TimelineEntry; isLast: boolean }) => (
  <div className="flex gap-3">
    <div className="flex flex-col items-center">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border/45 bg-surface text-muted">
        {entry.icon}
      </div>
      {!isLast && <div className="w-px flex-1 bg-border/30" />}
    </div>
    <div className="pb-6">
      <p className="text-sm font-medium text-text">{entry.label}</p>
      <p className="text-xs text-muted">{fmtDateTime(entry.date)}</p>
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   Main Component
   ═══════════════════════════════════════════════════════════════ */

const KartfluencerProfileView = ({ influencerId }: { influencerId: string }) => {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const navigate = useNavigate();

  const [data, setData] = useState<KartfluencerProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshingFollowers, setRefreshingFollowers] = useState(false);
  const [qrExpanded, setQrExpanded] = useState(false);

  // Inline views update state
  const [viewsModal, setViewsModal] = useState<{ reelId: string } | null>(null);
  const [viewCountInput, setViewCountInput] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  /* ── Load profile data ──────────────────────────────────────── */

  const load = useCallback(async () => {
    if (!token || !influencerId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await kartfluencerApi.getInfluencerProfileData(token, influencerId);
      setData(result);
    } catch (err) {
      logger.error('kartfluencer.load_profile_failed', err);
      setError(err instanceof Error ? err.message : "Failed to load profile");
    } finally {
      setLoading(false);
    }
  }, [token, influencerId]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ── Refresh followers ──────────────────────────────────────── */

  const handleRefreshFollowers = async () => {
    setRefreshingFollowers(true);
    try {
      await kartfluencerApi.fetchLiveFollowerCount(token, influencerId);
      await load();
    } catch (err) {
      logger.error('kartfluencer.refresh_follower_count_failed', err);
    } finally {
      setRefreshingFollowers(false);
    }
  };

  /* ── Update reel views ──────────────────────────────────────── */

  const handleUpdateViews = async (reelId: string) => {
    const count = parseInt(viewCountInput, 10);
    if (isNaN(count) || count < 0) return;
    setActionLoading(reelId);
    try {
      await kartfluencerApi.updateReelViews(token, influencerId, reelId, count);
      setViewsModal(null);
      setViewCountInput("");
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update views");
    } finally {
      setActionLoading(null);
    }
  };

  /* ── Approve milestone ──────────────────────────────────────── */

  const handleApproveMilestone = async (reelId: string) => {
    setActionLoading(reelId);
    try {
      await kartfluencerApi.approveMilestonePayout(token, influencerId, reelId);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to approve milestone");
    } finally {
      setActionLoading(null);
    }
  };

  /* ── Derived values ─────────────────────────────────────────── */

  const totalViews = useMemo(
    () => (data?.reels ?? []).reduce((sum, r) => sum + r.viewCount, 0),
    [data?.reels]
  );

  const timeline = useMemo((): TimelineEntry[] => {
    if (!data) return [];
    const entries: TimelineEntry[] = [];

    // Registration
    entries.push({
      date: data.record.createdAt,
      label: "Registered as influencer",
      icon: <Calendar className="h-3.5 w-3.5" />,
    });

    // Reel submissions
    for (const reel of data.reels) {
      entries.push({
        date: reel.createdAt,
        label: "Submitted reel",
        icon: <Film className="h-3.5 w-3.5" />,
      });
    }

    // Wallet transactions
    for (const tx of data.walletHistory) {
      entries.push({
        date: tx.createdAt,
        label: tx.description,
        icon: <Wallet className="h-3.5 w-3.5" />,
      });
    }

    // Booking visits
    for (const booking of data.bookingHistory) {
      entries.push({
        date: booking.sessionDate,
        label: "Visited A Square",
        icon: <MapPin className="h-3.5 w-3.5" />,
      });
    }

    // Sort descending
    entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return entries;
  }, [data]);

  /* ── Loading / Error states ─────────────────────────────────── */

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-blue-500" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
        <p className="text-sm text-red-500">{error ?? "Profile not found"}</p>
        <button onClick={() => navigate(-1)} className="text-sm text-blue-500 underline">
          Go back
        </button>
      </div>
    );
  }

  const { record, reels, wallet, walletHistory, bookingHistory, bookingSummary } = data;

  /* ════════════════════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════════════════════ */

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 pb-20">
      {/* Back link */}
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-text"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Directory
      </button>

      {/* ── A. Header Card ──────────────────────────────────────── */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="rounded-xl border border-border/45 bg-panel p-6 shadow-sm"
      >
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          {/* Left: handle, badges, bio */}
          <div className="flex-1 space-y-3">
            <div className="flex items-center gap-3">
              <Instagram className="h-6 w-6 text-pink-500" />
              <h1 className="font-display text-2xl font-bold text-text">@{record.instagramHandle}</h1>
            </div>

            {/* Badges */}
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[record.status]}`}>
                {STATUS_LABELS[record.status]}
              </span>
              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${TIER_COLORS[record.tier]}`}>
                {tierLabel(record.tier)}
              </span>
            </div>

            {/* Follower count */}
            <div className="flex items-end gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.08em] text-muted">Live Followers</p>
                <p className="font-display text-3xl font-semibold text-text">
                  {record.liveFollowerCount != null ? fmtNum(record.liveFollowerCount) : "—"}
                </p>
              </div>
              {record.lastFollowerFetchAt && (
                <p className="flex items-center gap-1 pb-1 text-xs text-muted">
                  <Clock className="h-3 w-3" />
                  {fmtDateTime(record.lastFollowerFetchAt)}
                </p>
              )}
              <button
                onClick={handleRefreshFollowers}
                disabled={refreshingFollowers}
                className="mb-1 inline-flex items-center gap-1 rounded-md border border-border/45 bg-surface px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:text-text disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${refreshingFollowers ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>

            {/* Bio */}
            {record.instagramBio && (
              <p className="max-w-md text-sm italic text-muted">{record.instagramBio}</p>
            )}

            {/* Detail pills */}
            <div className="flex flex-wrap gap-2 pt-1">
              {record.phoneNumber && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border/30 bg-surface px-2.5 py-0.5 text-xs text-muted">
                  {record.phoneCountryCode} {record.phoneNumber}
                </span>
              )}
              <span className="inline-flex items-center gap-1 rounded-full border border-border/30 bg-surface px-2.5 py-0.5 text-xs text-muted">
                <MapPin className="h-3 w-3" />
                {record.branchName}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-border/30 bg-surface px-2.5 py-0.5 text-xs text-muted">
                <Calendar className="h-3 w-3" />
                Registered {fmtDate(record.createdAt)}
              </span>
            </div>
          </div>

          {/* Right: QR + Score */}
          <div className="flex items-start gap-6">
            {/* QR Code */}
            {record.qrCode && (
              <div className="flex flex-col items-center gap-1">
                <button
                  onClick={() => setQrExpanded(!qrExpanded)}
                  className="rounded-lg border border-border/30 bg-white p-1.5 transition-shadow hover:shadow-md"
                  title="Click to expand"
                >
                  <QRCodeSVG value={record.qrCode} size={qrExpanded ? 180 : 64} />
                </button>
                <span className="flex items-center gap-1 text-[10px] text-muted">
                  <QrCode className="h-3 w-3" />
                  {qrExpanded ? "Click to shrink" : "Click to expand"}
                </span>
              </div>
            )}

            {/* Score */}
            {record.influencerScore != null && <ScoreRing score={record.influencerScore} />}
          </div>
        </div>
      </motion.section>

      {/* ── B. Performance KPIs ─────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: "Total Reels", value: reels.length, icon: <Film className="h-5 w-5" /> },
          { label: "Total Views", value: fmtNum(totalViews), icon: <Eye className="h-5 w-5" /> },
          { label: "Total Earned", value: fmtCurrency(wallet.totalEarned), icon: <IndianRupee className="h-5 w-5" /> },
          { label: "Actual Visits", value: bookingSummary.totalVisits, icon: <MapPin className="h-5 w-5" /> },
        ].map((kpi, i) => (
          <motion.div
            key={kpi.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: i * 0.07 }}
            className="rounded-xl border border-border/45 bg-panel p-4 shadow-sm"
          >
            <div className="mb-2 text-muted">{kpi.icon}</div>
            <p className="text-[11px] uppercase tracking-[0.08em] text-muted">{kpi.label}</p>
            <p className="font-display text-3xl font-semibold text-text">{kpi.value}</p>
          </motion.div>
        ))}
      </div>

      {/* ── C. Reel Performance Table ───────────────────────────── */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.15 }}
        className="rounded-xl border border-border/45 bg-panel p-4 shadow-sm"
      >
        <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold text-text">
          <Film className="h-5 w-5 text-muted" />
          Reel Performance
        </h2>

        {reels.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No reels submitted yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/30 text-left text-[11px] uppercase tracking-[0.08em] text-muted">
                  <th className="pb-2 pr-3">Reel Link</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2 pr-3 text-right">Views</th>
                  <th className="pb-2 pr-3">Current Tier</th>
                  <th className="pb-2 pr-3 text-right">Earned</th>
                  <th className="pb-2 pr-3">Milestone</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {reels.map((reel) => {
                  const pendingAmount = reel.milestoneReady
                    ? calculateIncrementalPayout(reel.currentViewTier, reel.highestPaidTier)
                    : 0;

                  return (
                    <tr key={reel.id} className="border-b border-border/15 last:border-0">
                      <td className="py-2.5 pr-3">
                        <a
                          href={reel.reelLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-blue-500 hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" />
                          <span className="max-w-[120px] truncate">{reel.reelLink.replace(/^https?:\/\/(www\.)?instagram\.com\//, "")}</span>
                        </a>
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${REEL_STATUS_COLORS[reel.status] ?? ""}`}>
                          {reel.status}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-right font-medium text-text">{fmtNum(reel.viewCount)}</td>
                      <td className="py-2.5 pr-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${VIEW_TIER_COLORS[reel.currentViewTier] ?? ""}`}>
                          {viewTierLabel(reel.currentViewTier)}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-right font-medium text-text">{fmtCurrency(reel.totalEarned)}</td>
                      <td className="py-2.5 pr-3">
                        {reel.milestoneReady && pendingAmount > 0 ? (
                          <span className="inline-flex animate-pulse items-center gap-1 rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-semibold text-orange-700">
                            <TrendingUp className="h-3 w-3" />
                            Milestone Ready {fmtCurrency(pendingAmount)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </td>
                      <td className="py-2.5">
                        <div className="flex items-center gap-2">
                          {/* Update Views */}
                          {viewsModal?.reelId === reel.id ? (
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min={0}
                                value={viewCountInput}
                                onChange={(e) => setViewCountInput(e.target.value)}
                                placeholder="Views"
                                className="w-24 rounded border border-border/45 bg-surface px-2 py-1 text-xs text-text"
                              />
                              <button
                                onClick={() => handleUpdateViews(reel.id)}
                                disabled={actionLoading === reel.id}
                                className="rounded bg-blue-500 px-2 py-1 text-xs text-white hover:bg-blue-600 disabled:opacity-50"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => { setViewsModal(null); setViewCountInput(""); }}
                                className="rounded px-1.5 py-1 text-xs text-muted hover:text-text"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => { setViewsModal({ reelId: reel.id }); setViewCountInput(String(reel.viewCount)); }}
                              className="rounded border border-border/45 bg-surface px-2 py-1 text-xs text-muted transition-colors hover:text-text"
                            >
                              Update Views
                            </button>
                          )}

                          {/* Approve milestone */}
                          {reel.milestoneReady && pendingAmount > 0 && (
                            <button
                              onClick={() => handleApproveMilestone(reel.id)}
                              disabled={actionLoading === reel.id}
                              className="rounded bg-emerald-500 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
                            >
                              {actionLoading === reel.id ? "..." : "Approve"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </motion.section>

      {/* ── D. Visit History ────────────────────────────────────── */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.2 }}
        className="rounded-xl border border-border/45 bg-panel p-4 shadow-sm"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-text">
            <MapPin className="h-5 w-5 text-muted" />
            Visit History at A Square
          </h2>
          <span className="text-sm text-muted">
            {bookingSummary.totalVisits} visits &middot; {fmtCurrency(bookingSummary.totalSpent)} total spent
          </span>
        </div>

        {bookingHistory.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No booking records found matching this phone number.</p>
        ) : (
          <>
            {(bookingSummary.firstVisitDate || bookingSummary.lastVisitDate) && (
              <div className="mb-3 flex gap-4 text-xs text-muted">
                {bookingSummary.firstVisitDate && <span>First visit: {fmtDate(bookingSummary.firstVisitDate)}</span>}
                {bookingSummary.lastVisitDate && <span>Last visit: {fmtDate(bookingSummary.lastVisitDate)}</span>}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/30 text-left text-[11px] uppercase tracking-[0.08em] text-muted">
                    <th className="pb-2 pr-3">Session Date</th>
                    <th className="pb-2 pr-3">Location</th>
                    <th className="pb-2 pr-3">Activities</th>
                    <th className="pb-2 pr-3 text-right">Amount</th>
                    <th className="pb-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {bookingHistory.map((b) => (
                    <tr key={b.bookingId} className="border-b border-border/15 last:border-0">
                      <td className="py-2.5 pr-3 text-text">{fmtDate(b.sessionDate)}</td>
                      <td className="py-2.5 pr-3 text-muted">{b.locationId}</td>
                      <td className="py-2.5 pr-3 text-muted">{b.activities.join(", ") || "—"}</td>
                      <td className="py-2.5 pr-3 text-right font-medium text-text">{fmtCurrency(b.finalAmount)}</td>
                      <td className="py-2.5">
                        <span className="text-xs capitalize text-muted">{b.bookingStatus}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </motion.section>

      {/* ── E. Wallet & Transactions ────────────────────────────── */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.25 }}
        className="space-y-4"
      >
        {/* Balance card */}
        <div className="rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 p-5 text-white shadow-sm">
          <div className="flex items-center gap-2 text-blue-100">
            <Wallet className="h-5 w-5" />
            <span className="text-sm font-medium">Wallet Balance</span>
          </div>
          <p className="mt-2 font-display text-4xl font-bold">{fmtCurrency(wallet.balance)}</p>
          <div className="mt-3 flex gap-6 text-sm text-blue-100">
            <span>Total Earned: {fmtCurrency(wallet.totalEarned)}</span>
            <span>Total Withdrawn: {fmtCurrency(wallet.totalWithdrawn)}</span>
          </div>
        </div>

        {/* Transaction list */}
        {walletHistory.length > 0 && (
          <div className="rounded-xl border border-border/45 bg-panel p-4 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-text">Transaction History</h3>
            <div className="space-y-1">
              {walletHistory.map((tx) => (
                <div key={tx.id} className="flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors hover:bg-surface">
                  <div>
                    <p className="text-sm text-text">{tx.description}</p>
                    <p className="text-xs text-muted">{fmtDateTime(tx.createdAt)}</p>
                  </div>
                  <span
                    className={`font-display text-sm font-semibold ${
                      tx.amount >= 0 ? "text-emerald-600" : "text-red-500"
                    }`}
                  >
                    {tx.amount >= 0 ? "+" : ""}
                    {fmtCurrency(Math.abs(tx.amount))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </motion.section>

      {/* ── F. Activity Timeline ────────────────────────────────── */}
      {timeline.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.3 }}
          className="rounded-xl border border-border/45 bg-panel p-4 shadow-sm"
        >
          <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold text-text">
            <Clock className="h-5 w-5 text-muted" />
            Activity Timeline
          </h2>
          <div className="ml-1">
            {timeline.map((entry, i) => (
              <TimelineItem key={`${entry.date}-${i}`} entry={entry} isLast={i === timeline.length - 1} />
            ))}
          </div>
        </motion.section>
      )}
    </div>
  );
};

export default KartfluencerProfileView;
