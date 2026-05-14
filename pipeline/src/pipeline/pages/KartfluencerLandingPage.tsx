import { useCallback, useEffect, useRef, useState } from 'react'
import { getDownloadURL, ref as storageRef } from 'firebase/storage'
import type { KartfluencerRecord } from '../api/types'
import { kartfluencerApi } from '../api/kartfluencer'
import { useLocations } from '../../lib/useLocations'
import { db, storage } from '../../lib/firebase'
import './KartfluencerLandingPage.css'

/* ─── Constants ──────────────────────────────────────────────────── */

const PANEL_COUNT = 5

// Hero reel video hosted in Firebase Storage. Upload the MP4 once to this path
// (via Firebase Console or gsutil) and it will be fetched on mount.
const HERO_REEL_STORAGE_PATH = 'kartfluencer/hero-reel.mp4'
// Fallback if the storage fetch fails — original Instagram post embed.
const HERO_REEL_FALLBACK_EMBED = 'https://www.instagram.com/p/DVbRNWOj5DE/embed/'

const PROGRESS_LABELS = ['Reel', 'Engagement', 'Booking', 'Rewards', 'Location']
const CAPTIONS = [
  'Watch the hype build on social',
  'Engagement grows with every scroll',
  'Seamless booking in seconds',
  'Unlock rewards on every ride',
  'Expanding across India — starting Srikakulam',
]

const STATS = [
  { icon: '🎬', label: 'Reels Made', value: '500+' },
  { icon: '👁️', label: 'Total Views', value: '10M+' },
  { icon: '💰', label: 'Earned by Influencers', value: '₹5L+' },
]

const FEATURES_DATA = [
  {
    tag: 'STEP 1',
    emoji: '📝',
    title: (
      <>
        Register as a <em>KartFluencer</em>
      </>
    ),
    desc: 'Sign up on our portal with your Instagram handle, pick a branch, and choose your visit date. It takes less than 2 minutes.',
  },
  {
    tag: 'STEP 2',
    emoji: '🏎️',
    title: (
      <>
        Visit & <em>experience</em> the thrill
      </>
    ),
    desc: 'Show up at A Square GoKarting, race on the track, enjoy all activities, and capture the best moments on camera.',
  },
  {
    tag: 'STEP 3',
    emoji: '🎬',
    title: (
      <>
        Create & post your <em>reel</em>
      </>
    ),
    desc: 'Make a 30-90 second Instagram Reel showcasing your go-karting experience. Tag @asquaregokarting and use the location sticker.',
  },
  {
    tag: 'STEP 4',
    emoji: '📤',
    title: (
      <>
        Submit your <em>reel link</em>
      </>
    ),
    desc: 'Come back to the KartFluencer portal, paste your Instagram reel link, and submit it for review. Our team verifies within 24-48 hours.',
  },
  {
    tag: 'STEP 5',
    emoji: '📈',
    title: (
      <>
        Watch your reel <em>go viral</em>
      </>
    ),
    desc: 'Sit back and watch the views roll in. We track your reel performance in real-time — likes, comments, shares, and views.',
  },
  {
    tag: 'STEP 6',
    emoji: '💰',
    title: (
      <>
        Hit 1M views, get paid <em>₹10,000</em>
      </>
    ),
    desc: 'Once your reel crosses 1 million views, you earn ₹10,000 credited directly to your UPI. Plus access passes and exclusive perks.',
  },
]

const TESTIMONIAL_SLIDES = [
  [
    {
      name: 'Gudiseti Yedava',
      role: '@gudiseti_yedava · 121K',
      quote:
        'The helicopter ride was unreal! My reel from A Square GoKarting crossed 1M views. The whole experience — go-karting, helicopter, team support — was next level.',
      active: false,
      img: '/images/influencers/gudiseti_yedava.jpg',
    },
    {
      name: 'Duvvuri Durga',
      role: '@narajahmundry · 95K',
      quote:
        "I've done 50+ brand collabs but nothing beats a helicopter joy ride + go-karting in one day. The content made itself and the payment came within a week!",
      active: true,
      img: '/images/influencers/narajahmundry.jpg',
    },
    {
      name: 'The Foodie Girl',
      role: '@the_foodie_grl_ · 80K',
      quote:
        'The helicopter selfie became my most-liked post ever! A Square GoKarting knows how to create moments that go viral. Already planning visit #2.',
      active: false,
      img: '/images/influencers/the_foodie_grl.jpg',
    },
  ],
  [
    {
      name: 'Traditional Pilla',
      role: '@rajahmundry_traditional_pilla · 70K',
      quote:
        'I went in a saree, got on a helicopter, and raced go-karts — my audience went crazy! The reel hit 800K views in 2 days.',
      active: false,
      img: '/images/influencers/rajahmundry_traditional_pilla.jpg',
    },
    {
      name: 'Mallesh Duvvuri',
      role: '@malleshduvvuri · 65K',
      quote:
        "The track, the helicopter flying in, the crowd energy — you don't need to script anything here. Real moments, real engagement, real payment.",
      active: true,
      img: '/images/influencers/malleshduvvuri.jpg',
    },
    {
      name: 'KIET Entertainment',
      role: '@kiet_clg_entertainment · 45K',
      quote:
        'Our college crew had the best time! Helicopter rides + racing + content creation — everything a creator dreams of. 500K views in 3 days!',
      active: false,
      img: '/images/influencers/kiet_clg_entertainment.jpg',
    },
  ],
]

const INFLUENCERS = [
  {
    img: '/images/influencers/gudiseti_yedava.jpg',
    name: 'Gudiseti Yedava',
    handle: '@gudiseti_yedava',
    followers: '121K',
    quote:
      'One reel, 1.2M views, ₹10,000 in my UPI within a week. The A Square team handled everything — I just had to race and record.',
  },
  {
    img: '/images/influencers/narajahmundry.jpg',
    name: 'Duvvuri Durga',
    handle: '@narajahmundry',
    followers: '95K',
    quote:
      "I've done 50+ brand collabs. This was the smoothest — no back and forth, clear deliverables, instant payment.",
  },
  {
    img: '/images/influencers/the_foodie_grl.jpg',
    name: 'The Foodie Girl',
    handle: '@the_foodie_grl_',
    followers: '80K',
    quote:
      "The helicopter + go-karting combo made my reel blow up! Best content day I've had. Already planning my second visit.",
  },
  {
    img: '/images/influencers/rajahmundry_traditional_pilla.jpg',
    name: 'Traditional Pilla',
    handle: '@rajahmundry_traditional_pilla',
    followers: '70K',
    quote:
      'Even with a traditional niche, the go-karting content got insane engagement. My audience loved something different!',
  },
  {
    img: '/images/influencers/malleshduvvuri.jpg',
    name: 'Mallesh Duvvuri',
    handle: '@malleshduvvuri',
    followers: '65K',
    quote:
      'The track, the helicopter, the energy — content practically made itself. Plus I got 4 access passes for my squad.',
  },
  {
    img: '/images/influencers/kiet_clg_entertainment.jpg',
    name: 'KIET Entertainment',
    handle: '@kiet_clg_entertainment',
    followers: '45K',
    quote:
      'Our college crew had the best time! The reel hit 500K views in 3 days. A Square knows how to work with young creators.',
  },
  {
    img: '/images/influencers/aditya_students.jpg',
    name: 'Aditya Students',
    handle: '@aditya_students_ikkadaa',
    followers: '38K',
    quote:
      'We brought 10 students and created 5 reels in one day. Total views crossed 2M. The team was super supportive!',
  },
]

