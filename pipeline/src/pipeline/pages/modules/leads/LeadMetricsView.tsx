import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { useLeadMetrics } from "../../../features/leads/useLeadMetrics";
import { LEAD_STATUS_LABELS, LEAD_SOURCE_LABELS } from "../../../features/leads/lead-constants";

const STATUS_COLORS: Record<string, string> = {
  new: "#3B82F6",
  contacted: "#8B5CF6",
  interested: "#F59E0B",
  booked: "#10B981",
  closed: "#6B7280",
  lost: "#EF4444",
};

const LeadMetricsView = () => {
  const { metrics, loading, error } = useLeadMetrics();

  if (loading) return <div className="py-12 text-center text-sm text-muted">Loading metrics...</div>;
  if (error) return <div className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">{error}</div>;
  if (!metrics) return null;

  const funnelData = Object.entries(metrics.byStatus).map(([status, count]) => ({
    name: LEAD_STATUS_LABELS[status as keyof typeof LEAD_STATUS_LABELS] ?? status,
    value: count,
    status,
  }));

  const sourceData = Object.entries(metrics.bySource)
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => ({
      name: LEAD_SOURCE_LABELS[source as keyof typeof LEAD_SOURCE_LABELS] ?? source,
      value: count,
    }));

  return (
    <div className="ui-section-stack">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-4">
        <div className="ui-panel p-3 sm:p-4">
          <p className="font-display text-2xl sm:text-3xl font-semibold leading-none text-text">{metrics.total}</p>
          <p className="mt-1 text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Total Leads</p>
        </div>
        <div className="relative rounded-xl border border-success/35 bg-success/10 p-3 sm:p-4 shadow-sm">
          <p className="font-display text-2xl sm:text-3xl font-semibold leading-none text-success">{metrics.conversionRate}%</p>
          <p className="mt-1 text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.08em] text-success">Conversion Rate</p>
        </div>
        <div className="relative rounded-xl border border-critical/35 bg-critical/10 p-3 sm:p-4 shadow-sm">
          <p className="font-display text-2xl sm:text-3xl font-semibold leading-none text-critical">{metrics.byScoreLabel.hot ?? 0}</p>
          <p className="mt-1 text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.08em] text-critical">Hot Leads</p>
        </div>
        <div className="relative rounded-xl border border-warning/35 bg-warning/10 p-3 sm:p-4 shadow-sm">
          <p className="font-display text-2xl sm:text-3xl font-semibold leading-none text-warning">{metrics.byScoreLabel.warm ?? 0}</p>
          <p className="mt-1 text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.08em] text-warning">Warm Leads</p>
        </div>
      </div>

      {/* Conversion Funnel */}
      <div className="ui-panel p-3 sm:p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted">Conversion Funnel</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={funnelData} layout="vertical" margin={{ left: -10, right: 10 }}>
            <XAxis type="number" tick={{ fill: "rgb(var(--color-muted))", fontSize: 11 }} />
            <YAxis type="category" dataKey="name" width={80} tick={{ fill: "rgb(var(--color-muted))", fontSize: 10 }} />
            <Tooltip contentStyle={{ background: "rgb(var(--color-panel))", border: "1px solid rgb(var(--color-border))", borderRadius: 8, color: "rgb(var(--color-text))" }} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]}>
              {funnelData.map((entry) => (
                <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? "#6B7280"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Source Breakdown */}
      <div className="ui-panel p-3 sm:p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted">Leads by Source</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={sourceData} margin={{ left: -10, right: 10 }}>
            <XAxis dataKey="name" tick={{ fill: "rgb(var(--color-muted))", fontSize: 9 }} angle={-30} textAnchor="end" height={60} interval={0} />
            <YAxis tick={{ fill: "rgb(var(--color-muted))", fontSize: 11 }} />
            <Tooltip contentStyle={{ background: "rgb(var(--color-panel))", border: "1px solid rgb(var(--color-border))", borderRadius: 8, color: "rgb(var(--color-text))" }} />
            <Bar dataKey="value" fill="rgb(var(--color-accent))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Status Breakdown Table */}
      <div className="overflow-x-auto rounded-xl border border-border/50 bg-panel shadow-sm">
        <table className="w-full text-sm min-w-[360px]">
          <thead className="bg-surface/45">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.09em] text-muted">Status</th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.09em] text-muted">Count</th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.09em] text-muted">% of Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/55">
            {Object.entries(metrics.byStatus).map(([status, count]) => (
              <tr key={status}>
                <td className="px-4 py-3 font-medium text-text capitalize">{LEAD_STATUS_LABELS[status as keyof typeof LEAD_STATUS_LABELS] ?? status}</td>
                <td className="px-4 py-3 text-right text-text">{count}</td>
                <td className="px-4 py-3 text-right text-muted">{metrics.total > 0 ? Math.round((count / metrics.total) * 100) : 0}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default LeadMetricsView;
