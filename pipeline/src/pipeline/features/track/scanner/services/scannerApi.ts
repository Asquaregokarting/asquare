// A² Scanner — Firestore-based Booking Lookup & Serial Verification
// Serial-number-driven: uses serialStart from billing items.
// Statuses: pending → riding → completed.

import {
  collection,
  doc,
  DocumentData,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where
} from "firebase/firestore";
import { initializeFirestore } from "../../../../lib/firebase";
import { ensureFirebaseAuthForStorage } from "../../../../lib/firebase-auth";
import { BillLookupResult, ScanSerial } from "../types/scanner.types";

const BOOKINGS_COLLECTION = "bookings";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface NormalizedItem {
  itemName: string;
  quantity: number;
  unitPrice: number;
  serialStart: number; // 0 = no serial assigned
}

interface StoredSerial {
  serialId?: string;
  serialNumber?: number;
  itemName?: string;
  unitPrice?: number;
  status?: string;
  verifiedAt?: string;
  verifiedBy?: string;
  kartNumber?: string;
  rideStartedAt?: string;
}

/** Remove undefined values from an object (Firestore rejects undefined). */
const stripUndefined = <T extends Record<string, unknown>>(obj: T): T => {
  const result = {} as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) result[key] = value;
  }
  return result as T;
};

/** Check if an activity name is a Go-Karting activity (verifiable in scanner). */
const isGoKartingActivity = (name: string): boolean => {
  const n = name.toLowerCase();
  return n.includes("gokarting") || n.includes("go-karting") || n.includes("go karting")
    || n.includes("gokart") || n.includes("go-kart") || n.includes("go kart");
};

/** Normalize a raw booking item into a flat structure, extracting serialStart.
 *  Priority: printSerial (ticket) → billingItem.serialStart → item.serialStart */
const normalizeItem = (raw: unknown, billingItem?: unknown, printSerial?: number): NormalizedItem => {
  const item = raw as Record<string, unknown>;
  const activity = item.activity as Record<string, unknown> | undefined;
  const billing = billingItem as Record<string, unknown> | undefined;
  return {
    itemName: String(item.itemName ?? activity?.name ?? billing?.itemName ?? "Item"),
    quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)),
    unitPrice: Math.max(0, Number(item.unitPrice ?? item.price ?? activity?.basePrice ?? 0)),
    serialStart: Math.floor(Number(printSerial ?? billing?.serialStart ?? item.serialStart ?? 0)) || 0
  };
};

/** Expand items into individual serial entries using serialStart from billing.
 *  When serialStart is missing (0), falls back to item-index IDs but still marks Go-Karting as verifiable. */
const itemsToSerials = (items: NormalizedItem[]): ScanSerial[] => {
  const serials: ScanSerial[] = [];
  let fallbackCounter = 0;
  for (const item of items) {
    const isGk = isGoKartingActivity(item.itemName);
    for (let unit = 0; unit < item.quantity; unit++) {
      const serialNumber = item.serialStart > 0 ? item.serialStart + unit : 0;
      const serialId = serialNumber > 0
        ? `S-${String(serialNumber).padStart(3, "0")}`
        : `item-${fallbackCounter}`;
      fallbackCounter++;
      serials.push({
        serialId,
        serialNumber,
        itemName: item.itemName,
        unitPrice: item.unitPrice,
        status: "pending",
        verifiable: isGk
      });
    }
  }
  return serials;
};

/** Merge generated serials with any persisted state from the booking document. */
const mergeWithStored = (generated: ScanSerial[], stored: StoredSerial[]): ScanSerial[] => {
  if (stored.length === 0) return generated;
  const map = new Map(stored.map((s) => [s.serialId, s]));
  return generated.map((s) => {
    const existing = map.get(s.serialId);
    if (!existing) return s;
    return {
      ...s,
      status: (existing.status === "completed" ? "completed" : existing.status === "riding" ? "riding" : "pending") as ScanSerial["status"],
      verifiedAt: existing.verifiedAt,
      verifiedBy: existing.verifiedBy,
      kartNumber: existing.kartNumber,
      rideStartedAt: existing.rideStartedAt
    };
  });
};

