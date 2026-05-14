import {
  deleteFirestoreShift,
  endFirestoreShift,
  endFirestoreShiftBreak,
  endFirestoreShiftById,
  endFirestoreShiftWithSettlement,
  forceCloseFirestoreShift,
  listFirestoreShifts,
  reportFirestoreShifts,
  startFirestoreShift,
  startFirestoreShiftBreak
} from "./shifts-firestore";
import { Role } from "./types";

export interface ShiftRecord {
  id: string;
  userId: string;
  role: "Telecaller" | "Cashier" | "TrackMarshall" | "Incharge";
  locationId: string;
  locationName: string;
  shiftDate: string;
  startTime: string;
  endTime?: string;
  totalActiveHours?: number;
  breaks: Array<{ breakStart: string; breakEnd?: string }>;
  settlement?: {
    cashEntered: number;
    cardEntered: number;
    upiEntered: number;
    cashActual: number;
    cardActual: number;
    upiActual: number;
    settledAt: string;
    totalTransactions: number;
    locationId?: string;
  };
  /**
   * Audit metadata stamped when an Owner/Admin force-closes this shift on
   * behalf of an absent cashier (e.g. cleaning up the May-11 cluster of
   * unsettled docs). Presence of these fields means the settlement was
   * NOT entered by the cashier themselves — the Owner is on record.
   */
  forceClosedBy?: string;
  forceClosedByName?: string;
  forceClosedAt?: string;
  forceCloseReason?: string;
}

export const shiftsApi = {
  list(
    token: string,
    query?: {
      from?: string;
      to?: string;
      role?: Role;
      userId?: string;
      activeOnly?: boolean;
      locationId?: string;
    }
  ): Promise<{ shifts: ShiftRecord[] }> {
    return listFirestoreShifts(token, query).then((shifts) => ({ shifts }));
  },
  start(token: string, role: "Telecaller" | "Cashier" | "TrackMarshall" | "Incharge", locationId: string): Promise<{ shift: ShiftRecord }> {
    return startFirestoreShift(token, role, locationId).then((shift) => ({ shift }));
  },
  startBreak(token: string): Promise<{ shift: ShiftRecord }> {
    return startFirestoreShiftBreak(token).then((shift) => ({ shift }));
  },
  endBreak(token: string): Promise<{ shift: ShiftRecord }> {
    return endFirestoreShiftBreak(token).then((shift) => ({ shift }));
  },
  end(token: string): Promise<{ shift: ShiftRecord }> {
    return endFirestoreShift(token).then((shift) => ({ shift }));
  },
  endById(token: string, shiftId: string): Promise<{ shift: ShiftRecord }> {
    return endFirestoreShiftById(token, shiftId).then((shift) => ({ shift }));
  },
  endWithSettlement(
    token: string,
    settlement: NonNullable<ShiftRecord["settlement"]>
  ): Promise<{ shift: ShiftRecord }> {
    return endFirestoreShiftWithSettlement(token, settlement).then((shift) => ({ shift }));
  },
  forceClose(
    token: string,
    shiftId: string,
    settlement: NonNullable<ShiftRecord["settlement"]>,
    reason: string
  ): Promise<{ shift: ShiftRecord }> {
    return forceCloseFirestoreShift(token, shiftId, settlement, reason).then((shift) => ({ shift }));
  },
  report(token: string, userId: string): Promise<{ shifts: ShiftRecord[] }> {
    return reportFirestoreShifts(token, userId).then((shifts) => ({ shifts }));
  },
  delete(token: string, shiftId: string): Promise<void> {
    return deleteFirestoreShift(token, shiftId);
  }
};
