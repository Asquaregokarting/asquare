import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Wallet,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  Search,
  RefreshCw,
} from "lucide-react";
import { useAuth } from "../../../features/auth/auth-context";
import { kartfluencerApi } from "../../../api/kartfluencer";
import { logger } from "../../../../lib/logger";
import type { KartfluencerWithdrawal } from "../../../api/types";

type WithdrawalStatus = KartfluencerWithdrawal["status"];
type FilterTab = "all" | WithdrawalStatus;

const STATUS_COLORS: Record<WithdrawalStatus, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  processing: "bg-blue-100 text-blue-700",
  completed: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
};

const STATUS_LABELS: Record<WithdrawalStatus, string> = {
  pending: "Pending",
  processing: "Processing",
  completed: "Completed",
  rejected: "Rejected",
};

const METHOD_LABELS: Record<string, string> = {
  manual_upi: "Manual UPI",
  razorpay: "Razorpay",
};

const KartfluencerWithdrawalsView = () => {
  const { session } = useAuth();
  const token = session?.token ?? "";

  const [withdrawals, setWithdrawals] = useState<KartfluencerWithdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [search, setSearch] = useState("");
  const [processingId, setProcessingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await kartfluencerApi.listWithdrawals(token);
      setWithdrawals(data);
    } catch (err) {
      logger.error('kartfluencer.load_withdrawals_failed', err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  // Stats
  const stats = useMemo(() => {
    const pending = withdrawals.filter((w) => w.status === "pending");
    const completed = withdrawals.filter((w) => w.status === "completed");
    return {
      pendingCount: pending.length,
      pendingAmount: pending.reduce((s, w) => s + w.amount, 0),
      completedCount: completed.length,
      completedAmount: completed.reduce((s, w) => s + w.amount, 0),
    };
  }, [withdrawals]);

  // Filtered list
  const filtered = useMemo(() => {
    let list = withdrawals;
    if (filterTab !== "all") {
      list = list.filter((w) => w.status === filterTab);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (w) =>
          w.instagramHandle.toLowerCase().includes(q) ||
          w.upiId.toLowerCase().includes(q) ||
          w.upiName.toLowerCase().includes(q)
      );
    }
    return list;
  }, [withdrawals, filterTab, search]);

  const handleApprove = async (id: string) => {
    if (!confirm("Approve this withdrawal via Manual UPI transfer?")) return;
    setProcessingId(id);
    try {
      await kartfluencerApi.processWithdrawal(token, id, "manual_upi");
      void load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to process withdrawal");
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (id: string) => {
    const reason = prompt("Reason for rejection:");
    if (!reason) return;
    setProcessingId(id);
    try {
      await kartfluencerApi.rejectWithdrawal(token, id, reason);
      void load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to reject withdrawal");
    } finally {
      setProcessingId(null);
    }
  };

  const tabs: Array<{ key: FilterTab; label: string }> = [
    { key: "all", label: "All" },
    { key: "pending", label: "Pending" },
    { key: "processing", label: "Processing" },
    { key: "completed", label: "Completed" },
    { key: "rejected", label: "Rejected" },
  ];

  return (
    <div className="ui-section-stack">
      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Pending"
          value={stats.pendingCount}
          sub={`₹${stats.pendingAmount.toLocaleString()}`}
          color="text-yellow-600"
          icon={<Clock size={16} className="text-yellow-500" />}
        />
        <StatCard
          label="Pending Amount"
          value={`₹${stats.pendingAmount.toLocaleString()}`}
          color="text-yellow-600"
          icon={<Wallet size={16} className="text-yellow-500" />}
        />
        <StatCard
          label="Completed"
          value={stats.completedCount}
          sub={`₹${stats.completedAmount.toLocaleString()}`}
          color="text-emerald-600"
          icon={<CheckCircle2 size={16} className="text-emerald-500" />}
        />
        <StatCard
          label="Total Paid"
          value={`₹${stats.completedAmount.toLocaleString()}`}
          color="text-emerald-600"
          icon={<Wallet size={16} className="text-emerald-500" />}
        />
      </div>

      {/* Toolbar */}
      <div className="ui-toolbar flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg border border-border/50 bg-surface/60 p-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilterTab(tab.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                filterTab === tab.key
                  ? "bg-accent text-white shadow-sm"
                  : "text-muted hover:text-text hover:bg-surface"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            placeholder="Search handle, UPI..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ui-field pl-8 min-h-9 text-xs w-full"
          />
        </div>
        <button onClick={() => void load()} className="ui-btn ui-btn-neutral text-xs gap-1">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Withdrawal cards */}
      {loading ? (
        <div className="py-16 text-center text-sm text-muted">Loading withdrawals...</div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted">No withdrawals found.</div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((w) => (
            <div
              key={w.id}
              className="rounded-xl border border-border/50 bg-surface/80 px-4 py-3.5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                {/* Left: influencer info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-sm font-semibold text-text truncate">
                      {w.instagramHandle}
                    </span>
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[w.status]}`}
                    >
                      {STATUS_LABELS[w.status]}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs">
                    <div>
                      <span className="text-muted">Amount:</span>{" "}
                      <span className="font-semibold text-text">₹{w.amount.toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-muted">UPI ID:</span>{" "}
                      <span className="text-text">{w.upiId}</span>
                    </div>
                    <div>
                      <span className="text-muted">UPI Name:</span>{" "}
                      <span className="text-text">{w.upiName}</span>
                    </div>
                    <div>
                      <span className="text-muted">Requested:</span>{" "}
                      <span className="text-text">
                        {new Date(w.requestedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  {/* Completed details */}
                  {w.status === "completed" && (
                    <div className="flex flex-wrap items-center gap-3 mt-2 text-xs">
                      {w.processedAt && (
                        <span className="text-muted">
                          Processed: {new Date(w.processedAt).toLocaleDateString()}
                        </span>
                      )}
                      {w.method && (
                        <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-700">
                          {METHOD_LABELS[w.method] ?? w.method}
                        </span>
                      )}
                      {w.paymentProofUrl && (
                        <a
                          href={w.paymentProofUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-accent hover:underline"
                        >
                          <ExternalLink size={12} /> Payment Proof
                        </a>
                      )}
                    </div>
                  )}

                  {/* Rejected details */}
                  {w.status === "rejected" && w.rejectionReason && (
                    <div className="mt-2 text-xs text-red-600">
                      Reason: {w.rejectionReason}
                    </div>
                  )}
                </div>

                {/* Right: action buttons for pending */}
                {w.status === "pending" && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => void handleApprove(w.id)}
                      disabled={processingId === w.id}
                      className="ui-btn ui-btn-primary text-xs gap-1"
                    >
                      {processingId === w.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <CheckCircle2 size={14} />
                      )}
                      Approve (Manual UPI)
                    </button>
                    <button
                      onClick={() => void handleReject(w.id)}
                      disabled={processingId === w.id}
                      className="ui-btn ui-btn-neutral text-xs gap-1 text-red-600 hover:text-red-700"
                    >
                      <XCircle size={14} /> Reject
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Sub-components ──────────────────────────────────────────────

const StatCard = ({
  label,
  value,
  sub,
  color,
  icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  icon?: React.ReactNode;
}) => (
  <div className="rounded-xl border border-border/50 bg-surface/80 px-4 py-3">
    <div className="flex items-center gap-1.5 mb-1">
      {icon}
      <span className="text-[10px] text-muted uppercase tracking-wide">{label}</span>
    </div>
    <div className={`text-xl font-bold ${color ?? "text-text"}`}>{value}</div>
    {sub && <div className="text-[10px] text-muted mt-0.5">{sub}</div>}
  </div>
);

export default KartfluencerWithdrawalsView;
