import type { EventCampaignStatus } from '../../../features/event-campaigns/event-campaign-types'

interface Props {
  message: string | null
  sentAt: string | null
  status: EventCampaignStatus
  onMessageChange: (msg: string) => void
  onSend: () => void
}

const PostEventNotificationSection = ({
  message,
  sentAt,
  status,
  onMessageChange,
  onSend,
}: Props) => (
  <section className="rounded-2xl border border-border bg-surface p-5">
    <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
      Post-Event Notification
    </h3>
    <p className="mt-1 text-xs text-muted">Send a message to users when this event ends.</p>

    <textarea
      value={message ?? ''}
      onChange={(e) => onMessageChange(e.target.value)}
      placeholder="e.g. Thank you for being part of our Summer Festival! Stay tuned for upcoming events."
      rows={3}
      className="ui-field mt-3 w-full text-sm"
    />

    {sentAt ? (
      <div className="mt-3 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-xs text-info">
        Notification sent on {new Date(sentAt).toLocaleDateString()}
      </div>
    ) : (
      <button
        type="button"
        disabled={status !== 'ended' || !message?.trim()}
        onClick={onSend}
        className="ui-btn ui-btn-neutral mt-3 min-h-9 px-4 text-xs disabled:cursor-not-allowed disabled:opacity-50"
      >
        Send Notification
      </button>
    )}

    {status !== 'ended' && !sentAt && (
      <p className="mt-2 text-[11px] text-muted">
        Available once the event status is set to "Ended".
      </p>
    )}
  </section>
)

export default PostEventNotificationSection
