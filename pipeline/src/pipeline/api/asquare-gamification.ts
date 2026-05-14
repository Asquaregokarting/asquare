import {
  doc,
  getDoc,
  setDoc,
} from "firebase/firestore";
import { getAsquareFirestore } from "./asquare-firestore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DailyTask {
  id: string;
  name: string;
  reward: number;
  rewardType: "tires" | "wallet";
  actionType: "generic" | "share" | "social_follow";
}

export interface Achievement {
  id: string;
  name: string;
  icon: string;
  unlocked: boolean;
}

export interface GamificationConfig {
  dailyTasks: DailyTask[];
  achievements: Achievement[];
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export const asquareGamificationApi = {
  /**
   * Read the gamification configuration from `settings/gamification`.
   */
  async getConfig(): Promise<GamificationConfig> {
    const firestore = getAsquareFirestore();
    const snap = await getDoc(doc(firestore, "settings", "gamification"));

    if (!snap.exists()) {
      return { dailyTasks: [], achievements: [] };
    }

    const data = snap.data() as Record<string, unknown>;

    const dailyTasks: DailyTask[] = Array.isArray(data.dailyTasks)
      ? data.dailyTasks.map((raw: Record<string, unknown>) => ({
          id: String(raw.id ?? ""),
          name: String(raw.name ?? ""),
          reward: Number(raw.reward ?? 0),
          rewardType: raw.rewardType === "wallet" ? "wallet" : "tires",
          actionType:
            raw.actionType === "share"
              ? "share"
              : raw.actionType === "social_follow"
                ? "social_follow"
                : "generic",
        }))
      : [];

    const achievements: Achievement[] = Array.isArray(data.achievements)
      ? data.achievements.map((raw: Record<string, unknown>) => ({
          id: String(raw.id ?? ""),
          name: String(raw.name ?? ""),
          icon: String(raw.icon ?? ""),
          unlocked: Boolean(raw.unlocked),
        }))
      : [];

    return { dailyTasks, achievements };
  },

  /**
   * Save (merge) the gamification configuration to `settings/gamification`.
   */
  async saveConfig(config: Partial<GamificationConfig>): Promise<void> {
    const firestore = getAsquareFirestore();
    await setDoc(
      doc(firestore, "settings", "gamification"),
      config,
      { merge: true }
    );
  },
};
