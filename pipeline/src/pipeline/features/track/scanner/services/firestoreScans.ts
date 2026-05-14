import { addDoc, collection, doc, onSnapshot, query, serverTimestamp, Unsubscribe, updateDoc, where } from "firebase/firestore";
import { initializeFirestore } from "../../../../lib/firebase";
import { ScanHistoryRecord } from "../types/scanner.types";
import { logger } from "../../../../../lib/logger";

const DB_NAME = "scans";

type PendingScanInput = Omit<ScanHistoryRecord, "id" | "createdAt" | "status" | "verifiedAt" | "verifiedBy">;

/**
 * Creates a new scan document with status "pending".
 * Returns the Firestore document ID, or null if Firestore is unavailable.
 */
export const createPendingScan = async (record: PendingScanInput): Promise<string | null> => {
  const db = initializeFirestore();
  if (!db) {
    logger.warn('scanner.pending_scan_firestore_unavailable');
    return null;
  }

  try {
    const docRef = await addDoc(collection(db, DB_NAME), {
      ...record,
      status: "pending",
      createdAt: serverTimestamp()
    });
    return docRef.id;
  } catch (err) {
    logger.warn('scanner.create_pending_scan_failed', { error: err });
    return null;
  }
};

/**
 * Marks an existing pending scan as completed, recording the verified serials,
 * who verified it, and when.
 */
export const completeScan = async (scanId: string, verifiedBy: string, serials: string[]): Promise<void> => {
  const db = initializeFirestore();
  if (!db) {
    logger.warn('scanner.scan_completion_firestore_unavailable');
    return;
  }

  await updateDoc(doc(db, DB_NAME, scanId), {
    status: "completed",
    verifiedAt: serverTimestamp(),
    verifiedBy,
    serials
  });
};

/**
 * Returns true if a scan record should be treated as completed.
 *
 * Classification rules (handles both new and legacy records):
 *   - Explicit status field: use it directly.
 *   - No status field + serials populated: old code wrote after validation → completed.
 *   - No status field + empty serials: new pending record before verification → pending.
 */
const isCompleted = (r: ScanHistoryRecord): boolean => {
  if (r.status === "completed") return true;
  if (r.status === "pending") return false;
  // Legacy record (no status field): classify by whether serials were written
  return Array.isArray(r.serials) && r.serials.length > 0;
};

const toMs = (ts: ScanHistoryRecord["createdAt"]): number =>
  (ts as { toMillis?: () => number } | null)?.toMillis?.() ?? 0;

/**
 * Subscribes to scan history for a given location, filtered by resolved status.
 * All records for the location are fetched and classified client-side so that
 * legacy records (no status field) are correctly bucketed.
 */
export const subscribeScanHistory = (
  locationFilter: string | null,
  statusFilter: "pending" | "completed",
  onData: (records: ScanHistoryRecord[]) => void,
  onError?: (err: Error) => void
): Unsubscribe => {
  const db = initializeFirestore();
  if (!db) return () => undefined;

  if (!locationFilter) {
    onData([]);
    return () => undefined;
  }

  const q = query(collection(db, DB_NAME), where("location", "==", locationFilter));

  return onSnapshot(
    q,
    (snapshot) => {
      const records: ScanHistoryRecord[] = snapshot.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<ScanHistoryRecord, "id">) }))
        .filter((r) => isCompleted(r) === (statusFilter === "completed"))
        .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
      onData(records);
    },
    (err) => onError?.(err)
  );
};
