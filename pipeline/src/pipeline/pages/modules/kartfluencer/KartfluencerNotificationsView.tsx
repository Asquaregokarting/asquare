import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../../features/auth/auth-context";
import { kartfluencerApi } from "../../../api/kartfluencer";
import type { KartfluencerNotification } from "../../../api/types";
import { Bell, Megaphone, Send, ToggleLeft, ToggleRight, Trash2, AlertTriangle, Info } from "lucide-react";
import { logger } from "../../../../lib/logger";

const TYPE_OPTIONS: Array<{ value: KartfluencerNotification["type"]; label: string; icon: typeof Bell }> = [
  { value: "offer", label: "Offer", icon: Megaphone },
  { value: "alert", label: "Alert", icon: AlertTriangle },
  { value: "info", label: "Info", icon: Info },
];

const TYPE_COLORS: Record<string, string> = {
  offer: "bg-orange-100 text-orange-700 border-orange-200",
  alert: "bg-red-100 text-red-700 border-red-200",
  info: "bg-blue-100 text-blue-700 border-blue-200",
};

const KartfluencerNotificationsView = () => {
  const { session } = useAuth();
  const token = session?.token ?? "";

  const [notifications, setNotifications] = useState<KartfluencerNotification[]>([]);
  const [loading, setLoading] = useState(true);

  // Create form
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [type, setType] = useState<KartfluencerNotification["type"]>("info");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await kartfluencerApi.listNotifications(token);
      setNotifications(data);
    } catch (err) {
      logger.error('kartfluencer.load_notifications_failed', err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !message.trim()) return;
    setCreating(true);
    setError("");
    try {
      await kartfluencerApi.createNotification(token, { title: title.trim(), message: message.trim(), type });
      setTitle("");
      setMessage("");
      setType("info");
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create notification");
    } finally {
      setCreating(false);
    }
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    try {
      await kartfluencerApi.toggleNotification(token, id, !isActive);
      void load();
    } catch (err) {
      logger.error('kartfluencer.notification_toggle_failed', err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this notification?")) return;
    try {
      await kartfluencerApi.deleteNotification(token, id);
      void load();
    } catch (err) {
      logger.error('kartfluencer.notification_delete_failed', err);
    }
  };

  return (
    <div className="ui-section-stack max-w-3xl">
      {/* Create Form */}
      <div className="rounded-xl border border-border/50 bg-surface/80 p-5">
        <h3 className="text-sm font-semibold text-text mb-4 flex items-center gap-2">
          <Send size={16} /> Create Broadcast
        </h3>
        {error && <div className="mb-3 rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">{error}</div>}
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="ui-field w-full"
              placeholder="Notification title..."
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1">Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="ui-field w-full min-h-[80px]"
              placeholder="Write your broadcast message..."
              required
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs font-medium text-muted">Type:</label>
            {TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setType(opt.value)}
                className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                  type === opt.value ? TYPE_COLORS[opt.value] : "border-border/50 bg-base text-muted hover:border-border"
                }`}
              >
                <opt.icon size={12} /> {opt.label}
              </button>
            ))}
          </div>
          <button type="submit" disabled={creating} className="ui-btn ui-btn-primary text-xs">
            {creating ? "Sending..." : "Send Broadcast"}
          </button>
        </form>
      </div>

      {/* Existing Notifications */}
      <div>
        <h3 className="text-sm font-semibold text-text mb-3">Active Broadcasts ({notifications.filter((n) => n.isActive).length})</h3>
        {loading ? (
          <div className="py-8 text-center text-sm text-muted">Loading...</div>
        ) : notifications.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted">No broadcasts yet.</div>
        ) : (
          <div className="space-y-3">
            {notifications.map((n) => (
              <div
                key={n.id}
                className={`rounded-xl border p-4 transition-opacity ${
                  n.isActive ? "border-border/50 bg-surface/80" : "border-border/30 bg-surface/40 opacity-60"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] font-medium rounded-full px-2 py-0.5 ${TYPE_COLORS[n.type]}`}>
                        {n.type}
                      </span>
                      <span className="text-xs font-semibold text-text">{n.title}</span>
                    </div>
                    <p className="text-xs text-muted">{n.message}</p>
                    <p className="text-[10px] text-muted/70 mt-1">
                      {new Date(n.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 ml-3">
                    <button onClick={() => handleToggle(n.id, n.isActive)} className="p-1.5 rounded hover:bg-surface" title={n.isActive ? "Deactivate" : "Activate"}>
                      {n.isActive ? <ToggleRight size={18} className="text-green-600" /> : <ToggleLeft size={18} className="text-muted" />}
                    </button>
                    <button onClick={() => handleDelete(n.id)} className="p-1.5 rounded hover:bg-surface" title="Delete">
                      <Trash2 size={14} className="text-critical" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default KartfluencerNotificationsView;
