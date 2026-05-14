import { useCallback, useState } from 'react'
import { feedbackCallsApi } from '../../api/feedback-calls'
import type { FeedbackCallTransition } from '../../api/feedback-calls'
import type { SubmitFeedbackPayload } from '../../api/types'
import { useAuth } from '../auth/auth-context'
import { useAsyncAction } from '../shared/useAsyncAction'

export const useFeedbackCallActions = (onMutate?: () => void) => {
  const { session } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const token = session?.token ?? ''
  const action = useAsyncAction({ setBusy, setError, setSuccess })
  const refresh = () => onMutate?.()

  const markInProgress = useCallback(
    (callId: string) =>
      action(() => feedbackCallsApi.updateStatus(token, callId, 'in_progress'), {
        successMessage: 'Marked in progress',
        fallbackError: 'Failed to update status',
        onSuccess: refresh,
      }),
    [token, action],
  )

  const markNoAnswer = useCallback(
    (callId: string) =>
      action(() => feedbackCallsApi.updateStatus(token, callId, 'no_answer'), {
        successMessage: 'Logged as no answer',
        fallbackError: 'Failed to update status',
        onSuccess: refresh,
      }),
    [token, action],
  )

  const markCallLater = useCallback(
    (callId: string, nextAttemptAt?: string) =>
      action(() => feedbackCallsApi.updateStatus(token, callId, 'call_later', { nextAttemptAt }), {
        successMessage: 'Scheduled for later',
        fallbackError: 'Failed to update status',
        onSuccess: refresh,
      }),
    [token, action],
  )

  const submitFeedback = useCallback(
    (callId: string, payload: SubmitFeedbackPayload) =>
      action(() => feedbackCallsApi.submitFeedback(token, callId, payload), {
        successMessage: 'Feedback saved',
        fallbackError: 'Failed to save feedback',
        onSuccess: refresh,
      }),
    [token, action],
  )

  const updateStatus = useCallback(
    (callId: string, next: FeedbackCallTransition, nextAttemptAt?: string) =>
      action(
        () =>
          feedbackCallsApi.updateStatus(
            token,
            callId,
            next,
            nextAttemptAt ? { nextAttemptAt } : undefined,
          ),
        {
          successMessage: 'Status updated',
          fallbackError: 'Failed to update status',
          onSuccess: refresh,
        },
      ),
    [token, action],
  )

  const triggerDistribution = useCallback(
    (forDate?: string) =>
      action(() => feedbackCallsApi.triggerDistribution(token, forDate ? { forDate } : undefined), {
        successMessage: 'Distribution complete',
        fallbackError: 'Failed to run distribution',
        onSuccess: refresh,
      }),
    [token, action],
  )

  return {
    busy,
    error,
    success,
    setError,
    setSuccess,
    markInProgress,
    markNoAnswer,
    markCallLater,
    submitFeedback,
    updateStatus,
    triggerDistribution,
  }
}
