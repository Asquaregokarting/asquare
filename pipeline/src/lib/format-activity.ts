/**
 * Shared display formatters for activity/cart items.
 *
 * Transforms raw activity data (where variant info is baked into the name
 * string) into a structured label:
 *   "Go Karting – Adult – 8 Laps"
 *   "Zipline – Single Zipline"
 *   "Mechanical Bull"
 */

interface ActivityLike {
  name: string
  category?: string
}

const GOKARTING_RE = /^Gokarting\s+(\w+)(?:\s*\((\d+\s*Laps)\))?$/i

/**
 * Returns a structured label for an activity without quantity.
 *
 * Examples:
 *  - "Gokarting Adult (8 Laps)" → "Go Karting – Adult – 8 Laps"
 *  - { name: "Single Zipline", category: "Zipline" } → "Zipline – Single Zipline"
 *  - { name: "Mechanical Bull", category: "Mechanical Bull" } → "Mechanical Bull"
 */
export function formatActivityLabel(activity: ActivityLike): string {
  const { name, category } = activity
  const lowerCat = (category || '').toLowerCase()

  // Go-Karting: parse "Gokarting Adult (8 Laps)" into structured parts
  if (lowerCat === 'gokarting' || lowerCat.includes('kart')) {
    const match = name.match(GOKARTING_RE)
    if (match) {
      const parts = ['Go Karting', match[1]]
      if (match[2]) parts.push(match[2])
      return parts.join(' – ')
    }
  }

  // Non-gokarting: show "Category – Name" when they differ
  if (category && category.toLowerCase() !== name.toLowerCase()) {
    return `${category} – ${name}`
  }

  return name
}

/**
 * Returns a structured label with quantity: "Go Karting – Adult – 8 Laps × 4"
 */
export function formatActivityDisplay(activity: ActivityLike, quantity: number): string {
  return `${formatActivityLabel(activity)} × ${quantity}`
}
