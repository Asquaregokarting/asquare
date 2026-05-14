import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type AutoSaveStatus = "idle" | "saving" | "saved" | "error" | "not-ready";

export interface UseAutoSaveOptions<T> {
  /** The draft data to watch for changes. */
  data: T;
  /** Gate: returns true only when data is complete enough to save. */
  isSaveable: (data: T) => boolean;
  /** The actual persist function — called with latest data. */
  onSave: (data: T) => Promise<void>;
  /** Debounce delay in ms (default 2000). */
  debounceMs?: number;
  /** Set false to disable auto-save (e.g. ThirdParty role). */
  enabled?: boolean;
}

export interface UseAutoSaveResult {
  status: AutoSaveStatus;
  error: string | null;
  /** Manually retry after a failure. */
  retry: () => void;
  /** Force an immediate save (e.g. before switching locations). */
  flush: () => Promise<void>;
}

export const useAutoSave = <T>({
  data,
  isSaveable,
  onSave,
  debounceMs = 2000,
  enabled = true,
}: UseAutoSaveOptions<T>): UseAutoSaveResult => {
  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  // Refs to avoid stale closures
  const dataRef = useRef(data);
  const isSaveableRef = useRef(isSaveable);
  const onSaveRef = useRef(onSave);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const versionRef = useRef(0); // incremented on each data change
  const savingRef = useRef(false);
  const pendingRef = useRef(false); // true if a save was queued during an in-flight save
  const mountedRef = useRef(true);
  const savedFadeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track the fingerprint at load time — skip saving if data hasn't changed from initial load
  const baselineFingerprintRef = useRef<string | null>(null);

  // Keep refs fresh
  dataRef.current = data;
  isSaveableRef.current = isSaveable;
  onSaveRef.current = onSave;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const doSave = useCallback(async () => {
    if (savingRef.current) {
      // A save is already in flight — mark as pending so we re-save after
      pendingRef.current = true;
      return;
    }

    const currentData = dataRef.current;
    if (!isSaveableRef.current(currentData)) {
      if (mountedRef.current) setStatus("not-ready");
      return;
    }

    savingRef.current = true;
    pendingRef.current = false;
    const versionAtStart = versionRef.current;

    if (mountedRef.current) {
      setStatus("saving");
      setError(null);
    }

    try {
      await onSaveRef.current(currentData);

      if (!mountedRef.current) return;

      // If data changed while we were saving, re-save
      if (versionRef.current !== versionAtStart || pendingRef.current) {
        savingRef.current = false;
        pendingRef.current = false;
        void doSave();
        return;
      }

      setStatus("saved");
      setError(null);

      // Fade "saved" back to "idle" after 3 seconds
      if (savedFadeRef.current) clearTimeout(savedFadeRef.current);
      savedFadeRef.current = setTimeout(() => {
        if (mountedRef.current) setStatus("idle");
      }, 3000);
    } catch (err) {
      if (mountedRef.current) {
        setStatus("error");
        setError(err instanceof Error ? err.message : "Auto-save failed.");
      }
    } finally {
      savingRef.current = false;
    }
  }, []);

  // Stable fingerprint to avoid re-triggering on same data with new references.
  // We exclude File objects (non-serializable) — image uploads trigger saves separately.
  const dataFingerprint = useMemo(() => {
    try {
      return JSON.stringify(data, (_, val) => (val instanceof File ? val.name : val));
    } catch {
      return String(Date.now());
    }
  }, [data]);

  // Debounced trigger on data changes
  useEffect(() => {
    if (!enabled) return;

    dataRef.current = data;

    // Set baseline on first enabled render (initial load) — don't auto-save loaded data
    if (baselineFingerprintRef.current === null) {
      baselineFingerprintRef.current = dataFingerprint;
      return;
    }

    // Skip if data hasn't changed from what was loaded
    if (dataFingerprint === baselineFingerprintRef.current) {
      return;
    }

    versionRef.current += 1;

    // Clear any existing "saved" fade timer
    if (savedFadeRef.current) {
      clearTimeout(savedFadeRef.current);
      savedFadeRef.current = null;
    }

    // Update status to reflect pending changes
    if (!isSaveableRef.current(data)) {
      setStatus("not-ready");
    }

    // Reset debounce timer
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      void doSave();
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataFingerprint, enabled, debounceMs, doSave]);

  // Reset baseline when auto-save is disabled (e.g., during location switch / loading)
  useEffect(() => {
    if (!enabled) {
      baselineFingerprintRef.current = null;
    }
  }, [enabled]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (savedFadeRef.current) clearTimeout(savedFadeRef.current);
    };
  }, []);

  const retry = useCallback(() => {
    void doSave();
  }, [doSave]);

  const flush = useCallback(async () => {
    // Cancel pending debounce
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    // Only flush if there's something saveable
    if (!enabled || !isSaveableRef.current(dataRef.current)) return;

    // Wait for any in-flight save to finish
    if (savingRef.current) {
      pendingRef.current = true;
      // Wait for the in-flight save to complete
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (!savingRef.current) {
            clearInterval(check);
            resolve();
          }
        }, 50);
      });
    }

    // If pending was handled by the re-save logic, we're done
    if (!savingRef.current && versionRef.current > 0) {
      await doSave();
    }
  }, [enabled, doSave]);

  return { status, error, retry, flush };
};
