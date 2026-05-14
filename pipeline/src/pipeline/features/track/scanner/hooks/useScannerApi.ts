// A² Scanner — useScannerApi hook
// Supports partial verification: lookup → select serials → verify selected
// Auto-adds verified gokarting serials to the waiting list queue

import { useCallback, useState } from "react";
import { BillLookupResult, ScanSerial, SCANNER_LOCATION_BRANCH_IDS, ScannerLocation } from "../types/scanner.types";
import { lookupBill, verifySerials } from "../services/scannerApi";

type Phase = "idle" | "loading" | "result" | "updating" | "done" | "error";

export interface ScanMeta {
  scannedBy: string;
  location: string;
  shiftStartedBy: string;
}

interface ScannerApiState {
  phase: Phase;
  result: BillLookupResult | null;
  errorMsg: string | null;
}

interface UseScannerApiReturn extends ScannerApiState {
  fetchBill: (billingId: string, meta: ScanMeta) => Promise<void>;
  submitVerification: (selected: ScanSerial[], meta: ScanMeta) => Promise<void>;
  reset: () => void;
}

export const useScannerApi = (): UseScannerApiReturn => {
  const [state, setState] = useState<ScannerApiState>({
    phase: "idle",
    result: null,
    errorMsg: null
  });

  const fetchBill = useCallback(async (billingId: string, _meta: ScanMeta) => {
    setState({ phase: "loading", result: null, errorMsg: null });
    try {
      const res = await lookupBill(billingId.trim());
      if (res.serials.length === 0) {
        setState({ phase: "error", result: null, errorMsg: "No items found for this Billing ID." });
        return;
      }
      setState({ phase: "result", result: res, errorMsg: null });
    } catch (err) {
      setState({
        phase: "error",
        result: null,
        errorMsg: err instanceof Error ? err.message : "Failed to fetch billing details."
      });
    }
  }, []);

  const submitVerification = useCallback(
    async (selected: ScanSerial[], meta: ScanMeta) => {
      if (!state.result || selected.length === 0) return;

      const { billingId, customerName, customerPhone } = state.result;
      const selectedIds = selected.map((s) => s.serialId);

      // Map location name to branchId for waiting list
      const branchId = SCANNER_LOCATION_BRANCH_IDS[meta.location as ScannerLocation] ?? "";

      setState((prev) => ({ ...prev, phase: "updating" }));

      try {
        await verifySerials(billingId, selectedIds, meta.scannedBy, {
          customerName,
          customerPhone,
          branchId
        });
        setState((prev) => ({ ...prev, phase: "done" }));
      } catch (err) {
        setState((prev) => ({
          ...prev,
          phase: "error",
          errorMsg: err instanceof Error ? err.message : "Verification failed."
        }));
      }
    },
    [state.result]
  );

  const reset = useCallback(() => {
    setState({ phase: "idle", result: null, errorMsg: null });
  }, []);

  return { ...state, fetchBill, submitVerification, reset };
};
