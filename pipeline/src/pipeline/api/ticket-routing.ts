import type { Role, TicketCategory } from './types'

export interface RoutingCandidate {
  id: string
  name: string
  role: Role
  branchId: string
  active: boolean
  /** Last time this user was assigned a ticket. Used for round-robin tie-break. */
  lastAssignedAtMs: number
}

export interface RoutingResult {
  assigneeId: string
  assigneeRole: Role
  assigneeName: string
  /** Remaining roles after the chosen one — used by slaWatcher to escalate. */
  escalationChain: Role[]
}

export function routeTicket(
  category: TicketCategory,
  branchId: string,
  candidates: ReadonlyArray<RoutingCandidate>,
): RoutingResult | null {
  for (let i = 0; i < category.routingChain.length; i += 1) {
    const role = category.routingChain[i]
    const eligible = candidates
      .filter((c) => c.active && c.role === role && c.branchId === branchId)
      .sort((a, b) => a.lastAssignedAtMs - b.lastAssignedAtMs || a.id.localeCompare(b.id))
    if (eligible.length > 0) {
      const chosen = eligible[0]
      return {
        assigneeId: chosen.id,
        assigneeRole: chosen.role,
        assigneeName: chosen.name,
        escalationChain: category.routingChain.slice(i + 1),
      }
    }
  }
  // Fallback: anyone in the chain at any branch.
  for (let i = 0; i < category.routingChain.length; i += 1) {
    const role = category.routingChain[i]
    const eligible = candidates
      .filter((c) => c.active && c.role === role)
      .sort((a, b) => a.lastAssignedAtMs - b.lastAssignedAtMs || a.id.localeCompare(b.id))
    if (eligible.length > 0) {
      const chosen = eligible[0]
      return {
        assigneeId: chosen.id,
        assigneeRole: chosen.role,
        assigneeName: chosen.name,
        escalationChain: category.routingChain.slice(i + 1),
      }
    }
  }
  return null
}
