/**
 * Incharge Daily Tasks Firestore module.
 *
 * One document per branch + day in `inchargeTasks`. Each doc tracks the three
 * mandatory tasks an Incharge user must complete every day before the End
 * Shift button on the Shifts page becomes enabled:
 *
 *   - washroom        (>= 3 photos uploaded)
 *   - housekeeping    (>= 3 photos uploaded)
 *   - vehicleReport   (one entry per kart at the branch)
 *
 * Doc id pattern: `${locationSlug}_${YYYY-MM-DD}` — deterministic per branch/day,
 * matching the existing `deepCleanAssignments` precedent so the End-Shift gate
 * can read a single doc without queries.
 */

import {
  Unsubscribe,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { initializeFirestore } from "../lib/firebase";
import { nowIso } from "./firestore-utils";
import { resolveLocation } from "../../lib/locations";
import { todayIST } from "../lib/ist-date";

const INCHARGE_TASKS_COLLECTION = "inchargeTasks";

/**
 * Recursively drops any property whose value is `undefined`. Firestore rejects
 * writes that contain `undefined` at any depth, and the shared `stripUndefined`
 * helper only handles the top level — so we need a deep version here for the
 * nested task/entry payloads.
 */
const dropUndefinedDeep = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map((item) => dropUndefinedDeep(item)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = dropUndefinedDeep(v);
    }
    return out as T;
  }
  return value;
};

export type InchargeTaskKey = "washroom" | "housekeeping" | "vehicleReport";

export type InchargeKartCondition = "good" | "minor_issue" | "bad" | "engine_failure";

export interface InchargePhotoTask {
  completed: boolean;
  photos: string[];
  completedAt?: string;
  completedBy?: string;
  completedByName?: string;
}

export interface InchargeVehicleReportEntry {
  kartId: string;
  kartNumber: string;
  condition: InchargeKartCondition;
  remarks?: string;
}

export interface InchargeVehicleReport {
  completed: boolean;
  entries: InchargeVehicleReportEntry[];
  completedAt?: string;
  completedBy?: string;
  completedByName?: string;
}

export interface InchargeDailyRecord {
  id: string;
  locationId: string;
  locationName: string;
  date: string;
  washroom: InchargePhotoTask | null;
  housekeeping: InchargePhotoTask | null;
  vehicleReport: InchargeVehicleReport | null;
  createdAt: string;
  updatedAt: string;
}

const MIN_PHOTOS_PER_TASK = 3;

const getFs = () => initializeFirestore();

const normalizeSlug = (raw: string): string => resolveLocation(raw)?.slug ?? raw;

export const getInchargeDocId = (locationSlug: string, dateYmd: string): string =>
  `${normalizeSlug(locationSlug)}_${dateYmd}`;

const mapPhotoTask = (data: unknown): InchargePhotoTask | null => {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const photos = Array.isArray(d.photos) ? d.photos.filter((p): p is string => typeof p === "string") : [];
  return {
    completed: d.completed === true,
    photos,
    completedAt: typeof d.completedAt === "string" ? d.completedAt : undefined,
    completedBy: typeof d.completedBy === "string" ? d.completedBy : undefined,
    completedByName: typeof d.completedByName === "string" ? d.completedByName : undefined,
  };
};

const mapVehicleReport = (data: unknown): InchargeVehicleReport | null => {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const rawEntries = Array.isArray(d.entries) ? d.entries : [];
  const entries: InchargeVehicleReportEntry[] = [];
  for (const e of rawEntries) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    const condition = String(r.condition ?? "");
    if (!["good", "minor_issue", "bad", "engine_failure"].includes(condition)) continue;
    const remarks = typeof r.remarks === "string" && r.remarks.length > 0 ? r.remarks : undefined;
    const entry: InchargeVehicleReportEntry = {
      kartId: String(r.kartId ?? ""),
      kartNumber: String(r.kartNumber ?? ""),
      condition: condition as InchargeKartCondition,
    };
    if (remarks) entry.remarks = remarks;
    entries.push(entry);
  }
  return {
    completed: d.completed === true,
    entries,
    completedAt: typeof d.completedAt === "string" ? d.completedAt : undefined,
    completedBy: typeof d.completedBy === "string" ? d.completedBy : undefined,
    completedByName: typeof d.completedByName === "string" ? d.completedByName : undefined,
  };
};

const mapInchargeDoc = (id: string, raw: Record<string, unknown>): InchargeDailyRecord => ({
  id,
  locationId: String(raw.locationId ?? ""),
  locationName: String(raw.locationName ?? ""),
  date: String(raw.date ?? ""),
  washroom: mapPhotoTask(raw.washroom),
  housekeeping: mapPhotoTask(raw.housekeeping),
  vehicleReport: mapVehicleReport(raw.vehicleReport),
  createdAt: String(raw.createdAt ?? ""),
  updatedAt: String(raw.updatedAt ?? ""),
});

export const getInchargeForToday = async (
  locationSlug: string
): Promise<InchargeDailyRecord | null> => {
  const fs = getFs();
  if (!fs) return null;
  const docId = getInchargeDocId(locationSlug, todayIST());
  const snap = await getDoc(doc(fs, INCHARGE_TASKS_COLLECTION, docId));
  if (!snap.exists()) return null;
  return mapInchargeDoc(snap.id, snap.data() as Record<string, unknown>);
};

