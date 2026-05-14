import { NotificationSound, UserNotificationSettings } from "../../api/types";

export type NotificationPreferenceState = UserNotificationSettings;
export type { NotificationSound };

export interface UserPreferenceState {
  defaultTabPath: string;
  compactDensity: boolean;
  emailDigest: boolean;
  notifications: NotificationPreferenceState;
}

export const defaultNotificationPreferences: NotificationPreferenceState = {
  sound: "soft",
  browserPushEnabled: false
};

export const createDefaultUserPreferences = (defaultTabPath: string): UserPreferenceState => ({
  defaultTabPath,
  compactDensity: false,
  emailDigest: true,
  notifications: defaultNotificationPreferences
});

export const getPreferenceStorageKey = (userId: string) => `pipeline-preferences:${userId}`;

export const loadUserPreferences = (userId: string, defaultTabPath: string): UserPreferenceState => {
  const raw = localStorage.getItem(getPreferenceStorageKey(userId));
  if (!raw) {
    return createDefaultUserPreferences(defaultTabPath);
  }

  try {
    const parsed = JSON.parse(raw) as Partial<UserPreferenceState> & {
      notifications?: Partial<NotificationPreferenceState>;
    };
    const normalizedSound = parsed.notifications?.sound;
    const sound: NotificationSound =
      normalizedSound === "chime" || normalizedSound === "bell" || normalizedSound === "off" || normalizedSound === "custom"
        ? normalizedSound
        : "soft";

    return {
      defaultTabPath: parsed.defaultTabPath || defaultTabPath,
      compactDensity: Boolean(parsed.compactDensity),
      emailDigest: parsed.emailDigest ?? true,
      notifications: {
        sound,
        browserPushEnabled: Boolean(parsed.notifications?.browserPushEnabled),
        customSoundDataUrl:
          typeof parsed.notifications?.customSoundDataUrl === "string" ? parsed.notifications.customSoundDataUrl : undefined
      }
    };
  } catch {
    return createDefaultUserPreferences(defaultTabPath);
  }
};

export const saveUserPreferences = (userId: string, value: UserPreferenceState) => {
  localStorage.setItem(getPreferenceStorageKey(userId), JSON.stringify(value));
};
