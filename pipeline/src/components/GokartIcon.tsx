

interface GokartIconProps {
    className?: string
    size?: 'sm' | 'md' | 'lg'
}

export default function GokartIcon({ className = "", size = 'md' }: GokartIconProps) {
    const sizeClasses = {
        sm: 'w-6 h-6 p-1',
        md: 'w-10 h-10 p-1.5',
        lg: 'w-12 h-12 p-2'
    }

    return (
        <div className={`bg-black rounded-xl flex items-center justify-center overflow-hidden ${sizeClasses[size]} ${className}`}>
            <img
                src="https://asquaregokarting.com/admin_secure/images/games/A%20Square%20logo%20dark%20(1).png"
                alt="A Square Logo"
                className="w-full h-full object-contain"
            />
        </div>
    )
}
