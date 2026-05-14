import { useCallback, useEffect, useRef, useState } from 'react'
import SEO from '../components/SEO'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ChevronLeft,
  ChevronRight,
  Disc,
  Flame,
  Gamepad2,
  Heart,
  Loader2,
  Sparkles,
  Trophy,
} from 'lucide-react'
import * as THREE from 'three'
import { useGames } from '../contexts/GamesContext'
import { useAuth } from '../contexts/AuthContext'
import { leaderboardService } from '../services/leaderboardService'
import { logger } from '../lib/logger'
import type { GameType } from '../types'

const RUNNER_BEST_KEY = 'asquare_runner_best_score'
const COIN_TO_TIRE_RATE = 0.1
const LANE_X = [-2.4, 0, 2.4] as const

type LaneIndex = 0 | 1 | 2
type LeaderboardPeriod = 'weekly' | 'monthly' | 'all'

interface LeaderboardRow {
  userId: string
  userName: string
  score: number
  rank: number
  level: number
}

type PlayGame = {
  id: GameType
  name: string
  description: string
  icon: typeof Gamepad2
  color: string
  tires: string
  levels: string | null
  route?: string
}

const games: PlayGame[] = [
  {
    id: 'runner',
    name: '3D Kart Dash',
    description: 'Three.js lane runner with obstacles and collectible rings',
    icon: Gamepad2,
    color: 'from-cyan-500 to-blue-600',
    tires: 'Score to earn tires',
    levels: '3D',
  },
  {
    id: 'spin',
    name: 'Spin the Wheel',
    description: 'Lucky wheel with prizes',
    icon: Sparkles,
    color: 'from-yellow-500 to-orange-500',
    tires: 'Prizes vary',
    levels: null,
    route: '/spin-and-win',
  },
]

function disposeMesh(mesh: THREE.Mesh) {
  mesh.geometry.dispose()
  if (Array.isArray(mesh.material)) {
    mesh.material.forEach((material) => material.dispose())
  } else {
    mesh.material.dispose()
  }
}

const buildLeaderboardRows = (
  entries: Array<{ userId: string; userName: string; score: number }>,
): LeaderboardRow[] => {
  const sorted = entries
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score
      return a.userName.localeCompare(b.userName)
    })

  return sorted.map((entry, index) => ({
    userId: entry.userId,
    userName: entry.userName,
    score: entry.score,
    rank: index + 1,
    level: Math.max(1, Math.floor(entry.score / 900) + 1),
  }))
}

