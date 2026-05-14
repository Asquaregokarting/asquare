import { AlertTriangle, Phone } from "lucide-react";
import type { LeadRecord } from "../../../api/types";
import { relativeTime } from "../../../features/leads/lead-utils";

interface Props {
  overdueCount: number;
  nextOverdue: LeadRecord | null;
  onCallNow: (leadId: string) => void;
}

const CallbackAlert = ({ overdueCount, nextOverdue, onCallNow }: Props) => {
  if (overdueCount === 0 || !nextOverdue) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3 rounded-xl border border-critical/50 bg-critical/10 px-3 py-3 sm:px-4 shadow-sm animate-pulse">
      <AlertTriangle size={20} className="shrink-0 text-critical" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-critical">
          {overdueCount} overdue callback{overdueCount > 1 ? "s" : ""}
        </p>
        <p className="text-xs text-critical/80 truncate">
          Next: {nextOverdue.customerName} — due {relativeTime(nextOverdue.callbackScheduledAt ?? nextOverdue.lastActivityAt)}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onCallNow(nextOverdue.id)}
        className="ui-btn ui-btn-critical min-h-8 px-3 text-xs inline-flex items-center gap-1 w-full sm:w-auto justify-center"
      >
        <Phone size={12} />
        Call Now
      </button>
    </div>
  );
};

export default CallbackAlert;
