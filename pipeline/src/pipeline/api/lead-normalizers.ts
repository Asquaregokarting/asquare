import type {
  SuperfoneEventRecord,
  SuperfoneInteraktControls,
  SuperfoneInteraktControlsResponse
} from "./types";
import { nowIso } from "./firestore-utils";

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

const toBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on", "enabled"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off", "disabled"].includes(normalized)) {
      return false;
    }
  }
  return null;
};

const asIsoString = (value: unknown): string => {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return nowIso();
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return nowIso();
  }

  return parsed.toISOString();
};

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item ?? "").trim())
    .filter((item) => item.length > 0);
};

export const parseSuperfoneEventRecords = (payload: unknown): SuperfoneEventRecord[] => {
  const object = asObject(payload);
  const candidates =
    (Array.isArray(payload) ? payload : null) ??
    (object && Array.isArray(object.events) ? object.events : null) ??
    (object && Array.isArray(object.data) ? object.data : null);

  if (!candidates) {
    return [];
  }

  return candidates
    .map((item, index) => {
      const row = asObject(item);
      if (!row) {
        return null;
      }

      const meta = asObject(row.meta) ?? {};
      const normalized = asObject(row.normalized) ?? {};
      const raw = asObject(row.raw) ?? {};

      const id = String(row.id ?? row.event_id ?? `sf-event-${index + 1}`).trim() || `sf-event-${index + 1}`;
      const receivedAt = asIsoString(row.receivedAt ?? row.received_at ?? meta.received_at);
      const directLabelTitles = asStringArray(row.labelTitles);
      const normalizedLabelTitles = asStringArray(
        (Array.isArray(normalized.contact_labels) ? normalized.contact_labels : []).map((entry) => asObject(entry)?.title)
      );
      const labelTitles = directLabelTitles.length > 0 ? directLabelTitles : normalizedLabelTitles;

      const durationSec = toNumber(row.durationSec ?? row.duration_sec ?? normalized.cdr_duration);
      const ringingSec = toNumber(row.ringingSec ?? row.ringing_sec ?? normalized.cdr_ringing_duration);

      return {
        id,
        receivedAt,
        event: String(row.event ?? normalized.event ?? "").trim(),
        customerPhone: String(row.customerPhone ?? row.customer_phone ?? normalized.cdr_phone ?? "").trim(),
        customerName: String(row.customerName ?? row.customer_name ?? normalized.contact_first_name ?? "Unknown").trim() || "Unknown",
        staffName: String(row.staffName ?? row.staff_name ?? normalized.staff_first_name ?? "").trim(),
        staffPhone: String(row.staffPhone ?? row.staff_phone ?? normalized.staff_phone ?? "").trim(),
        callType: String(row.callType ?? row.call_type ?? normalized.cdr_call_type ?? "").trim(),
        disposition: String(row.disposition ?? normalized.cdr_disposition ?? "").trim(),
        durationSec,
        ringingSec,
        source: String(row.source ?? normalized.contact_source ?? "").trim(),
        labelTitles,
        meta,
        normalized,
        raw
      } satisfies SuperfoneEventRecord;
    })
    .filter((item): item is SuperfoneEventRecord => Boolean(item));
};

export const parseSuperfoneInteraktControls = (payload: unknown): SuperfoneInteraktControls => {
  const object = asObject(payload) ?? {};
  const controls = asObject(object.controls) ?? object;

  return {
    base_enabled: toBoolean(controls.base_enabled) ?? false,
    runtime_enabled: toBoolean(controls.runtime_enabled) ?? false,
    configured: toBoolean(controls.configured) ?? false,
    dispatch_allowed: toBoolean(controls.dispatch_allowed) ?? false,
    template: String(controls.template ?? "").trim() || null
  };
};

export const parseSuperfoneInteraktControlsResponse = (
  payload: unknown,
  mode: "interakt_status" | "interakt_toggle"
): SuperfoneInteraktControlsResponse => {
  const object = asObject(payload) ?? {};
  return {
    ok: true,
    mode,
    controls: parseSuperfoneInteraktControls(payload),
    generated_at: asIsoString(object.generated_at ?? object.generatedAt ?? nowIso())
  };
};

