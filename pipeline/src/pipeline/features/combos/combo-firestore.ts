import { collection, deleteDoc, doc, getDocs, setDoc } from "firebase/firestore";
import { ensureAnonymousAuth, initializeFirestore } from "../../lib/firebase";
import type { ComboRecord, ComboItem } from "./combo-types";

const COMBOS_COLLECTION = "combos";

const getDb = () => initializeFirestore();

const nowIso = () => new Date().toISOString();

/** Remove undefined values from an object (Firestore rejects undefined). */
const stripUndefined = <T extends Record<string, unknown>>(obj: T): T =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;

/** Strip undefined values from a combo record, including nested items. */
const cleanComboData = (data: Record<string, unknown>): Record<string, unknown> => {
  const cleaned = stripUndefined(data);
  if (Array.isArray(cleaned.items)) {
    cleaned.items = cleaned.items.map((item: Record<string, unknown>) => stripUndefined(item));
  }
  return cleaned;
};

const mapCombo = (id: string, data: Record<string, unknown>): ComboRecord => ({
  id,
  name: String(data.name ?? ""),
  locationKey: String(data.locationKey ?? ""),
  items: Array.isArray(data.items) ? (data.items as ComboItem[]) : [],
  pricingMode: data.pricingMode === "fixed" ? "fixed" : "discount",
  discountPercent: data.discountPercent != null ? Number(data.discountPercent) : undefined,
  comboPrice: Number(data.comboPrice ?? 0),
  originalTotal: Number(data.originalTotal ?? 0),
  status: data.status === "Inactive" ? "Inactive" : "Active",
  createdAt: String(data.createdAt ?? nowIso()),
  updatedAt: String(data.updatedAt ?? nowIso()),
});

export const listCombos = async (locationKey?: string): Promise<ComboRecord[]> => {
  await ensureAnonymousAuth();
  const db = getDb();
  if (!db) return [];
  // Simple query — sort client-side to avoid requiring composite indexes
  const snap = await getDocs(collection(db, COMBOS_COLLECTION));
  const all = snap.docs.map((d) => mapCombo(d.id, d.data() as Record<string, unknown>));
  return all
    .filter((c) => c.status === "Active")
    .filter((c) => !locationKey || c.locationKey === locationKey)
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const listAllCombos = async (): Promise<ComboRecord[]> => {
  await ensureAnonymousAuth();
  const db = getDb();
  if (!db) return [];
  const snap = await getDocs(collection(db, COMBOS_COLLECTION));
  return snap.docs
    .map((d) => mapCombo(d.id, d.data() as Record<string, unknown>))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

export const createCombo = async (combo: Omit<ComboRecord, "id" | "createdAt" | "updatedAt">): Promise<ComboRecord> => {
  await ensureAnonymousAuth();
  const db = getDb();
  if (!db) throw new Error("Firestore not configured.");
  const now = nowIso();
  const id = `combo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const record: ComboRecord = { ...combo, id, createdAt: now, updatedAt: now };
  await setDoc(doc(db, COMBOS_COLLECTION, id), cleanComboData(record as unknown as Record<string, unknown>));
  return record;
};

export const updateCombo = async (
  id: string,
  updates: Partial<Omit<ComboRecord, "id" | "createdAt">>
): Promise<void> => {
  await ensureAnonymousAuth();
  const db = getDb();
  if (!db) throw new Error("Firestore not configured.");
  await setDoc(doc(db, COMBOS_COLLECTION, id), cleanComboData({ ...updates, updatedAt: nowIso() } as Record<string, unknown>), { merge: true });
};

export const deleteCombo = async (id: string): Promise<void> => {
  await ensureAnonymousAuth();
  const db = getDb();
  if (!db) throw new Error("Firestore not configured.");
  await deleteDoc(doc(db, COMBOS_COLLECTION, id));
};
