import { addDoc, collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, serverTimestamp, Unsubscribe, updateDoc, where } from "firebase/firestore";
import { initializeFirestore } from "../lib/firebase";
import { TrackMarshallShiftRecord } from "./types";
import { nowIso, toOptionalString } from "./firestore-utils";
import { branchIdToDisplayName, resolveLocation, getAllLocations } from "../../lib/locations";

const TRACK_MARSHALL_SHIFTS_COLLECTION = "trackMarshallShifts";
const ACTIVE_SHIFT_STATUS = "Active";

const getTrackMarshallShiftCollection = () => {
  const firestore = initializeFirestore();
  if (!firestore) {
    return null;
  }
  return collection(firestore, TRACK_MARSHALL_SHIFTS_COLLECTION);
};

const toBranchId = (branch: string): string => resolveLocation(branch)?.branchId ?? branch;

const toBranchName = (branchId: string): string => branchIdToDisplayName(branchId);

const toRecord = (id: string, data: Record<string, unknown>): TrackMarshallShiftRecord => {
  const loginTime = String(data.loginTime ?? nowIso());
  const logoutTime = toOptionalString(data.logoutTime);
  const startMs = new Date(loginTime).getTime();
  const endMs = logoutTime ? new Date(logoutTime).getTime() : NaN;
  const totalActiveHours =
    typeof data.totalActiveHours === "number" && Number.isFinite(data.totalActiveHours)
      ? data.totalActiveHours
      : logoutTime && Number.isFinite(startMs) && Number.isFinite(endMs)
      ? Math.max(0, Number(((endMs - startMs) / (1000 * 60 * 60)).toFixed(2)))
      : undefined;

  return {
    id,
    userId: toOptionalString(data.userId),
    staffName: String(data.staffName ?? "Track Marshall"),
    branchId: String(data.branchId ?? getAllLocations()[0]?.branchId ?? "0"),
    branchName: String(data.branchName ?? toBranchName(String(data.branchId ?? getAllLocations()[0]?.branchId ?? "0"))),
    loginTime,
    logoutTime,
    totalActiveHours,
    status: data.status === "Completed" ? "Completed" : "Active",
    createdAt: String(data.createdAt ?? loginTime),
    updatedAt: String(data.updatedAt ?? loginTime)
  };
};

export const listTrackMarshallShifts = async (): Promise<TrackMarshallShiftRecord[]> => {
  const collectionRef = getTrackMarshallShiftCollection();
  if (!collectionRef) {
    return [];
  }

  const snapshot = await getDocs(query(collectionRef, orderBy("loginTime", "desc")));
  return snapshot.docs.map((item) => toRecord(item.id, item.data() as Record<string, unknown>));
};

export const getActiveTrackMarshallShiftByUser = async (userId: string): Promise<TrackMarshallShiftRecord | null> => {
  const collectionRef = getTrackMarshallShiftCollection();
  if (!collectionRef) {
    return null;
  }
  const snapshot = await getDocs(query(collectionRef, where("userId", "==", userId), where("status", "==", ACTIVE_SHIFT_STATUS)));
  return snapshot.docs.length > 0 ? toRecord(snapshot.docs[0].id, snapshot.docs[0].data() as Record<string, unknown>) : null;
};

export const getActiveTrackMarshallShiftByBranch = async (branch: string): Promise<TrackMarshallShiftRecord | null> => {
  const collectionRef = getTrackMarshallShiftCollection();
  if (!collectionRef) {
    return null;
  }
  const branchId = toBranchId(branch);
  const snapshot = await getDocs(query(collectionRef, where("branchId", "==", branchId), where("status", "==", ACTIVE_SHIFT_STATUS)));
  return snapshot.docs.length > 0 ? toRecord(snapshot.docs[0].id, snapshot.docs[0].data() as Record<string, unknown>) : null;
};

export const startTrackMarshallShift = async (payload: {
  userId?: string;
  staffName: string;
  branch: string;
}): Promise<TrackMarshallShiftRecord> => {
  const collectionRef = getTrackMarshallShiftCollection();
  if (!collectionRef) {
    throw new Error("Track Marshall shift store is not configured.");
  }

  const branchId = toBranchId(payload.branch);
  const existing = await getActiveTrackMarshallShiftByBranch(branchId);
  if (existing) {
    throw new Error(`${existing.branchName} already has an active shift.`);
  }

  const loginTime = nowIso();
  const created = await addDoc(collectionRef, {
    userId: toOptionalString(payload.userId),
    staffName: payload.staffName.trim() || "Track Marshall",
    branchId,
    branchName: toBranchName(branchId),
    loginTime,
    status: ACTIVE_SHIFT_STATUS,
    createdAt: loginTime,
    updatedAt: loginTime,
    serverCreatedAt: serverTimestamp()
  });

  return {
    id: created.id,
    userId: toOptionalString(payload.userId),
    staffName: payload.staffName.trim() || "Track Marshall",
    branchId,
    branchName: toBranchName(branchId),
    loginTime,
    status: "Active",
    createdAt: loginTime,
    updatedAt: loginTime
  };
};

export const endTrackMarshallShift = async (shiftId: string): Promise<TrackMarshallShiftRecord> => {
  return endTrackMarshallShiftAt(shiftId);
};

export const endTrackMarshallShiftAt = async (
  shiftId: string,
  logoutTime: string = nowIso()
): Promise<TrackMarshallShiftRecord> => {
  const collectionRef = getTrackMarshallShiftCollection();
  if (!collectionRef) {
    throw new Error("Track Marshall shift store is not configured.");
  }
  const snapshot = await getDoc(doc(collectionRef, shiftId));
  if (!snapshot.exists()) {
    throw new Error("Shift not found.");
  }
  const existing = toRecord(snapshot.id, snapshot.data() as Record<string, unknown>);
  const totalActiveHours = Math.max(
    0,
    Number(((new Date(logoutTime).getTime() - new Date(existing.loginTime).getTime()) / (1000 * 60 * 60)).toFixed(2))
  );

  await updateDoc(doc(collectionRef, shiftId), {
    logoutTime,
    totalActiveHours,
    status: "Completed",
    updatedAt: logoutTime
  });

  return {
    ...existing,
    logoutTime,
    totalActiveHours,
    status: "Completed",
    updatedAt: logoutTime
  };
};

export const subscribeActiveTrackMarshallShifts = (
  onData: (records: TrackMarshallShiftRecord[]) => void,
  onError?: (error: Error) => void
): Unsubscribe => {
  const collectionRef = getTrackMarshallShiftCollection();
  if (!collectionRef) {
    onData([]);
    return () => undefined;
  }

  return onSnapshot(
    query(collectionRef, where("status", "==", ACTIVE_SHIFT_STATUS), orderBy("loginTime", "desc")),
    (snapshot) => {
      onData(snapshot.docs.map((item) => toRecord(item.id, item.data() as Record<string, unknown>)));
    },
    (error) => {
      onError?.(error as Error);
    }
  );
};
