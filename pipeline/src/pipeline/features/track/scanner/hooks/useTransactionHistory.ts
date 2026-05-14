// A² Scanner — useTransactionHistory hook
// Returns one row per SERIAL (not per booking), sorted by serialNumber ASC.
// Go-Karting detection: serial presence OR activity name/category match.
// Pending  = today's serials not yet completed (pending or riding).
// Completed = serials verified today.

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { initializeFirestore } from "../../../../lib/firebase";
import {
  ScannerLocation,
  SCANNER_LOCATION_IDS,
  SCANNER_LOCATION_BRANCH_IDS,
  SCANNER_LOCATION_DOC_IDS,
} from "../types/scanner.types";
import { logger } from "../../../../../lib/logger";

const BOOKINGS_COLLECTION = "bookings";

// ─── Go-Karting detection ─────────────────────────────────────────────

const GK_KEYWORDS = ["gokarting", "go-karting", "go karting", "gokart", "go-kart", "go kart", "go_karting", "go_kart"];

const isGoKartingText = (text: string): boolean => {
  if (!text) return false;
  const lower = text.toLowerCase();
  return GK_KEYWORDS.some((kw) => lower.includes(kw));
};

const isGoKartingItem = (
  itemName: string,
  activityName?: string,
  activityCategory?: string,
  gameTypeId?: string
): boolean => {
  if (isGoKartingText(itemName)) return true;
  if (activityName && isGoKartingText(activityName)) return true;
  if (activityCategory && isGoKartingText(activityCategory)) return true;
  if (gameTypeId === "2") return true;
  return false;
};

/** Derive kart engine CC from the item name. */
const getKartCc = (itemName: string): string => {
  const n = itemName.toLowerCase();
  if (n.includes("child") || n.includes("kids") || n.includes("junior")) return "200cc";
  return "270cc";
};

// ─── Date helpers ─────────────────────────────────────────────────────

const toLocalDateStr = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const toDatePrefix = (value: unknown): string | undefined => {
  if (!value) return undefined;
  if (typeof value === "string" && value.length >= 10) return value.slice(0, 10);
  if (typeof (value as { toDate?: () => Date }).toDate === "function") {
    return toLocalDateStr((value as { toDate: () => Date }).toDate());
  }
  if (value instanceof Date && !isNaN(value.getTime())) return toLocalDateStr(value);
  return undefined;
};

const getTodayPrefix = (): string => toLocalDateStr(new Date());

// ─── Location normalization ───────────────────────────────────────────

const buildLocationIds = (location: string): string[] => {
  const ids = new Set<string>();
  const slug = SCANNER_LOCATION_IDS[location];
  const branchId = SCANNER_LOCATION_BRANCH_IDS[location];
  const docId = SCANNER_LOCATION_DOC_IDS[location];
  if (slug) ids.add(slug);
  if (branchId) ids.add(branchId);
  if (docId) ids.add(docId);
  ids.add(location);
  ids.add(location.toLowerCase());
  return Array.from(ids);
};

// ─── Types ────────────────────────────────────────────────────────────

export interface SerialHistoryRecord {
  /** Unique key: bookingId_serialId */
  id: string;
  bookingId: string;
  serialId: string;
  serialNumber: number;
  itemName: string;
  kartCc: string;
  customerName?: string;
  customerPhone?: string;
  invoiceNumber?: string;
  status: "pending" | "riding" | "completed";
  verifiedAt?: string;
  verifiedBy?: string;
  kartNumber?: string;
  rideStartedAt?: string;
  bookingDate?: string;
}

interface RawBookingDoc {
  invoiceNumber?: string;
  orderNumber?: string;
  userDisplayName?: string;
  customerName?: string;
  userName?: string;
  userPhone?: string;
  customerPhone?: string;
  mobile?: string;
  sessionDate?: unknown;
  createdAt?: unknown;
  visitDate?: unknown;
  transactionDate?: unknown;
  paymentStatus?: string;
  bookingStatus?: string;
  items?: unknown[];
  billingItems?: unknown[];
  printSerials?: number[];
  serials?: Array<{
    serialId?: string;
    serialNumber?: number;
    itemName?: string;
    status?: string;
    verifiedBy?: string;
    verifiedAt?: string;
    kartNumber?: string;
    rideStartedAt?: string;
  }>;
}

// ─── Serial extraction ────────────────────────────────────────────────

