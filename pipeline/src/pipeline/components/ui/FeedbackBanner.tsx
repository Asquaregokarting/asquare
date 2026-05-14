interface FeedbackBannerProps {
  tone: 'error' | 'success' | 'info'
  message: string
}

const toneClasses: Record<FeedbackBannerProps['tone'], string> = {
  error: 'border-critical/45 bg-critical/10 text-critical',
  success: 'border-success/45 bg-success/10 text-success',
  info: 'border-info/45 bg-info/10 text-info',
}

export const FeedbackBanner = ({ tone, message }: FeedbackBannerProps) => (
  <p
    className={`w-full rounded-lg border px-3 py-2 text-sm break-words whitespace-pre-wrap ${toneClasses[tone]}`}
    role={tone === 'error' ? 'alert' : 'status'}
  >
    {message}
  </p>
)

export const FeedbackBannerStack = ({
  error,
  success,
}: {
  error?: string | null
  success?: string | null
}) => (
  <>
    {error ? <FeedbackBanner tone="error" message={error} /> : null}
    {success ? <FeedbackBanner tone="success" message={success} /> : null}
  </>
)
