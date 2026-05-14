import { AnimatePresence, motion } from "framer-motion";
import type { AutoSaveStatus } from "./useAutoSave";

interface SaveStatusBarProps {
  status: AutoSaveStatus;
  error: string | null;
  onRetry: () => void;
  onSave?: () => void;
  canSave?: boolean;
}

const config: Record<AutoSaveStatus, { dot: string; border: string; text: string; label: string }> = {
  idle: { dot: "bg-muted/40", border: "border-border/30", text: "text-muted/60", label: "Auto-saving as draft" },
  saving: { dot: "bg-warning animate-pulse", border: "border-warning/30", text: "text-warning", label: "Saving..." },
  saved: { dot: "bg-success", border: "border-success/30", text: "text-success", label: "All changes saved" },
  error: { dot: "bg-critical", border: "border-critical/30", text: "text-critical", label: "Save failed" },
  "not-ready": { dot: "bg-muted/40", border: "border-border/30", text: "text-muted/60", label: "Editing..." },
};

export const SaveStatusBar = ({ status, error, onRetry, onSave, canSave }: SaveStatusBarProps) => {
  const c = config[status];

  return (
    <div className="flex items-center gap-2">
      <AnimatePresence mode="wait">
        <motion.div
          key={status}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className={`flex flex-1 items-center gap-2.5 rounded-lg border ${c.border} bg-panel/80 px-3 py-2`}
          role="status"
          aria-live="polite"
        >
          <span className={`h-2 w-2 shrink-0 rounded-full ${c.dot}`} />
          <span className={`text-xs font-medium ${c.text}`}>{c.label}</span>
          {status === "error" && error && (
            <span className="text-xs text-critical/70">— {error}</span>
          )}
          {status === "error" && (
            <button
              type="button"
              onClick={onRetry}
              className="ml-auto rounded-md border border-critical/30 bg-critical/10 px-2 py-1 text-[11px] font-semibold text-critical transition-colors hover:bg-critical/20"
            >
              Retry
            </button>
          )}
        </motion.div>
      </AnimatePresence>

      {onSave && (
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave || status === "saving"}
          className="ui-btn ui-btn-primary min-h-9 shrink-0 px-4 text-xs font-semibold disabled:opacity-50"
        >
          {status === "saving" ? "Saving..." : "Save Now"}
        </button>
      )}
    </div>
  );
};
