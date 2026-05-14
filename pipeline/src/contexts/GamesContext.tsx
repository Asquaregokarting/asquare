/* eslint-disable react-refresh/only-export-components -- idiomatic context: provider + useGames hook co-located */
import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import type {
  GameScore,
  GameProgress,
  DailyChallenge,
  GameType,
  GameDifficulty,
  UserSpins,
  SpinResult,
  SpinSource,
} from '../types'
import { setWithExpiry, getWithExpiry } from '../lib/utils'
import { getRandomPrize } from '../data/spinPrizes'
import { useAuth } from './AuthContext'
import { db } from '../lib/firebase'
import {
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  increment,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore'
import { walletService } from '../services/walletService'
import { logger } from '../lib/logger'

interface GamesState {
  tires: number
  progress: GameProgress
  dailyChallenges: DailyChallenge | null
  recentScores: GameScore[]
  currentStreak: number
  isOffline: boolean
  pendingSync: GameScore[]
  spins: UserSpins
  gamesCompletedSinceLastSpin: number
}

type GamesAction =
  | { type: 'ADD_TIRES'; payload: number }
  | { type: 'SPEND_TIRES'; payload: number }
  | { type: 'ADD_SCORE'; payload: GameScore }
  | { type: 'UPDATE_PROGRESS'; payload: Partial<GameProgress> }
  | { type: 'SET_DAILY_CHALLENGES'; payload: DailyChallenge }
  | { type: 'COMPLETE_DAILY_GAME'; payload: { gameType: GameType; bonusTires: number } }
  | { type: 'UPDATE_STREAK'; payload: number }
  | { type: 'SET_OFFLINE'; payload: boolean }
  | { type: 'CLEAR_PENDING_SYNC' }
  | { type: 'LOAD_FROM_STORAGE'; payload: Partial<GamesState> }
  | { type: 'EARN_SPIN'; payload: { count: number; source: SpinSource } }
  | { type: 'USE_SPIN'; payload: SpinResult }
  | { type: 'INCREMENT_GAMES_COUNT' }
  | { type: 'RESET_GAMES_COUNT' }
  | { type: 'CLAIM_SPIN_PRIZE'; payload: string }

interface AddTiresIdempotentOptions {
  description?: string
  /** When supplied, the credit is deduplicated server-side via a deterministic
   *  audit doc ID. Use this for any reward that must NOT double-credit on
   *  retries (multi-tab, double-click, page reload between award and persist). */
  idempotencyKey: string
}

// Overloaded so the optimistic path stays synchronous (act() in tests can
// flush state without awaiting) while the idempotent path returns an
// awaitable result for callers that need to know whether the credit landed.
interface AddTires {
  (tires: number, streakBonus?: boolean): void
  (tires: number, streakBonus: boolean, options: AddTiresIdempotentOptions): Promise<boolean>
}

interface GamesContextType extends GamesState {
  addTires: AddTires
  spendTires: (tires: number) => boolean
  recordScore: (gameType: GameType, score: number, difficulty?: GameDifficulty) => void
  updateProgress: (update: Partial<GameProgress>) => void
  completeDailyGame: (gameType: GameType, bonusTires: number) => void
  canAfford: (cost: number) => boolean
  syncWithServer: () => Promise<void>
  earnSpin: (count: number, source: SpinSource) => void
  useSpin: () => SpinResult | null
  claimSpinPrize: (spinId: string) => void
}

const GamesContext = createContext<GamesContextType | null>(null)

const STORAGE_KEY = 'asquare_games_state'
const STREAK_BONUS_PERCENT = 10

const initialProgress: GameProgress = {
  puzzlesCompleted: 0,
  memoryGamesWon: 0,
  runnerHighScore: 0,
  triviaQuestionsAnswered: 0,
  currentStreak: 0,
  longestStreak: 0,
  lastPlayedAt: null,
}

const initialState: GamesState = {
  tires: 0,
  progress: initialProgress,
  dailyChallenges: null,
  recentScores: [],
  currentStreak: 0,
  isOffline: false,
  pendingSync: [],
  spins: {
    available: 0,
    total: 0,
    used: 0,
    history: [],
    lastEarnedAt: null,
  },
  gamesCompletedSinceLastSpin: 0,
}

function gamesReducer(state: GamesState, action: GamesAction): GamesState {
  switch (action.type) {
    case 'ADD_TIRES':
      return { ...state, tires: state.tires + action.payload }

    case 'SPEND_TIRES':
      return { ...state, tires: Math.max(0, state.tires - action.payload) }

    case 'ADD_SCORE': {
      const newScores = [action.payload, ...state.recentScores].slice(0, 50)
      const pendingSync = state.isOffline
        ? [...state.pendingSync, action.payload]
        : state.pendingSync
      return { ...state, recentScores: newScores, pendingSync }
    }

    case 'UPDATE_PROGRESS':
      return {
        ...state,
        progress: { ...state.progress, ...action.payload, lastPlayedAt: new Date() },
      }

    case 'SET_DAILY_CHALLENGES':
      return { ...state, dailyChallenges: action.payload }

    case 'COMPLETE_DAILY_GAME': {
      if (!state.dailyChallenges) return state
      const updatedChallenges = { ...state.dailyChallenges }
      // Mark as completed if all games done
      const allCompleted = updatedChallenges.games.every(
        (g) => g.gameType === action.payload.gameType || g.bonusTires === 0,
      )
      if (allCompleted) {
        updatedChallenges.completed = true
      }
      return {
        ...state,
        dailyChallenges: updatedChallenges,
        tires: state.tires + action.payload.bonusTires,
      }
    }

    case 'UPDATE_STREAK': {
      const newStreak = action.payload
      const longestStreak = Math.max(state.progress.longestStreak, newStreak)
      return {
        ...state,
        currentStreak: newStreak,
        progress: { ...state.progress, currentStreak: newStreak, longestStreak },
      }
    }

    case 'SET_OFFLINE':
      return { ...state, isOffline: action.payload }

    case 'CLEAR_PENDING_SYNC':
      return { ...state, pendingSync: [] }

    case 'LOAD_FROM_STORAGE':
      return { ...state, ...action.payload }

    case 'EARN_SPIN':
      return {
        ...state,
        spins: {
          ...state.spins,
          available: state.spins.available + action.payload.count,
          total: state.spins.total + action.payload.count,
          lastEarnedAt: new Date(),
        },
      }

    case 'USE_SPIN':
      return {
        ...state,
        spins: {
          ...state.spins,
          available: Math.max(0, state.spins.available - 1),
          used: state.spins.used + 1,
          history: [action.payload, ...state.spins.history].slice(0, 50),
        },
      }

    case 'INCREMENT_GAMES_COUNT':
      return {
        ...state,
        gamesCompletedSinceLastSpin: state.gamesCompletedSinceLastSpin + 1,
      }

    case 'RESET_GAMES_COUNT':
      return {
        ...state,
        gamesCompletedSinceLastSpin: 0,
      }

    case 'CLAIM_SPIN_PRIZE': {
      const updatedHistory = state.spins.history.map((spin) =>
        spin.id === action.payload ? { ...spin, claimed: true } : spin,
      )
      return {
        ...state,
        spins: { ...state.spins, history: updatedHistory },
      }
    }

    default:
      return state
  }
}

export function GamesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [state, dispatch] = useReducer(gamesReducer, initialState)

  // Load from local storage on mount
  useEffect(() => {
    const saved = getWithExpiry<Partial<GamesState>>(STORAGE_KEY)
    if (saved) {
      dispatch({ type: 'LOAD_FROM_STORAGE', payload: saved })
    }

    // Listen for online/offline status
    const handleOnline = () => dispatch({ type: 'SET_OFFLINE', payload: false })
    const handleOffline = () => dispatch({ type: 'SET_OFFLINE', payload: true })

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    dispatch({ type: 'SET_OFFLINE', payload: !navigator.onLine })

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  // Sync tires and progress from Firestore with real-time updates
  useEffect(() => {
    if (!user?.id) return

    const userRef = doc(db, 'users', user.id)
    const unsubscribe = onSnapshot(
      userRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const userData = snapshot.data()
          const payload: Partial<GamesState> = {
            tires: userData.tires || 0,
            progress: userData.progress || initialProgress,
            currentStreak: userData.currentStreak || 0,
          }
          // Hydrate spins from Firestore if available
          if (userData.spins) {
            payload.spins = {
              available: userData.spins.available ?? 0,
              total: userData.spins.total ?? 0,
              used: userData.spins.used ?? 0,
              history: state.spins.history, // Keep local history (not stored in user doc)
              lastEarnedAt: userData.spins.lastEarnedAt?.toDate?.() ?? null,
            }
          }
          if (typeof userData.gamesCompletedSinceLastSpin === 'number') {
            payload.gamesCompletedSinceLastSpin = userData.gamesCompletedSinceLastSpin
          }
          dispatch({ type: 'LOAD_FROM_STORAGE', payload })
        } else {
          // Initialize user in Firestore if not exists
          setDoc(userRef, {
            tires: 0,
            progress: initialProgress,
            currentStreak: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }).catch((err) => logger.error('games.user_init_failed', err))
        }
      },
      (error) => {
        logger.error('games.sync_failed', error)
      },
    )

    return () => unsubscribe()
  }, [user?.id])

  // Save to local storage on state change.
  // Previously this fired on EVERY reducer dispatch (and every Firestore
  // snapshot during gameplay), causing render-blocking JSON.stringify +
  // synchronous localStorage writes per frame. We now debounce to 500ms so
  // bursty gameplay events coalesce into a single write.
  const persistTimerRef = useRef<number | null>(null)
  useEffect(() => {
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current)
    }
    persistTimerRef.current = window.setTimeout(() => {
      const toSave = {
        tires: state.tires,
        progress: state.progress,
        recentScores: state.recentScores.slice(0, 20),
        currentStreak: state.currentStreak,
        pendingSync: state.pendingSync,
      }
      setWithExpiry(STORAGE_KEY, toSave, 1000 * 60 * 60 * 24 * 30) // 30 days
      persistTimerRef.current = null
    }, 500)
    return () => {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current)
        persistTimerRef.current = null
      }
    }
  }, [state.tires, state.progress, state.recentScores, state.currentStreak, state.pendingSync])

  // Check and update streak
  useEffect(() => {
    const lastPlayed = state.progress.lastPlayedAt
    if (!lastPlayed) return

    const lastPlayedDate = new Date(lastPlayed)
    const today = new Date()
    const diffDays = Math.floor(
      (today.getTime() - lastPlayedDate.getTime()) / (1000 * 60 * 60 * 24),
    )

    if (diffDays === 0) {
      // Same day, streak continues
    } else if (diffDays === 1) {
      // Next day, increment streak
      dispatch({ type: 'UPDATE_STREAK', payload: state.currentStreak + 1 })
    } else if (diffDays > 1) {
      // Streak broken
      dispatch({ type: 'UPDATE_STREAK', payload: 0 })
    }
  }, [state.progress.lastPlayedAt, state.currentStreak])

  // Daily Login Spin logic - Now correctly awards after login
  useEffect(() => {
    if (!user) return // Don't award if not logged in

    const LAST_LOGIN_SPIN_KEY = `asquare_last_login_spin_${user.id}`
    const today = new Date().toDateString()
    const lastLoginSpin = localStorage.getItem(LAST_LOGIN_SPIN_KEY)

    if (lastLoginSpin !== today) {
      // Award daily login spin
      dispatch({ type: 'EARN_SPIN', payload: { count: 1, source: 'daily_login' } })
      localStorage.setItem(LAST_LOGIN_SPIN_KEY, today)
      logger.info('games.daily_login_spin_awarded', { displayName: user.displayName })
    }
  }, [user])

  const addTires = useCallback(
    ((
      tires: number,
      streakBonus: boolean = true,
      options?: AddTiresIdempotentOptions,
    ): Promise<boolean> | void => {
      let finalTires = tires
      if (streakBonus && state.currentStreak > 0) {
        const bonus = Math.floor(tires * (STREAK_BONUS_PERCENT / 100) * state.currentStreak)
        finalTires += Math.min(bonus, tires) // Cap bonus at 100% of base
      }

      const description =
        options?.description ??
        (streakBonus && state.currentStreak > 0
          ? `Earned from Gameplay (incl. x${state.currentStreak} Streak Bonus)`
          : 'Earned from Gameplay')

      // Idempotent path — credit FIRST, dispatch only on success. Awaitable
      // by callers so a failed credit does NOT inflate the local total under
      // retry. Used by daily-task rewards in Profile.tsx.
      if (options?.idempotencyKey) {
        if (!user) return Promise.resolve(false)
        return walletService
          .creditTires(user.id, finalTires, description, options.idempotencyKey)
          .then((ok) => {
            if (!ok) {
              logger.error('games.sync_tires_failed', new Error('creditTires returned false'), {
                idempotencyKey: options.idempotencyKey,
              })
              return false
            }
            dispatch({ type: 'ADD_TIRES', payload: finalTires })
            return true
          })
      }

      // Optimistic path — game/spin UX needs immediate feedback. Synchronous
      // dispatch + fire-and-forget Firestore write with rollback on failure.
      // Returns void so act()-based tests can flush updates without awaiting.
      dispatch({ type: 'ADD_TIRES', payload: finalTires })

      if (user) {
        walletService
          .creditTires(user.id, finalTires, description)
          .then((ok) => {
            if (!ok) {
              dispatch({ type: 'ADD_TIRES', payload: -finalTires })
              logger.error('games.sync_tires_failed', new Error('creditTires returned false'))
            }
          })
          .catch((err) => logger.error('games.sync_tires_failed', err))
      }
    }) as AddTires,
    [state.currentStreak, user],
  )

  const spendTires = useCallback(
    (tires: number): boolean => {
      if (state.tires < tires) return false
      dispatch({ type: 'SPEND_TIRES', payload: tires })

      // Sync to Firestore
      if (user) {
        updateDoc(doc(db, 'users', user.id), {
          tires: increment(-tires),
          updatedAt: serverTimestamp(),
        }).catch((err) => logger.error('games.sync_tire_deduction_failed', err))

        // Log Transaction
        walletService.logTireTransaction(user.id, tires, 'Redeemed for Reward', 'tire_debit')
      }
      return true
    },
    [state.tires, user],
  )

  const recordScore = useCallback(
    (gameType: GameType, score: number, difficulty?: GameDifficulty) => {
      const gameScore: GameScore = {
        id: crypto.randomUUID(),
        gameType,
        difficulty,
        score,
        playedAt: new Date(),
      }
      dispatch({ type: 'ADD_SCORE', payload: gameScore })

      // Update progress based on game type
      const progressUpdate: Partial<GameProgress> = {}
      switch (gameType) {
        case 'puzzle':
          progressUpdate.puzzlesCompleted = state.progress.puzzlesCompleted + 1
          break
        case 'memory':
          progressUpdate.memoryGamesWon = state.progress.memoryGamesWon + 1
          break
        case 'runner':
          if (score > state.progress.runnerHighScore) {
            progressUpdate.runnerHighScore = score
          }
          break
        case 'trivia':
          progressUpdate.triviaQuestionsAnswered = state.progress.triviaQuestionsAnswered + 1
          break
      }
      dispatch({ type: 'UPDATE_PROGRESS', payload: progressUpdate })

      // Persist progress so leaderboard can use real score + last played time.
      if (user && Object.keys(progressUpdate).length > 0) {
        setDoc(
          doc(db, 'users', user.id),
          {
            progress: {
              ...state.progress,
              ...progressUpdate,
              lastPlayedAt: Timestamp.fromDate(new Date()),
            },
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        ).catch((err) => logger.error('games.sync_progress_failed', err))
      }

      // Calculate tires based on score and difficulty
      let baseTires = Math.floor(score / 10)
      if (difficulty === 'medium') baseTires *= 1.5
      if (difficulty === 'hard') baseTires *= 2
      void addTires(Math.max(10, Math.min(100, baseTires)))

      // Track games for spin earning (1 spin per 3 games)
      if (gameType !== 'spin') {
        if (state.gamesCompletedSinceLastSpin >= 2) {
          // Award a spin after every 3 games and reset counter
          dispatch({ type: 'EARN_SPIN', payload: { count: 1, source: 'game_completion' } })
          dispatch({ type: 'RESET_GAMES_COUNT' })
        } else {
          dispatch({ type: 'INCREMENT_GAMES_COUNT' })
        }
      }
    },
    [addTires, state.progress, state.gamesCompletedSinceLastSpin, user],
  )

  const updateProgress = useCallback((update: Partial<GameProgress>) => {
    dispatch({ type: 'UPDATE_PROGRESS', payload: update })
  }, [])

  const completeDailyGame = useCallback((gameType: GameType, bonusTires: number) => {
    dispatch({ type: 'COMPLETE_DAILY_GAME', payload: { gameType, bonusTires } })
  }, [])

  const canAfford = useCallback((cost: number): boolean => state.tires >= cost, [state.tires])

  const syncWithServer = useCallback(async () => {
    if (state.pendingSync.length === 0 || !user?.id) return

    try {
      const userRef = doc(db, 'users', user.id)

      // Batch write pending scores to the user's game_scores subcollection
      const { collection: firestoreCollection, addDoc: firestoreAddDoc } =
        await import('firebase/firestore')
      const scoresRef = firestoreCollection(db, 'users', user.id, 'game_scores')

      // Write each pending score
      for (const score of state.pendingSync) {
        await firestoreAddDoc(scoresRef, {
          ...score,
          playedAt:
            score.playedAt instanceof Date ? Timestamp.fromDate(score.playedAt) : score.playedAt,
          syncedAt: serverTimestamp(),
        })
      }

      // Sync current spins state to user doc
      await setDoc(
        userRef,
        {
          spins: {
            available: state.spins.available,
            total: state.spins.total,
            used: state.spins.used,
            lastEarnedAt: state.spins.lastEarnedAt
              ? Timestamp.fromDate(new Date(state.spins.lastEarnedAt))
              : null,
          },
          gamesCompletedSinceLastSpin: state.gamesCompletedSinceLastSpin,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      )

      dispatch({ type: 'CLEAR_PENDING_SYNC' })
    } catch (error) {
      logger.error('games.server_sync_failed', error)
    }
  }, [state.pendingSync, state.spins, state.gamesCompletedSinceLastSpin, user])

  // Spin methods
  const earnSpin = useCallback((count: number, source: SpinSource) => {
    dispatch({ type: 'EARN_SPIN', payload: { count, source } })
  }, [])

  const useSpin = useCallback((): SpinResult | null => {
    if (state.spins.available <= 0) return null

    const prize = getRandomPrize()
    const result: SpinResult = {
      id: crypto.randomUUID(),
      prize,
      spunAt: new Date(),
      source: 'game_completion', // Will be tracked by how spin was earned
      claimed: false,
    }

    dispatch({ type: 'USE_SPIN', payload: result })
    return result
  }, [state.spins.available])

  const claimSpinPrize = useCallback(
    (spinId: string) => {
      const spinResult = state.spins.history.find((s) => s.id === spinId)
      if (!spinResult || spinResult.claimed) return

      // Apply prize rewards
      if (spinResult.prize.type === 'tires') {
        void addTires(spinResult.prize.value, false)
      }
      // For other prize types (discount, freebie, addon), they would be stored in user profile
      // and applied during booking/redemption

      dispatch({ type: 'CLAIM_SPIN_PRIZE', payload: spinId })
    },
    [state.spins.history, addTires],
  )

  // Sync when coming back online
  useEffect(() => {
    if (!state.isOffline && state.pendingSync.length > 0) {
      syncWithServer()
    }
  }, [state.isOffline, state.pendingSync.length, syncWithServer])

  // Memoize the provider value so consumers (PlayAndWin, SpinAndWin, MyBookings,
  // Profile) only re-render when state or one of the action callbacks change.
  const value = useMemo<GamesContextType>(
    () => ({
      ...state,
      addTires,
      spendTires,
      recordScore,
      updateProgress,
      completeDailyGame,
      canAfford,
      syncWithServer,
      earnSpin,
      useSpin,
      claimSpinPrize,
    }),
    [
      state,
      addTires,
      spendTires,
      recordScore,
      updateProgress,
      completeDailyGame,
      canAfford,
      syncWithServer,
      earnSpin,
      useSpin,
      claimSpinPrize,
    ],
  )

  return <GamesContext.Provider value={value}>{children}</GamesContext.Provider>
}

export function useGames() {
  const context = useContext(GamesContext)
  if (!context) {
    throw new Error('useGames must be used within a GamesProvider')
  }
  return context
}
