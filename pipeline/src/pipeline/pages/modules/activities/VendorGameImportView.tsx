import { useVendorGameImport } from "../../../features/activities/useVendorGameImport";
import { Upload, CheckCircle, Download, AlertCircle, Loader2 } from "lucide-react";

const STEPS = ["Upload", "Map Columns", "Preview", "Import"];

const VENDOR_FIELDS = [
  { field: "vendorName", label: "Vendor Name", required: true },
  { field: "companyName", label: "Company Name", required: true },
  { field: "mobileNumber", label: "Mobile Number", required: true },
  { field: "email", label: "Email", required: true },
  { field: "gstNumber", label: "GST Number", required: true },
  { field: "address", label: "Address", required: true },
  { field: "bankAccountNumber", label: "Bank Account Number", required: true },
  { field: "bankName", label: "Bank Name", required: true },
  { field: "ifscCode", label: "IFSC Code", required: true },
  { field: "bankBranch", label: "Bank Branch", required: true },
  { field: "branch", label: "Branch / City", required: true },
  { field: "vendorType", label: "Vendor Type", required: false },
  { field: "revenueShare", label: "Revenue Share (%)", required: false },
];

const GAME_FIELDS = [
  { field: "vendorName", label: "Vendor Name", required: true },
  { field: "branch", label: "Branch / City", required: true },
  { field: "gameName", label: "Game Name", required: true },
  { field: "gameStatus", label: "Game Status", required: false },
  { field: "subGameName", label: "Sub Game Name", required: true },
  { field: "variantLabel", label: "Variant Label", required: true },
  { field: "price", label: "Price", required: true },
  { field: "durationMinutes", label: "Duration (minutes)", required: false },
  { field: "laps", label: "Laps", required: false },
  { field: "active", label: "Active", required: false },
];

const stepIndex = (step: string): number =>
  ["idle", "file_selected", "mapping", "preview", "importing", "complete"].indexOf(step);

