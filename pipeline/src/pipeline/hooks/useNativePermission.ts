/**
 * useNativePermission — hook for requesting a native permission with
 * a pre-permission explanation gate on mobile platforms.
 *
 * Usage:
 *   const { gate, ensurePermission } = useNativePermission("camera");
 *
 *   // Call ensurePermission before opening the feature. On web it resolves
 *   // immediately. On native it shows the PermissionGate if needed.
 *   const handleOpenScanner = async () => {
 *     const granted = await ensurePermission();
 *     if (granted) openScanner();
 *   };
 *
 *   // Render the gate in JSX (renders null when not active)
 *   return <>{gate}</>;
 */

import { createElement, useCallback, useRef, useState } from "react";
import { getCurrentPlatform } from "../../lib/platform";
import { PermissionGate } from "../components/ui/PermissionGate";
import type { PermissionType } from "../../lib/native-permissions";

interface UseNativePermissionReturn {
  /** Render this in your JSX — shows the PermissionGate modal when active, null otherwise. */
  gate: ReturnType<typeof createElement> | null;
  /** Call this before accessing a feature that needs the permission. Resolves true if granted. */
  ensurePermission: () => Promise<boolean>;
}

export const useNativePermission = (type: PermissionType): UseNativePermissionReturn => {
  const [showGate, setShowGate] = useState(false);
  const resolveRef = useRef<((granted: boolean) => void) | null>(null);
  const platform = getCurrentPlatform();
  const isNative = platform === "android" || platform === "ios";

  const ensurePermission = useCallback((): Promise<boolean> => {
    // On web/desktop, permissions are handled by the browser at usage-time
    if (!isNative) {
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setShowGate(true);
    });
  }, [isNative]);

  const handleGranted = useCallback(() => {
    setShowGate(false);
    resolveRef.current?.(true);
    resolveRef.current = null;
  }, []);

  const handleClose = useCallback(() => {
    setShowGate(false);
    resolveRef.current?.(false);
    resolveRef.current = null;
  }, []);

  const gate = showGate
    ? createElement(PermissionGate, { type, onGranted: handleGranted, onClose: handleClose })
    : null;

  return { gate, ensurePermission };
};
