import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { getAsquareFirestore } from './asquare-firestore'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CarouselSlide {
  id: string
  title: string
  subtitle: string
  highlightText: string
  highlightColor: string
  backgroundColor: string
  accentColor: string
  badgeText: string
  imageUrl: string
  buttonText: string
  buttonLink: string
  secondaryButtonText: string
  secondaryButtonLink: string
  position: number
  isActive: boolean
}

export interface CarouselConfig {
  slides: CarouselSlide[]
  autoRotateInterval: number
}

// ---------------------------------------------------------------------------
// Defaults (seed data matching current hardcoded slides)
// ---------------------------------------------------------------------------

const DEFAULT_SLIDES: CarouselSlide[] = [
  {
    id: 'gokart',
    title: 'High-Speed Adventure Awaits',
    subtitle:
      'Experience the thrill of professional go-kart racing across 4 locations in Andhra Pradesh.',
    highlightText: '',
    highlightColor: '#FF6B00',
    backgroundColor: '#001636',
    accentColor: '#FF6B00',
    badgeText: 'Go Karting',
    imageUrl: '/gokart.webp',
    buttonText: 'Explore Activities',
    buttonLink: '/activities',
    secondaryButtonText: '',
    secondaryButtonLink: '',
    position: 0,
    isActive: true,
  },
  {
    id: 'helicopter',
    title: 'Joy Rides',
    subtitle: 'Helicopter adventures in 3 cities. Book your sky-high experience today.',
    highlightText: '',
    highlightColor: '#facc15',
    backgroundColor: '#1a1a2e',
    accentColor: '#facc15',
    badgeText: 'Helicopter Rides',
    imageUrl: '/helicopter-banner-placeholder.jpg',
    buttonText: 'Book Now',
    buttonLink: '/helicopter-bookings',
    secondaryButtonText: '',
    secondaryButtonLink: '',
    position: 1,
    isActive: true,
  },
  {
    id: 'influencer',
    title: 'Are you an Influencer?',
    subtitle: 'Create reels about your GoKarting experience and earn up to per reel',
    highlightText: '₹10,000',
    highlightColor: '#E10600',
    backgroundColor: '#15151E',
    accentColor: '#E10600',
    badgeText: 'Kartfluencer',
    imageUrl: '',
    buttonText: 'Join Kartfluencer',
    buttonLink: '/influencer-portal',
    secondaryButtonText: '',
    secondaryButtonLink: '',
    position: 2,
    isActive: true,
  },
  {
    id: 'partner',
    title: 'Partner With Us',
    subtitle: 'Become an A Square GoKarting franchise partner. Expanding to',
    highlightText: 'Srikakulam',
    highlightColor: '#0066FF',
    backgroundColor: '#0a1628',
    accentColor: '#0066FF',
    badgeText: 'Franchise Opportunity',
    imageUrl: '',
    buttonText: 'Become a Partner',
    buttonLink: '/partner',
    secondaryButtonText: 'Brochure',
    secondaryButtonLink: '/brochure-srikakulam.pdf',
    position: 3,
    isActive: true,
  },
]

const DEFAULT_CONFIG: CarouselConfig = {
  slides: DEFAULT_SLIDES,
  autoRotateInterval: 100000,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DOC_PATH = 'settings'
const DOC_ID = 'carousel_config'

function mapSlide(raw: Record<string, unknown>): CarouselSlide {
  return {
    id: String(raw.id ?? ''),
    title: String(raw.title ?? ''),
    subtitle: String(raw.subtitle ?? ''),
    highlightText: String(raw.highlightText ?? ''),
    highlightColor: String(raw.highlightColor ?? '#FF6B00'),
    backgroundColor: String(raw.backgroundColor ?? '#001636'),
    accentColor: String(raw.accentColor ?? '#FF6B00'),
    badgeText: String(raw.badgeText ?? ''),
    imageUrl: String(raw.imageUrl ?? ''),
    buttonText: String(raw.buttonText ?? ''),
    buttonLink: String(raw.buttonLink ?? ''),
    secondaryButtonText: String(raw.secondaryButtonText ?? ''),
    secondaryButtonLink: String(raw.secondaryButtonLink ?? ''),
    position: Number(raw.position ?? 0),
    isActive: raw.isActive !== false,
  }
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export const carouselConfigApi = {
  async getConfig(): Promise<CarouselConfig> {
    const firestore = getAsquareFirestore()
    const snap = await getDoc(doc(firestore, DOC_PATH, DOC_ID))

    if (!snap.exists()) {
      return DEFAULT_CONFIG
    }

    const data = snap.data() as Record<string, unknown>
    const slides: CarouselSlide[] = Array.isArray(data.slides)
      ? (data.slides as Record<string, unknown>[]).map(mapSlide)
      : DEFAULT_SLIDES

    return {
      slides: slides.sort((a, b) => a.position - b.position),
      autoRotateInterval: Number(data.autoRotateInterval ?? 100000),
    }
  },

  async saveConfig(config: CarouselConfig): Promise<void> {
    const firestore = getAsquareFirestore()
    await setDoc(doc(firestore, DOC_PATH, DOC_ID), {
      slides: config.slides,
      autoRotateInterval: config.autoRotateInterval,
      updatedAt: serverTimestamp(),
    })
  },

  async toggleSlide(slideId: string, isActive: boolean): Promise<void> {
    const config = await this.getConfig()
    const slides = config.slides.map((s) => (s.id === slideId ? { ...s, isActive } : s))
    await this.saveConfig({ ...config, slides })
  },

  async deleteSlide(slideId: string): Promise<void> {
    const config = await this.getConfig()
    const slides = config.slides
      .filter((s) => s.id !== slideId)
      .map((s, i) => ({ ...s, position: i }))
    await this.saveConfig({ ...config, slides })
  },

  async upsertSlide(slide: CarouselSlide): Promise<void> {
    const config = await this.getConfig()
    const idx = config.slides.findIndex((s) => s.id === slide.id)
    const slides = [...config.slides]
    if (idx >= 0) {
      slides[idx] = slide
    } else {
      slides.push({ ...slide, position: slides.length })
    }
    await this.saveConfig({ ...config, slides })
  },

  async reorderSlides(slideIds: string[]): Promise<void> {
    const config = await this.getConfig()
    const slideMap = new Map(config.slides.map((s) => [s.id, s]))
    const reordered = slideIds
      .map((id, i) => {
        const slide = slideMap.get(id)
        return slide ? { ...slide, position: i } : null
      })
      .filter((s): s is CarouselSlide => s !== null)
    await this.saveConfig({ ...config, slides: reordered })
  },

  getDefaultSlides(): CarouselSlide[] {
    return DEFAULT_SLIDES
  },

  createEmptySlide(): CarouselSlide {
    return {
      id: `slide-${Date.now()}`,
      title: '',
      subtitle: '',
      highlightText: '',
      highlightColor: '#FF6B00',
      backgroundColor: '#001636',
      accentColor: '#0066FF',
      badgeText: '',
      imageUrl: '',
      buttonText: '',
      buttonLink: '',
      secondaryButtonText: '',
      secondaryButtonLink: '',
      position: 0,
      isActive: true,
    }
  },
}
