import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "../../features/auth/auth-context";
import { kartfluencerApi } from "../../api/kartfluencer";
import { canRoleAccessTab } from "../../features/navigation/module-manifest";
import type { KartfluencerStats } from "../../api/types";
import { Instagram, Users, Eye, Film, IndianRupee, ArrowRight, Zap, Wallet, BarChart3 } from "lucide-react";

const KartfluencerBanner = () => {
  const { session } = useAuth();
  const navigate = useNavigate();
  const role = session?.user.role;
  const token = session?.token ?? "";

  const [stats, setStats] = useState<KartfluencerStats | null>(null);

  useEffect(() => {
    if (!token || !role || !canRoleAccessTab(role, "Kartfluencer")) return;
    void kartfluencerApi.getStats(token).then(setStats).catch(() => {});
  }, [token, role]);

  if (!role || !canRoleAccessTab(role, "Kartfluencer")) return null;

  const fmtNum = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
    return String(n);
  };

  return (
    <section>
      {/* Section header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-fuchsia-500 to-pink-500 shadow-sm">
            <Instagram size={15} className="text-white" />
          </div>
          <div>
            <h2 className="font-display text-xl tracking-tight text-text lg:text-2xl">Kartfluencer</h2>
          </div>
        </div>
        <Link
          to="/kartfluencer/analytics"
          className="text-sm font-medium text-accent hover:underline"
        >
          View Analytics →
        </Link>
      </div>

      {/* KPI row — matches dashboard KpiCard grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <KfKpiCard
          label="Influencers"
          value={stats ? String(stats.total) : "–"}
          icon={Users}
          iconColor="text-fuchsia-500"
          loading={!stats}
        />
        <KfKpiCard
          label="Total Views"
          value={stats ? fmtNum(stats.totalViews) : "–"}
          icon={Eye}
          iconColor="text-blue-500"
          loading={!stats}
        />
        <KfKpiCard
          label="Pending Reels"
          value={stats ? String(stats.pendingReels) : "–"}
          icon={Film}
          iconColor="text-amber-500"
          loading={!stats}
        />
        <KfKpiCard
          label="Milestones Ready"
          value={stats ? String(stats.milestoneReadyReels) : "–"}
          icon={Zap}
          iconColor="text-orange-500"
          loading={!stats}
          highlight={!!stats && stats.milestoneReadyReels > 0}
        />
        <KfKpiCard
          label="Total Paid Out"
          value={stats ? `₹${fmtNum(stats.totalPaidOut)}` : "–"}
          icon={IndianRupee}
          iconColor="text-emerald-500"
          loading={!stats}
        />
        <KfKpiCard
          label="Pending Payouts"
          value={stats ? String(stats.pendingWithdrawals) : "–"}
          icon={Wallet}
          iconColor="text-violet-500"
          loading={!stats}
          highlight={!!stats && stats.pendingWithdrawals > 0}
        />
      </div>

      {/* Quick actions row */}
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <KfActionCard
          label="Review Reels"
          description="Verify submitted reels and approve view milestones"
          icon={Film}
          iconBg="bg-purple-500"
          badge={stats?.milestoneReadyReels ? `${stats.milestoneReadyReels} ready` : undefined}
          badgeTone="warning"
          onClick={() => navigate("/kartfluencer/reels")}
        />
        <KfActionCard
          label="Process Withdrawals"
          description="Review and process influencer payout requests"
          icon={Wallet}
          iconBg="bg-emerald-500"
          badge={stats?.pendingWithdrawals ? `${stats.pendingWithdrawals} pending` : undefined}
          badgeTone="critical"
          onClick={() => navigate("/kartfluencer/withdrawals")}
        />
        <KfActionCard
          label="Influencer Pipeline"
          description="Track journey from registration to active earning"
          icon={BarChart3}
          iconBg="bg-blue-500"
          onClick={() => navigate("/kartfluencer/pipeline")}
        />
      </div>
    </section>
  );
};

// ─── Sub-components matching dashboard design system ─────────────

const KfKpiCard = ({
  label,
  value,
  icon: Icon,
  iconColor,
  loading,
  highlight,
}: {
  label: string;
  value: string;
  icon: typeof Users;
  iconColor: string;
  loading: boolean;
  highlight?: boolean;
}) => (
  <motion.div
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.24, ease: "easeOut" }}
    className={`relative rounded-xl border bg-panel p-4 shadow-sm transition-colors ${
      highlight ? "border-warning/45 bg-warning/5" : "border-border/45"
    }`}
  >
    <div className="flex items-center gap-2 mb-2">
      <Icon size={14} className={iconColor} />
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{label}</p>
    </div>
    {loading ? (
      <div className="h-9 w-20 animate-pulse rounded-lg bg-border/30" />
    ) : (
      <p className={`font-display text-2xl font-semibold leading-none tracking-tight lg:text-3xl ${
        highlight ? "text-warning" : "text-text"
      }`}>
        {value}
      </p>
    )}
    {highlight && (
      <span className="absolute top-2 right-2 flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warning/60" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-warning" />
      </span>
    )}
  </motion.div>
);

const KfActionCard = ({
  label,
  description,
  icon: Icon,
  iconBg,
  badge,
  badgeTone,
  onClick,
}: {
  label: string;
  description: string;
  icon: typeof Users;
  iconBg: string;
  badge?: string;
  badgeTone?: "warning" | "critical";
  onClick: () => void;
}) => {
  const badgeColors = badgeTone === "critical"
    ? "border-critical/35 bg-critical/10 text-critical"
    : "border-warning/35 bg-warning/10 text-warning";

  return (
    <motion.button
      type="button"
      whileHover={{ y: -2, scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      onClick={onClick}
      className="group relative flex w-full items-start gap-3.5 rounded-xl border border-border/45 bg-panel p-4 text-left shadow-sm transition-all duration-150 hover:border-accent/35 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconBg} shadow-sm`}>
        <Icon size={18} className="text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-text">{label}</h3>
          {badge && (
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[0.625rem] font-semibold ${badgeColors}`}>
              {badge}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted">{description}</p>
      </div>
      <ArrowRight size={16} className="shrink-0 text-muted/40 transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
    </motion.button>
  );
};

export default KartfluencerBanner;
