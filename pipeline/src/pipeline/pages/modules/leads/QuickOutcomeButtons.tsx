import { useState } from "react";
import { CheckCircle, PhoneMissed, Clock, XCircle } from "lucide-react";
import type { CallOutcome } from "../../../api/types";

interface Props {
  onOutcome: (outcome: CallOutcome, callbackDate?: string) => void;
  busy: boolean;
  compact?: boolean;
}

const QuickOutcomeButtons = ({ onOutcome, busy, compact = false }: Props) => {
  const [showCallbackPicker, setShowCallbackPicker] = useState(false);
  const [callbackDate, setCallbackDate] = useState("");

  const btnBase = compact
    ? "inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold transition disabled:opacity-40"
    : "inline-flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-semibold transition disabled:opacity-40";
  const iconSize = compact ? 12 : 16;

  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        type="button"
        disabled={busy}
        onClick={() => onOutcome("connected")}
        className={`${btnBase} border border-success/40 bg-success/10 text-success hover:bg-success/20`}
      >
        <CheckCircle size={iconSize} />
        Connected
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => onOutcome("no_answer")}
        className={`${btnBase} border border-warning/40 bg-warning/10 text-warning hover:bg-warning/20`}
      >
        <PhoneMissed size={iconSize} />
        No Answer
      </button>
      {!showCallbackPicker ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => setShowCallbackPicker(true)}
          className={`${btnBase} border border-info/40 bg-info/10 text-info hover:bg-info/20`}
        >
          <Clock size={iconSize} />
          Callback
        </button>
      ) : (
        <div className="flex items-center gap-1.5">
          <input
            type="datetime-local"
            value={callbackDate}
            onChange={(e) => setCallbackDate(e.target.value)}
            className="ui-field min-h-8 text-xs"
            min={new Date().toISOString().slice(0, 16)}
          />
          <button
            type="button"
            disabled={busy || !callbackDate}
            onClick={() => {
              onOutcome("callback", new Date(callbackDate).toISOString());
              setShowCallbackPicker(false);
              setCallbackDate("");
            }}
            className={`${btnBase} border border-info/40 bg-info/15 text-info hover:bg-info/25`}
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={() => { setShowCallbackPicker(false); setCallbackDate(""); }}
            className="text-muted hover:text-text text-xs"
          >
            Cancel
          </button>
        </div>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => onOutcome("not_interested")}
        className={`${btnBase} border border-muted/30 bg-muted/10 text-muted hover:bg-muted/20`}
      >
        <XCircle size={iconSize} />
        Not Interested
      </button>
    </div>
  );
};

export default QuickOutcomeButtons;
