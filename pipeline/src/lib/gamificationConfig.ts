import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from './firebase'

export const GAMIFICATION_SETTINGS_COLLECTION = 'settings'
export const GAMIFICATION_SETTINGS_DOC_ID = 'gamification'

export const SOCIAL_FOLLOW_TASK_ID = 'follow-social-media'
export const SOCIAL_FOLLOW_TASK_NAME = 'Follow all A Square social media accounts'
export const SOCIAL_FOLLOW_TASK_REWARD = 10

export interface SocialMediaLink {
  platform: 'instagram' | 'facebook' | 'youtube'
  label: string
  url: string
}

export const SOCIAL_MEDIA_LINKS: SocialMediaLink[] = [
  { platform: 'instagram', label: 'Instagram', url: 'https://instagram.com/asquaregokarting' },
  { platform: 'facebook', label: 'Facebook', url: 'https://facebook.com/asquaregokarting' },
  { platform: 'youtube', label: 'YouTube', url: 'https://www.youtube.com/@asquaregokarting3851' },
]

export type DailyTaskActionType = 'generic' | 'share' | 'social_follow'
export type DailyTaskRewardType = 'tires' | 'wallet'

export interface GamificationDailyTask {
  id: string
  name: string
  reward: number
  rewardType: DailyTaskRewardType
  actionType: DailyTaskActionType
}

export interface GamificationAchievement {
  id: string
  name: string
  icon: string
  unlocked: boolean
}

export interface GamificationConfig {
  dailyTasks: GamificationDailyTask[]
  achievements: GamificationAchievement[]
}

export const defaultGamificationConfig: GamificationConfig = {
  dailyTasks: [
    {
      id: 'daily-checkin',
      name: 'Daily Check-in',
      reward: 50,
      rewardType: 'tires',
      actionType: 'generic',
    },
    {
      id: 'first-ride',
      name: 'First Ride of the Day',
      reward: 200,
      rewardType: 'tires',
      actionType: 'generic',
    },
    {
      id: 'invite-friend',
      name: 'Invite a Friend',
      reward: 500,
      rewardType: 'tires',
      actionType: 'share',
    },
    {
      id: 'puzzle',
      name: 'Play Pit Stop Puzzle',
      reward: 100,
      rewardType: 'tires',
      actionType: 'generic',
    },
  ],
  achievements: [
    { id: 'first-ride', name: 'First Ride', icon: 'ASQUARE_LOGO', unlocked: true },
    { id: 'speed-demon', name: 'Speed Demon', icon: '\u26A1', unlocked: true },
    { id: 'party-planner', name: 'Party Planner', icon: '\uD83C\uDF89', unlocked: false },
    { id: 'game-master', name: 'Game Master', icon: '\uD83C\uDFAE', unlocked: true },
    { id: 'loyal-racer', name: 'Loyal Racer', icon: '\uD83D\uDD11', unlocked: false },
    { id: 'referral-king', name: 'Referral King', icon: '\uD83E\uDD1D', unlocked: false },
  ],
}

const gamificationDocRef = doc(db, GAMIFICATION_SETTINGS_COLLECTION, GAMIFICATION_SETTINGS_DOC_ID)

const sanitizeTasks = (value: unknown): GamificationDailyTask[] => {
  if (!Array.isArray(value)) return defaultGamificationConfig.dailyTasks

  return value
    .map((task, index) => {
      if (!task || typeof task !== 'object') return null

      const rawTask = task as Partial<GamificationDailyTask>
      const name = typeof rawTask.name === 'string' ? rawTask.name.trim() : ''
      if (!name) return null

      const reward = Number(rawTask.reward)
      const actionType: DailyTaskActionType =
        rawTask.actionType === 'share'
          ? 'share'
          : rawTask.actionType === 'social_follow'
            ? 'social_follow'
            : 'generic'
      const rewardType: DailyTaskRewardType = rawTask.rewardType === 'wallet' ? 'wallet' : 'tires'
      const normalizedReward = Number.isFinite(reward) ? Math.max(0, Math.round(reward)) : 0

      return {
        id: typeof rawTask.id === 'string' && rawTask.id.trim() ? rawTask.id : `task-${index + 1}`,
        name,
        reward: actionType === 'social_follow' ? SOCIAL_FOLLOW_TASK_REWARD : normalizedReward,
        rewardType: actionType === 'social_follow' ? 'wallet' : rewardType,
        actionType,
      }
    })
    .filter((task): task is GamificationDailyTask => Boolean(task))
    .filter((task) => task.actionType !== 'social_follow')
}

const sanitizeAchievements = (value: unknown): GamificationAchievement[] => {
  if (!Array.isArray(value)) return defaultGamificationConfig.achievements

  return value
    .map((achievement, index) => {
      if (!achievement || typeof achievement !== 'object') return null

      const rawAchievement = achievement as Partial<GamificationAchievement>
      const name = typeof rawAchievement.name === 'string' ? rawAchievement.name.trim() : ''
      if (!name) return null

      const icon =
        typeof rawAchievement.icon === 'string' && rawAchievement.icon.trim()
          ? rawAchievement.icon
          : '\uD83C\uDFC6'

      return {
        id:
          typeof rawAchievement.id === 'string' && rawAchievement.id.trim()
            ? rawAchievement.id
            : `achievement-${index + 1}`,
        name,
        icon,
        unlocked: Boolean(rawAchievement.unlocked),
      }
    })
    .filter((achievement): achievement is GamificationAchievement => Boolean(achievement))
}

export const normalizeGamificationConfig = (value: unknown): GamificationConfig => {
  if (!value || typeof value !== 'object') return defaultGamificationConfig

  const rawValue = value as Partial<GamificationConfig>
  const dailyTasks = sanitizeTasks(rawValue.dailyTasks)
  const achievements = sanitizeAchievements(rawValue.achievements)

  return {
    dailyTasks: dailyTasks.length > 0 ? dailyTasks : defaultGamificationConfig.dailyTasks,
    achievements: achievements.length > 0 ? achievements : defaultGamificationConfig.achievements,
  }
}

export const getGamificationConfig = async (): Promise<GamificationConfig> => {
  const snapshot = await getDoc(gamificationDocRef)
  if (!snapshot.exists()) {
    return defaultGamificationConfig
  }

  return normalizeGamificationConfig(snapshot.data())
}

export const saveGamificationConfig = async (config: GamificationConfig): Promise<void> => {
  const normalized = normalizeGamificationConfig(config)
  await setDoc(
    gamificationDocRef,
    {
      ...normalized,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}