/** Convert a date to YYYY-MM-DD using **local** time (avoids UTC date-shift). */
const toLocalDatePrefix = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Extract a date string (YYYY-MM-DD) from various Firestore date formats. */
const extractDateStr = (value: unknown): string | undefined => {
  if (!value) return undefined;
  if (typeof value === "string") return value.slice(0, 10);
  if (typeof (value as { toDate?: () => Date }).toDate === "function") {
    return toLocalDatePrefix((value as { toDate: () => Date }).toDate());
  }
  if (value instanceof Date) return toLocalDatePrefix(value);
  return undefined;
};

// ---------------------------------------------------------------------------
// lookupBill — fetch a booking and return serial-number-driven entries
// ---------------------------------------------------------------------------

/** Parse new QR format: INVOICE|GK:001,002,003|CHK:xxxx */
const parseQrValue = (raw: string): { invoiceNumber: string; gkSerials: string[] } => {
  if (!raw.includes("|GK:")) return { invoiceNumber: raw, gkSerials: [] };
  const parts = raw.split("|");
  const invoiceNumber = parts[0];
  const gkPart = parts.find((p) => p.startsWith("GK:"));
  const chkPart = parts.find((p) => p.startsWith("CHK:"));
  const gkSerials = gkPart ? gkPart.slice(3).split(",") : [];
  if (chkPart) {
    const payload = `${invoiceNumber}|${gkPart}`;
    let sum = 0;
    for (let i = 0; i < payload.length; i++) sum += payload.charCodeAt(i);
    const expected = String(sum % 10000).padStart(4, "0");
    if (chkPart.slice(4) !== expected) {
      throw new Error("QR code checksum validation failed. This ticket may be invalid.");
    }
  }
  return { invoiceNumber, gkSerials };
};

