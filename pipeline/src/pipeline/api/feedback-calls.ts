import {
  listFirestoreFeedbackCalls,
  getFirestoreFeedbackCall,
  updateFeedbackCallStatus,
  submitFeedbackCallResult,
  triggerFeedbackCallsDistribution,
  getFirestoreFeedbackCallRun,
  listFirestoreFeedbackCallRuns,
  getFirestoreFeedbackCallMetrics,
  type FeedbackCallTransition,
  type FeedbackMetricsFilter,
} from './feedback-calls-firestore'

export const feedbackCallsApi = {
  list: listFirestoreFeedbackCalls,
  get: getFirestoreFeedbackCall,
  updateStatus: updateFeedbackCallStatus,
  submitFeedback: submitFeedbackCallResult,
  triggerDistribution: triggerFeedbackCallsDistribution,
  getRun: getFirestoreFeedbackCallRun,
  listRuns: listFirestoreFeedbackCallRuns,
  getMetrics: getFirestoreFeedbackCallMetrics,
}

export type { FeedbackCallTransition, FeedbackMetricsFilter }
