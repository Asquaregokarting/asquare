import type { LeadTimelineEvent, TimelineAction } from "../../../api/types";
import { relativeTime } from "../../../features/leads/lead-utils";
import {
  Clock, UserPlus, ArrowRight, MessageSquare, Phone, Send, StickyNote,
  Calendar, X, Zap, MessageCircle, Workflow, MousePointerClick, Reply,
  CheckCircle2, ShoppingCart, CreditCard, AlertTriangle,
} from "lucide-react";

const ACTION_ICONS: Record<TimelineAction, typeof Clock> = {
  created: Zap,
  claimed: UserPlus,
  assigned: UserPlus,
  reassigned: ArrowRight,
  status_changed: ArrowRight,
  called: Phone,
  feedback_submitted: MessageSquare,
  whatsapp_sent: Send,
  whatsapp_inbound: MessageCircle,
  workflow_response: Workflow,
  button_clicked: MousePointerClick,
  template_replied: Reply,
  completed_flow: CheckCircle2,
  whatsapp_order: ShoppingCart,
  payment_confirmed: CreditCard,
  payment_failed: AlertTriangle,
  note_added: StickyNote,
  imported: Zap,
  callback_scheduled: Calendar,
  closed: X,
  score_updated: Zap,
};

interface Props {
  events: LeadTimelineEvent[];
  loading: boolean;
}

const LeadTimelinePanel = ({ events, loading }: Props) => {
  if (loading) {
    return <div className="py-4 text-center text-sm text-muted">Loading timeline...</div>;
  }

  if (events.length === 0) {
    return <div className="py-4 text-center text-sm text-muted/60">No activity yet</div>;
  }

  return (
    <div className="space-y-0">
      {events.map((event) => {
        const Icon = ACTION_ICONS[event.action] ?? Clock;
        return (
          <div key={event.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-surface">
                <Icon size={13} className="text-muted" />
              </div>
              <div className="w-px flex-1 bg-border/40" />
            </div>
            <div className="flex-1 pb-4">
              <p className="text-sm text-text">{event.detail}</p>
              <p className="text-[11px] text-muted/80">
                {event.actorName} &middot; {relativeTime(event.createdAt)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default LeadTimelinePanel;
