import { collection, doc, documentId, getDocs, limit, orderBy, query, QueryConstraint, setDoc, startAfter, updateDoc } from "firebase/firestore";
import { initializeFirestore } from "../lib/firebase";
import { getAllLocations, branchIdToDisplayName } from "../../lib/locations";
import { listFirestoreUsers } from "./users-firestore";
import { CallHistoryRecord, StaffInsightRecord, SuperfoneEventQuery, SuperfoneEventRecord } from "./types";
import { nowIso, toOptionalString } from "./firestore-utils";

const SUPERFONE_EVENTS_COLLECTION = "superfoneEvents";
const USE_FIRESTORE_SUPERFONE = import.meta.env.VITE_USE_FIRESTORE_SUPERFONE !== "false";
const MAX_QUERY_LIMIT = 5000;

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

const normalizePhoneDigits = (value: unknown): string => String(value ?? "").replace(/\D/g, "").slice(-10);

const normalizeName = (value: unknown): string =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const getSuperfoneCollection = () => {
  if (!USE_FIRESTORE_SUPERFONE) {
    return null;
  }
  const firestore = initializeFirestore();
  if (!firestore) {
    return null;
  }
  return collection(firestore, SUPERFONE_EVENTS_COLLECTION);
};

const hashString = (value: string): string => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
};

/** Build keyword → branchId lookup from the centralized registry + known aliases. */
const _branchKeywords: Array<{ keywords: string[]; branchId: string }> = getAllLocations().map((loc) => ({
  keywords: [
    loc.slug,
    loc.displayName.toLowerCase(),
    loc.shortName.toLowerCase(),
    ...(loc.slug === "visakhapatnam" ? ["vizag", "vskp"] : []),
    ...(loc.slug === "kakinada" ? ["kkd"] : []),
    ...(loc.slug === "rajahmundry" ? ["rjy"] : []),
  ],
  branchId: loc.branchId,
}));

const deriveBranchId = (normalized: Record<string, unknown>): string => {
  const labels = Array.isArray(normalized.contact_labels)
    ? normalized.contact_labels.map((item) => String((item as Record<string, unknown>)?.title ?? "").toLowerCase())
    : [];
  const nameBlob = `${labels.join(" ")} ${String(normalized.contact_lead_group_name ?? "")} ${String(
    normalized.contact_lead_stage_name ?? ""
  )}`.toLowerCase();

  for (const entry of _branchKeywords) {
    if (entry.keywords.some((kw) => nameBlob.includes(kw))) {
      return entry.branchId;
    }
  }
  return "unknown";
};

const branchNameForId = (branchId: string): string => branchIdToDisplayName(branchId);

const deriveCallDirection = (callType: string): "Incoming" | "Outgoing" | "Unknown" => {
  const normalized = callType.trim().toLowerCase();
  if (normalized.includes("inbound") || normalized.includes("incoming")) {
    return "Incoming";
  }
  if (normalized.includes("outbound") || normalized.includes("outgoing")) {
    return "Outgoing";
  }
  return "Unknown";
};

const deriveCallStatus = (disposition: string): CallHistoryRecord["status"] => {
  const normalized = disposition.trim().toLowerCase();
  if (normalized.includes("answer") || normalized.includes("connect")) {
    return "Connected";
  }
  if (normalized.includes("miss")) {
    return "Missed";
  }
  if (normalized.includes("no answer")) {
    return "No Answer";
  }
  return "Not Connected";
};

const toEventDocId = (normalized: Record<string, unknown>, meta?: Record<string, unknown>): string => {
  const cdrId = toOptionalString(normalized.cdr_id);
  const cdrStart = toOptionalString(normalized.cdr_start);
  if (cdrId && cdrStart) {
    return `cdr-${cdrId}-${hashString(cdrStart)}`;
  }
  const seed = JSON.stringify({
    event: normalized.event,
    phone: normalized.cdr_phone ?? normalized.contact_phones,
    staffPhone: normalized.staff_phone,
    receivedAt: meta?.received_at,
    cdrStart
  });
  return `sf-${hashString(seed)}`;
};

const readLabelTitles = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            return "";
          }
          return String((entry as Record<string, unknown>).title ?? "").trim();
        })
        .filter(Boolean)
    : [];

const buildCustomerName = (normalized: Record<string, unknown>): string => {
  const first = toOptionalString(normalized.contact_first_name);
  const last = toOptionalString(normalized.contact_last_name);
  const joined = [first, last].filter(Boolean).join(" ").trim();
  return joined || "Unknown";
};

