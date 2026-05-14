import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/auth-context";
import { requestNotificationPermission, listenForForegroundMessages } from "./lead-notifications";

export const useLeadNotifications = () => {
  const { session } = useAuth();
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [latestNotification, setLatestNotification] = useState<{ title: string; body: string } | null>(null);

  const requestPermission = useCallback(async () => {
    if (!session?.user.id) return;
    const token = await requestNotificationPermission(session.user.id);
    setPermissionGranted(Boolean(token));
  }, [session?.user.id]);

  // Listen for foreground messages
  useEffect(() => {
    const unsubscribe = listenForForegroundMessages((payload) => {
      setLatestNotification(payload);
      // Auto-dismiss after 5s
      setTimeout(() => setLatestNotification(null), 5000);
    });
    return unsubscribe;
  }, []);

  return {
    permissionGranted,
    latestNotification,
    requestPermission,
    dismissNotification: () => setLatestNotification(null),
  };
};