const ColumnMapper = ({
  title,
  headers,
  fields,
  mapping,
  onUpdate,
}: {
  title: string;
  headers: string[];
  fields: Array<{ field: string; label: string; required: boolean }>;
  mapping: Record<string, string>;
  onUpdate: (field: string, column: string | undefined) => void;
}) => (
  <div className="space-y-3">
    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h4>
    <div className="grid gap-2">
      {fields.map(({ field, label, required }) => (
        <div key={field} className="flex items-center gap-3">
          <label className="w-44 text-sm font-medium text-text truncate">
            {label} {required && <span className="text-critical">*</span>}
          </label>
          <select
            value={mapping[field] ?? ""}
            onChange={(e) => onUpdate(field, e.target.value || undefined)}
            className={`ui-field flex-1 text-sm ${required && !mapping[field] ? "border-critical/50" : ""}`}
          >
            <option value="">-- Not mapped --</option>
            {headers.map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
          {mapping[field] && <span className="text-xs text-success font-medium">Mapped</span>}
        </div>
      ))}
    </div>
  </div>
);

const VendorGameImportView = () => {
  const imp = useVendorGameImport();
  const idx = stepIndex(imp.step);

  const validVendors = imp.vendorRows.filter((r) => r.vendor).length;
  const errorVendors = imp.vendorRows.filter((r) => r.error).length;
  const validGames = imp.gameRows.filter((r) => r.game).length;
  const errorGames = imp.gameRows.filter((r) => r.error).length;

  const vendorRequiredMapped = VENDOR_FIELDS
    .filter((f) => f.required)
    .every((f) => imp.vendorMapping[f.field]);
  const gameRequiredMapped = GAME_FIELDS
    .filter((f) => f.required)
    .every((f) => imp.gameMapping[f.field]);

  return (
    <div className="max-w-4xl ui-section-stack">
      {/* Step indicator */}
      <div className="flex gap-2">
        {STEPS.map((label, i) => {
          const isActive = i <= Math.max(0, idx - 1);
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

      {/* Error */}
      {imp.error && (
        <div className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical flex items-center gap-2">
          <AlertCircle size={16} /> {imp.error}
        </div>
      )}

      {/* Step 1: Upload */}
      {imp.step === "idle" && (
        <div className="space-y-4">
          <div className="rounded-xl border-2 border-dashed border-border/70 bg-surface/80 flex flex-col items-center justify-center py-16">
            <Upload size={40} className="mb-3 text-muted/60" />
            <p className="mb-1 text-sm text-muted">Upload an Excel file (.xlsx) with vendor and game data</p>
            <p className="mb-4 text-xs text-muted/70">The file should have two sheets: "Vendors" and "Games"</p>
            <div className="flex gap-3">
              <label className="ui-btn ui-btn-primary px-6 cursor-pointer">
                Choose File
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void imp.selectFile(f);
                  }}
                />
              </label>
              <button
                type="button"
                onClick={() => void imp.downloadTemplate()}
                disabled={imp.busy}
                className="ui-btn ui-btn-neutral px-4 flex items-center gap-2"
              >
                <Download size={14} />
                Download Template
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Column Mapping */}
      {imp.step === "mapping" && imp.sheetInfo && (
        <div className="ui-panel p-5 space-y-6">
          <h3 className="text-sm font-semibold text-text">Map Columns — {imp.file?.name}</h3>

          {imp.sheetInfo.vendorHeaders.length > 0 && (
            <ColumnMapper
              title="Vendors Sheet"
              headers={imp.sheetInfo.vendorHeaders}
              fields={VENDOR_FIELDS}
              mapping={imp.vendorMapping}
              onUpdate={imp.updateVendorMapping}
            />
          )}

          {imp.sheetInfo.gameHeaders.length > 0 && (
            <>
              <hr className="border-border/40" />
              <ColumnMapper
                title="Games Sheet"
                headers={imp.sheetInfo.gameHeaders}
                fields={GAME_FIELDS}
                mapping={imp.gameMapping}
                onUpdate={imp.updateGameMapping}
              />
            </>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={imp.reset} className="ui-btn ui-btn-neutral min-h-9 px-4 text-xs">
              Cancel
            </button>
            <button
              type="button"
              disabled={imp.busy || !vendorRequiredMapped || !gameRequiredMapped}
              onClick={() => void imp.preview()}
              className="ui-btn ui-btn-primary min-h-9 px-4 text-xs"
            >
              {imp.busy ? "Parsing..." : "Preview"}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Preview */}
      {imp.step === "preview" && (
        <div className="ui-panel p-5 space-y-5">
          <h3 className="text-sm font-semibold text-text">Preview — {imp.file?.name}</h3>

          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-success/40 bg-success/10 p-3 text-center">
              <div className="text-lg font-bold text-success">{validVendors}</div>
              <div className="text-xs text-muted">Valid Vendors</div>
            </div>
            <div className="rounded-lg border border-critical/40 bg-critical/10 p-3 text-center">
              <div className="text-lg font-bold text-critical">{errorVendors}</div>
              <div className="text-xs text-muted">Vendor Errors</div>
            </div>
            <div className="rounded-lg border border-success/40 bg-success/10 p-3 text-center">
              <div className="text-lg font-bold text-success">{validGames}</div>
              <div className="text-xs text-muted">Valid Games</div>
            </div>
            <div className="rounded-lg border border-critical/40 bg-critical/10 p-3 text-center">
              <div className="text-lg font-bold text-critical">{errorGames}</div>
              <div className="text-xs text-muted">Game Errors</div>
            </div>
          </div>

          {/* Vendor preview table */}
          {imp.vendorRows.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">Vendors ({imp.vendorRows.length} rows)</h4>
              <div className="max-h-60 overflow-auto rounded-lg border border-border/50">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-surface-alt/50">
                      <th className="px-2 py-1.5 text-left font-medium text-muted">Row</th>
                      <th className="px-2 py-1.5 text-left font-medium text-muted">Vendor Name</th>
                      <th className="px-2 py-1.5 text-left font-medium text-muted">Company</th>
                      <th className="px-2 py-1.5 text-left font-medium text-muted">Mobile</th>
                      <th className="px-2 py-1.5 text-left font-medium text-muted">Branch</th>
                      <th className="px-2 py-1.5 text-left font-medium text-muted">Rev Share</th>
                      <th className="px-2 py-1.5 text-left font-medium text-muted">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {imp.vendorRows.map((r) => (
                      <tr
                        key={r.rowNumber}
                        className={r.error ? "bg-critical/5" : ""}
                      >
                        <td className="px-2 py-1 text-muted">{r.rowNumber}</td>
                        <td className="px-2 py-1">{r.vendor?.vendorName ?? r.data[Object.keys(r.data)[0]] ?? "—"}</td>
                        <td className="px-2 py-1">{r.vendor?.companyName ?? "—"}</td>
                        <td className="px-2 py-1">{r.vendor?.mobileNumber ?? "—"}</td>
                        <td className="px-2 py-1">{r.vendor?.branchName ?? "—"}</td>
                        <td className="px-2 py-1">{r.vendor?.revenueShare != null ? `${r.vendor.revenueShare}%` : "—"}</td>
                        <td className="px-2 py-1">
                          {r.error ? (
                            <span className="text-critical" title={r.error}>{r.error}</span>
                          ) : (
                            <span className="text-success">Valid</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Game preview table */}
          {imp.gameRows.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">Games ({imp.gameRows.length} rows)</h4>
              <div className="max-h-60 overflow-auto rounded-lg border border-border/50">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-surface-alt/50">
                      <th className="px-2 py-1.5 text-left font-medium text-muted">Row</th>
                      <th className="px-2 py-1.5 text-left font-medium text-muted">Vendor</th>
                      <th className="px-2 py-1.5 text-left font-medium text-muted">Branch</th>
                      <th className="px-2 py-1.5 text-left font-medium text-muted">Game</th>
                      <th className="px-2 py-1.5 text-left font-medium text-muted">Sub Game</th>
                      <th className="px-2 py-1.5 text-left font-medium text-muted">Variant</th>
                      <th className="px-2 py-1.5 text-left font-medium text-muted">Price</th>
                      <th className="px-2 py-1.5 text-left font-medium text-muted">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {imp.gameRows.map((r) => (
                      <tr
                        key={r.rowNumber}
                        className={r.error ? "bg-critical/5" : ""}
                      >
                        <td className="px-2 py-1 text-muted">{r.rowNumber}</td>
                        <td className="px-2 py-1">{r.game?.vendorName ?? "—"}</td>
                        <td className="px-2 py-1">{r.game?.branchName ?? "—"}</td>
                        <td className="px-2 py-1">{r.game?.gameName ?? "—"}</td>
                        <td className="px-2 py-1">{r.game?.subGameName ?? "—"}</td>
                        <td className="px-2 py-1">{r.game?.variantLabel ?? "—"}</td>
                        <td className="px-2 py-1">{r.game?.price != null ? `₹${r.game.price}` : "—"}</td>
                        <td className="px-2 py-1">
                          {r.error ? (
                            <span className="text-critical" title={r.error}>{r.error}</span>
                          ) : (
                            <span className="text-success">Valid</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={imp.reset} className="ui-btn ui-btn-neutral min-h-9 px-4 text-xs">
              Cancel
            </button>
            <button
              type="button"
              disabled={imp.busy || (validVendors === 0 && validGames === 0)}
              onClick={() => void imp.confirmImport()}
              className="ui-btn ui-btn-primary min-h-9 px-4 text-xs"
            >
              {imp.busy ? "Importing..." : `Import ${validVendors} Vendors & ${validGames} Games`}
            </button>
          </div>
        </div>
      )}

      {/* Importing */}
      {imp.step === "importing" && (
        <div className="ui-panel p-8 text-center space-y-4">
          <Loader2 size={48} className="mx-auto text-accent animate-spin" />
          <h3 className="text-lg font-semibold text-text">Importing...</h3>
          {imp.progress && <p className="text-sm text-muted">{imp.progress}</p>}
        </div>
      )}

      {/* Step 4: Complete */}
      {imp.step === "complete" && imp.importResult && (
        <div className="ui-panel p-8 text-center space-y-4">
          <CheckCircle size={48} className="mx-auto text-success" />
          <h3 className="text-lg font-semibold text-text">Import Complete</h3>
          <p className="text-sm text-muted">
            {imp.importResult.vendorsCreated} vendors created, {imp.importResult.gamesCreated} game variants added
            {imp.importResult.errors.length > 0 && ` — ${imp.importResult.errors.length} errors`}
          </p>
          {imp.importResult.errors.length > 0 && (
            <div className="max-h-40 overflow-auto rounded-lg border border-critical/40 bg-critical/10 p-3 text-left text-xs text-critical">
              {imp.importResult.errors.map((e, i) => (
                <div key={i}>[{e.sheet}] Row {e.row}: {e.message}</div>
              ))}
            </div>
          )}
          <button type="button" onClick={imp.reset} className="ui-btn ui-btn-primary px-6">
            Import More
          </button>
        </div>
      )}
    </div>
  );
};

export default VendorGameImportView;
