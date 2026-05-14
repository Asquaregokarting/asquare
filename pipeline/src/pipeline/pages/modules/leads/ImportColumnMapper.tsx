interface Props {
  headers: string[];
  mapping: Record<string, string>;
  onUpdateMapping: (field: string, column: string | undefined) => void;
}

const LEAD_FIELDS = [
  { field: "customerName", label: "Customer Name", required: true },
  { field: "customerPhone", label: "Phone Number", required: true },
  { field: "customerEmail", label: "Email", required: false },
  { field: "branchId", label: "Branch / City", required: false },
  { field: "notes", label: "Notes", required: false },
  { field: "assignedTo", label: "Assigned To", required: false },
];

const ImportColumnMapper = ({ headers, mapping, onUpdateMapping }: Props) => (
  <div className="space-y-3">
    <p className="text-sm text-muted">Map your Excel columns to lead fields. Required fields are marked with *.</p>
    <div className="grid gap-3">
      {LEAD_FIELDS.map(({ field, label, required }) => (
        <div key={field} className="flex items-center gap-3">
          <label className="w-40 text-sm font-medium text-text">
            {label} {required && <span className="text-critical">*</span>}
          </label>
          <select
            value={mapping[field] ?? ""}
            onChange={(e) => onUpdateMapping(field, e.target.value || undefined)}
            className={`ui-field flex-1 ${required && !mapping[field] ? "border-critical/50" : ""}`}
          >
            <option value="">-- Not mapped --</option>
            {headers.map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
          {mapping[field] && (
            <span className="text-xs text-success font-medium">Mapped</span>
          )}
        </div>
      ))}
    </div>
  </div>
);

export default ImportColumnMapper;
