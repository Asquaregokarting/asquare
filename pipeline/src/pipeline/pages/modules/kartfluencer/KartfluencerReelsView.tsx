import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../../features/auth/auth-context'
import { kartfluencerApi } from '../../../api/kartfluencer'
import { VIEW_PAYMENT_TIERS, calculateIncrementalPayout } from '../../../api/kartfluencer-firestore'
import type { KartfluencerReel, KartfluencerViewTier } from '../../../api/types'
import {
  ExternalLink,
  CheckCircle,
  XCircle,
  Film,
  Eye,
  TrendingUp,
  DollarSign,
  BarChart3,
} from 'lucide-react'
import { logger } from '../../../../lib/logger'

const VIEW_TIER_COLORS: Record<KartfluencerViewTier, string> = {
  below_threshold: 'bg-gray-100 text-gray-600',
  starter: 'bg-sky-100 text-sky-700',
  bronze_views: 'bg-orange-100 text-orange-700',
  silver_views: 'bg-slate-200 text-slate-700',
  gold_views: 'bg-yellow-100 text-yellow-700',
  viral: 'bg-purple-100 text-purple-700',
}

const KartfluencerReelsView = () => {
  const { session } = useAuth()
  const token = session?.token ?? ''

  const [reels, setReels] = useState<KartfluencerReel[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState<'' | 'pending' | 'verified' | 'rejected'>('')
  const [actionId, setActionId] = useState<string | null>(null)
  const [viewsModal, setViewsModal] = useState<{ reelId: string; influencerId: string } | null>(
    null,
  )
  const [viewCountInput, setViewCountInput] = useState('')

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const data = await kartfluencerApi.listReels(token)
      setReels(data)
    } catch (err) {
      logger.error('kartfluencer.load_reels_failed', err)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    if (!filterStatus) return reels
    return reels.filter((r) => r.status === filterStatus)
  }, [reels, filterStatus])

  const pendingCount = useMemo(() => reels.filter((r) => r.status === 'pending').length, [reels])
  const verifiedCount = useMemo(() => reels.filter((r) => r.status === 'verified').length, [reels])
  const rejectedCount = useMemo(() => reels.filter((r) => r.status === 'rejected').length, [reels])
  const milestoneReadyCount = useMemo(() => reels.filter((r) => r.milestoneReady).length, [reels])

  const handleReview = async (reel: KartfluencerReel, status: 'verified' | 'rejected') => {
    setActionId(reel.id)
    try {
      await kartfluencerApi.updateReel(token, reel.influencerId, reel.id, status)
      void load()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update reel')
    } finally {
      setActionId(null)
    }
  }

  const handleApprovePayout = async (reel: KartfluencerReel) => {
    setActionId(reel.id)
    try {
      await kartfluencerApi.approveMilestonePayout(token, reel.influencerId, reel.id)
      void load()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to approve payout')
    } finally {
      setActionId(null)
    }
  }

  const handleUpdateViews = async () => {
    if (!viewsModal) return
    const count = parseInt(viewCountInput, 10)
    if (isNaN(count) || count < 0) {
      alert('Enter a valid view count.')
      return
    }
    setActionId(viewsModal.reelId)
    try {
      await kartfluencerApi.updateReelViews(
        token,
        viewsModal.influencerId,
        viewsModal.reelId,
        count,
      )
      setViewsModal(null)
      setViewCountInput('')
      void load()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update views')
    } finally {
      setActionId(null)
    }
  }

  const getViewTierLabel = (tier: KartfluencerViewTier): string =>
    VIEW_PAYMENT_TIERS.find((t) => t.tier === tier)?.label ?? tier

  return (
    <div className="ui-section-stack">
      {/* Stats */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => setFilterStatus('')}
          className={`rounded-lg border px-4 py-2 text-xs font-medium transition-colors ${
            filterStatus === ''
              ? 'border-accent bg-accent/10 text-accent'
              : 'border-border/50 bg-surface/80 text-muted hover:border-accent/30'
          }`}
        >
          All ({reels.length})
        </button>
        <button
          onClick={() => setFilterStatus('pending')}
          className={`rounded-lg border px-4 py-2 text-xs font-medium transition-colors ${
            filterStatus === 'pending'
              ? 'border-yellow-400 bg-yellow-50 text-yellow-700'
              : 'border-border/50 bg-surface/80 text-muted hover:border-yellow-300'
          }`}
        >
          Pending ({pendingCount})
        </button>
        <button
          onClick={() => setFilterStatus('verified')}
          className={`rounded-lg border px-4 py-2 text-xs font-medium transition-colors ${
            filterStatus === 'verified'
              ? 'border-green-400 bg-green-50 text-green-700'
              : 'border-border/50 bg-surface/80 text-muted hover:border-green-300'
          }`}
        >
          Verified ({verifiedCount})
        </button>
        <button
          onClick={() => setFilterStatus('rejected')}
          className={`rounded-lg border px-4 py-2 text-xs font-medium transition-colors ${
            filterStatus === 'rejected'
              ? 'border-red-400 bg-red-50 text-red-700'
              : 'border-border/50 bg-surface/80 text-muted hover:border-red-300'
          }`}
        >
          Rejected ({rejectedCount})
        </button>
        {milestoneReadyCount > 0 && (
          <span className="rounded-lg border border-pink-300 bg-pink-50 px-4 py-2 text-xs font-medium text-pink-700">
            Milestones Ready: {milestoneReadyCount}
          </span>
        )}
      </div>

      {/* Reel Grid */}
      {loading ? (
        <div className="py-16 text-center text-sm text-muted">Loading reels...</div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted">
          <Film size={40} className="mx-auto mb-3 text-muted/40" />
          <p>No reels found.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((reel) => {
            const pendingAmount = reel.milestoneReady
              ? calculateIncrementalPayout(reel.currentViewTier, reel.highestPaidTier)
              : 0

            return (
              <div
                key={reel.id}
                className="rounded-xl border border-border/50 bg-surface/80 p-4 hover:shadow-md transition-shadow"
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <span className="text-xs font-semibold text-text">Influencer</span>
                    <p className="text-[10px] text-muted truncate max-w-[180px]">
                      {reel.influencerId}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {reel.milestoneReady && (
                      <span className="text-[10px] font-medium rounded-full px-2 py-0.5 bg-pink-100 text-pink-700 animate-pulse">
                        Milestone Ready
                      </span>
                    )}
                    <span
                      className={`text-[10px] font-medium rounded-full px-2 py-0.5 ${
                        reel.status === 'verified'
                          ? 'bg-green-100 text-green-700'
                          : reel.status === 'rejected'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-yellow-100 text-yellow-700'
                      }`}
                    >
                      {reel.status}
                    </span>
                  </div>
                </div>

                {/* Reel Link */}
                <a
                  href={reel.reelLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs text-accent hover:underline mb-3 truncate"
                >
                  <ExternalLink size={12} />
                  {reel.reelLink}
                </a>

                {/* View Stats */}
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="rounded-lg bg-base border border-border/30 px-2.5 py-1.5">
                    <div className="flex items-center gap-1 text-[10px] text-muted mb-0.5">
                      <Eye size={10} /> Views
                    </div>
                    <div className="text-xs font-bold text-text">
                      {reel.viewCount.toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-lg bg-base border border-border/30 px-2.5 py-1.5">
                    <div className="flex items-center gap-1 text-[10px] text-muted mb-0.5">
                      <DollarSign size={10} /> Earned
                    </div>
                    <div className="text-xs font-bold text-text">
                      ₹{reel.totalEarned.toLocaleString()}
                    </div>
                  </div>
                </div>

                {/* Tiers */}
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex items-center gap-1 text-[10px]">
                    <TrendingUp size={10} className="text-muted" />
                    <span
                      className={`rounded-full px-1.5 py-0.5 font-medium ${VIEW_TIER_COLORS[reel.currentViewTier]}`}
                    >
                      {getViewTierLabel(reel.currentViewTier)}
                    </span>
                  </div>
                  {reel.highestPaidTier !== 'below_threshold' && (
                    <div className="flex items-center gap-1 text-[10px]">
                      <BarChart3 size={10} className="text-muted" />
                      <span className="text-muted">Paid up to:</span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 font-medium ${VIEW_TIER_COLORS[reel.highestPaidTier]}`}
                      >
                        {getViewTierLabel(reel.highestPaidTier)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Milestone Ready Badge with pending amount */}
                {reel.milestoneReady && pendingAmount > 0 && (
                  <div className="rounded-lg bg-pink-50 border border-pink-200 px-3 py-2 mb-3 text-xs text-pink-700 font-medium">
                    Pending payout: ₹{pendingAmount.toLocaleString()}
                  </div>
                )}

                <div className="text-[10px] text-muted mb-3">
                  Submitted:{' '}
                  {new Date(reel.createdAt).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-2 pt-2 border-t border-border/30">
                  {reel.status === 'pending' && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleReview(reel, 'verified')}
                        disabled={actionId === reel.id}
                        className="ui-btn text-xs px-3 py-1.5 bg-green-50 text-green-700 hover:bg-green-100 flex items-center gap-1 flex-1"
                      >
                        <CheckCircle size={12} /> Verify
                      </button>
                      <button
                        onClick={() => handleReview(reel, 'rejected')}
                        disabled={actionId === reel.id}
                        className="ui-btn text-xs px-3 py-1.5 bg-red-50 text-red-700 hover:bg-red-100 flex items-center gap-1 flex-1"
                      >
                        <XCircle size={12} /> Reject
                      </button>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setViewsModal({ reelId: reel.id, influencerId: reel.influencerId })
                        setViewCountInput(String(reel.viewCount))
                      }}
                      className="ui-btn text-[10px] px-2 py-1 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 flex items-center gap-1 flex-1"
                    >
                      <Eye size={10} /> Update Views
                    </button>
                    {reel.milestoneReady && (
                      <button
                        onClick={() => handleApprovePayout(reel)}
                        disabled={actionId === reel.id}
                        className="ui-btn text-[10px] px-2 py-1 bg-pink-50 text-pink-700 hover:bg-pink-100 flex items-center gap-1 flex-1"
                      >
                        <DollarSign size={10} /> Approve Payout
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Update Views Modal */}
      {viewsModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-base/70"
          onClick={() => setViewsModal(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-base border border-border/50 p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-text mb-4">Update View Count</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-muted mb-1">View Count</label>
                <input
                  type="number"
                  min={0}
                  value={viewCountInput}
                  onChange={(e) => setViewCountInput(e.target.value)}
                  className="ui-field w-full"
                  placeholder="Enter view count..."
                />
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button
                  onClick={() => setViewsModal(null)}
                  className="ui-btn ui-btn-neutral text-xs"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpdateViews}
                  disabled={actionId === viewsModal.reelId}
                  className="ui-btn ui-btn-primary text-xs"
                >
                  {actionId === viewsModal.reelId ? 'Saving...' : 'Update'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default KartfluencerReelsView
