import { useState } from "react";
import { useAuth } from "../../../features/auth/auth-context";
import { kartfluencerApi, type ImportKartfluencerRow } from "../../../api/kartfluencer";
import { resolveLocation } from "../../../../lib/locations";
import { Upload, CheckCircle, AlertTriangle, FileSpreadsheet, Database } from "lucide-react";
import type { KartfluencerStatus } from "../../../api/types";

const REQUIRED_COLUMNS = ["instagram_handle", "phone_number", "branch", "followers_range"];
const OPTIONAL_COLUMNS = ["phone_country_code", "visit_date", "status", "upi_id", "upi_name", "reel_link", "remarks", "created_at"];

type ImportStep = "idle" | "preview" | "importing" | "complete";

// ─── SQL Parser ─────────────────────────────────────────────────

/** Parse MySQL INSERT statements from a SQL dump and extract influencer rows. */
const parseSqlInserts = (sql: string): ImportKartfluencerRow[] => {
  const rows: ImportKartfluencerRow[] = [];

  // Find INSERT INTO `influencers` statements
  // Match multi-row inserts: INSERT INTO `influencers` (...) VALUES (...), (...);
  const insertRegex = /INSERT\s+INTO\s+`?influencers`?\s*\([^)]+\)\s*VALUES\s*([\s\S]*?);/gi;
  let insertMatch: RegExpExecArray | null;

  while ((insertMatch = insertRegex.exec(sql)) !== null) {
    const valuesBlock = insertMatch[1];

    // Extract column names from the INSERT statement
    const colMatch = insertMatch[0].match(/\(([^)]+)\)\s*VALUES/i);
    const columns = colMatch
      ? colMatch[1].split(",").map((c) => c.trim().replace(/`/g, "").toLowerCase())
      : [];

    // Parse each (...) value tuple
    // We need to handle: quoted strings with commas, NULL, numbers
    const tupleRegex = /\(([^)]*(?:'[^']*'[^)]*)*)\)/g;
    let tupleMatch: RegExpExecArray | null;

    while ((tupleMatch = tupleRegex.exec(valuesBlock)) !== null) {
      const raw = tupleMatch[1];
      const values = parseSqlValues(raw);

      const get = (col: string): string => {
        const idx = columns.indexOf(col);
        if (idx < 0 || idx >= values.length) return "";
        const v = values[idx];
        return v === "NULL" || v === null ? "" : String(v);
      };

      const branchInput = get("branch");
      const location = resolveLocation(branchInput);

      // Map "paid" status to "active" (V2 status)
      let status = get("status") as KartfluencerStatus | undefined;
      if (status === "paid" as string) status = "active";
      if (!status) status = undefined;

      const handle = get("instagram_handle");
      if (!handle) continue; // skip empty rows

      rows.push({
        instagramHandle: handle,
        phoneCountryCode: get("phone_country_code") || "+91",
        phoneNumber: get("phone_number"),
        branchId: location?.branchId ?? branchInput,
        branchName: location?.displayName ?? branchInput,
        visitDate: get("visit_date"),
        followersRange: get("followers_range"),
        status,
        upiId: get("upi_id") || undefined,
        upiName: get("upi_name") || undefined,
        reelLink: get("reel_link") || undefined,
        disqualifiedReason: get("remarks") || undefined,
        createdAt: get("created_at") || undefined,
      });
    }
  }

  return rows;
};

/** Parse a comma-separated SQL values string, respecting quoted strings and NULL. */
const parseSqlValues = (raw: string): string[] => {
  const values: string[] = [];
  let current = "";
  let inQuote = false;
  let i = 0;

  while (i < raw.length) {
    const ch = raw[i];

    if (inQuote) {
      if (ch === "'" && raw[i + 1] === "'") {
        // Escaped quote
        current += "'";
        i += 2;
        continue;
      }
      if (ch === "\\") {
        // Backslash escape
        current += raw[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (ch === "'") {
        inQuote = false;
        i++;
        continue;
      }
      current += ch;
      i++;
    } else {
      if (ch === "'") {
        inQuote = true;
        i++;
        continue;
      }
      if (ch === ",") {
        values.push(current.trim());
        current = "";
        i++;
        continue;
      }
      current += ch;
      i++;
    }
  }
  values.push(current.trim());

  return values.map((v) => (v === "NULL" || v === "null" ? "" : v));
};

// ─── CSV Parser ─────────────────────────────────────────────────

const parseCsvFile = (text: string): ImportKartfluencerRow[] => {
  const lines = text.split("\n").map((line) => line.split(",").map((cell) => cell.trim().replace(/^"|"$/g, "")));
  if (lines.length < 2) throw new Error("File must have at least a header row and one data row.");

  const headers = lines[0].map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  const missingRequired = REQUIRED_COLUMNS.filter((col) => !headers.includes(col));
  if (missingRequired.length > 0) throw new Error(`Missing required columns: ${missingRequired.join(", ")}`);

  const dataRows = lines.slice(1).filter((row) => row.some((cell) => cell.length > 0));

  return dataRows.map((row) => {
    const get = (col: string) => row[headers.indexOf(col)] ?? "";
    const branchInput = get("branch");
    const location = resolveLocation(branchInput);

    return {
      instagramHandle: get("instagram_handle"),
      phoneCountryCode: get("phone_country_code") || "+91",
      phoneNumber: get("phone_number"),
      branchId: location?.branchId ?? branchInput,
      branchName: location?.displayName ?? branchInput,
      visitDate: get("visit_date"),
      followersRange: get("followers_range"),
      status: (get("status") as KartfluencerStatus) || undefined,
      upiId: get("upi_id") || undefined,
      upiName: get("upi_name") || undefined,
      reelLink: get("reel_link") || undefined,
      disqualifiedReason: get("remarks") || undefined,
      createdAt: get("created_at") || undefined,
    };
  });
};

// ─── Component ──────────────────────────────────────────────────

const KartfluencerImportView = () => {
  const { session } = useAuth();
  const token = session?.token ?? "";

  const [step, setStep] = useState<ImportStep>("idle");
  const [fileName, setFileName] = useState("");
  const [fileType, setFileType] = useState<"csv" | "sql">("csv");
  const [parsedRows, setParsedRows] = useState<ImportKartfluencerRow[]>([]);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ successCount: number; errorCount: number; errors: Array<{ row: number; message: string }> } | null>(null);

  const handleFile = (file: File) => {
    setError("");
    setFileName(file.name);
    const isSql = file.name.toLowerCase().endsWith(".sql");
    setFileType(isSql ? "sql" : "csv");

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const mapped = isSql ? parseSqlInserts(text) : parseCsvFile(text);

        if (mapped.length === 0) {
          setError(isSql
            ? "No INSERT INTO `influencers` statements found in the SQL file."
            : "No data rows found in the CSV file.");
          return;
        }

        setParsedRows(mapped);
        setStep("preview");
      } catch (err) {
        setError(err instanceof Error ? err.message : `Failed to parse ${isSql ? "SQL" : "CSV"} file.`);
      }
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    setStep("importing");
    setError("");
    try {
      const batch = await kartfluencerApi.importBatch(token, parsedRows, fileName);
      setResult({ successCount: batch.successCount, errorCount: batch.errorCount, errors: batch.errors });
      setStep("complete");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
      setStep("preview");
    }
  };

  const reset = () => {
    setStep("idle");
    setFileName("");
    setParsedRows([]);
    setError("");
    setResult(null);
  };

  return (
    <div className="max-w-3xl ui-section-stack">
      {/* Step indicator */}
      <div className="flex gap-2">
        {["Upload", "Preview", "Import", "Done"].map((label, i) => {
          const stepIdx = ["idle", "preview", "importing", "complete"].indexOf(step);
          const isActive = i <= stepIdx;
          return (
            <span
              key={label}
              className={`ui-pill text-[10px] px-3 py-1 ${
                isActive ? "border-accent/45 bg-accent text-base" : "border-border/50 bg-surface text-muted"
              }`}
            >
              {i + 1}. {label}
            </span>
          );
        })}
      </div>

      {error && <div className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">{error}</div>}

      {/* Step 1: Upload */}
      {step === "idle" && (
        <div className="space-y-4">
          <div className="rounded-xl border-2 border-dashed border-border/70 bg-surface/80 flex flex-col items-center justify-center py-16">
            <Upload size={40} className="mb-3 text-muted/60" />
            <p className="mb-1 text-sm text-muted">Upload a CSV or SQL file with influencer data</p>
            <p className="mb-4 text-[10px] text-muted/70">
              Supports .csv files and .sql dumps (phpMyAdmin exports)
            </p>
            <label className="ui-btn ui-btn-primary px-6 cursor-pointer">
              Choose File
              <input
                type="file"
                accept=".csv,.sql"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </label>
          </div>

          {/* Format guides */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-border/50 bg-surface/80 p-4">
              <h4 className="text-xs font-semibold text-text mb-2 flex items-center gap-1">
                <Database size={14} /> SQL File (Recommended)
              </h4>
              <div className="text-[10px] text-muted space-y-1">
                <p>Upload a phpMyAdmin SQL dump file directly.</p>
                <p>The parser reads <code className="bg-base px-1 rounded text-[9px]">INSERT INTO `influencers`</code> statements.</p>
                <p>Old "paid" status is auto-mapped to "active".</p>
                <p>Branch names (Visakhapatnam, Kakinada, Rajahmundry) are auto-resolved.</p>
              </div>
            </div>
            <div className="rounded-xl border border-border/50 bg-surface/80 p-4">
              <h4 className="text-xs font-semibold text-text mb-2 flex items-center gap-1">
                <FileSpreadsheet size={14} /> CSV File
              </h4>
              <div className="text-[10px] text-muted space-y-1">
                <p><strong>Required:</strong> instagram_handle, phone_number, branch, followers_range</p>
                <p><strong>Optional:</strong> {OPTIONAL_COLUMNS.join(", ")}</p>
                <p><strong>Status values:</strong> detailed, visited, reel_submitted, verified, active, disqualified</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Preview */}
      {step === "preview" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border/50 bg-surface/80 p-4">
            <h4 className="text-xs font-semibold text-text mb-1 flex items-center gap-2">
              {fileType === "sql" ? <Database size={14} className="text-accent" /> : <FileSpreadsheet size={14} className="text-accent" />}
              {fileName}
            </h4>
            <p className="text-[10px] text-muted mb-3">
              {parsedRows.length} influencer records found{fileType === "sql" ? " from SQL INSERT statements" : ""}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="px-2 py-1 text-left text-muted">#</th>
                    <th className="px-2 py-1 text-left text-muted">Handle</th>
                    <th className="px-2 py-1 text-left text-muted">Phone</th>
                    <th className="px-2 py-1 text-left text-muted">Branch</th>
                    <th className="px-2 py-1 text-left text-muted">Followers</th>
                    <th className="px-2 py-1 text-left text-muted">Status</th>
                    <th className="px-2 py-1 text-left text-muted">Reel</th>
                    <th className="px-2 py-1 text-left text-muted">UPI</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.slice(0, 15).map((row, i) => (
                    <tr key={i} className="border-b border-border/30">
                      <td className="px-2 py-1 text-muted">{i + 1}</td>
                      <td className="px-2 py-1 text-text font-medium">{row.instagramHandle}</td>
                      <td className="px-2 py-1 text-muted">{row.phoneNumber}</td>
                      <td className="px-2 py-1 text-muted">{row.branchName}</td>
                      <td className="px-2 py-1 text-muted">{row.followersRange}</td>
                      <td className="px-2 py-1">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                          row.status === "active" ? "bg-green-100 text-green-700" :
                          row.status === "disqualified" ? "bg-red-100 text-red-700" :
                          row.status === "visited" ? "bg-amber-100 text-amber-700" :
                          row.status === "verified" ? "bg-emerald-100 text-emerald-700" :
                          "bg-blue-100 text-blue-700"
                        }`}>
                          {row.status ?? "detailed"}
                        </span>
                      </td>
                      <td className="px-2 py-1 text-muted truncate max-w-[100px]">{row.reelLink ? "Yes" : "—"}</td>
                      <td className="px-2 py-1 text-muted truncate max-w-[80px]">{row.upiId || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsedRows.length > 15 && (
                <p className="text-[10px] text-muted/70 mt-2 text-center">...and {parsedRows.length - 15} more rows</p>
              )}
            </div>
          </div>

          {/* Summary */}
          <div className="flex flex-wrap gap-3 text-[10px]">
            <span className="px-2.5 py-1 rounded-lg bg-surface border border-border/50 text-muted">
              Total: <strong className="text-text">{parsedRows.length}</strong>
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-surface border border-border/50 text-muted">
              With Reels: <strong className="text-text">{parsedRows.filter((r) => r.reelLink).length}</strong>
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-surface border border-border/50 text-muted">
              With UPI: <strong className="text-text">{parsedRows.filter((r) => r.upiId).length}</strong>
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-surface border border-border/50 text-muted">
              Active: <strong className="text-green-600">{parsedRows.filter((r) => r.status === "active").length}</strong>
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-surface border border-border/50 text-muted">
              Disqualified: <strong className="text-red-600">{parsedRows.filter((r) => r.status === "disqualified").length}</strong>
            </span>
          </div>

          <div className="flex gap-3">
            <button type="button" onClick={reset} className="ui-btn ui-btn-neutral text-xs">Cancel</button>
            <button type="button" onClick={handleImport} className="ui-btn ui-btn-primary text-xs">
              Import {parsedRows.length} Influencers
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Importing */}
      {step === "importing" && (
        <div className="py-16 text-center">
          <div className="animate-spin h-8 w-8 border-2 border-accent border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-sm text-muted">Importing {parsedRows.length} influencers...</p>
        </div>
      )}

      {/* Step 4: Complete */}
      {step === "complete" && result && (
        <div className="space-y-4">
          <div className="rounded-xl border border-green-200 bg-green-50 p-5 text-center">
            <CheckCircle size={40} className="mx-auto mb-3 text-green-600" />
            <h3 className="text-lg font-semibold text-green-800 mb-1">Import Complete</h3>
            <p className="text-sm text-green-700">
              {result.successCount} of {result.successCount + result.errorCount} records imported successfully.
            </p>
          </div>

          {result.errors.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4">
              <h4 className="text-xs font-semibold text-red-700 mb-2 flex items-center gap-1">
                <AlertTriangle size={12} /> {result.errorCount} Errors
              </h4>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {result.errors.map((err, i) => (
                  <p key={i} className="text-[10px] text-red-600">Row {err.row}: {err.message}</p>
                ))}
              </div>
            </div>
          )}

          <button type="button" onClick={reset} className="ui-btn ui-btn-primary text-xs">Import Another File</button>
        </div>
      )}
    </div>
  );
};

export default KartfluencerImportView;
