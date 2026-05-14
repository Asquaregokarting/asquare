// A² Scanner — useTransactionCounts hook
// Counts individual Go-Karting SERIALS from today's valid bookings.
// Total  = all generated serials (pending + completed).
// Pending   = serials not yet verified.
// Completed = serials with status "completed".

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

export interface TransactionCounts {
  total: number;
  pending: number;
  completed: number;
  loading: boolean;
}

// ─── Date helpers (all use LOCAL time to match user's timezone) ────────

const getTodayPrefix = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const toLocalDateStr = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Extract YYYY-MM-DD from any Firestore date format, using local timezone. */
const toDatePrefix = (value: unknown): string | undefined => {
  if (!value) return undefined;
  if (typeof value === "string" && value.length >= 10) return value.slice(0, 10);
  if (typeof (value as { toDate?: () => Date }).toDate === "function") {
    return toLocalDateStr((value as { toDate: () => Date }).toDate());
  }
  if (value instanceof Date && !isNaN(value.getTime())) return toLocalDateStr(value);
  return undefined;
};

// ─── Go-Karting detection ─────────────────────────────────────────────

const GK_KEYWORDS = ["gokarting", "go-karting", "go karting", "gokart", "go-kart", "go kart", "go_karting", "go_kart"];

const isGoKartingText = (text: string): boolean => {
  if (!text) return false;
  const lower = text.toLowerCase();
  return GK_KEYWORDS.some((kw) => lower.includes(kw));
};

/** Determine if an item is Go-Karting by checking every available field. */
const isGoKartingItem = (
  itemName: string,
  activityName?: string,
  activityCategory?: string,
  gameTypeId?: string
): boolean => {
  if (isGoKartingText(itemName)) return true;
  if (activityName && isGoKartingText(activityName)) return true;
  if (activityCategory && isGoKartingText(activityCategory)) return true;
  if (gameTypeId === "2") return true; // gameTypeId 2 = Go-Karting in catalog
  return false;
};

// ─── Location normalization ───────────────────────────────────────────

/** Build all possible locationId values for a given scanner location display name. */
const buildLocationIds = (location: string): string[] => {
  const ids = new Set<string>();
  const slug = SCANNER_LOCATION_IDS[location];
  const branchId = SCANNER_LOCATION_BRANCH_IDS[location];
  const docId = SCANNER_LOCATION_DOC_IDS[location];
  if (slug) ids.add(slug);
  if (branchId) ids.add(branchId);
  if (docId) ids.add(docId);
  ids.add(location); // display name itself
  ids.add(location.toLowerCase());
  return Array.from(ids);
};

// ─── Types ────────────────────────────────────────────────────────────

interface RawBookingDoc {
  paymentStatus?: string;
  bookingStatus?: string;
  sessionDate?: unknown;
  createdAt?: unknown;
  visitDate?: unknown;
  transactionDate?: unknown;
  items?: Array<Record<string, unknown>>;
  billingItems?: Array<Record<string, unknown>>;
  printSerials?: number[];
  serials?: Array<{ serialId?: string; status?: string; verifiedAt?: string }>;
}

// ─── Hook ─────────────────────────────────────────────────────────────

export const useTransactionCounts = (location: ScannerLocation | null): TransactionCounts => {
  const [counts, setCounts] = useState<{ pending: number; completed: number }>({ pending: 0, completed: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!location) {
      setCounts({ pending: 0, completed: 0 });
      setLoading(false);
      return;
    }

    const db = initializeFirestore();
    if (!db) {
      logger.error('scanner.firestore_not_initialized');
      setLoading(false);
      return;
    }

    setLoading(true);
    const locationIds = buildLocationIds(location);
    const todayPrefix = getTodayPrefix();

    const q = query(
      collection(db, BOOKINGS_COLLECTION),
      where("locationId", "in", locationIds)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        let pending = 0;
        let completed = 0;
        let debugBookings = 0;
        let debugGkItems = 0;
        let debugSerials = 0;

        for (const docSnap of snapshot.docs) {
          const raw = docSnap.data() as RawBookingDoc;

          // ── Booking eligibility ──
          const ps = String(raw.paymentStatus ?? "").toLowerCase();
          const bs = String(raw.bookingStatus ?? "").toLowerCase();
          if (ps !== "completed") continue;
          if (bs !== "confirmed" && bs !== "completed") continue;

          // ── Date extraction: try multiple fields ──
          const bookingDate =
            toDatePrefix(raw.sessionDate) ??
            toDatePrefix(raw.visitDate) ??
            toDatePrefix(raw.transactionDate) ??
            toDatePrefix(raw.createdAt);
          if (bookingDate !== todayPrefix) continue;

          debugBookings++;

          const items = Array.isArray(raw.items) ? raw.items : [];
          const billingItems = Array.isArray(raw.billingItems) ? raw.billingItems : [];
          const printSerials = Array.isArray(raw.printSerials) ? raw.printSerials : [];
          const storedSerials = Array.isArray(raw.serials) ? raw.serials : [];
          const storedMap = new Map(
            storedSerials.filter((s) => s.serialId).map((s) => [s.serialId as string, s])
          );

          // Use items if available, otherwise fall back to billingItems
          const sourceItems = items.length > 0 ? items : billingItems;

          let fallbackIdx = 0;
          for (let idx = 0; idx < sourceItems.length; idx++) {
            const item = sourceItems[idx];
            const billing = billingItems[idx] as Record<string, unknown> | undefined;
            const activity = item.activity as Record<string, unknown> | undefined;

            const itemName = String(item.itemName ?? activity?.name ?? billing?.itemName ?? "");
            const activityName = String(activity?.name ?? "");
            const activityCategory = String(activity?.category ?? billing?.category ?? "");
            const gameTypeId = String(activity?.gameTypeId ?? billing?.gameTypeId ?? "");
            const quantity = Math.max(1, Math.floor(Number(item.quantity ?? billing?.quantity) || 1));
            const serialStart = Math.floor(
              Number(printSerials[idx] ?? billing?.serialStart ?? item.serialStart ?? 0)
            ) || 0;

            // Only count Go-Karting items with a serial number
            const hasSerial = serialStart > 0;
            const isGk = isGoKartingItem(itemName, activityName, activityCategory, gameTypeId);
            if (!hasSerial && !isGk) {
              fallbackIdx += quantity;
              continue;
            }

            debugGkItems++;

            for (let unit = 0; unit < quantity; unit++) {
              const serialNumber = hasSerial ? serialStart + unit : 0;
              const serialId = serialNumber > 0
                ? `S-${String(serialNumber).padStart(3, "0")}`
                : `item-${fallbackIdx}`;
              fallbackIdx++;
              debugSerials++;

              const stored = storedMap.get(serialId);
              if (stored?.status === "completed") {
                completed++;
              } else {
                pending++;
              }
            }
          }
        }

        if (import.meta.env.DEV) {
          logger.debug('scanner.counts', {
            location,
            locationIds,
            todayPrefix,
            totalDocs: snapshot.docs.length,
            todayBookings: debugBookings,
            gkItems: debugGkItems,
            serials: debugSerials,
            pending,
            completed,
          });
        }

        setCounts({ pending, completed });
        setLoading(false);
      },
      (err) => {
        logger.error('scanner.snapshot_error', err);
        setCounts({ pending: 0, completed: 0 });
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [location]);

  return useMemo(
    () => ({
      total: counts.pending + counts.completed,
      pending: counts.pending,
      completed: counts.completed,
      loading,
    }),
    [counts, loading]
  );
};