const CHART_BARS = [
  { day: 'Mon', h: '30%' },
  { day: 'Tue', h: '55%' },
  { day: 'Wed', h: '42%' },
  { day: 'Thu', h: '78%' },
  { day: 'Fri', h: '90%' },
  { day: 'Sat', h: '100%', accent: true },
  { day: 'Sun', h: '70%' },
]

const ENG_STATS = [
  { id: 'engLikes', label: 'Likes', target: 78 },
  { id: 'engComments', label: 'Comments', target: 52 },
  { id: 'engShares', label: 'Shares', target: 65 },
  { id: 'engSaves', label: 'Saves', target: 41 },
]

const ENG_TARGETS: Record<string, number> = {
  engagementViews: 156200,
  engLikes: 18700,
  engComments: 4300,
  engShares: 2100,
  engSaves: 1450,
}

/* ─── Helpers ────────────────────────────────────────────────────── */

function fmtCount(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return n.toString()
}

function animateNumber(el: HTMLElement, from: number, to: number, duration: number) {
  const start = performance.now()
  function tick(now: number) {
    const t = Math.min((now - start) / duration, 1)
    const ease = 1 - Math.pow(1 - t, 3)
    el.textContent = fmtCount(Math.round(from + (to - from) * ease))
    if (t < 1) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

function animateStatValue(el: HTMLElement) {
  const text = el.textContent?.trim() ?? ''
  const hasPlus = text.includes('+')
  const hasX = text.includes('x')
  const hasCr = text.includes('Cr')
  const hasR = text.includes('₹')
  const numStr = text.replace(/[₹+xCr\s]/g, '')
  const target = parseFloat(numStr)
  if (isNaN(target)) return

  const start = performance.now()
  function tick(now: number) {
    const t = Math.min((now - start) / 1500, 1)
    const ease = 1 - Math.pow(1 - t, 3)
    const v = ease * target
    let s = ''
    if (hasR) s += '₹'
    s += Number.isInteger(target) ? Math.round(v).toString() : v.toFixed(0)
    if (hasCr) s += ' Cr'
    if (hasPlus) s += '+'
    if (hasX) s += 'x'
    el.textContent = s
    if (t < 1) requestAnimationFrame(tick)
    else el.textContent = text
  }
  requestAnimationFrame(tick)
}

/* ─── Helpers ─────────────────────────────────────────────────────── */

/**
 * Normalize anything a user might paste into the Instagram-handle field
 * into a canonical "@username" string.
 *
 * Accepts: bare usernames, "@username", full URLs (instagram.com/username,
 * www.instagram.com/username/, https://instagram.com/username?hl=en, etc.).
 * Rejects: post/reel/tv/explore links (returns "" so the caller errors out)
 * and any handle with characters Instagram doesn't allow.
 *
 * Instagram username rules: 1–30 chars, letters, digits, periods, underscores.
 */
function normalizeInstagramHandle(raw: string): string {
  if (!raw) return ''
  let s = raw.trim()

  // Strip surrounding whitespace and common URL protocols
  s = s.replace(/^https?:\/\//i, '').replace(/^\/\//, '')

  // Strip host (instagram.com, www.instagram.com, m.instagram.com) if present
  s = s.replace(/^(?:www\.|m\.)?instagram\.com\/?/i, '')

  // Drop query string and hash
  s = s.split(/[?#]/)[0]

  // Drop trailing slashes
  s = s.replace(/\/+$/, '')

  // If anything before the first slash is a reserved path segment, this is a
  // post/reel/profile-section link, not a profile URL — reject.
  const first = s.split('/')[0].toLowerCase()
  const reserved = new Set([
    'p',
    'reel',
    'reels',
    'tv',
    'stories',
    'explore',
    'accounts',
    'direct',
    'about',
    'developer',
    'legal',
    'privacy',
    'press',
    'api',
  ])
  if (reserved.has(first)) return ''

  // Take just the first path segment (the username)
  s = s.split('/')[0]

  // Remove a leading "@" if the user typed one
  s = s.replace(/^@+/, '')

  // Validate against Instagram's username rules
  if (!/^[A-Za-z0-9._]{1,30}$/.test(s)) return ''

  return `@${s}`
}

/* ─── Main Component ─────────────────────────────────────────────── */

interface KartfluencerLandingPageProps {
  onRegister: (record: KartfluencerRecord) => void
}

const KartfluencerLandingPage: React.FC<KartfluencerLandingPageProps> = ({ onRegister }) => {
  /* State */
  const [activePanel, setActivePanelState] = useState(-1)
  const [navScrolled, setNavScrolled] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [testimonialIdx, setTestimonialIdx] = useState(0)
  const [reelMedia, setReelMedia] = useState<{ mediaUrl: string; thumbnailUrl: string } | null>(
    null,
  )
  const [activeFeature, setActiveFeature] = useState(0)

  /* Form state */
  const [handle, setHandle] = useState('')
  const [phone, setPhone] = useState('')
  const [branchId, setBranchId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [formStep, setFormStep] = useState<'handle' | 'register' | 'existing' | 'done'>('handle')
  const [existingRecord, setExistingRecord] = useState<KartfluencerRecord | null>(null)
  const [igProfile, setIgProfile] = useState<{
    followers?: number
    mediaCount?: number
    bio?: string
    profilePictureUrl?: string
  } | null>(null)

  const featuresRef = useRef<HTMLElement>(null)

  const { enabledLocations: locations } = useLocations(db)

  /* Refs */
  const runwayRef = useRef<HTMLElement>(null)
  const gokartRef = useRef<HTMLDivElement>(null)
  const heroGlowRef = useRef<HTMLDivElement>(null)
  const cinemaBgImgRef = useRef<HTMLImageElement>(null)
  const cinemaRoadRef = useRef<HTMLDivElement>(null)
  const statsGridRef = useRef<HTMLDivElement>(null)
  const mapSectionRef = useRef<HTMLElement>(null)
  const activePanelRef = useRef(-1)
  const engTriggeredRef = useRef(false)
  const statsAnimatedRef = useRef(false)

  /* Update gokart 3D transform */
  const updateGokart = useCallback((p: number) => {
    const el = gokartRef.current
    if (!el) return
    const t = 1 - Math.pow(1 - p, 3)
    const tz = -400 + t * 580
    const sc = 0.22 + t * 0.5
    const op = 0.05 + t * 0.95
    const bl = 8 - t * 8
    const tx = 50 - t * 65
    const arc = Math.sin(t * Math.PI * 0.6) * 5
    const tyOff = -20 + t * 8 - arc
    const ry = 12 - t * 14

    el.style.transform = `translateY(${tyOff}%) translateX(${tx}px) translateZ(${tz}px) rotateY(${ry}deg) scale(${sc})`
    el.style.opacity = String(Math.min(op, 1))
    el.style.filter = `blur(${Math.max(bl, 0)}px) drop-shadow(0 25px 35px rgba(0,0,0,.6))`
    el.classList.toggle('in-front', p > 0.4)
  }, [])

  /* Trigger engagement count animation */
  const triggerEngagementCount = useCallback(() => {
    if (engTriggeredRef.current) return
    engTriggeredRef.current = true
    Object.entries(ENG_TARGETS).forEach(([id, target]) => {
      const el = document.getElementById(id)
      if (el) animateNumber(el, 0, target, 1400)
    })
  }, [])

  /* Set active panel */
  const setActivePanel = useCallback(
    (index: number) => {
      if (index === activePanelRef.current) return
      activePanelRef.current = index
      setActivePanelState(index)
      if (index === 1) triggerEngagementCount()
    },
    [triggerEngagementCount],
  )

  /* Main scroll handler */
  useEffect(() => {
    const onScroll = () => {
      const runway = runwayRef.current
      if (!runway) return

      setNavScrolled(window.scrollY > 60)

      // Hero glow parallax
      if (heroGlowRef.current) {
        heroGlowRef.current.style.transform = `translateX(-50%) translateY(${window.scrollY * 0.3}px)`
      }
      // Cinema bg zoom
      if (cinemaBgImgRef.current) {
        const zoom = 1.15 + window.scrollY * 0.00005
        cinemaBgImgRef.current.style.transform = `scale(${Math.min(zoom, 1.28)})`
      }
      // Left road scale
      if (cinemaRoadRef.current) {
        const s = 1.2 + window.scrollY * 0.00003
        cinemaRoadRef.current.style.transform = `rotateX(58deg) rotateZ(-14deg) scale(${Math.min(s, 1.28)})`
      }

      // Phone panel mapping
      const rect = runway.getBoundingClientRect()
      const scrolled = -rect.top
      const runwayH = runway.offsetHeight
      const progress = Math.max(0, Math.min(scrolled / (runwayH - window.innerHeight), 1))
      const rawIndex = progress * PANEL_COUNT
      const index = Math.min(Math.floor(rawIndex), PANEL_COUNT - 1)
      setActivePanel(index)

      // GoKart 3D
      updateGokart(progress)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [setActivePanel, updateGokart])

  /* Fade-up observer */
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('visible')
            obs.unobserve(e.target)
          }
        })
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' },
    )
    document.querySelectorAll('.kf-landing .fade-up').forEach((el) => obs.observe(el))
    return () => obs.disconnect()
  }, [])

  /* Stats counter observer */
  useEffect(() => {
    const grid = statsGridRef.current
    if (!grid) return
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && !statsAnimatedRef.current) {
            statsAnimatedRef.current = true
            grid.querySelectorAll<HTMLElement>('.stat-value').forEach((v, i) => {
              setTimeout(() => animateStatValue(v), i * 200)
            })
            obs.unobserve(e.target)
          }
        })
      },
      { threshold: 0.3 },
    )
    obs.observe(grid)
    return () => obs.disconnect()
  }, [])

  /* Map demo bar animation */
  useEffect(() => {
    const sec = mapSectionRef.current
    if (!sec) return
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            sec.querySelectorAll<HTMLElement>('.demo-fill').forEach((b) => {
              const w = b.style.width
              b.style.width = '0%'
              setTimeout(() => {
                b.style.width = w
              }, 300)
            })
            obs.unobserve(e.target)
          }
        })
      },
      { threshold: 0.3 },
    )
    obs.observe(sec)
    return () => obs.disconnect()
  }, [])

  /* Fetch hero reel video URL from Firebase Storage */
  useEffect(() => {
    let cancelled = false
    getDownloadURL(storageRef(storage, HERO_REEL_STORAGE_PATH))
      .then((url) => {
        if (!cancelled) setReelMedia({ mediaUrl: url, thumbnailUrl: '' })
      })
      .catch(() => {
        /* keep iframe fallback */
      })
    return () => {
      cancelled = true
    }
  }, [])

  /* Features sticky scroll tracking */
  useEffect(() => {
    const section = featuresRef.current
    if (!section) return
    const onScroll = () => {
      const rect = section.getBoundingClientRect()
      const scrolled = -rect.top
      const sectionH = section.offsetHeight
      const progress = Math.max(0, Math.min(scrolled / (sectionH - window.innerHeight), 1))
      const idx = Math.min(Math.floor(progress * FEATURES_DATA.length), FEATURES_DATA.length - 1)
      setActiveFeature(idx)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  /* Step 1: Verify handle — check Firestore + real Instagram */
  const handleVerify = useCallback(async () => {
    setFormError('')
    const h = normalizeInstagramHandle(handle)
    if (!h || h === '@') {
      setFormError('Please enter a valid Instagram handle (letters, numbers, ._ only).')
      return
    }
    setSubmitting(true)
    try {
      // Check if already registered in our system
      const existing = await kartfluencerApi.checkHandle(h)
      if (existing) {
        setExistingRecord(existing)
        setFormStep('existing')
        return
      }
      // Verify handle exists on real Instagram
      const igResult = await kartfluencerApi.verifyInstagram(h)
      if (!igResult.exists) {
        setFormError('Instagram handle not found. Please check and try again.')
        return
      }
      setIgProfile({
        followers: igResult.followers,
        mediaCount: igResult.mediaCount,
        bio: igResult.bio,
        profilePictureUrl: igResult.profilePictureUrl,
      })
      setHandle(h)
      setFormStep('register')
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Verification failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }, [handle])

  /* Step 2: Register new influencer */
  const handleRegister = useCallback(async () => {
    setFormError('')
    if (!phone.trim() || phone.replace(/\D/g, '').length < 10) {
      setFormError('Valid phone number is required.')
      return
    }
    if (!branchId) {
      setFormError('Please select a location.')
      return
    }
    setSubmitting(true)
    try {
      const branch = locations.find((l) => l.branchId === branchId)
      const record = await kartfluencerApi.createPublic({
        instagramHandle: handle,
        phoneNumber: phone.replace(/\D/g, '').slice(-10),
        branchId,
        branchName: branch?.displayName ?? '',
        visitDate: '',
        followersRange: '',
        followerCount: igProfile?.followers,
        profilePictureUrl: igProfile?.profilePictureUrl,
      })
      setFormStep('done')
      onRegister(record)
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Registration failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }, [
    handle,
    phone,
    branchId,
    locations,
    onRegister,
    igProfile?.followers,
    igProfile?.profilePictureUrl,
  ])

  /* Testimonial auto-rotate */
  useEffect(() => {
    const timer = setInterval(() => {
      setTestimonialIdx((prev) => (prev + 1) % TESTIMONIAL_SLIDES.length)
    }, 6000)
    return () => clearInterval(timer)
  }, [])

  /* Smooth scroll helper */
  const scrollToId = useCallback((id: string) => {
    setMobileMenuOpen(false)
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  /* Panel class helper */
  const panelClass = (i: number) => {
    if (i === activePanel) return 'phone-panel active'
    if (i < activePanel) return 'phone-panel exit-up'
    return 'phone-panel'
  }

  return (
    <div className="kf-landing">
      {/* ===== NAVBAR ===== */}
      <nav className={`navbar${navScrolled ? ' scrolled' : ''}`}>
        <div className="nav-container">
          <a
            href="#hero"
            onClick={(e) => {
              e.preventDefault()
              scrollToId('hero')
            }}
            className="nav-logo"
          >
            <img src="/asquare-logo.webp" alt="A Square GoKarting" style={{ height: 32 }} />
          </a>
          <div className={`nav-links${mobileMenuOpen ? ' open' : ''}`}>
            <a
              href="#hero"
              className="nav-link"
              onClick={(e) => {
                e.preventDefault()
                scrollToId('hero')
              }}
            >
              Home
            </a>
            <a
              href="#features"
              className="nav-link"
              onClick={(e) => {
                e.preventDefault()
                scrollToId('features')
              }}
            >
              How It Works
            </a>
            <a
              href="#impact"
              className="nav-link"
              onClick={(e) => {
                e.preventDefault()
                scrollToId('impact')
              }}
            >
              Creators
            </a>
            <a
              href="#map"
              className="nav-link"
              onClick={(e) => {
                e.preventDefault()
                scrollToId('map')
              }}
            >
              Locations
            </a>
            <a
              href="#apply"
              className="nav-link nav-link-cta"
              onClick={(e) => {
                e.preventDefault()
                scrollToId('apply')
              }}
            >
              Apply Now
            </a>
          </div>
          <button
            type="button"
            className={`nav-toggle${mobileMenuOpen ? ' active' : ''}`}
            aria-label="Toggle menu"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </nav>

      {/* ===== APPLY FORM ===== */}
      <section className="apply-section" id="apply">
        <div className="container">
          <h2 className="section-title fade-up">
            Become a <em>KartFluencer</em>
          </h2>
          <p className="section-subtitle fade-up">
            Limited slots available. Register now, race, create content, and earn up to ₹10,000.
          </p>

          <div className="apply-form-wrapper fade-up">
            {/* Step: Verify handle */}
            {formStep === 'handle' && (
              <div className="apply-form">
                <div className="apply-form-field">
                  <label>Instagram Handle</label>
                  <input
                    type="text"
                    placeholder="@yourusername"
                    value={handle}
                    onChange={(e) => setHandle(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
                  />
                </div>
                {formError && <div className="apply-error">{formError}</div>}
                <button
                  type="button"
                  className="apply-submit-btn"
                  onClick={handleVerify}
                  disabled={submitting}
                >
                  {submitting ? 'Verifying...' : 'Verify Handle →'}
                </button>
                <p className="apply-disclaimer">
                  We'll check if you're already registered in our system.
                </p>
              </div>
            )}

            {/* Step: Existing influencer found */}
            {formStep === 'existing' && existingRecord && (
              <div className="apply-success">
                <div className="apply-success-icon">👋</div>
                <h3>Welcome back, {existingRecord.instagramHandle}!</h3>
                <p>
                  You're already registered as a KartFluencer at {existingRecord.branchName}.
                  Status: <strong>{existingRecord.status.replace(/_/g, ' ')}</strong>
                </p>
                <button
                  type="button"
                  className="apply-submit-btn"
                  style={{ marginTop: 20 }}
                  onClick={() => onRegister(existingRecord)}
                >
                  Go to Portal →
                </button>
              </div>
            )}

            {/* Step: Register new */}
            {formStep === 'register' && (
              <div className="apply-form">
                <div className="apply-form-field">
                  <label>Instagram Handle</label>
                  <input
                    type="text"
                    value={handle}
                    disabled
                    aria-label="Instagram Handle"
                    style={{ opacity: 0.6 }}
                  />
                </div>
                {igProfile && (
                  <div
                    style={{
                      background: 'linear-gradient(135deg, rgba(225,6,0,0.08), rgba(225,6,0,0.02))',
                      border: '1px solid rgba(225,6,0,0.15)',
                      borderRadius: 12,
                      padding: '14px 16px',
                      display: 'flex',
                      gap: 16,
                      alignItems: 'center',
                      marginBottom: 4,
                    }}
                  >
                    {igProfile.profilePictureUrl && (
                      <img
                        src={igProfile.profilePictureUrl}
                        alt={handle}
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: '50%',
                          objectFit: 'cover',
                          border: '2px solid rgba(225,6,0,0.3)',
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <div style={{ flex: 1 }}>
                      <p style={{ color: '#fff', fontWeight: 700, fontSize: 14, margin: 0 }}>
                        {handle}
                      </p>
                      {igProfile.bio && (
                        <p
                          style={{
                            color: 'rgba(255,255,255,0.4)',
                            fontSize: 12,
                            margin: '4px 0 0',
                            lineHeight: 1.4,
                            overflow: 'hidden',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                          }}
                        >
                          {igProfile.bio}
                        </p>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 16, flexShrink: 0 }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ color: '#fff', fontWeight: 800, fontSize: 16 }}>
                          {igProfile.followers
                            ? igProfile.followers >= 1000000
                              ? `${(igProfile.followers / 1000000).toFixed(1)}M`
                              : igProfile.followers >= 1000
                                ? `${(igProfile.followers / 1000).toFixed(1)}K`
                                : igProfile.followers
                            : '—'}
                        </div>
                        <div
                          style={{
                            color: 'rgba(255,255,255,0.3)',
                            fontSize: 10,
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: 0.5,
                          }}
                        >
                          Followers
                        </div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ color: '#fff', fontWeight: 800, fontSize: 16 }}>
                          {igProfile.mediaCount
                            ? igProfile.mediaCount >= 1000
                              ? `${(igProfile.mediaCount / 1000).toFixed(1)}K`
                              : igProfile.mediaCount
                            : '—'}
                        </div>
                        <div
                          style={{
                            color: 'rgba(255,255,255,0.3)',
                            fontSize: 10,
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: 0.5,
                          }}
                        >
                          Posts
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                <div className="apply-form-field">
                  <label>Phone Number</label>
                  <div className="apply-phone-row">
                    <span className="apply-phone-prefix">+91</span>
                    <input
                      type="tel"
                      placeholder="9876543210"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      maxLength={10}
                    />
                  </div>
                </div>
                <div className="apply-form-field">
                  <label>Location</label>
                  <select
                    value={branchId}
                    onChange={(e) => setBranchId(e.target.value)}
                    aria-label="Location"
                  >
                    <option value="">Select branch</option>
                    {locations.map((loc) => (
                      <option key={loc.branchId} value={loc.branchId}>
                        {loc.displayName}
                      </option>
                    ))}
                  </select>
                </div>
                {formError && <div className="apply-error">{formError}</div>}
                <button
                  type="button"
                  className="apply-submit-btn"
                  onClick={handleRegister}
                  disabled={submitting}
                >
                  {submitting ? 'Registering...' : 'Register as KartFluencer →'}
                </button>
                <button
                  type="button"
                  className="apply-back-btn"
                  onClick={() => {
                    setFormStep('handle')
                    setFormError('')
                  }}
                >
                  ← Back
                </button>
                <p className="apply-disclaimer">
                  By registering you agree to our collaboration terms.
                </p>
              </div>
            )}

            {/* Step: Done */}
            {formStep === 'done' && (
              <div className="apply-success">
                <div className="apply-success-icon">🎉</div>
                <h3>You're on the Grid!</h3>
                <p>
                  Your KartFluencer application has been submitted. Our team will review your
                  profile within 24-48 hours and reach out on WhatsApp.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ===== HERO TEXT ===== */}
      <section className="hero-text" id="hero">
        <div className="hero-bg-glow" ref={heroGlowRef} />
        <div className="container">
          <div className="hero-badge">
            <span className="badge-emoji">🎬💰🔥</span>
            <span>90+ creators already earning with KartFluencer</span>
          </div>
          <h1 className="hero-title">
            Race. Create. <br />
            <em>Get Paid.</em>
          </h1>
          <p className="hero-subtitle">
            Create viral go-karting reels at A Square GoKarting, hit 1M views, and earn up to
            ₹10,000 — plus free access passes, helicopter joy rides, and exclusive creator perks.
          </p>
          <div className="scroll-hint">
            <span>Scroll to explore</span>
            <div className="scroll-hint-arrow">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path
                  d="M10 4v12M5 11l5 5 5-5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>
        </div>
      </section>

      {/* ===== PHONE SCROLL RUNWAY ===== */}
      <section className="phone-runway" id="phoneRunway" ref={runwayRef}>
        <div className="phone-sticky">
          {/* Layer 1: Far background.
              WebP variant is 50 KB vs 1.4 MB PNG (~96% smaller). PNG kept
              as a fallback for the rare browser that doesn't support WebP.
              `loading="lazy"` is safe here because the cinema runway is
              below the fold — the browser fetches as the user scrolls
              toward it. */}
          <div className="cinema-bg">
            <picture>
              <source srcSet="/images/road-bg.webp" type="image/webp" />
              <img
                src="/images/road-bg.png"
                alt=""
                className="cinema-bg-img"
                loading="lazy"
                decoding="async"
                ref={cinemaBgImgRef}
              />
            </picture>
            <div className="cinema-bg-overlay" />
          </div>

          {/* Layer 2: Left-side road (same WebP source) */}
          <div className="cinema-road" ref={cinemaRoadRef}>
            <picture>
              <source srcSet="/images/road-bg.webp" type="image/webp" />
              <img
                src="/images/road-bg.png"
                alt=""
                className="cinema-road-img"
                loading="lazy"
                decoding="async"
              />
            </picture>
          </div>

          {/* Layer 3: GoKart 3D — WebP 57 KB vs PNG 650 KB (~91% smaller). */}
          <div className="cinema-gokart" ref={gokartRef}>
            <picture>
              <source srcSet="/images/gokart.webp" type="image/webp" />
              <img
                src="/images/gokart.png"
                alt="Go Kart Racer"
                className="cinema-gokart-img"
                loading="lazy"
                decoding="async"
              />
            </picture>
          </div>

          {/* Progress dots */}
          <div className="phone-progress">
            {PROGRESS_LABELS.map((label, i) => (
              <div
                key={label}
                className={`progress-dot${i === activePanel ? ' active' : ''}`}
                data-index={i}
              >
                <span className="progress-label">{label}</span>
              </div>
            ))}
          </div>

          {/* Phone Frame */}
          <div className="phone-frame">
            <div className="phone-notch">
              <span className="phone-time">9:41</span>
              <span className="phone-dynamic-island" />
              <span className="phone-icons">
                <svg width="16" height="12" viewBox="0 0 16 12" fill="white">
                  <rect x="0" y="4" width="3" height="8" rx="1" />
                  <rect x="4" y="2" width="3" height="10" rx="1" />
                  <rect x="8" y="0" width="3" height="12" rx="1" />
                  <rect x="12" y="3" width="3" height="9" rx="1" />
                </svg>
              </span>
            </div>

            <div className="phone-screen">
              {/* Panel 0: Hero Instagram Reel (single, full-cover video) */}
              <div className={panelClass(0)}>
                <div className="hero-reel-container">
                  {reelMedia ? (
                    <video
                      key={reelMedia.mediaUrl}
                      className="hero-reel-video"
                      src={reelMedia.mediaUrl}
                      poster={reelMedia.thumbnailUrl || undefined}
                      autoPlay
                      muted
                      loop
                      playsInline
                      preload="auto"
                    />
                  ) : (
                    <iframe
                      src={HERO_REEL_FALLBACK_EMBED}
                      title="Instagram Reel"
                      allow="encrypted-media"
                      className="hero-reel-fallback-iframe"
                    />
                  )}
                </div>
              </div>

              {/* Panel 1: Engagement */}
              <div className={panelClass(1)}>
                <div className="engagement-screen">
                  <div className="engagement-header">
                    <span className="engagement-tag">📊 INSIGHTS</span>
                    <h3>Reel Performance</h3>
                  </div>
                  <div className="engagement-hero-stat">
                    <div className="engagement-big-number" id="engagementViews">
                      0
                    </div>
                    <div className="engagement-big-label">Total Views</div>
                    <div className="engagement-trend">↑ 340% this week</div>
                  </div>
                  <div className="engagement-grid">
                    {ENG_STATS.map((s) => (
                      <div key={s.id} className="engagement-stat-card">
                        <div className="eng-stat-value" id={s.id}>
                          0
                        </div>
                        <div className="eng-stat-label">{s.label}</div>
                        <div className="eng-stat-bar">
                          <div
                            className="eng-bar-fill"
                            style={{ '--target-width': `${s.target}%` } as React.CSSProperties}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="engagement-chart">
                    <div className="chart-bars">
                      {CHART_BARS.map((b) => (
                        <div
                          key={b.day}
                          className={`chart-bar${b.accent ? ' accent' : ''}`}
                          style={{ '--h': b.h } as React.CSSProperties}
                        >
                          <span>{b.day}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Panel 2: Payment — Reel milestone reward */}
              <div className={panelClass(2)}>
                <div className="payment-screen">
                  <div className="payment-close">✕</div>
                  <div className="payment-body">
                    <div className="payment-check-anim">
                      <svg width="64" height="64" viewBox="0 0 64 64">
                        <circle cx="32" cy="32" r="30" fill="#22C55E" opacity="0.15" />
                        <circle cx="32" cy="32" r="24" fill="#22C55E" />
                        <path
                          className="check-path"
                          d="M20 32l8 8 16-16"
                          stroke="white"
                          strokeWidth="3"
                          fill="none"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                    <div className="payment-amount">₹10,000</div>
                    <div className="payment-label">Payment Sent</div>
                    <div className="payment-time">9:41 • 04 Apr 2026</div>
                    <div className="payment-divider" />
                    <div className="payment-details">
                      <div className="payment-detail-row">
                        <span>Reel Views</span>
                        <strong>1,000,000+</strong>
                      </div>
                      <div className="payment-detail-row">
                        <span>Tier</span>
                        <strong>Legend</strong>
                      </div>
                      <div className="payment-detail-row">
                        <span>Txn ID</span>
                        <strong>#KF-10042026</strong>
                      </div>
                    </div>
                  </div>
                  <div className="payment-reward-card">
                    <div className="reward-icon-wrap">🎉</div>
                    <div className="reward-text">
                      <strong>Your reel just hit 1M views!</strong>
                      <span>Thank you for participating</span>
                    </div>
                    <span className="reward-arrow">›</span>
                  </div>
                </div>
              </div>

              {/* Panel 3: Rewards — Access Passes + Withdraw */}
              <div className={panelClass(3)}>
                <div className="redeem-screen">
                  <div className="redeem-top-bar">Your KartFluencer Rewards 🏆</div>
                  <div className="redeem-cards-row">
                    <div className="redeem-card">
                      <div className="redeem-card-img">
                        <div className="redeem-card-emoji">🎟️</div>
                      </div>
                      <div className="redeem-card-body">
                        <strong>1 Access Pass</strong>
                        <span>Single entry</span>
                      </div>
                    </div>
                    <div className="redeem-card">
                      <div className="redeem-card-img alt">
                        <div className="redeem-card-emoji">🎟️🎟️</div>
                      </div>
                      <div className="redeem-card-body">
                        <strong>2 Access Passes</strong>
                        <span>Bring a friend</span>
                      </div>
                    </div>
                  </div>
                  <div className="redeem-cards-row" style={{ marginTop: 10 }}>
                    <div className="redeem-card">
                      <div className="redeem-card-img">
                        <span className="redeem-exclusive">VIP</span>
                        <div className="redeem-card-emoji">🎟️×4</div>
                      </div>
                      <div className="redeem-card-body">
                        <strong>4 Access Passes</strong>
                        <span>Full squad entry</span>
                      </div>
                    </div>
                  </div>
                  <div className="redeem-gift-card">
                    <div className="gift-inner">
                      <span className="gift-voucher-label">Withdraw Amount</span>
                      <div className="gift-amount">₹10,000</div>
                      <div className="gift-brand-tag">credited to UPI</div>
                    </div>
                  </div>
                  <div className="redeem-bottom-nav">
                    <div className="rnav-item">
                      🎁<span>Rewards</span>
                    </div>
                    <div className="rnav-item active">
                      🏠<span>Redeem</span>
                    </div>
                    <div className="rnav-item">
                      🎯<span>Earn</span>
                    </div>
                    <div className="rnav-item">
                      📦<span>Orders</span>
                    </div>
                    <div className="rnav-item">
                      ☰<span>More</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Panel 4: Locations */}
              <div className={panelClass(4)}>
                <div className="map-phone-screen">
                  <div className="map-phone-header">
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="white"
                      strokeWidth="2"
                    >
                      <path d="M15 18l-6-6 6-6" />
                    </svg>
                    <span>Locations</span>
                  </div>
                  <div
                    className="map-phone-visual"
                    style={{
                      flexDirection: 'column',
                      gap: 8,
                      padding: '0 16px',
                      justifyContent: 'flex-start',
                      paddingTop: 12,
                    }}
                  >
                    {['Visakhapatnam', 'Kakinada', 'Rajahmundry'].map((city) => (
                      <div
                        key={city}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          background: 'rgba(255,122,61,.08)',
                          border: '1px solid rgba(255,122,61,.15)',
                          borderRadius: 12,
                          padding: '10px 14px',
                        }}
                      >
                        <span style={{ fontSize: '1.2rem' }}>📍</span>
                        <div>
                          <div style={{ fontSize: '.8rem', fontWeight: 700 }}>{city}</div>
                          <div style={{ fontSize: '.6rem', color: 'rgba(255,255,255,.5)' }}>
                            Now Available
                          </div>
                        </div>
                        <span
                          style={{
                            marginLeft: 'auto',
                            fontSize: '.55rem',
                            fontWeight: 700,
                            padding: '3px 8px',
                            borderRadius: 20,
                            background: 'rgba(34,197,94,.15)',
                            color: '#22C55E',
                          }}
                        >
                          LIVE
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="map-phone-callout">
                    <div className="callout-pin-anim">📍</div>
                    <h4>Launching Soon in Srikakulam</h4>
                    <p>A Square GoKarting</p>
                    <div className="callout-badge">Coming Q2 2026</div>
                  </div>
                  <div className="map-phone-footer">
                    <button type="button" className="map-notify-btn">
                      Notify Me
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Caption */}
          <div className="phone-caption">
            {CAPTIONS.map((text, i) => (
              <p key={i} className={`caption-text${i === activePanel ? ' active' : ''}`}>
                {text}
              </p>
            ))}
          </div>
        </div>
      </section>

      {/* ===== MISSION ===== */}
      <section className="mission" id="mission">
        <div className="container">
          <h2 className="section-title fade-up">
            A Square GoKarting empowers racers and brands to engage, retain, and grow their
            customers through <em>instant rewards.</em>
          </h2>
        </div>
      </section>

      {/* ===== STATS ===== */}
      <section className="stats" id="stats">
        <div className="container">
          <div className="stats-grid" ref={statsGridRef}>
            {STATS.map((s, i) => (
              <div
                key={s.label}
                className="stat-card fade-up"
                style={{ '--delay': `${i * 0.1}s` } as React.CSSProperties}
              >
                <div className="stat-icon">{s.icon}</div>
                <div className="stat-label">{s.label}</div>
                <div className="stat-value">{s.value}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== FEATURES — Sticky scroll runway ===== */}
      <section className="features-runway" id="features" ref={featuresRef}>
        <div className="features-sticky">
          <div className="container">
            <div className="features-layout">
              {/* Left — sticky text that transitions */}
              <div className="features-text-col">
                {FEATURES_DATA.map((f, i) => (
                  <div
                    key={i}
                    className={`features-text-item${activeFeature === i ? ' active' : ''}`}
                  >
                    <span className="feature-tag">{f.tag}</span>
                    <div className="feature-emoji">{f.emoji}</div>
                    <h3 className="feature-title">{f.title}</h3>
                    <p className="feature-desc">{f.desc}</p>
                  </div>
                ))}
              </div>

              {/* Right — phones that scroll from below */}
              <div className="features-phone-col">
                {/* Step 0: Register */}
                <div className={`features-phone-item${activeFeature === 0 ? ' active' : ''}`}>
                  <div className="feature-phone dark-phone">
                    <div className="feature-phone-screen">
                      <div className="feature-screen-content dark-content">
                        <div className="mini-header">📝 REGISTER</div>
                        <div className="mini-title">Join KartFluencer</div>
                        <div className="mini-cards">
                          <div
                            className="mini-card"
                            style={{
                              background: '#1a1a2e',
                              color: '#fff',
                              border: '1px solid rgba(255,122,61,.2)',
                            }}
                          >
                            <strong>@yourusername</strong>
                            <br />
                            <small style={{ color: 'rgba(255,255,255,.5)' }}>
                              Instagram Handle
                            </small>
                          </div>
                          <div
                            className="mini-card"
                            style={{
                              background: '#1a1a2e',
                              color: '#fff',
                              border: '1px solid rgba(255,122,61,.2)',
                            }}
                          >
                            <strong>Visakhapatnam</strong>
                            <br />
                            <small style={{ color: 'rgba(255,255,255,.5)' }}>Select Branch</small>
                          </div>
                          <div
                            className="mini-card"
                            style={{
                              background: '#1a1a2e',
                              color: '#fff',
                              border: '1px solid rgba(255,122,61,.2)',
                            }}
                          >
                            <strong>15 Apr 2026</strong>
                            <br />
                            <small style={{ color: 'rgba(255,255,255,.5)' }}>Visit Date</small>
                          </div>
                        </div>
                        <button type="button" className="mini-offer-btn" style={{ marginTop: 12 }}>
                          Register Now
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Step 1: Visit */}
                <div className={`features-phone-item${activeFeature === 1 ? ' active' : ''}`}>
                  <div className="feature-phone">
                    <div className="feature-phone-screen">
                      <div className="feature-screen-content">
                        <div className="mini-header">🏎️ RACE DAY</div>
                        <div className="mini-title">Your visit is confirmed!</div>
                        <div className="mini-cards">
                          <div className="mini-card">
                            🎟️ All Access Pass
                            <br />
                            <small>Entry for you + 3 guests</small>
                          </div>
                          <div className="mini-card">
                            🏁 Go-Kart Racing
                            <br />
                            <small>Unlimited laps</small>
                          </div>
                          <div className="mini-card">
                            📸 Pro Photo Coverage
                            <br />
                            <small>Included free</small>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Step 2: Create Reel */}
                <div className={`features-phone-item${activeFeature === 2 ? ' active' : ''}`}>
                  <div className="feature-phone">
                    <div className="feature-phone-screen">
                      <div className="feature-screen-content">
                        <div className="mini-header">🎬 CREATE</div>
                        <div className="mini-title">Reel Checklist</div>
                        <div className="mini-cards">
                          <div className="mini-card">
                            ✅ 30-90 sec Reel
                            <br />
                            <small>Showcase the experience</small>
                          </div>
                          <div className="mini-card">
                            ✅ Tag @asquaregokarting
                            <br />
                            <small>Required</small>
                          </div>
                          <div className="mini-card">
                            ✅ Add location sticker
                            <br />
                            <small>Branch location</small>
                          </div>
                          <div className="mini-card">
                            ✅ Use #ASquareGoKarting
                            <br />
                            <small>Hashtag</small>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Step 3: Submit */}
                <div className={`features-phone-item${activeFeature === 3 ? ' active' : ''}`}>
                  <div className="feature-phone dark-phone">
                    <div className="feature-phone-screen">
                      <div className="feature-screen-content dark-content">
                        <div className="mini-header">📤 SUBMIT</div>
                        <div className="mini-title">Paste your reel link</div>
                        <div className="mini-cards">
                          <div
                            className="mini-card"
                            style={{
                              background: '#1a1a2e',
                              color: '#fff',
                              border: '1px solid rgba(255,122,61,.2)',
                            }}
                          >
                            <strong>instagram.com/reel/...</strong>
                            <br />
                            <small style={{ color: 'rgba(255,255,255,.5)' }}>Reel URL</small>
                          </div>
                        </div>
                        <button type="button" className="mini-offer-btn" style={{ marginTop: 12 }}>
                          Submit Reel
                        </button>
                        <div
                          style={{
                            textAlign: 'center',
                            marginTop: 10,
                            fontSize: '.65rem',
                            color: 'rgba(255,255,255,.4)',
                          }}
                        >
                          Reviewed within 24-48 hours
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Step 4: Go Viral */}
                <div className={`features-phone-item${activeFeature === 4 ? ' active' : ''}`}>
                  <div className="feature-phone">
                    <div className="feature-phone-screen">
                      <div className="feature-screen-content">
                        <div className="mini-header" style={{ background: '#22C55E' }}>
                          📈 TRACKING
                        </div>
                        <div className="mini-title">Reel Performance</div>
                        <div className="mini-stats-grid">
                          <div className="mini-stat">
                            <strong>856K</strong>
                            <br />
                            <small>Views</small>
                          </div>
                          <div className="mini-stat">
                            <strong>42K</strong>
                            <br />
                            <small>Likes</small>
                          </div>
                          <div className="mini-stat">
                            <strong>8.2K</strong>
                            <br />
                            <small>Shares</small>
                          </div>
                        </div>
                        <div className="mini-cards" style={{ marginTop: 12 }}>
                          <div
                            className="mini-card"
                            style={{
                              textAlign: 'center',
                              background: 'linear-gradient(135deg,#fef3c7,#fde68a)',
                              color: '#333',
                            }}
                          >
                            <strong>🔥 Almost there! 144K more to 1M</strong>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Step 5: Get Paid */}
                <div className={`features-phone-item${activeFeature === 5 ? ' active' : ''}`}>
                  <div className="feature-phone dark-phone">
                    <div className="feature-phone-screen">
                      <div
                        className="feature-screen-content dark-content"
                        style={{
                          textAlign: 'center',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          height: '100%',
                          gap: 8,
                        }}
                      >
                        <div style={{ fontSize: '3rem' }}>🎉</div>
                        <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#22C55E' }}>
                          ₹10,000
                        </div>
                        <div style={{ fontSize: '.85rem', fontWeight: 700 }}>Payment Sent!</div>
                        <div
                          style={{
                            fontSize: '.65rem',
                            color: 'rgba(255,255,255,.5)',
                            marginTop: 4,
                          }}
                        >
                          Your reel hit 1M+ views
                        </div>
                        <div
                          style={{
                            marginTop: 12,
                            fontSize: '.6rem',
                            color: 'rgba(255,255,255,.4)',
                            background: 'rgba(255,255,255,.06)',
                            padding: '8px 16px',
                            borderRadius: 12,
                          }}
                        >
                          Credited to UPI • Txn #KF-10042026
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== MAP SECTION ===== */}
      <section className="map-section" id="map" ref={mapSectionRef}>
        <div className="container">
          <h2 className="section-title fade-up">
            KartFluencers are <em>going viral</em> across India
          </h2>
          <p className="section-subtitle fade-up">
            Our influencers create high-energy content from A Square GoKarting venues across Andhra
            Pradesh — reaching millions of viewers and growing fast
          </p>
          <div className="map-wrapper fade-up">
            <div className="india-map">
              <svg viewBox="0 0 500 600" className="map-svg">
                <path
                  className="map-path"
                  d="M200,50 L250,30 L300,40 L340,60 L360,100 L380,130 L400,140 L420,170 L410,200 L430,230 L420,260 L400,280 L410,310 L400,340 L380,360 L370,400 L350,430 L330,460 L310,480 L280,500 L260,520 L240,540 L230,560 L220,540 L200,510 L180,480 L160,450 L150,420 L140,390 L130,360 L120,330 L110,300 L120,270 L130,240 L140,210 L150,180 L160,150 L170,120 L180,90 L190,70 Z"
                />
                {[
                  [190, 200],
                  [300, 180],
                  [250, 300],
                  [220, 350],
                  [280, 250],
                  [350, 280],
                  [260, 420],
                  [310, 350],
                  [270, 470],
                ].map(([cx, cy], i) => (
                  <circle key={i} className="map-dot" cx={cx} cy={cy} r="5" />
                ))}
                <circle className="map-dot-glow-outer" cx="370" cy="270" r="20" />
                <circle className="map-dot-glow" cx="370" cy="270" r="12" />
                <circle className="map-dot-special" cx="370" cy="270" r="6" />
              </svg>
              <div className="map-stats-overlay">
                <div className="map-stat-box">
                  <div className="map-stat-value">90+</div>
                  <div className="map-stat-label">KartFluencers Registered</div>
                  <div className="map-demographics">
                    {[
                      ['Vizag', '38%'],
                      ['Kakinada', '28%'],
                      ['Rajahmundry', '22%'],
                      ['Other', '12%'],
                    ].map(([branch, pct]) => (
                      <div key={branch} className="demo-row">
                        <span>{branch}</span>
                        <div className="demo-bar">
                          <div className="demo-fill" style={{ width: pct }} />
                        </div>
                        <span>{pct}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="map-stat-box bottom">
                  <div className="map-stat-value">10M+</div>
                  <div className="map-stat-label">Total Reel Views Generated</div>
                </div>
                <div className="map-stat-box bottom">
                  <div className="map-stat-value">₹5L+</div>
                  <div className="map-stat-label">Paid to KartFluencers</div>
                </div>
              </div>
            </div>
            <div className="srikakulam-callout fade-up">
              <div className="callout-pin">📍</div>
              <h3>Launching Soon in Srikakulam</h3>
              <p>A Square GoKarting</p>
              <div className="callout-glow" />
            </div>
          </div>
        </div>
      </section>

      {/* ===== IMPACT ===== */}
      <section className="impact" id="impact">
        <div className="container">
          <h2 className="section-title fade-up">
            KartFluencer <em>stories</em>
          </h2>
          <p className="section-subtitle fade-up">
            Real creators, real results. Here's what our KartFluencers have to say.
          </p>
          <div className="influencer-scroll-track">
            {INFLUENCERS.map((inf, i) => (
              <div
                key={i}
                className="influencer-card fade-up"
                style={{ '--delay': `${i * 0.08}s` } as React.CSSProperties}
              >
                <div className="influencer-card-img">
                  <img src={inf.img} alt={inf.name} />
                  <div className="influencer-card-shade" />
                  <div className="influencer-card-badge">{inf.followers}</div>
                </div>
                <div className="influencer-card-body">
                  <p className="influencer-quote">"{inf.quote}"</p>
                  <div className="influencer-info">
                    <strong>{inf.name}</strong>
                    <span>{inf.handle}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== TESTIMONIALS ===== */}
      <section className="testimonials" id="testimonials">
        <div className="container">
          <h2 className="section-title fade-up">
            Voices of <em>KartFluencers</em>
          </h2>
          <p className="section-subtitle fade-up">
            Helicopter joy rides, go-karting, viral reels — hear it from the creators themselves.
          </p>
          <div className="testimonial-carousel">
            <div
              className="testimonial-track"
              style={{ transform: `translateX(-${testimonialIdx * 100}%)` }}
            >
              {TESTIMONIAL_SLIDES.map((slide, si) => (
                <div key={si} className="testimonial-slide">
                  {slide.map((t) => (
                    <div key={t.name} className={`testimonial-card${t.active ? ' active' : ''}`}>
                      <div
                        className="testimonial-header"
                        style={{ display: 'flex', alignItems: 'center', gap: 12 }}
                      >
                        <img
                          src={t.img}
                          alt={t.name}
                          style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }}
                        />
                        <div>
                          <strong>{t.name}</strong>
                          <span>{t.role}</span>
                        </div>
                      </div>
                      <p>"{t.quote}"</p>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="testimonial-nav">
              <button
                type="button"
                className="testimonial-arrow prev"
                aria-label="Previous testimonials"
                onClick={() =>
                  setTestimonialIdx(
                    (prev) => (prev - 1 + TESTIMONIAL_SLIDES.length) % TESTIMONIAL_SLIDES.length,
                  )
                }
              >
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
              <button
                type="button"
                className="testimonial-arrow next"
                aria-label="Next testimonials"
                onClick={() => setTestimonialIdx((prev) => (prev + 1) % TESTIMONIAL_SLIDES.length)}
              >
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ===== FOOTER ===== */}
      <footer className="footer" id="contact">
        <div className="container">
          <div className="footer-grid">
            <div className="footer-brand">
              <button
                type="button"
                className="footer-logo"
                onClick={() => scrollToId('hero')}
                aria-label="A Square GoKarting"
              >
                <img src="/asquare-logo.webp" alt="A Square GoKarting" style={{ height: 28 }} />
              </button>
              <p>
                The official influencer program by A Square GoKarting. Race, create, earn — join 90+
                creators across Andhra Pradesh.
              </p>
              <div className="footer-socials">
                <a
                  href="https://instagram.com/asquaregokarting"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="social-link"
                >
                  📷
                </a>
              </div>
            </div>
            <div className="footer-links-group">
              <h4>Program</h4>
              <a
                href="#features"
                onClick={(e) => {
                  e.preventDefault()
                  scrollToId('features')
                }}
              >
                How It Works
              </a>
              <a
                href="#impact"
                onClick={(e) => {
                  e.preventDefault()
                  scrollToId('impact')
                }}
              >
                Creator Stories
              </a>
              <a
                href="#map"
                onClick={(e) => {
                  e.preventDefault()
                  scrollToId('map')
                }}
              >
                Locations
              </a>
              <a
                href="#apply"
                onClick={(e) => {
                  e.preventDefault()
                  scrollToId('apply')
                }}
              >
                Apply Now
              </a>
            </div>
            <div className="footer-links-group">
              <h4>Rewards</h4>
              <a
                href="#features"
                onClick={(e) => {
                  e.preventDefault()
                  scrollToId('features')
                }}
              >
                Access Passes
              </a>
              <a
                href="#features"
                onClick={(e) => {
                  e.preventDefault()
                  scrollToId('features')
                }}
              >
                Cash Rewards
              </a>
              <a
                href="#features"
                onClick={(e) => {
                  e.preventDefault()
                  scrollToId('features')
                }}
              >
                View Tiers
              </a>
            </div>
            <div className="footer-links-group">
              <h4>Connect</h4>
              <a
                href="https://instagram.com/asquaregokarting"
                target="_blank"
                rel="noopener noreferrer"
              >
                @asquaregokarting
              </a>
              <a
                href="#apply"
                onClick={(e) => {
                  e.preventDefault()
                  scrollToId('apply')
                }}
              >
                Register
              </a>
            </div>
          </div>
          <div className="footer-bottom">
            <p>&copy; {new Date().getFullYear()} A Square GoKarting. KartFluencer Program.</p>
            <div className="footer-bottom-links">
              {/* eslint-disable-next-line jsx-a11y/anchor-is-valid -- TODO: link to actual policy pages once they exist */}
              <a href="#">Privacy Policy</a>
              {/* eslint-disable-next-line jsx-a11y/anchor-is-valid -- TODO: link to actual ToS page once they exist */}
              <a href="#">Terms of Service</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default KartfluencerLandingPage
