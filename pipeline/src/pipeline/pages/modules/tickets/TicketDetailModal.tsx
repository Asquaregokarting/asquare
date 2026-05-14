import { ModalShell } from '../../../components/ui/ModalShell'
import { TicketDetailContent } from './TicketDetailContent'
import type { Role, Ticket } from '../../../api/types'

interface TicketDetailModalProps {
  open: boolean
  onClose: () => void
  ticket: Ticket
  actor: { id: string; name: string; role: Role }
}

export const TicketDetailModal = ({ open, onClose, ticket, actor }: TicketDetailModalProps) => (
  <ModalShell open={open} onClose={onClose} maxWidth="max-w-4xl">
    <TicketDetailContent ticket={ticket} actor={actor} surface="modal" />
  </ModalShell>
)
