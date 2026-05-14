/**
 * Shared Firestore helpers for accessing the asquare-app-db database.
 * All asquare API adapters should use getAsquareFirestore() from here.
 *
 * After the database merge, both the pipeline lib and this bridge use the
 * same asquare-app-db database. getAsquareFirestore() delegates to the
 * pipeline's initializeFirestore() so that the anonymous-auth side-effect
 * is always triggered.
 */
import {
  Timestamp,
  type Firestore
} from "firebase/firestore";
import { initializeFirestore } from "../lib/firebase";

export const getAsquareFirestore = (): Firestore => {
  const db = initializeFirestore();
  if (!db) {
    throw new Error("Firebase app is not configured.");
  }
  return db;
};

export const toDate = (value: unknown): Date => {
  if (value && typeof value === "object" && "toDate" in value) {
    const candidate = value as { toDate?: () => Date };
    if (typeof candidate.toDate === "function") {
      return candidate.toDate();
    }
  }
  if (value instanceof Date) {
    return value;
  }
  const parsed = new Date(String(value ?? ""));
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

export const toOptionalDate = (value: unknown): Date | undefined => {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  if (value && typeof value === "object" && "toDate" in value) {
    const candidate = value as { toDate?: () => Date };
    if (typeof candidate.toDate === "function") {
      return candidate.toDate();
    }
  }
  if (value instanceof Date) {
    return value;
  }
  const parsed = new Date(String(value ?? ""));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

export const toTimestamp = (value: unknown): Timestamp | null => {
  if (value && typeof value === "object" && "toDate" in value) {
    return value as Timestamp;
  }
  if (value instanceof Date) {
    return Timestamp.fromDate(value);
  }
  return null;
};
