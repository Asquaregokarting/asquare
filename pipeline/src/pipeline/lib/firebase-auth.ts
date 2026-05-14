import { getAuth, signInAnonymously } from "firebase/auth";
import { initializeFirebaseApp } from "./firebase";

let signingInPromise: Promise<void> | null = null;

export const ensureFirebaseAuthForStorage = async (): Promise<void> => {
  const app = initializeFirebaseApp();
  if (!app) {
    throw new Error("Firebase app is not configured.");
  }

  const auth = getAuth(app);
  if (auth.currentUser) {
    return;
  }

  if (!signingInPromise) {
    signingInPromise = signInAnonymously(auth)
      .then(() => undefined)
      .finally(() => {
        signingInPromise = null;
      });
  }

  await signingInPromise;
};