const mapEventRecord = (id: string, data: Record<string, unknown>): SuperfoneEventRecord => {
  const normalized = (data.normalized as Record<string, unknown>) ?? {};
  const meta = (data.meta as Record<string, unknown>) ?? {};
  const callType = String(data.callType ?? normalized.cdr_call_type ?? "");
  const disposition = String(data.disposition ?? normalized.cdr_disposition ?? "");
  const receivedAt = String(data.receivedAt ?? meta.received_at ?? nowIso());
  const durationSec = toNumber(data.durationSec) ?? toNumber(normalized.cdr_duration) ?? 0;
  const ringingSec = toNumber(data.ringingSec) ?? toNumber(normalized.cdr_ringing_duration) ?? 0;
  const talkSeconds = toNumber(data.talkSeconds) ?? durationSec;

  return {
    id,
    receivedAt,
    event: String(data.event ?? normalized.event ?? ""),
    customerPhone: String(data.customerPhone ?? normalized.cdr_phone ?? ""),
    customerName: String(data.customerName ?? buildCustomerName(normalized)),
    staffName: String(data.staffName ?? ([normalized.staff_first_name, normalized.staff_last_name].filter(Boolean).join(" ") || "")),
    staffPhone: String(data.staffPhone ?? normalized.staff_phone ?? ""),
    callType,
    disposition,
    durationSec,
    ringingSec,
    source: String(data.source ?? normalized.contact_source ?? ""),
    labelTitles: Array.isArray(data.labelTitles) ? data.labelTitles.map((item) => String(item)) : readLabelTitles(normalized.contact_labels),
    branchId: toOptionalString(data.branchId),
    branchName: toOptionalString(data.branchName),
    staffUserId: toOptionalString(data.staffUserId),
    staffMatchedBy:
      data.staffMatchedBy === "phone" || data.staffMatchedBy === "name" || data.staffMatchedBy === "unmatched"
        ? data.staffMatchedBy
        : undefined,
    callDirection:
      data.callDirection === "Incoming" || data.callDirection === "Outgoing" || data.callDirection === "Unknown"
        ? data.callDirection
        : deriveCallDirection(callType),
    talkSeconds,
    meta,
    normalized,
    raw: (data.raw as Record<string, unknown>) ?? {}
  };
};

const parseCursor = (value?: string): { receivedAt: string; id: string } | null => {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }
  const [receivedAt, id] = raw.split("::").map((part) => decodeURIComponent(part));
  if (!receivedAt || !id) {
    return null;
  }
  return { receivedAt, id };
};

const toCursor = (event: SuperfoneEventRecord): string => `${encodeURIComponent(event.receivedAt)}::${encodeURIComponent(event.id)}`;

const matchesQuery = (event: SuperfoneEventRecord, queryFilter?: SuperfoneEventQuery & { staffId?: string }): boolean => {
  if (!queryFilter) {
    return true;
  }
  if (queryFilter.phone) {
    const phoneNeedle = queryFilter.phone.replace(/\D/g, "");
    const customerPhone = normalizePhoneDigits(event.customerPhone);
    const staffPhone = normalizePhoneDigits(event.staffPhone);
    if (!customerPhone.includes(phoneNeedle) && !staffPhone.includes(phoneNeedle)) {
      return false;
    }
  }
  if (queryFilter.from && event.receivedAt < queryFilter.from) {
    return false;
  }
  if (queryFilter.to && event.receivedAt > queryFilter.to) {
    return false;
  }
  if (queryFilter.staffId && event.staffUserId !== queryFilter.staffId) {
    return false;
  }
  return true;
};

const resolveStaffMapping = async (event: SuperfoneEventRecord): Promise<{
  staffUserId?: string;
  staffMatchedBy: "phone" | "name" | "unmatched";
}> => {
  const users = await listFirestoreUsers();
  const staffPhone = normalizePhoneDigits(event.staffPhone);
  const phoneMatch = users.find((user) => normalizePhoneDigits(user.phone) === staffPhone && staffPhone);
  if (phoneMatch) {
    return { staffUserId: phoneMatch.id, staffMatchedBy: "phone" };
  }

  const normalizedStaffName = normalizeName(event.staffName);
  const nameMatch = users.find((user) => normalizeName(user.name) === normalizedStaffName && normalizedStaffName);
  if (nameMatch) {
    return { staffUserId: nameMatch.id, staffMatchedBy: "name" };
  }

  return { staffMatchedBy: "unmatched" };
};

const ensureEventStaffMappings = async (events: SuperfoneEventRecord[]): Promise<SuperfoneEventRecord[]> => {
  const superfoneCollection = getSuperfoneCollection();
  if (!superfoneCollection) {
    return events;
  }

  const enriched = [...events];
  for (let index = 0; index < enriched.length; index += 1) {
    const item = enriched[index];
    if (item.staffUserId || item.staffMatchedBy) {
      continue;
    }
    const mapping = await resolveStaffMapping(item);
    await updateDoc(doc(superfoneCollection, item.id), mapping);
    enriched[index] = {
      ...item,
      staffUserId: mapping.staffUserId,
      staffMatchedBy: mapping.staffMatchedBy
    };
  }

  return enriched;
};

