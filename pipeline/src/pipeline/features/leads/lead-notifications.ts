import { getMessaging, getToken, onMessage } from "firebase/messaging";
import { doc, updateDoc } from "firebase/firestore";
import { initializeFirestore } from "../../lib/firebase";

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;

/**
 * Request FCM permission and store the token on the user's document.
 */
export const requestNotificationPermission = async (userId: string): Promise<string | null> => {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return null;

    const firestore = initializeFirestore();
    if (!firestore) return null;

    const messaging = getMessaging();
    const token = await getToken(messaging, { vapidKey: VAPID_KEY || undefined });
    if (!token) return null;

    // Store FCM token on the user's document
    const userRef = doc(firestore, "users", userId);
    await updateDoc(userRef, { fcmToken: token, fcmTokenUpdatedAt: new Date().toISOString() });

    return token;
  } catch {
    return null;
  }
};

/**
 * Listen for foreground messages and show a browser notification.
 */
export const listenForForegroundMessages = (callback: (payload: { title: string; body: string }) => void): (() => void) => {
  try {
    const messaging = getMessaging();
    const unsubscribe = onMessage(messaging, (payload) => {
      const title = payload.notification?.title ?? "New Lead Alert";
      const body = payload.notification?.body ?? "You have a new lead to follow up on.";
      callback({ title, body });
    });
    return unsubscribe;
  } catch {
    return () => {};
  }
};
