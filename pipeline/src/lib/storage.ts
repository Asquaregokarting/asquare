import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';

/**
 * Storage utility that uses Capacitor Preferences on native platforms
 * and localStorage on web. Capacitor Preferences persists even when
 * the app is killed on iOS/Android.
 */
export const storage = {
    async get(key: string): Promise<string | null> {
        if (Capacitor.isNativePlatform()) {
            const { value } = await Preferences.get({ key });
            return value;
        } else {
            return localStorage.getItem(key);
        }
    },

    async set(key: string, value: string): Promise<void> {
        if (Capacitor.isNativePlatform()) {
            await Preferences.set({ key, value });
        } else {
            localStorage.setItem(key, value);
        }
    },

    async remove(key: string): Promise<void> {
        if (Capacitor.isNativePlatform()) {
            await Preferences.remove({ key });
        } else {
            localStorage.removeItem(key);
        }
    },

    async clear(): Promise<void> {
        if (Capacitor.isNativePlatform()) {
            await Preferences.clear();
        } else {
            localStorage.clear();
        }
    }
};