export const isFirestoreSuperfoneActive = (): boolean => Boolean(getSuperfoneCollection());

export const buildFirestoreSuperfoneDocument = (record: {
  meta?: Record<string, unknown>;
  normalized: Record<string, unknown>;
  raw?: Record<string, unknown>;
}): SuperfoneEventRecord => {
  const meta = record.meta ?? {};
  const normalized = record.normalized;
  const raw = record.raw ?? normalized;
  const labelTitles = readLabelTitles(normalized.contact_labels);
  const branchId = deriveBranchId(normalized);
  const callType = String(normalized.cdr_call_type ?? "");
  const disposition = String(normalized.cdr_disposition ?? "");
  const contactPhones = Array.isArray(normalized.contact_phones)
    ? normalized.contact_phones
        .map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            return "";
          }
          return String((item as Record<string, unknown>).phone ?? "").trim();
        })
        .filter(Boolean)
    : [];
  const customerPhone = toOptionalString(normalized.cdr_phone) ?? contactPhones[0] ?? "";
  const staffName = [normalized.staff_first_name, normalized.staff_last_name].filter(Boolean).join(" ").trim();
  const customerName = buildCustomerName(normalized);
  const id = toEventDocId(normalized, meta);
  const durationSec = toNumber(normalized.cdr_duration) ?? 0;
  const ringingSec = toNumber(normalized.cdr_ringing_duration) ?? 0;
  const talkSeconds = Math.max(0, durationSec);
  return {
    id,
    receivedAt: String(meta.received_at ?? normalized.cdr_start ?? nowIso()),
    event: String(normalized.event ?? ""),
    customerPhone,
    customerName,
    staffName,
    staffPhone: String(normalized.staff_phone ?? ""),
    callType,
    disposition,
    durationSec,
    ringingSec,
    source: String(normalized.contact_source ?? ""),
    labelTitles,
    branchId,
    branchName: branchNameForId(branchId),
    callDirection: deriveCallDirection(callType),
    talkSeconds,
    meta,
    normalized,
    raw
  };
};

export const upsertFirestoreSuperfoneEvent = async (record: {
  meta?: Record<string, unknown>;
  normalized: Record<string, unknown>;
  raw?: Record<string, unknown>;
}): Promise<SuperfoneEventRecord> => {
  const superfoneCollection = getSuperfoneCollection();
  if (!superfoneCollection) {
    throw new Error("Firestore Superfone is not configured.");
  }

  const event = buildFirestoreSuperfoneDocument(record);
  const mapping = await resolveStaffMapping(event);
  const payload = {
    ...event,
    staffUserId: mapping.staffUserId,
    staffMatchedBy: mapping.staffMatchedBy
  };

  await setDoc(doc(superfoneCollection, event.id), payload, { merge: true });
  return payload;
};

export const listFirestoreSuperfoneEvents = async (
  queryFilter?: SuperfoneEventQuery & { cursor?: string; staffId?: string }
): Promise<{ events: SuperfoneEventRecord[]; nextCursor?: string }> => {
  const superfoneCollection = getSuperfoneCollection();
  if (!superfoneCollection) {
    throw new Error("Firestore Superfone is not configured.");
  }

  const safeLimit = Math.max(1, Math.min(queryFilter?.limit ?? 200, 500));
  const constraints: QueryConstraint[] = [orderBy("receivedAt", "desc"), orderBy(documentId(), "desc"), limit(Math.min(MAX_QUERY_LIMIT, safeLimit * 8))];
  const parsedCursor = parseCursor(queryFilter?.cursor);
  if (parsedCursor) {
    constraints.splice(2, 1, limit(Math.min(MAX_QUERY_LIMIT, safeLimit * 8)));
    constraints.push(startAfter(parsedCursor.receivedAt, parsedCursor.id));
  }

  const snapshot = await getDocs(query(superfoneCollection, ...constraints));
  const rows = snapshot.docs.map((item) => mapEventRecord(item.id, item.data() as Record<string, unknown>));
  const filtered = (await ensureEventStaffMappings(rows)).filter((item) => matchesQuery(item, queryFilter));
  const pageRows = filtered.slice(0, safeLimit);
  const nextCursor = filtered.length > safeLimit ? toCursor(filtered[safeLimit - 1]) : undefined;
  return {
    events: pageRows,
    nextCursor
  };
};

