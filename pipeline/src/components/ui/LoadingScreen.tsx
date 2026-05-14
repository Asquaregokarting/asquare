import LottieAnimation from './LottieAnimation'

export default function LoadingScreen() {
  return (
    <div className="min-h-screen bg-dark-900 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4 md:gap-6">
        {/* Lottie Racing Animation */}
        <LottieAnimation
          src="/animations/loading-racing.json"
          className="w-40 h-40 md:w-52 md:h-52 lg:w-64 lg:h-64"
        />

        {/* Brand name */}
        <div className="text-center">
          <h1 className="text-2xl md:text-3xl lg:text-4xl font-display font-bold gradient-text">
            A Square
          </h1>
          <p className="text-dark-400 text-sm md:text-base">Go-Karting</p>
        </div>
      </div>
    </div>
  )
}
