import { useCallback, useState } from "react";
import {
  readExcelSheets,
  detectVendorColumnMapping,
  detectGameColumnMapping,
  parseVendorSheet,
  parseGameSheet,
  generateVendorGameTemplate,
  type VendorImportRow,
  type GameImportRow,
  type ExcelSheetInfo,
} from "../../api/vendor-game-import";
import { importVendorsAndGames, type ImportResult } from "../../api/vendor-game-import-firestore";
import { useAuth } from "../auth/auth-context";

export type ImportStep =
  | "idle"
  | "file_selected"
  | "mapping"
  | "preview"
  | "importing"
  | "complete";

export const useVendorGameImport = () => {
  const { session } = useAuth();
  const token = session?.token ?? "";

  const [step, setStep] = useState<ImportStep>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [sheetInfo, setSheetInfo] = useState<ExcelSheetInfo | null>(null);
  const [vendorMapping, setVendorMapping] = useState<Record<string, string>>({});
  const [gameMapping, setGameMapping] = useState<Record<string, string>>({});
  const [vendorRows, setVendorRows] = useState<VendorImportRow[]>([]);
  const [gameRows, setGameRows] = useState<GameImportRow[]>([]);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>("");

  const selectFile = useCallback(async (f: File) => {
    setError(null);
    setBusy(true);
    try {
      const info = await readExcelSheets(f);
      if (info.vendorHeaders.length === 0 && info.gameHeaders.length === 0) {
        throw new Error("No data found in the file. Make sure it has 'Vendors' and 'Games' sheets.");
      }
      setFile(f);
      setSheetInfo(info);
      setVendorMapping(detectVendorColumnMapping(info.vendorHeaders));
      setGameMapping(detectGameColumnMapping(info.gameHeaders));
      setStep("mapping");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read file");
    } finally {
      setBusy(false);
    }
  }, []);

  const updateVendorMapping = useCallback((field: string, column: string | undefined) => {
    setVendorMapping((prev) => {
      const next = { ...prev };
      if (column) next[field] = column; else delete next[field];
      return next;
    });
  }, []);

  const updateGameMapping = useCallback((field: string, column: string | undefined) => {
    setGameMapping((prev) => {
      const next = { ...prev };
      if (column) next[field] = column; else delete next[field];
      return next;
    });
  }, []);

  const preview = useCallback(async () => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const { rows: vRows } = await parseVendorSheet(file, vendorMapping);
      setVendorRows(vRows);

      // Build vendor name set from valid parsed vendors
      const vendorNames = new Set(
        vRows.filter((r) => r.vendor).map((r) => r.vendor!.vendorName.toLowerCase())
      );

      const { rows: gRows } = await parseGameSheet(file, gameMapping, vendorNames);
      setGameRows(gRows);
      setStep("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse file");
    } finally {
      setBusy(false);
    }
  }, [file, vendorMapping, gameMapping]);

  const confirmImport = useCallback(async () => {
    if (!token) return;

    const validVendors = vendorRows
      .filter((r) => r.vendor)
      .map((r) => ({ rowNumber: r.rowNumber, vendor: r.vendor! }));
    const validGames = gameRows
      .filter((r) => r.game)
      .map((r) => ({ rowNumber: r.rowNumber, game: r.game! }));

    if (validVendors.length === 0 && validGames.length === 0) {
      setError("No valid rows to import.");
      return;
    }

    setStep("importing");
    setBusy(true);
    setError(null);
    try {
      const result = await importVendorsAndGames(
        token,
        validVendors,
        validGames,
        (msg) => setProgress(msg)
      );
      setImportResult(result);
      setStep("complete");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
      setStep("preview");
    } finally {
      setBusy(false);
      setProgress("");
    }
  }, [token, vendorRows, gameRows]);

  const downloadTemplate = useCallback(async () => {
    setBusy(true);
    try {
      const blob = await generateVendorGameTemplate();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "vendor-game-template.xlsx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate template");
    } finally {
      setBusy(false);
    }
  }, []);

  const reset = useCallback(() => {
    setStep("idle");
    setFile(null);
    setSheetInfo(null);
    setVendorMapping({});
    setGameMapping({});
    setVendorRows([]);
    setGameRows([]);
    setImportResult(null);
    setError(null);
    setBusy(false);
    setProgress("");
  }, []);

  return {
    step,
    file,
    sheetInfo,
    vendorMapping,
    gameMapping,
    vendorRows,
    gameRows,
    importResult,
    error,
    busy,
    progress,
    selectFile,
    updateVendorMapping,
    updateGameMapping,
    preview,
    confirmImport,
    downloadTemplate,
    reset,
  };
};