export const subscribeInchargeTasksForToday = (
  locationSlug: string,
  onData: (record: InchargeDailyRecord | null) => void,
  onError?: (error: Error) => void
): Unsubscribe => {
  const fs = getFs();
  if (!fs) {
    onData(null);
    return () => undefined;
  }
  const docId = getInchargeDocId(locationSlug, todayIST());
  return onSnapshot(
    doc(fs, INCHARGE_TASKS_COLLECTION, docId),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      onData(mapInchargeDoc(snap.id, snap.data() as Record<string, unknown>));
    },
    (reason) => onError?.(reason as Error)
  );
};

interface ListInchargeTasksForRangeInput {
  from: string;
  to: string;
  locationSlugs?: string[];
}

/**
 * Loads every Incharge daily-doc whose `date` falls within [from, to] (inclusive).
 * The slug filter is applied client-side because the active branch set is small
 * (≤ 5) and that avoids the Firestore `in` 10-value cap.
 *
 * Returns rows sorted by date desc, then locationId asc — deterministic for UI grouping.
 */
export const listInchargeTasksForRange = async ({
  from,
  to,
  locationSlugs,
}: ListInchargeTasksForRangeInput): Promise<InchargeDailyRecord[]> => {
  const fs = getFs();
  if (!fs) return [];
  const col = collection(fs, INCHARGE_TASKS_COLLECTION);
  const q = query(col, where("date", ">=", from), where("date", "<=", to));
  const snap = await getDocs(q);
  let rows = snap.docs.map((d) => mapInchargeDoc(d.id, d.data() as Record<string, unknown>));
  if (locationSlugs && locationSlugs.length > 0) {
    const allowed = new Set(locationSlugs.map((s) => normalizeSlug(s)));
    rows = rows.filter((r) => allowed.has(r.locationId));
  }
  rows.sort((a, b) => b.date.localeCompare(a.date) || a.locationId.localeCompare(b.locationId));
  return rows;
};

interface CompletePhotoTaskInput {
  locationId: string;
  locationName: string;
  date: string;
  taskKey: Exclude<InchargeTaskKey, "vehicleReport">;
  photoUrls: string[];
  userId: string;
  userName: string;
}

export const completePhotoTask = async ({
  locationId,
  locationName,
  date,
  taskKey,
  photoUrls,
  userId,
  userName,
}: CompletePhotoTaskInput): Promise<void> => {
  const fs = getFs();
  if (!fs) throw new Error("Firestore not configured.");
  if (photoUrls.length < MIN_PHOTOS_PER_TASK) {
    throw new Error(`At least ${MIN_PHOTOS_PER_TASK} photos are required.`);
  }
  const slug = normalizeSlug(locationId);
  const docId = getInchargeDocId(slug, date);
  const now = nowIso();
  const safeLocationName = locationName || resolveLocation(slug)?.displayName || slug;
  const taskPayload: InchargePhotoTask = {
    completed: true,
    photos: photoUrls,
    completedAt: now,
    completedBy: userId,
    completedByName: userName,
  };
  await setDoc(
    doc(fs, INCHARGE_TASKS_COLLECTION, docId),
    dropUndefinedDeep({
      id: docId,
      locationId: slug,
      locationName: safeLocationName,
      date,
      [taskKey]: taskPayload,
      createdAt: now,
      updatedAt: now,
    } as Record<string, unknown>),
    { merge: true }
  );
};

interface CompleteVehicleReportInput {
  locationId: string;
  locationName: string;
  date: string;
  entries: InchargeVehicleReportEntry[];
  userId: string;
  userName: string;
}

export const completeVehicleReport = async ({
  locationId,
  locationName,
  date,
  entries,
  userId,
  userName,
}: CompleteVehicleReportInput): Promise<void> => {
  const fs = getFs();
  if (!fs) throw new Error("Firestore not configured.");
  if (entries.length === 0) {
    throw new Error("Vehicle report requires at least one kart entry.");
  }
  const slug = normalizeSlug(locationId);
  const docId = getInchargeDocId(slug, date);
  const now = nowIso();
  const safeLocationName = locationName || resolveLocation(slug)?.displayName || slug;
  // Sanitise each entry: remarks may legitimately be empty/undefined and
  // Firestore rejects undefined values inside array elements.
  const safeEntries: InchargeVehicleReportEntry[] = entries.map((e) => {
    const trimmed = (e.remarks ?? "").trim();
    const entry: InchargeVehicleReportEntry = {
      kartId: e.kartId,
      kartNumber: e.kartNumber,
      condition: e.condition,
    };
    if (trimmed) entry.remarks = trimmed;
    return entry;
  });
  const reportPayload: InchargeVehicleReport = {
    completed: true,
    entries: safeEntries,
    completedAt: now,
    completedBy: userId,
    completedByName: userName,
  };
  await setDoc(
    doc(fs, INCHARGE_TASKS_COLLECTION, docId),
    dropUndefinedDeep({
      id: docId,
      locationId: slug,
      locationName: safeLocationName,
      date,
      vehicleReport: reportPayload,
      createdAt: now,
      updatedAt: now,
    } as Record<string, unknown>),
    { merge: true }
  );
};

export const isPhotoTaskComplete = (task: InchargePhotoTask | null): boolean =>
  task !== null && task.completed === true && task.photos.length >= MIN_PHOTOS_PER_TASK;

export const isVehicleReportComplete = (report: InchargeVehicleReport | null): boolean =>
  report !== null && report.completed === true && report.entries.length > 0;

export const isInchargeComplete = (record: InchargeDailyRecord | null): boolean => {
  if (!record) return false;
  return (
    isPhotoTaskComplete(record.washroom) &&
    isPhotoTaskComplete(record.housekeeping) &&
    isVehicleReportComplete(record.vehicleReport)
  );
};

export const INCHARGE_PHOTO_MIN = MIN_PHOTOS_PER_TASK;
