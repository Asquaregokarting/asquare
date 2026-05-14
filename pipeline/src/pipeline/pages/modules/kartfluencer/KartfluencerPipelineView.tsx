import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../features/auth/auth-context";
import { kartfluencerApi } from "../../../api/kartfluencer";
import { KARTFLUENCER_TIERS } from "../../../api/kartfluencer-firestore";
import type { KartfluencerRecord, KartfluencerStatus, KartfluencerTier } from "../../../api/types";
import { Instagram, Calendar, MapPin, ChevronRight, Wallet } from "lucide-react";
import { logger } from "../../../../lib/logger";

const PIPELINE_COLUMNS: Array<{ status: KartfluencerStatus; label: string; color: string; bgColor: string }> = [
  { status: "detailed", label: "Registered", color: "text-blue-600", bgColor: "bg-blue-50 border-blue-200" },
  { status: "visited", label: "Visited", color: "text-amber-600", bgColor: "bg-amber-50 border-amber-200" },
  { status: "reel_submitted", label: "Reel Submitted", color: "text-purple-600", bgColor: "bg-purple-50 border-purple-200" },
  { status: "verified", label: "Verified", color: "text-emerald-600", bgColor: "bg-emerald-50 border-emerald-200" },
  { status: "active", label: "Active", color: "text-green-700", bgColor: "bg-green-50 border-green-200" },
  { status: "disqualified", label: "Disqualified", color: "text-red-600", bgColor: "bg-red-50 border-red-200" },
];

const TIER_BADGE_COLORS: Record<KartfluencerTier, string> = {
  not_eligible: "bg-gray-100 text-gray-600",
  access_10k: "bg-sky-100 text-sky-700",
  access_25k: "bg-indigo-100 text-indigo-700",
  bronze: "bg-orange-100 text-orange-700",
  silver: "bg-slate-200 text-slate-700",
  gold: "bg-yellow-100 text-yellow-700",
  elite: "bg-purple-100 text-purple-700",
};

const KartfluencerPipelineView = ({ branchFilter = "" }: { branchFilter?: string }) => {
  const { session } = useAuth();
  const token = session?.token ?? "";

  const navigate = useNavigate();
  const [records, setRecords] = useState<KartfluencerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [movingId, setMovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const filter = branchFilter ? { branchId: branchFilter } : undefined;
      const data = await kartfluencerApi.list(token, filter as never);
      setRecords(data);
    } catch (err) {
      logger.error('kartfluencer.load_pipeline_failed', err);
    } finally {
      setLoading(false);
    }
  }, [token, branchFilter]);

  useEffect(() => { void load(); }, [load]);

  const columns = useMemo(() => {
    const grouped: Record<KartfluencerStatus, KartfluencerRecord[]> = {
      detailed: [], visited: [], reel_submitted: [], verified: [], active: [], disqualified: [],
    };
    for (const r of records) {
      (grouped[r.status] ?? grouped.detailed).push(r);
    }
    return grouped;
  }, [records]);

  const handleMoveNext = async (record: KartfluencerRecord) => {
    const flow: KartfluencerStatus[] = ["detailed", "visited", "reel_submitted", "verified", "active"];
    const idx = flow.indexOf(record.status);
    if (idx < 0 || idx >= flow.length - 1) return;
    const nextStatus = flow[idx + 1];

    setMovingId(record.id);
    try {
      await kartfluencerApi.updateStatus(token, record.id, nextStatus);
      void load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setMovingId(null);
    }
  };

  const handleDisqualify = async (record: KartfluencerRecord) => {
    const reason = prompt("Reason for disqualification:");
    if (reason === null) return;
    setMovingId(record.id);
    try {
      await kartfluencerApi.updateStatus(token, record.id, "disqualified", reason);
      void load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to disqualify");
    } finally {
      setMovingId(null);
    }
  };

  if (loading) {
    return <div className="py-16 text-center text-sm text-muted">Loading pipeline...</div>;
  }

  return (
    <div className="ui-section-stack">
      <div className="ui-toolbar flex items-center gap-3">
        <span className="text-xs text-muted">{records.length} influencers</span>
      </div>

      {/* Kanban Board */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {PIPELINE_COLUMNS.map((col) => {
          const items = columns[col.status];
          return (
            <div key={col.status} className="flex-shrink-0 w-[280px]">
              <div className={`rounded-t-xl border px-3 py-2.5 ${col.bgColor}`}>
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-semibold ${col.color}`}>{col.label}</span>
                  <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${col.bgColor} ${col.color}`}>
                    {items.length}
                  </span>
                </div>
              </div>
              <div className="border-x border-b border-border/50 rounded-b-xl bg-surface/40 p-2 space-y-2 min-h-[200px] max-h-[calc(100vh-300px)] overflow-y-auto">
                {items.length === 0 && (
                  <div className="py-8 text-center text-[10px] text-muted/60">No influencers</div>
                )}
                {items.map((r) => (
                  <div
                    key={r.id}
                    className="rounded-lg border border-border/50 bg-base p-3 shadow-sm hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-1.5">
                        <Instagram size={12} className="text-pink-500" />
                        <button type="button" onClick={() => navigate(`/kartfluencer/profile/${r.id}`)} className="text-xs font-semibold text-text truncate max-w-[140px] hover:text-accent hover:underline">{r.instagramHandle}</button>
                      </div>
                      <span className={`text-[9px] font-medium rounded-full px-1.5 py-0.5 ${TIER_BADGE_COLORS[r.tier]}`}>
                        {KARTFLUENCER_TIERS.find((t) => t.tier === r.tier)?.label.split(" ")[0] ?? r.tier}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-muted mb-2">
                      <MapPin size={10} /> {r.branchName}
                      {r.visitDate && (
                        <>
                          <Calendar size={10} className="ml-1" />
                          {new Date(r.visitDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                        </>
                      )}
                    </div>
                    {(r.walletBalance != null || r.totalEarned != null) && (
                      <div className="flex items-center gap-2 text-[10px] text-muted">
                        <Wallet size={10} />
                        {r.walletBalance != null && <span>Bal: ₹{r.walletBalance.toLocaleString()}</span>}
                        {r.totalEarned != null && <span className="ml-auto">Earned: ₹{r.totalEarned.toLocaleString()}</span>}
                      </div>
                    )}

                    {/* Actions */}
                    {col.status !== "active" && col.status !== "disqualified" && (
                      <div className="flex gap-1.5 mt-2 pt-2 border-t border-border/30">
                        <button
                          onClick={() => handleMoveNext(r)}
                          disabled={movingId === r.id}
                          className="ui-btn text-[10px] px-2 py-1 bg-accent/10 text-accent hover:bg-accent/20 flex items-center gap-0.5 flex-1"
                        >
                          {movingId === r.id ? "..." : "Advance"} <ChevronRight size={10} />
                        </button>
                        <button
                          onClick={() => handleDisqualify(r)}
                          disabled={movingId === r.id}
                          className="ui-btn text-[10px] px-2 py-1 bg-critical/10 text-critical hover:bg-critical/20"
                        >
                          DQ
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default KartfluencerPipelineView;
