import { forwardRef, useCallback, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useToast, type ToastItem, type ToastType } from "./toast-context";

const DISMISS_MS = 4000;

const icons: Record<ToastType, typeof AlertCircle> = {
  error: AlertCircle,
  success: CheckCircle2,
  info: Info,
};

const toneClasses: Record<ToastType, string> = {
  error: "border-critical/40 bg-critical/15 text-critical shadow-critical/10",
  success: "border-success/40 bg-success/15 text-success shadow-success/10",
  info: "border-info/40 bg-info/15 text-info shadow-info/10",
};

const Toast = forwardRef<HTMLDivElement, { item: ToastItem; onDismiss: (id: string) => void }>(({ item, onDismiss }, ref) => {
  const Icon = icons[item.type];
  const hovered = useRef(false);
  const elapsed = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTimer = useCallback(() => {
    if (timerRef.current) return;
    timerRef.current = setInterval(() => {
      elapsed.current += 100;
      if (elapsed.current >= DISMISS_MS) {
        onDismiss(item.id);
      }
    }, 100);
  }, [item.id, onDismiss]);

  const pauseTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    startTimer();
    return () => pauseTimer();
  }, [startTimer, pauseTimer]);

  const onEnter = () => {
    hovered.current = true;
    pauseTimer();
  };

  const onLeave = () => {
    hovered.current = false;
    startTimer();
  };

  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, x: 80, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 80, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      role={item.type === "error" ? "alert" : "status"}
      className={`pointer-events-auto flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-sm backdrop-blur-md shadow-lg ${toneClasses[item.type]}`}
    >
      <Icon className="mt-0.5 h-[18px] w-[18px] shrink-0" />
      <span className="flex-1 leading-snug">{item.message}</span>
      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        className="shrink-0 rounded-lg p-1 opacity-60 transition-opacity hover:opacity-100"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </motion.div>
  );
});

const ToastContainer = () => {
  const { toasts, dismiss } = useToast();

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed top-4 right-4 left-4 z-[9999] mx-auto flex max-w-md flex-col gap-3 sm:left-auto sm:mx-0"
    >
      <AnimatePresence mode="popLayout">
        {toasts.map((t) => (
          <Toast key={t.id} item={t} onDismiss={dismiss} />
        ))}
      </AnimatePresence>
    </div>
  );
};

export default ToastContainer;
