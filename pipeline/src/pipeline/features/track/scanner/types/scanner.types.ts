import { Timestamp } from "firebase/firestore";
import { getAllLocations } from "../../../../../lib/locations";

export type ScannerLocation = string;

// Derived from centralized location registry
const _locs = getAllLocations();

export const SCANNER_LOCATIONS: string[] = _locs.map((l) => l.displayName);

export const SCANNER_LOCATION_DOC_IDS: Record<string, string> = Object.fromEntries(
  _locs.map((l) => [l.displayName, l.firestoreDocId])
);

/** Maps scanner locations to Firestore branchId values. */
export const SCANNER_LOCATION_BRANCH_IDS: Record<string, string> = Object.fromEntries(
  _locs.map((l) => [l.displayName, l.branchId])
);

/** Maps scanner locations to bookings collection locationId values. */
export const SCANNER_LOCATION_IDS: Record<string, string> = Object.fromEntries(
  _locs.map((l) => [l.displayName, l.slug])
);

export interface ShiftVerificationPhotos {
  selfie: string;
  track: string;
  kart: string;
}

export interface ShiftEndVerificationPhotos {
  selfie: string;
  track_north: string;
  track_south: string;
  track_east: string;
  track_west: string;
}

export interface ShiftParticipant {
  userId: string;
  userName: string;
  role: string;
  joinedAt: string;
}

export interface Shift {
  id: string;
  location: ScannerLocation;
  startedBy: string;
  startedByUid: string;
  startedAt: string;
  shiftDate: string;
  active: boolean;
  endedAt?: string;
  endedBy?: string;
  autoClosed?: boolean;
  verificationPhotos?: ShiftVerificationPhotos;
  endVerificationPhotos?: ShiftEndVerificationPhotos;
  participants?: ShiftParticipant[];
}

// ---------------------------------------------------------------------------
// Serial — one verifiable unit within a booking
// ---------------------------------------------------------------------------

export interface ScanSerial {
  serialId: string;
  /** The actual billing serial number (e.g. 13, 14, 15). 0 if no serialStart. */
  serialNumber: number;
  itemName: string;
  unitPrice: number;
  status: "pending" | "riding" | "completed";
  verifiedAt?: string;
  verifiedBy?: string;
  /** Kart assigned when ride starts. */
  kartNumber?: string;
  rideStartedAt?: string;
  /** Whether this item can be verified by Track Marshall in the scanner. */
  verifiable: boolean;
}

// ---------------------------------------------------------------------------
// Extended serial used by ScanResultCard (adds scan-time validity info)
// ---------------------------------------------------------------------------

export interface ScanSerialItem extends Omit<ScanSerial, "status"> {
  status: "valid" | "used";
  usedBy?: string;
}

// ---------------------------------------------------------------------------
// Bill lookup result returned after QR scan / manual entry
// ---------------------------------------------------------------------------

export interface BillLookupResult {
  billingId: string;
  customerName?: string;
  customerPhone?: string;
  invoiceNumber?: string;
  totalAmount?: number;
  transactionDate?: string;
  items: Array<{ itemName: string; quantity: number; unitPrice: number }>;
  serials: ScanSerial[];
}

// ---------------------------------------------------------------------------
// Scan history (legacy — kept for backward compatibility)
// ---------------------------------------------------------------------------

export interface ScanHistoryRecord {
  id?: string;
  billingId: string;
  location: string;
  scannedBy: string;
  shiftStartedBy: string;
  serials: string[];
  status: "pending" | "completed";
  createdAt?: Timestamp | { toDate: () => Date } | null;
  verifiedAt?: Timestamp | { toDate: () => Date } | null;
  verifiedBy?: string;
}
