import { useCallback, useEffect, useState } from "react";
import {
  loadInteraktDashboard,
  type InteraktDashboardData,
  type InteraktCustomerEvent,
  type InteraktAccountAlert,
  type InteraktTemplateAlert,
  type InteraktPayment,
  type InteraktMessageRequest,
} from "../../../api/interakt-events-firestore";
import {
  MousePointerClick, ShoppingCart, CreditCard, AlertTriangle,
  Bell, FileText, RefreshCw, CheckCircle2, XCircle, MessageCircle,
  Reply, Send,
} from "lucide-react";

// ─── Time helper ────────────────────────────────────────────────────

const relTime = (iso: string): string => {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

// ─── Sub-components ─────────────────────────────────────────────────

const SectionHeader = ({ title, count, icon: Icon }: { title: string; count: number; icon: typeof Bell }) => (
  <div className="flex items-center gap-2 mb-3">
    <Icon size={16} className="text-muted" />
    <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">{title}</h3>
    <span className="ml-auto rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-muted">{count}</span>
  </div>
);

const EmptyState = ({ label }: { label: string }) => (
  <div className="rounded-lg border border-border/40 bg-surface/30 px-4 py-6 text-center text-sm text-muted/60">
    No {label} yet
  </div>
);

// ─── Customer Events Table ──────────────────────────────────────────

const CustomerEventsSection = ({ events }: { events: InteraktCustomerEvent[] }) => {
  const getEventIcon = (e: InteraktCustomerEvent) => {
    if (e.orderData || e.totalAmount) return ShoppingCart;
    if (e.isCompletedFlow) return CheckCircle2;
    if (e.buttonText) return MousePointerClick;
    if (e.replyText) return Reply;
    return MessageCircle;
  };

  const getEventLabel = (e: InteraktCustomerEvent) => {
    if (e.orderData || e.totalAmount) return "WhatsApp Order";
    if (e.isCompletedFlow) return "Completed Flow";
    if (e.buttonText) return "Button Click";
    if (e.replyText) return "Template Reply";
    return e.eventType;
  };

  return (
    <div>
      <SectionHeader title="Customer Engagement" count={events.length} icon={MousePointerClick} />
      {events.length === 0 ? <EmptyState label="customer events" /> : (
        <div className="overflow-hidden rounded-xl border border-border/50 bg-panel shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-surface/45">
              <tr>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">Event</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">Customer</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">Detail</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {events.map((e) => {
                const Icon = getEventIcon(e);
                return (
                  <tr key={e.id} className="hover:bg-surface/20">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <Icon size={14} className="text-muted shrink-0" />
                        <span className="text-text">{getEventLabel(e)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="text-text">{e.customerName}</div>
                      {e.phone && <div className="text-[11px] text-muted">{e.phone}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-muted max-w-[300px] truncate">
                      {e.totalAmount ? `₹${e.totalAmount}` : ""}
                      {e.buttonText || e.replyText || e.orderNumber || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right text-muted text-[12px]">{relTime(e.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ─── Payments Table ─────────────────────────────────────────────────

const PaymentsSection = ({ payments }: { payments: InteraktPayment[] }) => (
  <div>
    <SectionHeader title="WhatsApp Payments" count={payments.length} icon={CreditCard} />
    {payments.length === 0 ? <EmptyState label="payments" /> : (
      <div className="overflow-hidden rounded-xl border border-border/50 bg-panel shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-surface/45">
            <tr>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">Status</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">Customer</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">Amount</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">Payment ID</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {payments.map((p) => (
              <tr key={p.id} className="hover:bg-surface/20">
                <td className="px-4 py-2.5">
                  {p.isSuccess ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                      <CheckCircle2 size={12} /> Confirmed
                    </span>
                  ) : p.isFailed ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-critical/40 bg-critical/10 px-2 py-0.5 text-[11px] font-medium text-critical">
                      <XCircle size={12} /> Failed
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
                      {p.paymentStatus}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <div className="text-text">{p.customerName}</div>
                  {p.phone && <div className="text-[11px] text-muted">{p.phone}</div>}
                </td>
                <td className="px-4 py-2.5 text-right font-medium text-text">
                  {p.amount > 0 ? `₹${p.amount}` : "—"}
                </td>
                <td className="px-4 py-2.5 text-muted text-[12px] font-mono">
                  {p.paymentId || p.orderNumber || "—"}
                </td>
                <td className="px-4 py-2.5 text-right text-muted text-[12px]">{relTime(p.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

// ─── Account Alerts ─────────────────────────────────────────────────

const AccountAlertsSection = ({ alerts }: { alerts: InteraktAccountAlert[] }) => (
  <div>
    <SectionHeader title="Account Alerts" count={alerts.length} icon={AlertTriangle} />
    {alerts.length === 0 ? <EmptyState label="account alerts" /> : (
      <div className="space-y-2">
        {alerts.map((a) => {
          const isQuality = a.eventType.toLowerCase().includes("quality");
          return (
            <div
              key={a.id}
              className={`rounded-lg border px-4 py-3 text-sm ${
                isQuality
                  ? "border-warning/40 bg-warning/5 text-warning"
                  : "border-border/50 bg-panel text-text"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{a.eventType.replace(/_/g, " ")}</span>
                <span className="text-[11px] text-muted">{relTime(a.createdAt)}</span>
              </div>
              {Object.keys(a.alertData).length > 0 && (
                <pre className="mt-1.5 text-[11px] text-muted/80 overflow-x-auto">
                  {JSON.stringify(a.alertData, null, 2)}
                </pre>
              )}
            </div>
          );
        })}
      </div>
    )}
  </div>
);

// ─── Template Alerts ────────────────────────────────────────────────

const TemplateAlertsSection = ({ alerts }: { alerts: InteraktTemplateAlert[] }) => (
  <div>
    <SectionHeader title="Template Alerts" count={alerts.length} icon={FileText} />
    {alerts.length === 0 ? <EmptyState label="template alerts" /> : (
      <div className="overflow-hidden rounded-xl border border-border/50 bg-panel shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-surface/45">
            <tr>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">Template</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">Status</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">Event</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {alerts.map((a) => {
              const status = (a.templateStatus || "").toLowerCase();
              const isRejected = status.includes("rejected") || status.includes("disabled") || status.includes("paused");
              const isApproved = status.includes("approved") || status.includes("active");
              return (
                <tr key={a.id} className="hover:bg-surface/20">
                  <td className="px-4 py-2.5 font-medium text-text">{a.templateName || "—"}</td>
                  <td className="px-4 py-2.5">
                    {isRejected ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-critical/40 bg-critical/10 px-2 py-0.5 text-[11px] font-medium text-critical">
                        <XCircle size={12} /> {a.templateStatus}
                      </span>
                    ) : isApproved ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                        <CheckCircle2 size={12} /> {a.templateStatus}
                      </span>
                    ) : (
                      <span className="text-muted">{a.templateStatus || "—"}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-muted">{a.eventType.replace(/_/g, " ")}</td>
                  <td className="px-4 py-2.5 text-right text-muted text-[12px]">{relTime(a.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

// ─── Message Requests (Sent Notifications) ─────────────────────────

const MessageRequestsSection = ({ requests }: { requests: InteraktMessageRequest[] }) => (
  <div>
    <SectionHeader title="Sent Notifications" count={requests.length} icon={Send} />
    {requests.length === 0 ? <EmptyState label="sent notifications" /> : (
      <div className="overflow-hidden rounded-xl border border-border/50 bg-panel shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-surface/45">
            <tr>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">Template</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">Phone</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">Reference</th>
              <th className="px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">Status</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {requests.map((r) => {
              const isOk = r.responseStatus >= 200 && r.responseStatus < 300;
              return (
                <tr key={r.id} className="hover:bg-surface/20">
                  <td className="px-4 py-2.5 font-medium text-text">{r.type.replace(/_/g, " ")}</td>
                  <td className="px-4 py-2.5 text-muted font-mono text-[12px]">{r.phoneNumber || "—"}</td>
                  <td className="px-4 py-2.5 text-muted text-[12px]">{r.invoiceNo || "—"}</td>
                  <td className="px-4 py-2.5 text-center">
                    {isOk ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                        <CheckCircle2 size={12} /> {r.responseStatus}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-critical/40 bg-critical/10 px-2 py-0.5 text-[11px] font-medium text-critical">
                        <XCircle size={12} /> {r.responseStatus}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-muted text-[12px]">{relTime(r.requestedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

// ─── Main Dashboard ─────────────────────────────────────────────────

const InteraktDashboard = () => {
  const [data, setData] = useState<InteraktDashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await loadInteraktDashboard();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Interakt data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return <div className="py-12 text-center text-sm text-muted">Loading Interakt dashboard...</div>;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
        {error}
      </div>
    );
  }

  if (!data) return null;

  // Summary counts
  const totalEngagement = data.customerEvents.length;
  const successPayments = data.payments.filter((p) => p.isSuccess).length;
  const failedPayments = data.payments.filter((p) => p.isFailed).length;
  const totalAlerts = data.accountAlerts.length + data.templateAlerts.length;
  const totalSent = data.messageRequests.length;
  const sentOk = data.messageRequests.filter((r) => r.responseStatus >= 200 && r.responseStatus < 300).length;
  const sentFailed = totalSent - sentOk;
  const orders = data.customerEvents.filter((e) => e.orderData || e.totalAmount);
  const orderValue = orders.reduce((sum, e) => sum + (e.totalAmount ?? 0), 0);

  return (
    <div className="ui-section-stack">
      {/* Summary Cards */}
      <div className="flex items-center justify-between">
        <div className="flex gap-4 flex-1">
          <div className="ui-panel flex-1 p-4">
            <p className="font-display text-3xl font-semibold leading-none text-text">{totalEngagement}</p>
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Engagement Events</p>
          </div>
          <div className="relative rounded-xl border border-success/35 bg-success/10 p-4 shadow-sm flex-1">
            <p className="font-display text-3xl font-semibold leading-none text-success">{successPayments}</p>
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-success">Payments Confirmed</p>
          </div>
          {failedPayments > 0 && (
            <div className="relative rounded-xl border border-critical/35 bg-critical/10 p-4 shadow-sm flex-1">
              <p className="font-display text-3xl font-semibold leading-none text-critical">{failedPayments}</p>
              <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-critical">Payments Failed</p>
            </div>
          )}
          {orders.length > 0 && (
            <div className="relative rounded-xl border border-accent/35 bg-accent/10 p-4 shadow-sm flex-1">
              <p className="font-display text-3xl font-semibold leading-none text-accent">
                {orders.length} <span className="text-lg">/ ₹{orderValue}</span>
              </p>
              <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-accent">WhatsApp Orders</p>
            </div>
          )}
          {totalSent > 0 && (
            <div className="relative rounded-xl border border-info/35 bg-info/10 p-4 shadow-sm flex-1">
              <p className="font-display text-3xl font-semibold leading-none text-info">
                {sentOk}{sentFailed > 0 && <span className="text-lg text-critical"> / {sentFailed} failed</span>}
              </p>
              <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-info">Notifications Sent</p>
            </div>
          )}
          {totalAlerts > 0 && (
            <div className="relative rounded-xl border border-warning/35 bg-warning/10 p-4 shadow-sm flex-1">
              <p className="font-display text-3xl font-semibold leading-none text-warning">{totalAlerts}</p>
              <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-warning">Alerts</p>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="ml-4 rounded-lg border border-border/50 bg-surface px-3 py-2 text-sm text-muted hover:text-text transition-colors disabled:opacity-50"
          aria-label="Refresh"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Sent Notifications */}
      <MessageRequestsSection requests={data.messageRequests} />

      {/* Customer Engagement */}
      <CustomerEventsSection events={data.customerEvents} />

      {/* Payments */}
      <PaymentsSection payments={data.payments} />

      {/* Template Alerts */}
      <TemplateAlertsSection alerts={data.templateAlerts} />

      {/* Account Alerts */}
      <AccountAlertsSection alerts={data.accountAlerts} />
    </div>
  );
};

export default InteraktDashboard;
