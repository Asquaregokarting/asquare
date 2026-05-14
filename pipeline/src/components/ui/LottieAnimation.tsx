import Lottie from 'lottie-react'
import { useState, useEffect } from 'react'

// In-memory cache to avoid re-fetching the same animation JSON
const animationCache = new Map<string, object>()

interface LottieAnimationProps {
    src: string
    loop?: boolean
    autoplay?: boolean
    className?: string
    style?: React.CSSProperties
}

export default function LottieAnimation({
    src,
    loop = true,
    autoplay = true,
    className = '',
    style
}: LottieAnimationProps) {
    const [animationData, setAnimationData] = useState<object | null>(
        () => animationCache.get(src) ?? null
    )
    const [error, setError] = useState(false)

    useEffect(() => {
        if (animationCache.has(src)) {
            setAnimationData(animationCache.get(src)!)
            return
        }

        let cancelled = false
        fetch(src)
            .then(res => res.json())
            .then(data => {
                animationCache.set(src, data)
                if (!cancelled) setAnimationData(data)
            })
            .catch(() => {
                if (!cancelled) setError(true)
            })

        return () => { cancelled = true }
    }, [src])

    if (error || !animationData) {
        return <div className={className} style={style} />
    }

    return (
        <Lottie
            animationData={animationData}
            loop={loop}
            autoplay={autoplay}
            className={className}
            style={style}
        />
    )
}
