import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { ensureAnonymousAuth, initializeFirestore } from "../lib/firebase";

const COLLECTION = "partnerInquiries";

const MOBILE_PATTERN = /^[6-9]\d{9}$/;

const INVESTMENT_RANGES = [
  "1 Lakh - 5 Lakhs",
  "5 Lakhs - 10 Lakhs",
  "10 Lakhs - 15 Lakhs",
  "15 Lakhs - 20 Lakhs",
] as const;

export type InvestmentRange = (typeof INVESTMENT_RANGES)[number];

export interface PartnerInquiryPayload {
  name: string;
  phoneNumber: string;
  location: string;
  investmentRange: InvestmentRange;
}

function validatePayload(payload: PartnerInquiryPayload): void {
  const name = payload.name.trim();
  if (!name) throw new Error("Name is required.");

  const phone = payload.phoneNumber.replace(/\s+/g, "");
  if (!MOBILE_PATTERN.test(phone)) throw new Error("Please enter a valid 10-digit mobile number.");

  if (!payload.location) throw new Error("Please select a location.");

  if (!INVESTMENT_RANGES.includes(payload.investmentRange)) {
    throw new Error("Please select an investment range.");
  }
}

export async function submitPartnerInquiry(payload: PartnerInquiryPayload): Promise<string> {
  validatePayload(payload);

  await ensureAnonymousAuth();
  const db = initializeFirestore();
  if (!db) throw new Error("Firestore is not available.");

  const docRef = await addDoc(collection(db, COLLECTION), {
    name: payload.name.trim(),
    phoneNumber: payload.phoneNumber.replace(/\s+/g, ""),
    location: payload.location,
    investmentRange: payload.investmentRange,
    submittedAt: serverTimestamp(),
  });

  return docRef.id;
}

export { INVESTMENT_RANGES };
