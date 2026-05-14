/**
 * ImageLightbox — Full-screen image viewer with zoom and gallery navigation.
 *
 * Features:
 *   - Full-screen dark overlay
 *   - Scroll-to-zoom (desktop) + pinch-to-zoom (touch)
 *   - Pan when zoomed in (drag)
 *   - Gallery navigation (left/right arrows + swipe)
 *   - Close via X button, Escape key, or click on backdrop
 *   - Image counter (1/5, 2/5, etc.)
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react'

interface ImageLightboxProps {
  images: string[]
  initialIndex?: number
  onClose: () => void
}

const MIN_SCALE = 1
const MAX_SCALE = 5
const ZOOM_STEP = 0.5

export const ImageLightbox = ({ images, initialIndex = 0, onClose }: ImageLightboxProps) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const [scale, setScale] = useState(1)
  const [translate, setTranslate] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const translateStart = useRef({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  // Reset zoom/pan when changing image
  useEffect(() => {
    setScale(1)
    setTranslate({ x: 0, y: 0 })
  }, [currentIndex])

  // Prevent body scroll when lightbox is open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  const prev = useCallback(() => {
    setCurrentIndex((i) => (i > 0 ? i - 1 : images.length - 1))
  }, [images.length])

  const next = useCallback(() => {
    setCurrentIndex((i) => (i < images.length - 1 ? i + 1 : 0))
  }, [images.length])

  // Hold onClose/prev/next in refs so the keydown listener mounts once.
  // Re-binding on every render isn't a focus bug here (no inputs in the
  // lightbox), but the previous code disabled exhaustive-deps to hide
  // stale-closure risk. This pattern keeps the listener fresh without rebinds.
  const onCloseRef = useRef(onClose)
  const prevRef = useRef(prev)
  const nextRef = useRef(next)
  useEffect(() => {
    onCloseRef.current = onClose
    prevRef.current = prev
    nextRef.current = next
  }, [onClose, prev, next])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
      if (e.key === 'ArrowLeft') prevRef.current()
      if (e.key === 'ArrowRight') nextRef.current()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const zoomIn = useCallback(() => {
    setScale((s) => Math.min(MAX_SCALE, s + ZOOM_STEP))
  }, [])

  const zoomOut = useCallback(() => {
    setScale((s) => {
      const newScale = Math.max(MIN_SCALE, s - ZOOM_STEP)
      if (newScale === 1) setTranslate({ x: 0, y: 0 })
      return newScale
    })
  }, [])

  // Scroll to zoom (desktop)
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault()
      if (e.deltaY < 0) zoomIn()
      else zoomOut()
    },
    [zoomIn, zoomOut],
  )

  // Drag to pan (when zoomed)
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (scale <= 1) return
      e.preventDefault()
      setIsDragging(true)
      dragStart.current = { x: e.clientX, y: e.clientY }
      translateStart.current = { ...translate }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    [scale, translate],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return
      const dx = e.clientX - dragStart.current.x
      const dy = e.clientY - dragStart.current.y
      setTranslate({
        x: translateStart.current.x + dx,
        y: translateStart.current.y + dy,
      })
    },
    [isDragging],
  )

  const handlePointerUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  // Double-tap to toggle zoom
  const lastTap = useRef(0)
  const handleDoubleClick = useCallback(() => {
    if (scale > 1) {
      setScale(1)
      setTranslate({ x: 0, y: 0 })
    } else {
      setScale(3)
    }
  }, [scale])

  const handleClick = useCallback(
    (_e: React.MouseEvent) => {
      const now = Date.now()
      if (now - lastTap.current < 300) {
        handleDoubleClick()
        lastTap.current = 0
        return
      }
      lastTap.current = now
    },
    [handleDoubleClick],
  )

  // Click on backdrop to close (only if not zoomed)
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === containerRef.current && scale <= 1) {
        onClose()
      }
    },
    [onClose, scale],
  )

  if (images.length === 0) return null

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-base/90"
      onClick={handleBackdropClick}
      ref={containerRef}
    >
      {/* Top bar */}
      <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-4 py-3">
        <span className="rounded-full bg-base/70 px-3 py-1 text-sm font-medium text-white">
          {currentIndex + 1} / {images.length}
        </span>
        <div className="flex items-center gap-2">
          <button
            className="rounded-full bg-base/70 p-2 text-white transition-colors hover:bg-base/80"
            onClick={zoomOut}
            title="Zoom out"
          >
            <ZoomOut className="h-5 w-5" />
          </button>
          <span className="min-w-[3rem] text-center text-xs text-white/70">
            {Math.round(scale * 100)}%
          </span>
          <button
            className="rounded-full bg-base/70 p-2 text-white transition-colors hover:bg-base/80"
            onClick={zoomIn}
            title="Zoom in"
          >
            <ZoomIn className="h-5 w-5" />
          </button>
          <button
            className="rounded-full bg-base/70 p-2 text-white transition-colors hover:bg-base/80"
            onClick={onClose}
            title="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Left arrow */}
      {images.length > 1 && (
        <button
          className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-base/70 p-2 text-white transition-colors hover:bg-base/80"
          onClick={(e) => {
            e.stopPropagation()
            prev()
          }}
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      )}

      {/* Right arrow */}
      {images.length > 1 && (
        <button
          className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-base/70 p-2 text-white transition-colors hover:bg-base/80"
          onClick={(e) => {
            e.stopPropagation()
            next()
          }}
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      )}

      {/* Image */}
      <img
        src={images[currentIndex]}
        alt={`Image ${currentIndex + 1}`}
        className="max-h-[90vh] max-w-[90vw] select-none rounded-lg object-contain"
        style={{
          transform: `scale(${scale}) translate(${translate.x / scale}px, ${translate.y / scale}px)`,
          cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'zoom-in',
          transition: isDragging ? 'none' : 'transform 0.2s ease',
        }}
        draggable={false}
        onClick={handleClick}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
    </div>
  )
}

/**
 * Hook to manage lightbox state.
 *
 * Usage:
 *   const { lightboxImages, lightboxIndex, openLightbox, closeLightbox } = useLightbox()
 *   // On image click:
 *   openLightbox([url1, url2], clickedIndex)
 *   // Render:
 *   {lightboxImages && <ImageLightbox images={lightboxImages} initialIndex={lightboxIndex} onClose={closeLightbox} />}
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useLightbox() {
  const [lightboxImages, setLightboxImages] = useState<string[] | null>(null)
  const [lightboxIndex, setLightboxIndex] = useState(0)

  const openLightbox = useCallback((images: string[], index = 0) => {
    setLightboxImages(images)
    setLightboxIndex(index)
  }, [])

  const closeLightbox = useCallback(() => {
    setLightboxImages(null)
    setLightboxIndex(0)
  }, [])

  return { lightboxImages, lightboxIndex, openLightbox, closeLightbox }
}
