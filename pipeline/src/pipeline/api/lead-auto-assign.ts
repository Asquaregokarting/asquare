/**
 * Round-robin auto-assignment engine for leads.
 *
 * Uses a Firestore document (`leadConfig/roundRobin`) as an atomic counter
 * to distribute new leads evenly across active telecallers on shift.
 */

import {
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  where,
} from "firebase/firestore";
import { ensureAnonymousAuth, initializeFirestore } from "../lib/firebase";
import { listFirestoreUsers } from "./users-firestore";
import { nowIso } from "./firestore-utils";
import { logger } from "../../lib/logger";

interface ActiveTelecaller {
  userId: string;
  name: string;
}

// ─── Query active telecallers currently on shift ───────────────────

const getActiveTelecallersOnShift = async (
  branchId?: string
): Promise<ActiveTelecaller[]> => {
  // 1. Get all active telecaller users
  const telecallers = await listFirestoreUsers({
    role: "Telecaller",
    status: "Active",
    ...(branchId ? { location: branchId } : {}),
  });

  if (telecallers.length === 0) return [];

  // 2. Find who is currently on shift (has a shift record with no endTime)
  await ensureAnonymousAuth();
  const firestore = initializeFirestore();
  if (!firestore) return [];

  const shiftsCol = collection(firestore, "shifts");
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const shiftsSnap = await getDocs(
    query(shiftsCol, where("shiftDate", "==", todayStr), where("role", "==", "Telecaller"))
  );

  // Collect user IDs with active shifts (no endTime)
  const onShiftUserIds = new Set<string>();
  for (const d of shiftsSnap.docs) {
    const data = d.data() as Record<string, unknown>;
    if (!data.endTime) {
      onShiftUserIds.add(String(data.userId ?? ""));
    }
  }

  // 3. Intersect: active users who are on shift
  const result: ActiveTelecaller[] = [];
  for (const user of telecallers) {
    if (onShiftUserIds.has(user.id)) {
      result.push({ userId: user.id, name: user.name });
    }
  }

  return result;
};

// ─── Round-robin counter ───────────────────────────────────────────

const getNextRoundRobinTelecaller = async (
  branchId?: string
): Promise<ActiveTelecaller | null> => {
  // First try with branch filter
  let telecallers = await getActiveTelecallersOnShift(branchId);

  // Fall back to any on-shift telecaller if none match the branch
  if (telecallers.length === 0 && branchId) {
    telecallers = await getActiveTelecallersOnShift();
  }

  if (telecallers.length === 0) return null;

  // Sort by userId for deterministic ordering
  telecallers.sort((a, b) => a.userId.localeCompare(b.userId));

  await ensureAnonymousAuth();
  const firestore = initializeFirestore();
  if (!firestore) return null;

  const counterRef = doc(firestore, "leadConfig", "roundRobin");

  const chosen = await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(counterRef);
    const lastIndex = snap.exists()
      ? Number((snap.data() as Record<string, unknown>).lastAssignedIndex ?? -1)
      : -1;

    const nextIndex = (lastIndex + 1) % telecallers.length;
    tx.set(counterRef, { lastAssignedIndex: nextIndex, updatedAt: nowIso() });
    return telecallers[nextIndex];
  });

  return chosen;
};

// ─── Public API ────────────────────────────────────────────────────

/**
 * Auto-assign a lead to the next telecaller in the round-robin.
 * Returns the assigned userId, or null if no telecaller is available.
 */
export const autoAssignLead = async (
  leadId: string,
  branchId: string
): Promise<string | null> => {
  try {
    const telecaller = await getNextRoundRobinTelecaller(branchId);
    if (!telecaller) return null;

    await ensureAnonymousAuth();
    const firestore = initializeFirestore();
    if (!firestore) return null;

    const leadRef = doc(firestore, "leads", leadId);
    const timelineCol = collection(firestore, "leads", leadId, "timeline");

    await runTransaction(firestore, async (tx) => {
      tx.update(leadRef, {
        assignedTo: telecaller.userId,
        assignedAt: nowIso(),
        assignedBy: "auto-assign",
      });

      const timelineRef = doc(timelineCol);
      tx.set(timelineRef, {
        leadId,
        action: "assigned",
        actorId: "system",
        actorName: "Auto-Assign",
        detail: `Auto-assigned to ${telecaller.name} via round-robin`,
        metadata: { assignedTo: telecaller.userId, method: "round-robin" },
        createdAt: nowIso(),
      });
    });

    return telecaller.userId;
  } catch (error) {
    logger.error('lead_auto_assign.failed', error);
    return null;
  }
};

export { getActiveTelecallersOnShift };
export type { ActiveTelecaller };
