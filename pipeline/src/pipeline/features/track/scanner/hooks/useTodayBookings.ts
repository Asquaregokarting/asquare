// A² Scanner — useTodayBookings hook
// Subscribes to bookings scheduled for today at the selected location.
// Returns pending bookings (not all serials used yet).

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { initializeFirestore } from "../../../../lib/firebase";
import { ScannerLocation, SCANNER_LOCATION_IDS } from "../types/scanner.types";

const BOOKINGS_COLLECTION = "bookings";

// Today in IST as YYYY-MM-DD — matches the canonical `visitDate` bucket
// every booking is stamped with at creation. en-CA gives the right format.
const todayVisitDateIST = (): string =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

export interface PendingBookingRecord {
  id: string;
  customerName?: string;
  customerPhone?: string;
  totalAmount?: number;
  finalAmount?: number;
  qrCode?: string;
  bookingStatus?: string;
  paymentStatus?: string;
  items: Array<{ activityName: string; quantity: number; price: number }>;
  totalSerials: number;
  usedSerials: number;
  sessionDate?: Date;
}

interface RawBooking {
  userId?: string;
  userDisplayName?: string;
  userPhone?: string;
  totalAmount?: number;
  finalAmount?: number;
  qrCode?: string;
  bookingStatus?: string;
  paymentStatus?: string;
  sessionDate?: { toDate?: () => Date } | string | Date;
  items?: Array<{
    activity?: { name?: string };
    quantity?: number;
    price?: number;
  }>;
  serials?: Array<{ status?: string }>;
}

const mapBooking = (docId: string, raw: RawBooking): PendingBookingRecord => {
  const items = (raw.items ?? []).map((it) => ({
    activityName: it.activity?.name ?? "Item",
    quantity: Math.max(1, Math.floor(Number(it.quantity) || 1)),
    price: Math.max(0, Number(it.price) || 0)
  }));

  const totalSerials = items.reduce((sum, it) => sum + it.quantity, 0);
  const usedSerials = (raw.serials ?? []).filter((s) => s.status === "completed" || s.status === "used").length;

  let sessionDate: Date | undefined;
  if (raw.sessionDate) {
    if (typeof (raw.sessionDate as { toDate?: () => Date }).toDate === "function") {
      sessionDate = (raw.sessionDate as { toDate: () => Date }).toDate();
    } else {
      sessionDate = new Date(raw.sessionDate as string);
    }
  }

  return {
    id: docId,
    customerName: raw.userDisplayName,
    customerPhone: raw.userPhone,
    totalAmount: raw.totalAmount,
    finalAmount: raw.finalAmount,
    qrCode: raw.qrCode,
    bookingStatus: raw.bookingStatus,
    paymentStatus: raw.paymentStatus,
    items,
    totalSerials,
    usedSerials,
    sessionDate
  };
};

export const useTodayBookings = (location: ScannerLocation | null) => {
  const [allBookings, setAllBookings] = useState<PendingBookingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!location) {
      setAllBookings([]);
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

    const locationId = SCANNER_LOCATION_IDS[location];
    // Equality on the visitDate field (IST YYYY-MM-DD) replaces the old
    // sessionDate Date-range query. The range query was browser-timezone-
    // sensitive (scanner in UTC saw a different "today" than scanner in
    // IST) and required a composite index on (sessionDate, locationId).
    // visitDate is stamped at booking creation in IST, so equality is both
    // correct and cheaper (simpler index).
    const visitDate = todayVisitDateIST();

    const q = query(
      collection(db, BOOKINGS_COLLECTION),
      where("visitDate", "==", visitDate),
      where("locationId", "==", locationId)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const bookings = snapshot.docs
          .filter((d) => {
            const raw = d.data() as RawBooking;
            const ps = String(raw.paymentStatus ?? "").toLowerCase();
            const bs = String(raw.bookingStatus ?? "").toLowerCase();
            return ps === "completed" && (bs === "confirmed" || bs === "completed");
          })
          .map((d) => mapBooking(d.id, d.data() as RawBooking));
        setAllBookings(bookings);
        setLoading(false);
      },
      (err) => {
        setError(err.message || "Failed to load bookings.");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [location]);

  // Only return bookings where not all serials are used (pending)
  const pendingBookings = useMemo(
    () => allBookings.filter((b) => b.usedSerials < b.totalSerials || b.totalSerials === 0),
    [allBookings]
  );

  return { records: pendingBookings, loading, error };
};
