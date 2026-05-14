/**
 * Firebase Phone OTP verification for the pipeline app.
 * Uses the same Firebase project as the customer app.
 */
import {
  getAuth,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type ConfirmationResult
} from "firebase/auth";
import { initializeFirebaseApp } from "./firebase";

const COUNTRY_CODE = "+91";

let recaptchaVerifier: RecaptchaVerifier | null = null;
let confirmationResult: ConfirmationResult | null = null;

const getFirebaseAuth = () => {
  const app = initializeFirebaseApp();
  if (!app) throw new Error("Firebase is not configured.");
  return getAuth(app);
};

/**
 * Normalizes an Indian mobile number to 10 digits (strips +91, 91 prefix, spaces, dashes).
 */
export const normalizeMobile = (value: string): string => {
  const digits = value.replace(/\D+/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 13 && digits.startsWith("91")) return digits.slice(3);
  return digits;
};

/**
 * Validates that a mobile number is a valid 10-digit Indian number.
 */
export const isValidMobile = (mobile: string): boolean => /^[6-9]\d{9}$/.test(normalizeMobile(mobile));

/**
 * Sends an OTP to the given mobile number via Firebase Phone Auth.
 * Must be called with a visible recaptcha container div in the DOM.
 *
 * @param phoneNumber - 10-digit Indian mobile number (will be prefixed with +91)
 * @param recaptchaContainerId - DOM element ID for the invisible reCAPTCHA
 * @returns Promise that resolves when OTP is sent
 */
export const sendOtp = async (phoneNumber: string, recaptchaContainerId = "recaptcha-container"): Promise<void> => {
  const auth = getFirebaseAuth();
  const normalized = normalizeMobile(phoneNumber);
  if (!isValidMobile(normalized)) {
    throw new Error("Please enter a valid 10-digit mobile number.");
  }

  const fullNumber = `${COUNTRY_CODE}${normalized}`;

  // Clean up previous verifier
  if (recaptchaVerifier) {
    try { recaptchaVerifier.clear(); } catch { /* ignore */ }
    recaptchaVerifier = null;
  }

  const container = document.getElementById(recaptchaContainerId);
  if (!container) throw new Error("reCAPTCHA container not found.");

  recaptchaVerifier = new RecaptchaVerifier(auth, recaptchaContainerId, {
    size: "invisible",
    callback: () => { /* reCAPTCHA solved */ },
    "expired-callback": () => {
      throw new Error("reCAPTCHA expired. Please try again.");
    }
  });

  try {
    confirmationResult = await signInWithPhoneNumber(auth, fullNumber, recaptchaVerifier);
  } catch (err: unknown) {
    // Clean up verifier on failure
    if (recaptchaVerifier) {
      try { recaptchaVerifier.clear(); } catch { /* ignore */ }
      recaptchaVerifier = null;
    }

    const code = (err as { code?: string })?.code ?? "";
    if (code === "auth/too-many-requests") {
      throw new Error("Too many OTP requests. Please wait a few minutes and try again.");
    }
    if (code === "auth/invalid-phone-number") {
      throw new Error("Invalid phone number format. Please enter a valid 10-digit number.");
    }
    if (code === "auth/quota-exceeded") {
      throw new Error("SMS quota exceeded. Please try again later.");
    }
    if (code === "auth/network-request-failed") {
      throw new Error("Network error. Please check your connection and try again.");
    }
    throw new Error((err as Error)?.message ?? "Failed to send OTP. Please try again.");
  }
};

/**
 * Verifies the OTP entered by the user.
 *
 * @param otp - The 6-digit OTP code
 * @returns Promise that resolves to true on success
 */
export const verifyOtp = async (otp: string): Promise<boolean> => {
  if (!confirmationResult) {
    throw new Error("No OTP was sent. Please request a new OTP first.");
  }

  const trimmedOtp = otp.trim();
  if (!/^\d{6}$/.test(trimmedOtp)) {
    throw new Error("Please enter a valid 6-digit OTP.");
  }

  try {
    await confirmationResult.confirm(trimmedOtp);
    // Sign out immediately — we only needed phone verification, not Firebase session
    const auth = getFirebaseAuth();
    await auth.signOut();
    confirmationResult = null;
    return true;
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code ?? "";
    if (code === "auth/invalid-verification-code") {
      throw new Error("Invalid OTP. Please check the code and try again.");
    }
    if (code === "auth/code-expired") {
      throw new Error("OTP has expired. Please request a new one.");
    }
    if (code === "auth/network-request-failed") {
      throw new Error("Network error. Please check your connection and try again.");
    }
    throw new Error("OTP verification failed. Please try again.");
  }
};

/**
 * Resets the OTP state for a fresh attempt.
 */
export const resetOtpState = (): void => {
  if (recaptchaVerifier) {
    try { recaptchaVerifier.clear(); } catch { /* ignore */ }
    recaptchaVerifier = null;
  }
  confirmationResult = null;
};
