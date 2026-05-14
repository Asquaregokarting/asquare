import type { ImportRow } from "../../../api/lead-import";

interface Props {
  rows: ImportRow[];
  mapping: Record<string, string>;
}

const ImportPreviewTable = ({ rows, mapping }: Props) => {
  const validCount = rows.filter((r) => r.lead).length;
  const errorCount = rows.filter((r) => r.error).length;

  return (
    <div className="space-y-3">
      <div className="flex gap-4 text-sm">
        <span className="text-success font-medium">{validCount} valid</span>
        <span className="text-critical font-medium">{errorCount} errors</span>
        <span className="text-muted">{rows.length} total rows</span>
      </div>
      <div className="max-h-96 overflow-auto rounded-xl border border-border/50 bg-panel shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface/92">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.09em] text-muted">Row</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.09em] text-muted">Name</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.09em] text-muted">Phone</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.09em] text-muted">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/55">
            {rows.map((row) => (
              <tr
                key={row.rowNumber}
                className={row.error ? "bg-critical/5" : ""}
              >
                <td className="px-3 py-2 text-muted">{row.rowNumber}</td>
                <td className="px-3 py-2 text-text">{row.lead?.customerName ?? row.data[mapping.customerName ?? ""] ?? "-"}</td>
                <td className="px-3 py-2 text-text">{row.lead?.customerPhone ?? row.data[mapping.customerPhone ?? ""] ?? "-"}</td>
                <td className="px-3 py-2">
                  {row.error ? (
                    <span className="text-xs text-critical">{row.error}</span>
                  ) : (
                    <span className="text-xs text-success">Valid</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ImportPreviewTable;