export const buildFirestoreCallHistory = async (queryFilter?: {
  from?: string;
  to?: string;
  type?: "Incoming" | "Outgoing" | "Missed";
  staffId?: string;
  q?: string;
  limit?: number;
  cursor?: string;
}): Promise<{ records: CallHistoryRecord[]; nextCursor?: string }> => {
  const { events, nextCursor } = await listFirestoreSuperfoneEvents({
    from: queryFilter?.from,
    to: queryFilter?.to,
    limit: queryFilter?.limit ?? 100,
    cursor: queryFilter?.cursor,
    staffId: queryFilter?.staffId
  });

  const records = events
    .map<CallHistoryRecord>((event) => {
      const type: CallHistoryRecord["type"] =
        event.disposition.toLowerCase().includes("miss")
          ? "Missed"
          : event.callDirection === "Outgoing"
          ? "Outgoing"
          : "Incoming";
      return {
        id: event.id,
        customerName: event.customerName,
        customerNumber: event.customerPhone,
        userId: event.staffUserId ?? event.staffPhone ?? "unassigned",
        userName: event.staffName || "Unknown",
        type,
        status: deriveCallStatus(event.disposition),
        durationSeconds: Math.max(0, event.talkSeconds ?? event.durationSec ?? 0),
        timestamp: event.receivedAt,
        branchId: event.branchId,
        labelTitles: event.labelTitles
      };
    })
    .filter((record) => {
      if (queryFilter?.type && record.type !== queryFilter.type) {
        return false;
      }
      if (queryFilter?.q) {
        const needle = queryFilter.q.trim().toLowerCase();
        if (
          !`${record.customerName ?? ""} ${record.customerNumber} ${record.userName} ${record.status}`.toLowerCase().includes(needle)
        ) {
          return false;
        }
      }
      return true;
    });

  return { records, nextCursor };
};

export const buildFirestoreStaffInsights = async (queryFilter?: {
  from?: string;
  to?: string;
  staffId?: string;
}): Promise<{
  summary: {
    outgoingCalls: number;
    incomingCalls: number;
    connectedCalls: number;
    missedCalls: number;
    totalDurationSeconds: number;
    uniqueCustomers: number;
    noAnswerCalls: number;
  };
  staffInsights: StaffInsightRecord[];
}> => {
  const { events } = await listFirestoreSuperfoneEvents({
    from: queryFilter?.from,
    to: queryFilter?.to,
    limit: 500,
    staffId: queryFilter?.staffId
  });

  const byStaff = new Map<string, StaffInsightRecord>();
  const uniqueCustomers = new Set<string>();
  let connectedCalls = 0;
  let missedCalls = 0;
  let noAnswerCalls = 0;
  let outgoingCalls = 0;
  let incomingCalls = 0;
  let totalDurationSeconds = 0;

  for (const event of events) {
    if (event.customerPhone) {
      uniqueCustomers.add(normalizePhoneDigits(event.customerPhone));
    }
    const key = event.staffUserId ?? event.staffPhone ?? event.staffName ?? "unassigned";
    const current =
      byStaff.get(key) ??
      ({
        userId: event.staffUserId ?? key,
        staffName: event.staffName || "Unknown",
        outgoingCalls: 0,
        incomingCalls: 0,
        connectedCalls: 0,
        missedCalls: 0,
        totalDurationSeconds: 0,
        averageTalkSeconds: 0
      } satisfies StaffInsightRecord);

    if (event.callDirection === "Outgoing") {
      current.outgoingCalls += 1;
      outgoingCalls += 1;
    }
    if (event.callDirection === "Incoming") {
      current.incomingCalls += 1;
      incomingCalls += 1;
    }

    const disposition = event.disposition.toLowerCase();
    if (disposition.includes("answer") || disposition.includes("connect")) {
      current.connectedCalls += 1;
      connectedCalls += 1;
    } else if (disposition.includes("miss")) {
      current.missedCalls += 1;
      missedCalls += 1;
    }
    if (disposition.includes("no answer")) {
      noAnswerCalls += 1;
    }

    const talkSeconds = Math.max(0, event.talkSeconds ?? event.durationSec ?? 0);
    current.totalDurationSeconds += talkSeconds;
    totalDurationSeconds += talkSeconds;
    byStaff.set(key, current);
  }

  const staffInsights = [...byStaff.values()]
    .map((item) => ({
      ...item,
      averageTalkSeconds:
        item.connectedCalls > 0 ? Number((item.totalDurationSeconds / item.connectedCalls).toFixed(2)) : 0
    }))
    .sort((left, right) => right.totalDurationSeconds - left.totalDurationSeconds);

  return {
    summary: {
      outgoingCalls,
      incomingCalls,
      connectedCalls,
      missedCalls,
      totalDurationSeconds,
      uniqueCustomers: uniqueCustomers.size,
      noAnswerCalls
    },
    staffInsights
  };
};
