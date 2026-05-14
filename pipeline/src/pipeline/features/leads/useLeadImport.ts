import { useCallback, useState } from "react";
import { readExcelHeaders, parseExcelFile, detectColumnMapping, type ImportRow } from "../../api/lead-import";
import { leadsApi, type CreateLeadPayload } from "../../api/leads";
import { useAuth } from "../auth/auth-context";

export type ImportStep = "idle" | "file_selected" | "mapping" | "previewing" | "importing" | "complete";

export const useLeadImport = () => {
  const { session } = useAuth();
  const token = session?.token ?? "";

  const [step, setStep] = useState<ImportStep>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [previewRows, setPreviewRows] = useState<ImportRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ created: number; errors: Array<{ row: number; message: string }> } | null>(null);
  const [busy, setBusy] = useState(false);

  const selectFile = useCallback(async (f: File) => {
    setError(null);
    setBusy(true);
    try {
      const hdrs = await readExcelHeaders(f);
      if (hdrs.length === 0) throw new Error("No headers found in the file.");
      setFile(f);
      setHeaders(hdrs);
      const autoMap = detectColumnMapping(hdrs);
      setMapping(autoMap);
      setStep("mapping");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read file");
    } finally {
      setBusy(false);
    }
  }, []);

  const updateMapping = useCallback((field: string, column: string | undefined) => {
    setMapping((prev) => {
      const next = { ...prev };
      if (column) {
        next[field] = column;
      } else {
        delete next[field];
      }
      return next;
    });
  }, []);

  const preview = useCallback(async () => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const { rows } = await parseExcelFile(file, mapping);
      setPreviewRows(rows);
      setStep("previewing");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse file");
    } finally {
      setBusy(false);
    }
  }, [file, mapping]);

  const confirmImport = useCallback(async () => {
    if (!token || !file) return;
    const validLeads = previewRows.filter((r) => r.lead).map((r) => r.lead as CreateLeadPayload);
    if (validLeads.length === 0) {
      setError("No valid rows to import.");
      return;
    }

    setStep("importing");
    setBusy(true);
    setError(null);
    try {
      const result = await leadsApi.importBatch(token, validLeads, {
        fileName: file.name,
        columnMapping: mapping,
      });
      setImportResult({ created: result.created, errors: result.errors });
      setStep("complete");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
      setStep("previewing");
    } finally {
      setBusy(false);
    }
  }, [token, file, previewRows, mapping]);

  const reset = useCallback(() => {
    setStep("idle");
    setFile(null);
    setHeaders([]);
    setMapping({});
    setPreviewRows([]);
    setError(null);
    setImportResult(null);
    setBusy(false);
  }, []);

  return {
    step,
    file,
    headers,
    mapping,
    previewRows,
    error,
    importResult,
    busy,
    selectFile,
    updateMapping,
    preview,
    confirmImport,
    reset,
  };
};