export const lookupBill = async (billingId: string): Promise<BillLookupResult> => {
  await ensureFirebaseAuthForStorage();

  const db = initializeFirestore();
  if (!db) throw new Error("Firestore not available.");

  const { invoiceNumber: parsedId } = parseQrValue(billingId);
  const lookupId = parsedId || billingId;

  let matchedId: string | null = null;
  let matchedData: DocumentData | null = null;

  // 1. Direct document lookup by ID
  const directSnap = await getDoc(doc(db, BOOKINGS_COLLECTION, lookupId));
  if (directSnap.exists()) {
    matchedId = directSnap.id;
    matchedData = directSnap.data()!;
  }

  // 2. Query by invoiceNumber
  if (!matchedData) {
    const byInvoice = await getDocs(
      query(collection(db, BOOKINGS_COLLECTION), where("invoiceNumber", "==", lookupId))
    );
    if (!byInvoice.empty) {
      matchedId = byInvoice.docs[0].id;
      matchedData = byInvoice.docs[0].data();
    }
  }

  // 3. Query by orderNumber
  if (!matchedData) {
    const byOrder = await getDocs(
      query(collection(db, BOOKINGS_COLLECTION), where("orderNumber", "==", lookupId))
    );
    if (!byOrder.empty) {
      matchedId = byOrder.docs[0].id;
      matchedData = byOrder.docs[0].data();
    }
  }

  // 4. Query by qrCode
  if (!matchedData) {
    const byQr = await getDocs(
      query(collection(db, BOOKINGS_COLLECTION), where("qrCode", "==", billingId))
    );
    if (!byQr.empty) {
      matchedId = byQr.docs[0].id;
      matchedData = byQr.docs[0].data();
    }
  }

  // 5. Extract order number from QR format "ASQUARE-{ORDER}-{SUFFIX}"
  if (!matchedData && lookupId.startsWith("ASQUARE-")) {
    const parts = lookupId.split("-");
    if (parts.length >= 3) {
      const extractedId = parts.slice(1, -1).join("-");
      const extractedSnap = await getDoc(doc(db, BOOKINGS_COLLECTION, extractedId));
      if (extractedSnap.exists()) {
        matchedId = extractedSnap.id;
        matchedData = extractedSnap.data()!;
      }
    }
  }

  if (!matchedId || !matchedData) {
    throw new Error("Invalid or not found in system.");
  }

  // Validate booking eligibility
  const paymentStatus = String(matchedData.paymentStatus ?? "").toLowerCase();
  const bookingStatus = String(matchedData.bookingStatus ?? "").toLowerCase();

  // Soft-delete / cancellation guard. Pre-fix `lookupBill` accepted any
  // doc that matched by id/invoiceNumber/orderNumber/qrCode — so a
  // cancelled or soft-deleted booking could still be scanned and its
  // serials marked used. This is the cascade-discipline gap the
  // platform audit flagged HIGH on this surface.
  if (matchedData.cancelled === true) {
    throw new Error("This booking was cancelled and cannot be scanned.");
  }
  if (matchedData.deletedAt || matchedData.voidedAt) {
    throw new Error("This booking has been deleted and is no longer valid.");
  }

  if (paymentStatus !== "completed") {
    throw new Error(`This booking is not eligible for scanning. Payment status: ${paymentStatus || "unknown"}. Only fully paid bookings can be scanned.`);
  }

  if (bookingStatus !== "confirmed" && bookingStatus !== "completed") {
    throw new Error(`This booking is not eligible for scanning. Booking status: ${bookingStatus || "unknown"}. Only confirmed or completed bookings can be scanned.`);
  }

  // Normalize items — merge items with billingItems and printSerials to get serialStart
  const rawItemsArray: unknown[] = Array.isArray(matchedData.items) ? matchedData.items : [];
  const rawBillingItems: unknown[] = Array.isArray(matchedData.billingItems) ? matchedData.billingItems : [];
  const printSerials: number[] = Array.isArray(matchedData.printSerials) ? matchedData.printSerials : [];
  const normalizedItems = rawItemsArray.map((it, idx) => normalizeItem(it, rawBillingItems[idx], printSerials[idx]));

  const items = normalizedItems.map((it) => ({
    itemName: it.itemName,
    quantity: it.quantity,
    unitPrice: it.unitPrice
  }));

  const generated = itemsToSerials(normalizedItems);
  const stored: StoredSerial[] = Array.isArray(matchedData.serials) ? matchedData.serials : [];
  const serials = mergeWithStored(generated, stored);

  // Session date validation
  const sessionDateStr = extractDateStr(matchedData.sessionDate) ?? extractDateStr(matchedData.visitDate);
  const today = toLocalDatePrefix(new Date());

  if (sessionDateStr && sessionDateStr > today) {
    throw new Error(`This ticket is scheduled for ${sessionDateStr}. Not valid until that date.`);
  }

  return {
    billingId: matchedId,
    customerName: matchedData.userDisplayName ? String(matchedData.userDisplayName) : matchedData.customerName ? String(matchedData.customerName) : matchedData.userName ? String(matchedData.userName) : matchedData.name ? String(matchedData.name) : undefined,
    customerPhone: matchedData.userPhone ? String(matchedData.userPhone) : matchedData.customerPhone ? String(matchedData.customerPhone) : matchedData.mobile ? String(matchedData.mobile) : undefined,
    invoiceNumber: matchedData.invoiceNumber ? String(matchedData.invoiceNumber) : matchedData.orderNumber ? String(matchedData.orderNumber) : undefined,
    totalAmount: matchedData.finalAmount != null ? Number(matchedData.finalAmount) : matchedData.totalAmount != null ? Number(matchedData.totalAmount) : matchedData.amount != null ? Number(matchedData.amount) : undefined,
    transactionDate: matchedData.transactionDate ? String(matchedData.transactionDate) : extractDateStr(matchedData.sessionDate) ?? extractDateStr(matchedData.createdAt),
    items,
    serials
  };
};

// ---------------------------------------------------------------------------
// verifySerials — atomically mark selected serials as "completed"
// ---------------------------------------------------------------------------

export interface VerifyContext {
  customerName?: string;
  customerPhone?: string;
  branchId: string;
}

