/**
 * Event Coupon Notification API.
 *
 * When an Owner creates an event coupon with vendor games, notifications are sent
 * to each affected vendor. Vendors can accept or reject participation.
 * On rejection, the vendor's games are removed from the coupon's applicableGames.
 */

import { collection, doc, getDocs, orderBy, query, setDoc, updateDoc, where } from "firebase/firestore";
import { initializeFirestore } from "../lib/firebase";
import { EventCouponNotification } from "./types";
import { asquareCouponsApi, CouponGameAssociation } from "./asquare-coupons";

const COLLECTION = "eventCouponNotifications";
const nowIso = () => new Date().toISOString();

const getCol = () => {
  const fs = initializeFirestore();
  if (!fs) throw new Error("Firestore not configured.");
  return collection(fs, COLLECTION);
};

const mapNotification = (id: string, data: Record<string, unknown>): EventCouponNotification => ({
  id,
  couponId: String(data.couponId ?? ""),
  couponCode: String(data.couponCode ?? ""),
  couponDescription: String(data.couponDescription ?? ""),
  discountLabel: String(data.discountLabel ?? ""),
  vendorId: String(data.vendorId ?? ""),
  vendorName: data.vendorName ? String(data.vendorName) : undefined,
  games: Array.isArray(data.games) ? (data.games as EventCouponNotification["games"]) : [],
  status: (["pending", "accepted", "rejected"].includes(String(data.status)) ? String(data.status) : "pending") as EventCouponNotification["status"],
  createdAt: String(data.createdAt ?? nowIso()),
  respondedAt: data.respondedAt ? String(data.respondedAt) : undefined
});

/**
 * Creates event coupon notifications for all vendors whose games are included.
 * Groups games by vendorId and creates one notification per vendor.
 */
export const sendEventCouponNotifications = async (
  couponId: string,
  couponCode: string,
  couponDescription: string,
  discountLabel: string,
  _applicableGames: CouponGameAssociation[],
  vendorGameMap: Map<string, { vendorName: string; games: CouponGameAssociation[] }>
): Promise<number> => {
  const col = getCol();
  let count = 0;

  for (const [vendorId, info] of vendorGameMap.entries()) {
    const notifId = `ecn-${couponId}-${vendorId}`;
    await setDoc(doc(col, notifId), {
      id: notifId,
      couponId,
      couponCode,
      couponDescription,
      discountLabel,
      vendorId,
      vendorName: info.vendorName,
      games: info.games.map((g) => ({
        gameId: g.gameId,
        gameLabel: g.gameLabel,
        subGameId: g.subGameId,
        subGameLabel: g.subGameLabel,
        locationId: g.locationId
      })),
      status: "pending",
      createdAt: nowIso()
    });
    count++;
  }

  return count;
};

/**
 * Lists notifications for a specific vendor (ThirdParty user).
 */
export const listVendorEventNotifications = async (vendorId: string): Promise<EventCouponNotification[]> => {
  const col = getCol();
  const snap = await getDocs(query(col, where("vendorId", "==", vendorId), orderBy("createdAt", "desc")));
  return snap.docs.map((d) => mapNotification(d.id, d.data() as Record<string, unknown>));
};

/**
 * Lists all event coupon notifications (for Owner/Admin).
 */
export const listAllEventNotifications = async (): Promise<EventCouponNotification[]> => {
  const col = getCol();
  const snap = await getDocs(query(col, orderBy("createdAt", "desc")));
  return snap.docs.map((d) => mapNotification(d.id, d.data() as Record<string, unknown>));
};

/**
 * Vendor accepts the event coupon — games stay included.
 */
export const acceptEventCoupon = async (notificationId: string): Promise<void> => {
  const col = getCol();
  await updateDoc(doc(col, notificationId), { status: "accepted", respondedAt: nowIso() });
};

/**
 * Vendor rejects the event coupon — their games are removed from the coupon's applicableGames.
 */
export const rejectEventCoupon = async (
  notificationId: string,
  couponId: string,
  vendorGames: Array<{ gameId: string; locationId: string; subGameId?: string }>
): Promise<void> => {
  const col = getCol();

  // 1. Mark notification as rejected
  await updateDoc(doc(col, notificationId), { status: "rejected", respondedAt: nowIso() });

  // 2. Remove vendor's games from the coupon (match by locationId + gameId + subGameId)
  const coupons = await asquareCouponsApi.listCoupons();
  const coupon = coupons.find((c) => c.id === couponId);
  if (!coupon) return;

  const rejectKeys = new Set(vendorGames.map((g) => `${g.locationId}:${g.gameId}:${g.subGameId ?? ""}`));
  const updatedGames = coupon.applicableGames.filter(
    (g) => !rejectKeys.has(`${g.locationId}:${g.gameId}:${g.subGameId ?? ""}`)
  );

  await asquareCouponsApi.updateCoupon(couponId, { applicableGames: updatedGames });
};
