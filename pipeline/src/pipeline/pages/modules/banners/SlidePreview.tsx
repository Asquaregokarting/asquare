import type { CarouselSlide } from '../../../api/carousel-config-firestore'

interface SlidePreviewProps {
  slide: CarouselSlide
}

const SlidePreview = ({ slide }: SlidePreviewProps) => {
  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl"
      style={{ backgroundColor: slide.backgroundColor, minHeight: 200 }}
    >
      {/* Accent bar */}
      <div
        className="absolute top-0 left-0 right-0 h-1"
        style={{ backgroundColor: slide.accentColor }}
      />

      {/* Background glow */}
      <div
        className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] rounded-full blur-[80px] opacity-20"
        style={{ backgroundColor: slide.accentColor }}
      />

      {/* Content */}
      <div className="relative z-10 flex flex-col justify-center p-6 min-h-[200px]">
        {slide.badgeText && (
          <span
            className="inline-block self-start px-3 py-1 rounded-full text-xs font-bold tracking-wide uppercase mb-3 border"
            style={{
              color: slide.accentColor,
              backgroundColor: `${slide.accentColor}15`,
              borderColor: `${slide.accentColor}30`,
            }}
          >
            {slide.badgeText}
          </span>
        )}

        <h3 className="text-white font-display font-black text-xl uppercase tracking-tight leading-tight">
          {slide.title || 'Slide Title'}
        </h3>

        {slide.subtitle && (
          <p className="mt-2 text-white/40 text-sm max-w-md leading-relaxed">
            {slide.subtitle}
            {slide.highlightText && (
              <>
                {' '}
                <span className="font-bold" style={{ color: slide.highlightColor }}>
                  {slide.highlightText}
                </span>
              </>
            )}
          </p>
        )}

        <div className="flex items-center gap-2 mt-4">
          {slide.buttonText && (
            <span
              className="px-4 py-2 text-white font-bold rounded-full text-xs uppercase tracking-wider"
              style={{ backgroundColor: slide.accentColor }}
            >
              {slide.buttonText}
            </span>
          )}
          {slide.secondaryButtonText && (
            <span className="px-4 py-2 border border-white/20 text-white font-semibold rounded-full text-xs uppercase tracking-wider">
              {slide.secondaryButtonText}
            </span>
          )}
        </div>
      </div>

      {/* Image overlay */}
      {slide.imageUrl && (
        <div className="absolute right-0 bottom-0 w-1/3 h-full opacity-30">
          <img src={slide.imageUrl} alt="" className="h-full w-full object-cover object-center" />
        </div>
      )}

      {/* Inactive overlay */}
      {!slide.isActive && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-base/75 rounded-2xl">
          <span className="px-4 py-2 rounded-full bg-red-500/20 border border-red-500/40 text-red-400 text-xs font-bold uppercase tracking-wider">
            Inactive
          </span>
        </div>
      )}
    </div>
  )
}

export default SlidePreview
