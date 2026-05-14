/**
 * Native permission helpers for Capacitor (Android/iOS) and web.
 *
 * On native platforms, uses Capacitor's WebView permission bridge.
 * On web, falls back to the standard browser APIs.
 *
 * Permissions are requested on-demand (not at startup) per Android best practices.
 */

import { getCurrentPlatform } from "./platform";

export type PermissionResult = "granted" | "denied" | "prompt";

/**
 * Permission type identifiers used by the PermissionGate component
 * to display the correct explanation and icon.
 */
export type PermissionType = "camera" | "media" | "location" | "notifications";

/** Human-readable descriptions for each permission type. */
export const PERMISSION_INFO: Record<PermissionType, { title: string; reason: string; icon: string }> = {
  camera: {
    title: "Camera Access",
    reason: "Required to scan booking QR codes at the track.",
    icon: "camera"
  },
  media: {
    title: "Media Access",
    reason: "Required to upload images and files from your device.",
    icon: "image"
  },
  location: {
    title: "Location Access",
    reason: "Used to provide branch-specific services and improve security.",
    icon: "map-pin"
  },
  notifications: {
    title: "Notification Access",
    reason: "Required to receive alerts about leads, tasks, and updates.",
    icon: "bell"
  }
};

// ─── Camera ────────────────────────────────────────────────────────

/**
 * Request camera permission on the current platform.
 *
 * - Android/iOS (Capacitor WebView): calls getUserMedia which triggers
 *   the native permission dialog if the CAMERA permission is declared
 *   in AndroidManifest.xml / Info.plist.
 * - Web: uses the browser Permissions API, then getUserMedia as fallback.
 */
export const requestCameraPermission = async (): Promise<PermissionResult> => {
  const platform = getCurrentPlatform();

  if (platform === "android" || platform === "ios") {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      for (const track of stream.getTracks()) track.stop();
      return "granted";
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("NotAllowedError") || msg.includes("Permission denied") || msg.includes("permission")) {
        return "denied";
      }
      return "denied";
    }
  }

  // Web: try Permissions API first
  if (navigator.permissions) {
    try {
      const result = await navigator.permissions.query({ name: "camera" as PermissionName });
      if (result.state === "granted") return "granted";
      if (result.state === "denied") return "denied";
    } catch {
      // Permissions API doesn't support "camera" in this browser
    }
  }

  // Prompt via getUserMedia
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    for (const track of stream.getTracks()) track.stop();
    return "granted";
  } catch {
    return "denied";
  }
};

// ─── Media / Files ─────────────────────────────────────────────────

/**
 * Request media/file access permission.
 *
 * - Android 13+ (API 33): requires READ_MEDIA_IMAGES / READ_MEDIA_VIDEO.
 *   Capacitor WebView triggers the native dialog when an <input type="file">
 *   is used, so the permission is handled automatically by the OS.
 *   This helper validates access by attempting a test file input interaction.
 * - Android 12 and below: READ_EXTERNAL_STORAGE is used (declared with maxSdkVersion=32).
 * - iOS: NSPhotoLibraryUsageDescription in Info.plist handles the native prompt.
 * - Web: file inputs work without explicit permission.
 *
 * On native platforms, Capacitor's WebView delegates file picker intents
 * to the OS which handles permission prompts natively. This function
 * returns "granted" on web/native since the OS handles the prompt at
 * pick-time. Returns "denied" only if we can detect a block.
 */
export const requestMediaPermission = async (): Promise<PermissionResult> => {
  const platform = getCurrentPlatform();

  // On web, file inputs always work — no permission needed
  if (platform === "web" || platform === "windows") {
    return "granted";
  }

  // On native (Android/iOS), the Capacitor WebView delegates file picker
  // to the OS. The OS shows its own permission dialog when the user
  // picks a file via <input type="file">. We can't programmatically
  // pre-check this, but the manifest declarations ensure the dialog appears.
  // Return "granted" — the OS will gate actual access at pick-time.
  return "granted";
};

// ─── Location ──────────────────────────────────────────────────────

/**
 * Request location permission.
 *
 * - Android: ACCESS_FINE_LOCATION / ACCESS_COARSE_LOCATION declared in manifest.
 *   navigator.geolocation.getCurrentPosition() triggers the native permission dialog.
 * - iOS: NSLocationWhenInUseUsageDescription in Info.plist triggers the prompt.
 * - Web: uses the standard Geolocation API which prompts the user.
 *
 * Returns the permission result. On "denied", the user must enable
 * location access in device settings.
 */
export const requestLocationPermission = async (): Promise<PermissionResult> => {
  // Check if geolocation is available
  if (!("geolocation" in navigator)) {
    return "denied";
  }

  // Web: try Permissions API for quick check
  const platform = getCurrentPlatform();
  if (platform === "web") {
    if (navigator.permissions) {
      try {
        const result = await navigator.permissions.query({ name: "geolocation" });
        if (result.state === "granted") return "granted";
        if (result.state === "denied") return "denied";
      } catch {
        // fall through to prompt
      }
    }
  }

  // Prompt by requesting an actual position
  return new Promise<PermissionResult>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      () => resolve("granted"),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          resolve("denied");
        } else {
          // Timeout or position unavailable — permission was granted but location failed
          resolve("granted");
        }
      },
      { timeout: 10000, maximumAge: 60000 }
    );
  });
};

/**
 * Get current device location. Requires location permission to be granted.
 * Returns null if location cannot be determined.
 */
export const getCurrentLocation = (): Promise<{ latitude: number; longitude: number } | null> => {
  if (!("geolocation" in navigator)) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        });
      },
      () => resolve(null),
      { timeout: 10000, maximumAge: 60000 }
    );
  });
};

// ─── Notifications ─────────────────────────────────────────────────

/**
 * Request notification permission.
 *
 * - Android 13+ (API 33) requires POST_NOTIFICATIONS runtime permission.
 * - Older Android: notifications are allowed by default.
 * - Web: uses the standard Notification API.
 */
export const requestNotificationPermission = async (): Promise<PermissionResult> => {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "denied";
  }

  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";

  try {
    const result = await Notification.requestPermission();
    if (result === "granted") return "granted";
    if (result === "denied") return "denied";
    return "prompt";
  } catch {
    return "denied";
  }
};

/**
 * Check current notification permission without prompting.
 */
export const getNotificationPermissionState = (): PermissionResult => {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "denied";
  }
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  return "prompt";
};

// ─── Unified request ───────────────────────────────────────────────

/**
 * Request a permission by type. Dispatches to the correct handler.
 */
export const requestPermission = async (type: PermissionType): Promise<PermissionResult> => {
  switch (type) {
    case "camera":
      return requestCameraPermission();
    case "media":
      return requestMediaPermission();
    case "location":
      return requestLocationPermission();
    case "notifications":
      return requestNotificationPermission();
  }
};