export const verifySerials = async (
  bookingId: string,
  selectedIds: string[],
  userName: string,
  _context: VerifyContext
): Promise<void> => {
  await ensureFirebaseAuthForStorage();

  const db = initializeFirestore();
  if (!db) throw new Error("Firestore not available.");

  const docRef = doc(db, BOOKINGS_COLLECTION, bookingId);
  const selectedSet = new Set(selectedIds);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists()) throw new Error(`Booking ${bookingId} not found.`);

    const data = snap.data();

    if (String(data.paymentStatus ?? "").toLowerCase() !== "completed") {
      throw new Error("Cannot verify: payment is not completed.");
    }
    const txBookingStatus = String(data.bookingStatus ?? "").toLowerCase();
    if (txBookingStatus !== "confirmed" && txBookingStatus !== "completed") {
      throw new Error("Cannot verify: booking is not confirmed.");
    }

    const rawItems: unknown[] = Array.isArray(data.items) ? data.items : [];
    const rawBillingItems: unknown[] = Array.isArray(data.billingItems) ? data.billingItems : [];
    // printSerials is the canonical source of truth once a ticket is printed —
    // lookupBill uses it to generate the IDs the UI hands back. If we omit it
    // here, regenerated IDs fall back to `item-{idx}` and selectedSet never
    // matches, so the write succeeds but no serial actually flips to completed.
    const printSerials: number[] = Array.isArray(data.printSerials) ? data.printSerials : [];
    const items = rawItems.map((it, idx) => normalizeItem(it, rawBillingItems[idx], printSerials[idx]));
    const stored: StoredSerial[] = Array.isArray(data.serials) ? data.serials : [];
    const storedMap = new Map(stored.map((s) => [s.serialId, s]));

    const updatedSerials: StoredSerial[] = [];
    const now = new Date().toISOString();
    let fallbackIdx = 0;

    for (const item of items) {
      for (let unit = 0; unit < item.quantity; unit++) {
        const serialNumber = item.serialStart > 0 ? item.serialStart + unit : 0;
        const serialId = serialNumber > 0 ? `S-${String(serialNumber).padStart(3, "0")}` : `item-${fallbackIdx}`;
        fallbackIdx++;
        const existing = storedMap.get(serialId);

        if (selectedSet.has(serialId)) {
          if (!isGoKartingActivity(item.itemName)) {
            throw new Error(`"${item.itemName}" is not a Go-Karting activity and cannot be verified.`);
          }
          if (existing?.status === "completed") {
            throw new Error(`Serial ${serialId} has already been verified.`);
          }
          updatedSerials.push(stripUndefined({
            serialId,
            serialNumber,
            itemName: item.itemName,
            unitPrice: item.unitPrice,
            status: "completed",
            verifiedAt: now,
            verifiedBy: userName,
            kartNumber: existing?.kartNumber,
            rideStartedAt: existing?.rideStartedAt
          }));
        } else {
          updatedSerials.push(
            existing
              ? stripUndefined({ ...existing, serialId, serialNumber })
              : { serialId, serialNumber, itemName: item.itemName, unitPrice: item.unitPrice, status: "pending" }
          );
        }
      }
    }

    tx.update(docRef, { serials: updatedSerials, updatedAt: serverTimestamp() });
  });
};

// ---------------------------------------------------------------------------
// startRide — mark a serial as "riding" and assign a kart
// ---------------------------------------------------------------------------

export const startRide = async (
  bookingId: string,
  serialId: string,
  kartNumber: string,
  userName: string
): Promise<void> => {
  await ensureFirebaseAuthForStorage();

  const db = initializeFirestore();
  if (!db) throw new Error("Firestore not available.");

  const docRef = doc(db, BOOKINGS_COLLECTION, bookingId);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists()) throw new Error(`Booking ${bookingId} not found.`);

    const data = snap.data();
    const serials: StoredSerial[] = Array.isArray(data.serials) ? data.serials : [];

    const updatedSerials = serials.map((s) => {
      if (s.serialId === serialId) {
        if (s.status === "completed") throw new Error("This serial is already completed.");
        if (s.status === "riding") throw new Error("This serial is already riding.");
        return stripUndefined({
          ...s,
          status: "riding",
          kartNumber,
          rideStartedAt: new Date().toISOString(),
          verifiedBy: userName
        });
      }
      return stripUndefined({ ...s });
    });

    tx.update(docRef, { serials: updatedSerials, updatedAt: serverTimestamp() });
  });
};

// ---------------------------------------------------------------------------
// markRideDone — mark a serial as "completed" (ride finished)
// ---------------------------------------------------------------------------

export const markRideDone = async (
  bookingId: string,
  serialId: string,
  userName: string
): Promise<void> => {
  await ensureFirebaseAuthForStorage();

  const db = initializeFirestore();
  if (!db) throw new Error("Firestore not available.");

  const docRef = doc(db, BOOKINGS_COLLECTION, bookingId);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists()) throw new Error(`Booking ${bookingId} not found.`);

    const data = snap.data();
    const serials: StoredSerial[] = Array.isArray(data.serials) ? data.serials : [];

    const updatedSerials = serials.map((s) => {
      if (s.serialId === serialId) {
        return stripUndefined({
          ...s,
          status: "completed",
          verifiedAt: new Date().toISOString(),
          verifiedBy: userName
        });
      }
      return stripUndefined({ ...s });
    });

    tx.update(docRef, { serials: updatedSerials, updatedAt: serverTimestamp() });
  });
};
