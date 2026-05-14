import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  updateDoc,
} from "firebase/firestore";
import { getAsquareFirestore, toDate } from "./asquare-firestore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AsquareNotification {
  id: string;
  type: string;
  locationId: string;
  locationName: string;
  name: string;
  phone: string;
  email?: string;
  status: "new" | "contacted";
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const parseNotification = (
  id: string,
  data: Record<string, unknown>
): AsquareNotification => ({
  id,
  type: String(data.type ?? ""),
  locationId: String(data.locationId ?? ""),
  locationName: String(data.locationName ?? ""),
  name: String(data.name ?? ""),
  phone: String(data.phone ?? ""),
  email:
    typeof data.email === "string" && data.email.trim()
      ? data.email.trim()
      : undefined,
  status: data.status === "contacted" ? "contacted" : "new",
  createdAt: toDate(data.createdAt),
});

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export const asquareNotificationsApi = {
  /**
   * List all notifications ordered by `createdAt` descending.
   */
  async listNotifications(): Promise<AsquareNotification[]> {
    const firestore = getAsquareFirestore();
    const notificationsQuery = query(
      collection(firestore, "notifications"),
      orderBy("createdAt", "desc")
    );
    const snapshot = await getDocs(notificationsQuery);

    return snapshot.docs.map((record) =>
      parseNotification(record.id, record.data() as Record<string, unknown>)
    );
  },

  /**
   * Mark a notification as contacted.
   */
  async markContacted(id: string): Promise<void> {
    const firestore = getAsquareFirestore();
    await updateDoc(doc(firestore, "notifications", id), {
      status: "contacted",
    });
  },

  /**
   * Delete a notification document.
   */
  async deleteNotification(id: string): Promise<void> {
    const firestore = getAsquareFirestore();
    await deleteDoc(doc(firestore, "notifications", id));
  },
};
