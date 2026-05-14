import { Phone, SkipForward } from "lucide-react";
import type { QueuedLead } from "../../../features/leads/lead-queue-sort";
import type { CallOutcome } from "../../../api/types";
import { formatPhone, relativeTime } from "../../../features/leads/lead-utils";
import LeadScoreBadge from "./LeadScoreBadge";
import QuickOutcomeButtons from "./QuickOutcomeButtons";

interface Props {
  lead: QueuedLead | null;
  onOutcome: (leadId: string, outcome: CallOutcome, callbackDate?: string) => void;
  onSkip: () => void;
  busy: boolean;
}

const NextCallBanner = ({ lead, onOutcome, onSkip, busy }: Props) => {
  if (!lead) return null;

  const isOverdue = lead.isCallbackOverdue;

  return (
    <div
      className={`rounded-xl border p-3 sm:p-4 shadow-sm ${
        isOverdue
          ? "border-critical/50 bg-critical/5"
          : "border-info/40 bg-info/5"
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted mb-1">
            {isOverdue ? "Overdue Callback" : "Next Call"}
          </p>
          <h3 className="text-base sm:text-lg font-semibold text-text truncate">{lead.customerName}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 sm:gap-3 text-sm text-muted">
            <a
              href={`tel:${lead.customerPhone}`}
              className="inline-flex items-center gap-1 text-info hover:underline font-medium"
            >
              <Phone size={14} />
              {formatPhone(lead.customerPhone)}
            </a>
            <LeadScoreBadge score={lead.score} label={lead.scoreLabel} />
          </div>
          {isOverdue && lead.callbackScheduledAt && (
            <p className="mt-1 text-xs text-critical">
              Callback was due {relativeTime(lead.callbackScheduledAt)}
            </p>
          )}
          {lead.isCallbackUpcoming && lead.callbackScheduledAt && (
            <p className="mt-1 text-xs text-info">
              Callback due {relativeTime(lead.callbackScheduledAt)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-2">
          <a
            href={`tel:${lead.customerPhone}`}
            className="ui-btn ui-btn-primary min-h-10 px-4 text-sm inline-flex items-center gap-1.5 flex-1 justify-center sm:flex-none"
          >
            <Phone size={16} />
            Call Now
          </a>
          <button
            type="button"
            onClick={onSkip}
            className="inline-flex items-center gap-1 text-xs text-muted hover:text-text transition"
          >
            <SkipForward size={12} />
            Skip
          </button>
        </div>
      </div>
      <div className="mt-3 border-t border-border/30 pt-3">
        <QuickOutcomeButtons
          onOutcome={(outcome, callbackDate) => onOutcome(lead.id, outcome, callbackDate)}
          busy={busy}
        />
      </div>
    </div>
  );
};

export default NextCallBanner;
