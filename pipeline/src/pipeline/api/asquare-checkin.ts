import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { getAsquareFirestore } from "./asquare-firestore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CheckInConfig {
  slotCapacity: number;
  availableTimings: string[];
  dateTimings: Record<string, string[]>;
  locationTimings: Record<string, Record<string, string[]>>;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export const asquareCheckinApi = {
  /**
   * Read the check-in configuration from `settings/checkin_config`.
   */
  async getConfig(): Promise<CheckInConfig> {
    const firestore = getAsquareFirestore();
    const snap = await getDoc(doc(firestore, "settings", "checkin_config"));

    if (!snap.exists()) {
      return {
        slotCapacity: 0,
        availableTimings: [],
        dateTimings: {},
        locationTimings: {},
      };
    }

    const data = snap.data() as Record<string, unknown>;
    return {
      slotCapacity: Number(data.slotCapacity ?? 0),
      availableTimings: Array.isArray(data.availableTimings)
        ? data.availableTimings.map(String)
        : [],
      dateTimings:
        data.dateTimings && typeof data.dateTimings === "object"
          ? (data.dateTimings as Record<string, string[]>)
          : {},
      locationTimings:
        data.locationTimings && typeof data.locationTimings === "object"
          ? (data.locationTimings as Record<string, Record<string, string[]>>)
          : {},
    };
  },

  /**
   * Save (merge) the check-in configuration to `settings/checkin_config`.
   */
  async saveConfig(config: Partial<CheckInConfig>): Promise<void> {
    const firestore = getAsquareFirestore();
    await setDoc(
      doc(firestore, "settings", "checkin_config"),
      config,
      { merge: true }
    );
  },

  /**
   * Update the `timeSlot` field on every item inside a booking document.
   */
  async updateBookingTimeSlot(
    bookingId: string,
    items: Array<Record<string, unknown>>,
    timeSlot: string
  ): Promise<void> {
    const firestore = getAsquareFirestore();
    const updatedItems = items.map((item) => ({
      ...item,
      timeSlot,
    }));
    await updateDoc(doc(firestore, "bookings", bookingId), {
      items: updatedItems,
    });
  },
};
