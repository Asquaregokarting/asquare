import { useLeadImport } from "../../../features/leads/useLeadImport";
import ImportColumnMapper from "./ImportColumnMapper";
import ImportPreviewTable from "./ImportPreviewTable";
import { Upload, CheckCircle } from "lucide-react";

const STEPS = ["Upload", "Map Columns", "Preview", "Import"];

const LeadImportView = () => {
  const imp = useLeadImport();

  const stepIdx = ["idle", "file_selected", "mapping", "previewing", "importing", "complete"].indexOf(imp.step);

  return (
    <div className="max-w-3xl ui-section-stack">
      {/* Step indicator */}
      <div className="flex gap-2">
        {STEPS.map((label, i) => {
          const isActive = i <= Math.max(0, stepIdx - 1);
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
      {imp.error && <div className="rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">{imp.error}</div>}

      {/* Step 1: Upload */}
      {imp.step === "idle" && (
        <div className="rounded-xl border-2 border-dashed border-border/70 bg-surface/80 flex flex-col items-center justify-center py-16">
          <Upload size={40} className="mb-3 text-muted/60" />
          <p className="mb-3 text-sm text-muted">Upload an Excel file (.xlsx) with lead data</p>
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
        </div>
      )}

      {/* Step 2: Column Mapping */}
      {imp.step === "mapping" && (
        <div className="ui-panel p-5 space-y-4">
          <h3 className="text-sm font-semibold text-text">Map Columns — {imp.file?.name}</h3>
          <ImportColumnMapper
            headers={imp.headers}
            mapping={imp.mapping}
            onUpdateMapping={imp.updateMapping}
          />
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={imp.reset} className="ui-btn ui-btn-neutral min-h-9 px-4 text-xs">Cancel</button>
            <button
              type="button"
              disabled={imp.busy || !imp.mapping.customerName || !imp.mapping.customerPhone}
              onClick={() => void imp.preview()}
              className="ui-btn ui-btn-primary min-h-9 px-4 text-xs"
            >
              Preview
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Preview */}
      {imp.step === "previewing" && (
        <div className="ui-panel p-5 space-y-4">
          <h3 className="text-sm font-semibold text-text">Preview Import — {imp.file?.name}</h3>
          <ImportPreviewTable rows={imp.previewRows} mapping={imp.mapping} />
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={imp.reset} className="ui-btn ui-btn-neutral min-h-9 px-4 text-xs">Cancel</button>
            <button
              type="button"
              disabled={imp.busy || imp.previewRows.filter((r) => r.lead).length === 0}
              onClick={() => void imp.confirmImport()}
              className="ui-btn ui-btn-primary min-h-9 px-4 text-xs"
            >
              {imp.busy ? "Importing..." : `Import ${imp.previewRows.filter((r) => r.lead).length} Leads`}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Complete */}
      {imp.step === "complete" && imp.importResult && (
        <div className="ui-panel p-8 text-center space-y-4">
          <CheckCircle size={48} className="mx-auto text-success" />
          <h3 className="text-lg font-semibold text-text">Import Complete</h3>
          <p className="text-sm text-muted">
            {imp.importResult.created} leads created
            {imp.importResult.errors.length > 0 && `, ${imp.importResult.errors.length} errors`}
          </p>
          {imp.importResult.errors.length > 0 && (
            <div className="max-h-40 overflow-auto rounded-lg border border-critical/40 bg-critical/10 p-3 text-left text-xs text-critical">
              {imp.importResult.errors.map((e) => (
                <div key={e.row}>Row {e.row}: {e.message}</div>
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

export default LeadImportView;