const extractSerials = (docId: string, raw: RawBookingDoc): SerialHistoryRecord[] => {
  const customerName = raw.userDisplayName ?? raw.customerName ?? raw.userName;
  const customerPhone = raw.userPhone ?? raw.customerPhone ?? raw.mobile;
  const invoiceNumber = raw.invoiceNumber ?? raw.orderNumber;
  const bookingDate =
    toDatePrefix(raw.sessionDate) ??
    toDatePrefix(raw.visitDate) ??
    toDatePrefix(raw.transactionDate) ??
    toDatePrefix(raw.createdAt);

  const storedSerials = raw.serials ?? [];
  const storedMap = new Map(
    storedSerials.filter((s) => s.serialId).map((s) => [s.serialId as string, s])
  );

  const records: SerialHistoryRecord[] = [];
  const items = Array.isArray(raw.items) ? raw.items : [];
  const billingItems = Array.isArray(raw.billingItems) ? raw.billingItems : [];
  const printSerials = Array.isArray(raw.printSerials) ? raw.printSerials : [];

  const sourceItems = items.length > 0 ? items : billingItems;
  let fallbackIdx = 0;

  for (let idx = 0; idx < sourceItems.length; idx++) {
    const item = sourceItems[idx] as Record<string, unknown>;
    const billing = billingItems[idx] as Record<string, unknown> | undefined;
    const activity = item.activity as Record<string, unknown> | undefined;

    const itemName = String(item.itemName ?? activity?.name ?? billing?.itemName ?? "Item");
    const activityName = String(activity?.name ?? "");
    const activityCategory = String(activity?.category ?? billing?.category ?? "");
    const gameTypeId = String(activity?.gameTypeId ?? billing?.gameTypeId ?? "");
    const quantity = Math.max(1, Math.floor(Number(item.quantity ?? billing?.quantity) || 1));
    const serialStart = Math.floor(
      Number(printSerials[idx] ?? billing?.serialStart ?? item.serialStart ?? 0)
    ) || 0;

    const hasSerial = serialStart > 0;
    const isGk = isGoKartingItem(itemName, activityName, activityCategory, gameTypeId);
    if (!hasSerial && !isGk) {
      fallbackIdx += quantity;
      continue;
    }

    for (let unit = 0; unit < quantity; unit++) {
      const serialNumber = hasSerial ? serialStart + unit : 0;
      const serialId = serialNumber > 0
        ? `S-${String(serialNumber).padStart(3, "0")}`
        : `item-${fallbackIdx}`;
      fallbackIdx++;
      const stored = storedMap.get(serialId);

      records.push({
        id: `${docId}_${serialId}`,
        bookingId: docId,
        serialId,
        serialNumber,
        itemName,
        kartCc: getKartCc(itemName),
        customerName: customerName ? String(customerName) : undefined,
        customerPhone: customerPhone ? String(customerPhone) : undefined,
        invoiceNumber: invoiceNumber ? String(invoiceNumber) : undefined,
        status: (
          stored?.status === "completed"
            ? "completed"
            : stored?.status === "riding"
              ? "riding"
              : "pending"
        ) as SerialHistoryRecord["status"],
        verifiedAt: stored?.verifiedAt,
        verifiedBy: stored?.verifiedBy,
        kartNumber: stored?.kartNumber,
        rideStartedAt: stored?.rideStartedAt,
        bookingDate,
      });
    }
  }

  return records;
};

// ─── Hook ─────────────────────────────────────────────────────────────

export const useTransactionHistory = (
  location: ScannerLocation | null,
  statusFilter: "pending" | "completed"
) => {
  const [allSerials, setAllSerials] = useState<SerialHistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!location) {
      setAllSerials([]);
      setLoading(false);
      return;
    }

    const db = initializeFirestore();
    if (!db) {
      setError("Firestore not available.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const locationIds = buildLocationIds(location);
    const q = query(
      collection(db, BOOKINGS_COLLECTION),
      where("locationId", "in", locationIds)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const serials: SerialHistoryRecord[] = [];
        for (const d of snapshot.docs) {
          const raw = d.data() as RawBookingDoc;
          const ps = String(raw.paymentStatus ?? "").toLowerCase();
          const bs = String(raw.bookingStatus ?? "").toLowerCase();
          if (ps !== "completed") continue;
          if (bs !== "confirmed" && bs !== "completed") continue;
          serials.push(...extractSerials(d.id, raw));
        }
        setAllSerials(serials);
        setLoading(false);
      },
      (err) => {
        logger.error('scanner_history.snapshot_error', err);
        setError(err.message || "Failed to load bookings.");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [location]);

  const records = useMemo(() => {
    const today = getTodayPrefix();
    return allSerials
      .filter((r) => {
        if (statusFilter === "completed") {
          return r.status === "completed" && r.verifiedAt?.startsWith(today);
        }
        return (r.status === "pending" || r.status === "riding") && r.bookingDate === today;
      })
      .sort((a, b) => a.serialNumber - b.serialNumber);
  }, [allSerials, statusFilter]);

  return { records, loading, error };
};

/** Filter to today only (kept for backward compat). */
export const filterToday = (records: SerialHistoryRecord[]): SerialHistoryRecord[] => records;
