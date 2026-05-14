import type { SpinPrize } from '../types'

// Prize pool configuration for the spin wheel
// Weights determine probability (higher weight = more likely)
export const spinPrizes: SpinPrize[] = [
    // COMMON PRIZES (60-70% total weight)
    {
        id: 'tires-50',
        name: '50 Tires',
        description: 'Instant tires bonus',
        tier: 'common',
        type: 'tires',
        value: 50,
        icon: '🛞',
        color: 'from-blue-400 to-blue-600',
        weight: 25,
    },
    {
        id: 'tires-100',
        name: '100 Tires',
        description: 'Nice tires boost',
        tier: 'common',
        type: 'tires',
        value: 100,
        icon: '🛞',
        color: 'from-cyan-400 to-cyan-600',
        weight: 20,
    },
    {
        id: 'discount-5',
        name: '5% Discount',
        description: 'On your next booking',
        tier: 'common',
        type: 'discount',
        value: 5,
        icon: '🎫',
        color: 'from-indigo-400 to-indigo-600',
        weight: 20,
    },

    // GRAND PRIZES (25-35% total weight)
    {
        id: 'tires-300',
        name: '300 Tires',
        description: 'Major tires reward',
        tier: 'grand',
        type: 'tires',
        value: 300,
        icon: '🛞',
        color: 'from-purple-400 to-purple-600',
        weight: 12,
    },
    {
        id: 'discount-10',
        name: '10% Discount',
        description: 'Great savings on booking',
        tier: 'grand',
        type: 'discount',
        value: 10,
        icon: '🎁',
        color: 'from-pink-400 to-pink-600',
        weight: 10,
    },
    {
        id: 'discount-15',
        name: '15% Discount',
        description: 'Great savings on booking',
        tier: 'grand',
        type: 'discount',
        value: 15,
        icon: '🎫',
        color: 'from-orange-400 to-orange-600',
        weight: 8,
    },

    // MEGA PRIZES (5-10% total weight)
    {
        id: 'tires-1000',
        name: '1000 Tires!',
        description: 'Massive tires jackpot',
        tier: 'mega',
        type: 'tires',
        value: 1000,
        icon: '🛞',
        color: 'from-yellow-400 to-yellow-600',
        weight: 3,
    },
    {
        id: 'free-session',
        name: 'free 4 laps',
        description: 'One free 4-lap session',
        tier: 'mega',
        type: 'freebie',
        value: 1,
        icon: '🏆',
        color: 'from-amber-400 to-amber-600',
        weight: 2,
    },
]

// Helper function to select a random prize based on weights
export function getRandomPrize(): SpinPrize {
    const totalWeight = spinPrizes.reduce((sum, prize) => sum + prize.weight, 0)
    let random = Math.random() * totalWeight

    for (const prize of spinPrizes) {
        random -= prize.weight
        if (random <= 0) {
            return prize
        }
    }

    // Fallback (should never reach here)
    return spinPrizes[0]
}