export default function PlayAndWin() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { tires, currentStreak, spins, recordScore, addTires } = useGames()

  const [activeTab, setActiveTab] = useState<'games' | 'leaderboard'>('games')
  const [leaderboardPeriod, setLeaderboardPeriod] = useState<LeaderboardPeriod>('weekly')
  const [leaderboards, setLeaderboards] = useState<Record<LeaderboardPeriod, LeaderboardRow[]>>({
    weekly: [],
    monthly: [],
    all: [],
  })
  const [leaderboardLoading, setLeaderboardLoading] = useState(false)
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null)

  const [runnerReady, setRunnerReady] = useState(false)
  const [runnerRunning, setRunnerRunning] = useState(false)
  const [runnerScore, setRunnerScore] = useState(0)
  const [runnerCoins, setRunnerCoins] = useState(0)
  const [lastCoinTires, setLastCoinTires] = useState(0)
  const [runnerHealth, setRunnerHealth] = useState(3)
  const [coinPulse, setCoinPulse] = useState(false)
  const [recentCoinBonus, setRecentCoinBonus] = useState<number | null>(null)
  const [bonusAnimationKey, setBonusAnimationKey] = useState(0)
  const [runnerError, setRunnerError] = useState<string | null>(null)
  const [runnerInitToken, setRunnerInitToken] = useState(0)
  const [laneIndex, setLaneIndex] = useState<LaneIndex>(1)
  const [runnerBest, setRunnerBest] = useState(() => {
    if (typeof window === 'undefined') return 0
    const stored = Number(window.localStorage.getItem(RUNNER_BEST_KEY) || '0')
    return Number.isFinite(stored) ? stored : 0
  })

  const runnerContainerRef = useRef<HTMLDivElement | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const playerRef = useRef<THREE.Group | null>(null)
  const roadDashesRef = useRef<THREE.Mesh[]>([])
  const obstaclesRef = useRef<THREE.Mesh[]>([])
  const coinsRef = useRef<THREE.Mesh[]>([])
  const frameRef = useRef<number | null>(null)

  const laneIndexRef = useRef<LaneIndex>(1)
  const scoreDisplayRef = useRef(0)
  const coinCountRef = useRef(0)
  const bestScoreRef = useRef(runnerBest)
  const submittedScoreRef = useRef(false)
  const coinPulseTimeoutRef = useRef<number | null>(null)
  const bonusTimeoutRef = useRef<number | null>(null)

  const runnerStateRef = useRef({
    running: false,
    score: 0,
    speed: 12,
    health: 3,
    obstacleSpawnTimer: 0,
    coinSpawnTimer: 0,
    hitCooldown: 0,
    lastTimestamp: 0,
  })

  const endRunnerRef = useRef<(finalScore: number) => void>(() => {})

  useEffect(() => {
    bestScoreRef.current = runnerBest
  }, [runnerBest])

  useEffect(() => {
    laneIndexRef.current = laneIndex
  }, [laneIndex])

  useEffect(() => {
    endRunnerRef.current = (finalScore: number) => {
      const roundedScore = Math.max(0, Math.floor(finalScore))
      runnerStateRef.current.running = false
      setRunnerRunning(false)
      setRunnerScore(roundedScore)

      if (submittedScoreRef.current) return
      submittedScoreRef.current = true

      const convertedTires = Number((coinCountRef.current * COIN_TO_TIRE_RATE).toFixed(1))
      if (convertedTires > 0) {
        void addTires(convertedTires, false)
      }
      setLastCoinTires(convertedTires)

      recordScore('runner', roundedScore, 'easy')

      if (roundedScore > bestScoreRef.current) {
        bestScoreRef.current = roundedScore
        setRunnerBest(roundedScore)
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(RUNNER_BEST_KEY, String(roundedScore))
        }
      }
    }
  }, [recordScore, addTires])

  useEffect(() => {
    return () => {
      if (coinPulseTimeoutRef.current !== null) {
        window.clearTimeout(coinPulseTimeoutRef.current)
      }
      if (bonusTimeoutRef.current !== null) {
        window.clearTimeout(bonusTimeoutRef.current)
      }
    }
  }, [])

  const getPlayerBodyMaterial = () => {
    const player = playerRef.current
    if (!player) return null

    const bodyMesh = player.children.find(
      (child): child is THREE.Mesh => child instanceof THREE.Mesh,
    )
    if (!bodyMesh) return null

    const material = bodyMesh.material
    if (Array.isArray(material)) {
      return material[0] as THREE.MeshStandardMaterial
    }
    return material as THREE.MeshStandardMaterial
  }

  const clearDynamicObjects = () => {
    const scene = sceneRef.current
    if (!scene) return

    obstaclesRef.current.forEach((mesh) => {
      scene.remove(mesh)
      disposeMesh(mesh)
    })
    obstaclesRef.current = []

    coinsRef.current.forEach((mesh) => {
      scene.remove(mesh)
      disposeMesh(mesh)
    })
    coinsRef.current = []
  }

  const startRunner = () => {
    if (!runnerReady || !sceneRef.current || !playerRef.current) return

    clearDynamicObjects()

    runnerStateRef.current = {
      running: true,
      score: 0,
      speed: 12,
      health: 3,
      obstacleSpawnTimer: 0,
      coinSpawnTimer: 0,
      hitCooldown: 0,
      lastTimestamp: performance.now(),
    }

    submittedScoreRef.current = false
    scoreDisplayRef.current = 0
    if (coinPulseTimeoutRef.current !== null) {
      window.clearTimeout(coinPulseTimeoutRef.current)
      coinPulseTimeoutRef.current = null
    }
    if (bonusTimeoutRef.current !== null) {
      window.clearTimeout(bonusTimeoutRef.current)
      bonusTimeoutRef.current = null
    }

    setRunnerRunning(true)
    setRunnerScore(0)
    setRunnerCoins(0)
    coinCountRef.current = 0
    setRunnerHealth(3)
    setCoinPulse(false)
    setRecentCoinBonus(null)
    setLastCoinTires(0)
    setLaneIndex(1)
    laneIndexRef.current = 1

    const player = playerRef.current
    player.position.x = 0
    player.rotation.z = 0

    const bodyMaterial = getPlayerBodyMaterial()
    bodyMaterial?.color.set('#06b6d4')
  }

  const moveLeft = () => {
    setLaneIndex((current) => (current > 0 ? ((current - 1) as LaneIndex) : current))
  }

  const moveRight = () => {
    setLaneIndex((current) => (current < 2 ? ((current + 1) as LaneIndex) : current))
  }

  const handlePlayGame = (game: PlayGame) => {
    if (game.id === 'runner') {
      startRunner()
      return
    }

    if (game.route) {
      navigate(game.route)
    }
  }

  const loadLeaderboards = useCallback(async () => {
    setLeaderboardLoading(true)
    setLeaderboardError(null)

    try {
      const { weekly, monthly, all } = await leaderboardService.getRunnerLeaderboards()
      setLeaderboards({
        weekly: buildLeaderboardRows(weekly),
        monthly: buildLeaderboardRows(monthly),
        all: buildLeaderboardRows(all),
      })
    } catch (loadError) {
      logger.error('play_and_win.leaderboard_failed', loadError)
      setLeaderboardError('Failed to load leaderboard. Pull to refresh and try again.')
    } finally {
      setLeaderboardLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'leaderboard') {
      void loadLeaderboards()
    }
  }, [activeTab, loadLeaderboards])

  useEffect(() => {
    if (activeTab !== 'games') {
      runnerStateRef.current.running = false
      setRunnerRunning(false)
      return
    }

    const container = runnerContainerRef.current
    if (!container) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x030712)
    scene.fog = new THREE.Fog(0x030712, 18, 86)

    const initialRect = container.getBoundingClientRect()
    const initialWidth = Math.max(1, initialRect.width || container.clientWidth || 1)
    const initialHeight = Math.max(1, initialRect.height || container.clientHeight || 1)

    const camera = new THREE.PerspectiveCamera(58, initialWidth / initialHeight, 0.1, 140)
    camera.position.set(0, 5.2, 8.8)
    camera.lookAt(0, 0.6, -8)

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      })
    } catch (error) {
      logger.error('play_and_win.3d_renderer_init_failed', error)
      setRunnerError('Unable to initialize 3D renderer on this device/browser.')
      setRunnerReady(false)
      return
    }

    setRunnerError(null)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(initialWidth, initialHeight)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    container.appendChild(renderer.domElement)

    const ambient = new THREE.AmbientLight(0xffffff, 0.65)
    scene.add(ambient)

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.05)
    keyLight.position.set(4, 12, 8)
    keyLight.castShadow = true
    keyLight.shadow.mapSize.set(1024, 1024)
    scene.add(keyLight)

    const fillLight = new THREE.PointLight(0x38bdf8, 0.9, 50)
    fillLight.position.set(-5, 4, 6)
    scene.add(fillLight)

    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(11, 92),
      new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.94, metalness: 0.08 }),
    )
    road.rotation.x = -Math.PI / 2
    road.position.set(0, 0, -34)
    road.receiveShadow = true
    scene.add(road)

    const borderMaterial = new THREE.MeshStandardMaterial({
      color: 0x1f2937,
      roughness: 0.75,
      metalness: 0.2,
    })
    const borderLeft = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 92), borderMaterial)
    borderLeft.position.set(-5.4, 0.2, -34)
    scene.add(borderLeft)

    const borderRight = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 92), borderMaterial)
    borderRight.position.set(5.4, 0.2, -34)
    scene.add(borderRight)

    const laneDashMaterial = new THREE.MeshStandardMaterial({
      color: 0x334155,
      emissive: 0x111827,
      roughness: 0.45,
    })
    for (let i = 0; i < 30; i += 1) {
      const z = -i * 3.2

      const dashLeft = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 1.6), laneDashMaterial)
      dashLeft.position.set(-1.2, 0.03, z)
      scene.add(dashLeft)
      roadDashesRef.current.push(dashLeft)

      const dashRight = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 1.6), laneDashMaterial)
      dashRight.position.set(1.2, 0.03, z)
      scene.add(dashRight)
      roadDashesRef.current.push(dashRight)
    }

    const kart = new THREE.Group()

    const kartBody = new THREE.Mesh(
      new THREE.BoxGeometry(1.35, 0.45, 2.1),
      new THREE.MeshStandardMaterial({ color: 0x06b6d4, roughness: 0.28, metalness: 0.62 }),
    )
    kartBody.position.y = 0.38
    kartBody.castShadow = true
    kart.add(kartBody)

    const kartCabin = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.35, 0.95),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.45, metalness: 0.2 }),
    )
    kartCabin.position.set(0, 0.72, 0.08)
    kartCabin.castShadow = true
    kart.add(kartCabin)

    const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x020617, roughness: 0.9 })
    ;[
      [-0.62, 0.17, 0.68],
      [0.62, 0.17, 0.68],
      [-0.62, 0.17, -0.68],
      [0.62, 0.17, -0.68],
    ].forEach(([x, y, z]) => {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.2, 16), wheelMaterial)
      wheel.rotation.z = Math.PI / 2
      wheel.position.set(x, y, z)
      wheel.castShadow = true
      kart.add(wheel)
    })

    kart.position.set(0, 0, 2.3)
    scene.add(kart)

    sceneRef.current = scene
    playerRef.current = kart
    setRunnerReady(true)

    const spawnObstacle = () => {
      const laneX = LANE_X[Math.floor(Math.random() * LANE_X.length)]
      const obstacle = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 1.2, 1.2),
        new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.62, metalness: 0.2 }),
      )
      obstacle.position.set(laneX, 0.64, -58)
      obstacle.castShadow = true
      scene.add(obstacle)
      obstaclesRef.current.push(obstacle)
    }

    const spawnCoin = () => {
      const laneX = LANE_X[Math.floor(Math.random() * LANE_X.length)]
      const coin = new THREE.Mesh(
        new THREE.TorusGeometry(0.45, 0.14, 14, 28),
        new THREE.MeshStandardMaterial({
          color: 0xfacc15,
          emissive: 0x78350f,
          roughness: 0.3,
          metalness: 0.75,
        }),
      )
      coin.position.set(laneX, 0.95, -56 - Math.random() * 6)
      coin.rotation.x = Math.PI / 2
      scene.add(coin)
      coinsRef.current.push(coin)
    }

    const animate = (timestamp: number) => {
      frameRef.current = window.requestAnimationFrame(animate)

      const player = playerRef.current
      const game = runnerStateRef.current
      const delta =
        game.lastTimestamp > 0 ? Math.min((timestamp - game.lastTimestamp) / 1000, 0.05) : 0.016
      game.lastTimestamp = timestamp

      const laneMotionSpeed = game.running ? game.speed * 2.3 : 10
      roadDashesRef.current.forEach((dash) => {
        dash.position.z += laneMotionSpeed * delta
        if (dash.position.z > 10) {
          dash.position.z -= 96
        }
      })

      if (player) {
        const targetLaneX = LANE_X[laneIndexRef.current]
        player.position.x = THREE.MathUtils.lerp(player.position.x, targetLaneX, delta * 15)
        const targetTilt = (targetLaneX - player.position.x) * -0.12
        player.rotation.z = THREE.MathUtils.lerp(player.rotation.z, targetTilt, delta * 10)
      }

      if (game.running && player) {
        game.speed = Math.min(29, game.speed + delta * 0.95)
        game.score += delta * (18 + game.speed * 1.4)

        const roundedScore = Math.floor(game.score)
        if (roundedScore !== scoreDisplayRef.current) {
          scoreDisplayRef.current = roundedScore
          setRunnerScore(roundedScore)
        }

        game.obstacleSpawnTimer += delta
        game.coinSpawnTimer += delta

        const obstacleInterval = Math.max(0.33, 0.9 - game.speed * 0.016)
        if (game.obstacleSpawnTimer >= obstacleInterval) {
          game.obstacleSpawnTimer = 0
          spawnObstacle()
        }

        if (game.coinSpawnTimer >= 0.62) {
          game.coinSpawnTimer = 0
          spawnCoin()
        }

        if (game.hitCooldown > 0) {
          game.hitCooldown -= delta
        }

        for (let i = obstaclesRef.current.length - 1; i >= 0; i -= 1) {
          const obstacle = obstaclesRef.current[i]
          obstacle.position.z += game.speed * delta * 2.2
          obstacle.rotation.y += delta * 2.2

          const zGap = Math.abs(obstacle.position.z - player.position.z)
          const xGap = Math.abs(obstacle.position.x - player.position.x)

          if (obstacle.position.z > 12) {
            scene.remove(obstacle)
            disposeMesh(obstacle)
            obstaclesRef.current.splice(i, 1)
            continue
          }

          if (zGap < 1.16 && xGap < 1.08 && game.hitCooldown <= 0) {
            game.hitCooldown = 0.85
            game.health = Math.max(0, game.health - 1)
            setRunnerHealth(game.health)

            const bodyMaterial = getPlayerBodyMaterial()
            bodyMaterial?.color.set('#ef4444')
            window.setTimeout(() => {
              const latestMaterial = getPlayerBodyMaterial()
              latestMaterial?.color.set('#06b6d4')
            }, 150)

            scene.remove(obstacle)
            disposeMesh(obstacle)
            obstaclesRef.current.splice(i, 1)

            if (game.health <= 0) {
              endRunnerRef.current(game.score)
              break
            }
          }
        }

        for (let i = coinsRef.current.length - 1; i >= 0; i -= 1) {
          const coin = coinsRef.current[i]
          coin.position.z += game.speed * delta * 2.05
          coin.rotation.z += delta * 6.4

          const zGap = Math.abs(coin.position.z - player.position.z)
          const xGap = Math.abs(coin.position.x - player.position.x)

          if (coin.position.z > 12) {
            scene.remove(coin)
            disposeMesh(coin)
            coinsRef.current.splice(i, 1)
            continue
          }

          if (zGap < 1.02 && xGap < 0.9) {
            game.score += 34
            const updatedScore = Math.floor(game.score)
            scoreDisplayRef.current = updatedScore
            setRunnerScore(updatedScore)
            coinCountRef.current += 1
            setRunnerCoins(coinCountRef.current)
            setCoinPulse(true)
            setRecentCoinBonus(34)
            setBonusAnimationKey((current) => current + 1)

            if (coinPulseTimeoutRef.current !== null) {
              window.clearTimeout(coinPulseTimeoutRef.current)
            }
            coinPulseTimeoutRef.current = window.setTimeout(() => setCoinPulse(false), 220)

            if (bonusTimeoutRef.current !== null) {
              window.clearTimeout(bonusTimeoutRef.current)
            }
            bonusTimeoutRef.current = window.setTimeout(() => setRecentCoinBonus(null), 500)

            scene.remove(coin)
            disposeMesh(coin)
            coinsRef.current.splice(i, 1)
          }
        }
      }

      renderer.render(scene, camera)
    }

    const handleResize = () => {
      const currentContainer = runnerContainerRef.current
      if (!currentContainer) return

      const rect = currentContainer.getBoundingClientRect()
      const width = Math.max(1, rect.width || currentContainer.clientWidth || 1)
      const height = Math.max(1, rect.height || currentContainer.clientHeight || 1)

      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    frameRef.current = window.requestAnimationFrame(animate)

    return () => {
      window.removeEventListener('resize', handleResize)

      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
      }
      if (coinPulseTimeoutRef.current !== null) {
        window.clearTimeout(coinPulseTimeoutRef.current)
        coinPulseTimeoutRef.current = null
      }
      if (bonusTimeoutRef.current !== null) {
        window.clearTimeout(bonusTimeoutRef.current)
        bonusTimeoutRef.current = null
      }

      clearDynamicObjects()

      roadDashesRef.current.forEach((dash) => {
        scene.remove(dash)
        disposeMesh(dash)
      })
      roadDashesRef.current = []

      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose()
          if (Array.isArray(object.material)) {
            object.material.forEach((material) => material.dispose())
          } else {
            object.material.dispose()
          }
        }
      })

      renderer.dispose()

      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement)
      }

      setRunnerReady(false)
      playerRef.current = null
      sceneRef.current = null
    }
  }, [activeTab, runnerInitToken])

  useEffect(() => {
    if (activeTab !== 'games') return

    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()

      if (key === 'arrowleft' || key === 'a') {
        event.preventDefault()
        moveLeft()
        return
      }

      if (key === 'arrowright' || key === 'd') {
        event.preventDefault()
        moveRight()
        return
      }

      if ((key === ' ' || key === 'enter') && !runnerRunning && runnerReady) {
        event.preventDefault()
        startRunner()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [runnerReady, runnerRunning, activeTab])

  const activeLeaderboard = leaderboards[leaderboardPeriod]
  const podiumFirst = activeLeaderboard[0]
  const podiumSecond = activeLeaderboard[1]
  const podiumThird = activeLeaderboard[2]
  const leaderboardRest = activeLeaderboard.slice(3)

  return (
    <div className="pt-0 px-4 md:px-6 lg:px-8 safe-bottom lg:max-w-6xl xl:max-w-7xl lg:mx-auto">
      <div className="mb-6">
        <SEO
          title="Play & Win"
          description="Play exciting games to earn tires and rewards at A Square GoKarting."
          path="/play"
          noindex
        />
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-display font-bold text-white mb-1">
              Play & Win
            </h1>
            <p className="text-dark-400 md:text-base">Earn tires, play games</p>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-1 text-yellow-400">
              <Disc className="w-5 h-5" />
              <span className="text-2xl font-bold">{tires}</span>
            </div>
            <span className="text-dark-400 text-xs">tires</span>
          </div>
        </div>

        {currentStreak > 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mt-3 flex items-center gap-2 bg-gradient-to-r from-orange-500/20 to-red-500/20 px-3 py-2 rounded-xl"
          >
            <Flame className="w-5 h-5 text-orange-400" />
            <span className="text-orange-400 font-medium">{currentStreak} day streak</span>
            <span className="text-dark-400 text-sm">+{currentStreak * 10}% bonus</span>
          </motion.div>
        )}
      </div>

      {/* Mobile tabs (hidden on desktop — both sections shown side by side) */}
      <div className="flex bg-dark-800 rounded-xl p-1 mb-6 lg:hidden">
        {(['games', 'leaderboard'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium capitalize transition-all ${
              activeTab === tab ? 'bg-primary-500 text-white' : 'text-dark-400 hover:text-white'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Desktop: side-by-side layout */}
      <div className="lg:grid lg:grid-cols-[1fr_360px] xl:grid-cols-[1fr_400px] lg:gap-8 lg:items-start">
        {/* Games section — always visible on desktop, tab-gated on mobile */}
        <div className={`${activeTab !== 'games' ? 'hidden lg:block' : ''}`}>
          <div className="space-y-4">
            <div className="card">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div>
                  <h2 className="text-white font-display font-bold text-lg">3D Kart Dash</h2>
                  <p className="text-dark-400 text-xs">
                    Dodge red crates, collect gold rings, survive as long as you can.
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-widest text-dark-500">Best</p>
                  <p className="text-primary-400 font-bold text-sm flex items-center gap-1 justify-end">
                    <Trophy className="w-3.5 h-3.5" />
                    {runnerBest}
                  </p>
                </div>
              </div>

              <div className="relative h-72 md:h-80 lg:h-96 rounded-2xl overflow-hidden border border-white/10 bg-dark-950/80">
                <div ref={runnerContainerRef} className="absolute inset-0" />

                <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-lg bg-black/45 px-2 py-1 border border-white/10">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <Heart
                      key={index}
                      className={`w-4 h-4 ${index < runnerHealth ? 'text-red-400 fill-red-500/70' : 'text-white/20'}`}
                    />
                  ))}
                </div>

                <div className="absolute right-3 top-3 flex items-start gap-2">
                  <div
                    className={`rounded-lg bg-black/45 px-2 py-1 border border-white/10 transition-all duration-200 ${
                      coinPulse ? 'scale-110 border-yellow-300/40' : 'scale-100'
                    }`}
                  >
                    <p className="text-[10px] uppercase tracking-widest text-dark-400">Coins</p>
                    <p className="text-yellow-300 font-bold text-sm text-right flex items-center justify-end gap-1">
                      <Sparkles className="w-3.5 h-3.5" />
                      {runnerCoins}
                    </p>
                  </div>

                  <div className="rounded-lg bg-black/45 px-2 py-1 border border-white/10 min-w-[72px]">
                    <p className="text-[10px] uppercase tracking-widest text-dark-400">Score</p>
                    <p className="text-white font-bold text-sm text-right">{runnerScore}</p>
                    {recentCoinBonus !== null && (
                      <motion.span
                        key={bonusAnimationKey}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: [0, 1, 0], y: [6, 0, -6] }}
                        transition={{ duration: 0.5, ease: 'easeOut' }}
                        className="block text-[10px] text-right text-yellow-300"
                      >
                        +{recentCoinBonus}
                      </motion.span>
                    )}
                  </div>
                </div>

                {!runnerRunning && (
                  <div className="absolute inset-0 bg-black/55 backdrop-blur-[1px] flex flex-col items-center justify-center text-center px-4">
                    <p className="text-white font-semibold text-base mb-1">
                      {runnerScore > 0 ? `Run ended at ${runnerScore}` : 'Ready for a 3D run'}
                    </p>
                    {runnerError ? (
                      <p className="text-red-300 text-xs mb-3 max-w-xs">{runnerError}</p>
                    ) : (
                      <p className="text-dark-300 text-xs mb-3 max-w-xs">
                        Use keyboard arrows or the on-screen buttons to change lanes.
                      </p>
                    )}
                    <button
                      onClick={() => {
                        if (runnerError) {
                          setRunnerInitToken((current) => current + 1)
                          return
                        }
                        startRunner()
                      }}
                      disabled={!runnerReady && !runnerError}
                      className="px-4 py-2 rounded-xl bg-gradient-to-r from-primary-600 to-primary-500 text-white font-bold disabled:opacity-60"
                    >
                      {runnerError
                        ? 'Retry 3D'
                        : runnerReady
                          ? runnerScore > 0
                            ? 'Play Again'
                            : 'Start Run'
                          : 'Loading 3D...'}
                    </button>
                  </div>
                )}

                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2">
                  <button
                    onClick={moveLeft}
                    className="w-11 h-11 rounded-xl bg-black/45 border border-white/15 text-white flex items-center justify-center"
                    aria-label="Move left"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    onClick={moveRight}
                    className="w-11 h-11 rounded-xl bg-black/45 border border-white/15 text-white flex items-center justify-center"
                    aria-label="Move right"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="mt-3 text-[11px] text-dark-400 flex items-center justify-between">
                <span>
                  Lane {laneIndex + 1} • Coins {runnerCoins}
                </span>
                <span>{runnerRunning ? 'Running' : 'Paused'}</span>
              </div>
              <div className="mt-1 text-[11px] text-dark-400 flex items-center justify-between">
                <span>Conversion: 1 coin = 0.1 tire</span>
                {!runnerRunning && runnerScore > 0 && (
                  <span className="text-yellow-300">
                    Converted: +{lastCoinTires.toFixed(1)} tires
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {games.map((game) => (
                <motion.button
                  key={game.id}
                  onClick={() => handlePlayGame(game)}
                  whileTap={{ scale: 0.98 }}
                  className="card text-left relative"
                >
                  {game.id === 'spin' && spins.available > 0 && (
                    <div className="absolute top-2 right-2 bg-primary-500 text-white text-xs font-bold px-2 py-1 rounded-full">
                      {spins.available}
                    </div>
                  )}

                  {game.id === 'runner' && (
                    <div className="absolute top-2 right-2 bg-cyan-500/20 text-cyan-300 text-[10px] font-bold px-2 py-1 rounded-full border border-cyan-400/30">
                      BEST {runnerBest}
                    </div>
                  )}

                  <div
                    className={`w-12 h-12 rounded-xl bg-gradient-to-br ${game.color} flex items-center justify-center mb-3`}
                  >
                    <game.icon className="w-6 h-6 text-white" />
                  </div>

                  <h3 className="font-semibold text-white">{game.name}</h3>
                  <p className="text-dark-400 text-xs mt-1">{game.description}</p>

                  <div className="flex items-center justify-between mt-3">
                    <span className="text-primary-400 text-sm font-medium">{game.tires}</span>
                    {game.levels && <span className="text-dark-500 text-xs">{game.levels}</span>}
                  </div>
                </motion.button>
              ))}
            </div>
          </div>
        </div>
        {/* end games wrapper */}

        {/* Leaderboard section — always visible on desktop, tab-gated on mobile */}
        <div
          className={`${activeTab !== 'leaderboard' ? 'hidden lg:block' : ''} lg:sticky lg:top-4 lg:self-start`}
        >
          <div className="space-y-4">
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setLeaderboardPeriod('weekly')}
                className={`flex-1 py-2 rounded-lg text-sm font-medium ${
                  leaderboardPeriod === 'weekly'
                    ? 'bg-primary-500 text-white'
                    : 'bg-dark-800 text-dark-400'
                }`}
              >
                Weekly
              </button>
              <button
                onClick={() => setLeaderboardPeriod('monthly')}
                className={`flex-1 py-2 rounded-lg text-sm font-medium ${
                  leaderboardPeriod === 'monthly'
                    ? 'bg-primary-500 text-white'
                    : 'bg-dark-800 text-dark-400'
                }`}
              >
                Monthly
              </button>
              <button
                onClick={() => setLeaderboardPeriod('all')}
                className={`flex-1 py-2 rounded-lg text-sm font-medium ${
                  leaderboardPeriod === 'all'
                    ? 'bg-primary-500 text-white'
                    : 'bg-dark-800 text-dark-400'
                }`}
              >
                All Time
              </button>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => void loadLeaderboards()}
                disabled={leaderboardLoading}
                className="text-xs px-3 py-1.5 rounded-lg bg-dark-800 text-dark-300 border border-white/10 disabled:opacity-60"
              >
                {leaderboardLoading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>

            {leaderboardError && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
                {leaderboardError}
              </div>
            )}

            {leaderboardLoading ? (
              <div className="card text-center py-10">
                <Loader2 className="w-6 h-6 text-primary-400 animate-spin mx-auto mb-2" />
                <p className="text-dark-300 text-sm">Loading leaderboard...</p>
              </div>
            ) : activeLeaderboard.length === 0 ? (
              <div className="card text-center py-10">
                <Trophy className="w-8 h-8 text-dark-500 mx-auto mb-2" />
                <p className="text-dark-300 text-sm">No leaderboard data available yet.</p>
              </div>
            ) : (
              <>
                <div className="flex items-end justify-center gap-3 mb-6">
                  {podiumSecond && (
                    <div className="text-center">
                      <div className="w-14 h-14 mx-auto mb-2 rounded-full bg-gradient-to-br from-slate-400 to-slate-500 flex items-center justify-center">
                        <Trophy className="w-6 h-6 text-white" />
                      </div>
                      <div className="text-white font-medium text-sm">{podiumSecond.userName}</div>
                      <div className="text-dark-400 text-xs">
                        {podiumSecond.score.toLocaleString()} pts
                      </div>
                    </div>
                  )}
                  {podiumFirst && (
                    <div className="text-center -mb-4">
                      <div className="w-20 h-20 mx-auto mb-2 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center border-4 border-yellow-400/40">
                        <Trophy className="w-8 h-8 text-white" />
                      </div>
                      <div className="text-white font-semibold">{podiumFirst.userName}</div>
                      <div className="text-yellow-400 text-sm font-medium">
                        {podiumFirst.score.toLocaleString()} pts
                      </div>
                    </div>
                  )}
                  {podiumThird && (
                    <div className="text-center">
                      <div className="w-14 h-14 mx-auto mb-2 rounded-full bg-gradient-to-br from-amber-600 to-amber-700 flex items-center justify-center">
                        <Trophy className="w-6 h-6 text-white" />
                      </div>
                      <div className="text-white font-medium text-sm">{podiumThird.userName}</div>
                      <div className="text-dark-400 text-xs">
                        {podiumThird.score.toLocaleString()} pts
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  {leaderboardRest.map((entry) => {
                    const isCurrentUser = Boolean(user?.id) && entry.userId === user?.id
                    return (
                      <div
                        key={entry.userId}
                        className={`flex items-center gap-3 p-3 rounded-xl ${
                          isCurrentUser
                            ? 'bg-primary-500/15 border border-primary-500/30'
                            : 'bg-dark-800'
                        }`}
                      >
                        <span className="w-6 text-center text-dark-400 font-medium">
                          {entry.rank}
                        </span>
                        <div className="w-10 h-10 rounded-full bg-dark-700 flex items-center justify-center">
                          <Disc className="w-4 h-4 text-dark-400" />
                        </div>
                        <div className="flex-1">
                          <div className="text-white text-sm font-medium">
                            {entry.userName}
                            {isCurrentUser && (
                              <span className="ml-2 text-primary-300 text-xs">(You)</span>
                            )}
                          </div>
                          <div className="text-dark-500 text-xs">Level {entry.level}</div>
                        </div>
                        <span className="text-dark-300 text-sm">
                          {entry.score.toLocaleString()} pts
                        </span>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>
        {/* end leaderboard wrapper */}
      </div>
      {/* end desktop grid */}
    </div>
  )
}
