import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, Plus, Search, Trash2, QrCode } from 'lucide-react'
import { useAuth } from '../../../features/auth/auth-context'
import { kartfluencerApi } from '../../../api/kartfluencer'
import { KARTFLUENCER_TIERS } from '../../../api/kartfluencer-firestore'
import { getEnabledLocations } from '../../../../lib/locations'
import type {
  KartfluencerRecord,
  KartfluencerStatus,
  KartfluencerTier,
  KartfluencerStats,
} from '../../../api/types'
import { logger } from '../../../../lib/logger'

const STATUS_LABELS: Record<KartfluencerStatus, string> = {
  detailed: 'Registered',
  visited: 'Visited',
  reel_submitted: 'Reel Submitted',
  verified: 'Verified',
  active: 'Active',
  disqualified: 'Disqualified',
}

const STATUS_COLORS: Record<KartfluencerStatus, string> = {
  detailed: 'bg-blue-100 text-blue-700',
  visited: 'bg-amber-100 text-amber-700',
  reel_submitted: 'bg-purple-100 text-purple-700',
  verified: 'bg-emerald-100 text-emerald-700',
  active: 'bg-green-100 text-green-800',
  disqualified: 'bg-red-100 text-red-700',
}

const TIER_COLORS: Record<KartfluencerTier, string> = {
  // Tier badges: tinted-neutral foundation, tone color reserved for the
  // labels themselves. No purple/pink gradient (AI-palette tell), no raw
  // tailwind palette colors that bypass our semantic tokens.
  not_eligible: 'border border-border bg-surface text-muted',
  access_10k: 'border border-info/35 bg-info/10 text-info',
  access_25k: 'border border-info/45 bg-info/15 text-info',
  bronze: 'border border-warning/35 bg-warning/10 text-warning',
  silver: 'border border-muted/40 bg-muted/15 text-muted',
  gold: 'border border-warning/45 bg-warning/15 text-warning',
  elite: 'border border-accent bg-accent/10 text-accent',
}

const KartfluencerListView = ({ branchFilter = '' }: { branchFilter?: string }) => {
  const { session } = useAuth()
  const navigate = useNavigate()
  const token = session?.token ?? ''

  const [records, setRecords] = useState<KartfluencerRecord[]>([])
  const [stats, setStats] = useState<KartfluencerStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<KartfluencerStatus | ''>('')
  const [filterTier, setFilterTier] = useState<KartfluencerTier | ''>('')

  // Use external branch filter from module, or allow local override
  const effectiveBranch = branchFilter
  const [showAddModal, setShowAddModal] = useState(false)
  const [selectedRecord, setSelectedRecord] = useState<KartfluencerRecord | null>(null)

  const locations = useMemo(() => getEnabledLocations(), [])

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const filter: Record<string, string> = {}
      if (filterStatus) filter.status = filterStatus
      if (filterTier) filter.tier = filterTier
      if (effectiveBranch) filter.branchId = effectiveBranch
      const [data, statsData] = await Promise.all([
        kartfluencerApi.list(token, filter as never),
        kartfluencerApi.getStats(token, effectiveBranch || undefined),
      ])
      setRecords(data)
      setStats(statsData)
    } catch (err) {
      logger.error('kartfluencer.load_list_failed', err)
    } finally {
      setLoading(false)
    }
  }, [token, filterStatus, filterTier, effectiveBranch])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    if (!search.trim()) return records
    const q = search.toLowerCase()
    return records.filter(
      (r) =>
        r.instagramHandle.toLowerCase().includes(q) ||
        r.phoneNumber.includes(q) ||
        r.branchName.toLowerCase().includes(q),
    )
  }, [records, search])

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this influencer?')) return
    try {
      await kartfluencerApi.delete(token, id)
      void load()
    } catch (err) {
      logger.error('kartfluencer.list_delete_failed', err)
    }
  }

  return (
    <div className="ui-section-stack">
      {/* Stats bar */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-9 gap-3">
          <StatCard label="Total" value={stats.total} />
          <StatCard label="Registered" value={stats.byStatus.detailed} color="text-blue-600" />
          <StatCard label="Visited" value={stats.byStatus.visited} color="text-amber-600" />
          <StatCard label="Reels" value={stats.byStatus.reel_submitted} color="text-purple-600" />
          <StatCard label="Verified" value={stats.byStatus.verified} color="text-emerald-600" />
          <StatCard label="Active" value={stats.byStatus.active} color="text-green-700" />
          <StatCard label="Pending Reels" value={stats.pendingReels} color="text-orange-600" />
          <StatCard
            label="Milestones Ready"
            value={stats.milestoneReadyReels}
            color="text-pink-600"
          />
          <StatCard label="Total Views" value={stats.totalViews} color="text-indigo-600" />
        </div>
      )}

      {/* Toolbar */}
      <div className="ui-toolbar flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            placeholder="Search handle or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ui-field pl-8 min-h-9 text-xs w-full"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as KartfluencerStatus | '')}
          className="ui-field min-h-9 text-xs"
        >
          <option value="">All Statuses</option>
          {Object.entries(STATUS_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={filterTier}
          onChange={(e) => setFilterTier(e.target.value as KartfluencerTier | '')}
          className="ui-field min-h-9 text-xs"
        >
          <option value="">All Tiers</option>
          {KARTFLUENCER_TIERS.filter((t) => t.tier !== 'not_eligible').map((t) => (
            <option key={t.tier} value={t.tier}>
              {t.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => setShowAddModal(true)}
          className="ui-btn ui-btn-primary text-xs gap-1"
        >
          <Plus size={14} /> Add Influencer
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="py-16 text-center text-sm text-muted">Loading influencers...</div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted">No influencers found.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/50">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/50 bg-surface/80">
                <th className="px-3 py-2.5 text-left font-medium text-muted">Handle</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted">Phone</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted">Branch</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted">Tier</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted">Status</th>
                <th className="px-3 py-2.5 text-right font-medium text-muted">Wallet</th>
                <th className="px-3 py-2.5 text-right font-medium text-muted">Earned</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted">QR</th>
                <th className="px-3 py-2.5 text-left font-medium text-muted">Created</th>
                <th className="px-3 py-2.5 text-right font-medium text-muted">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-border/30 hover:bg-surface/60 transition-colors"
                >
                  <td className="px-3 py-2.5 font-medium text-text">{r.instagramHandle}</td>
                  <td className="px-3 py-2.5 text-muted">
                    {r.phoneCountryCode} {r.phoneNumber}
                  </td>
                  <td className="px-3 py-2.5 text-muted">{r.branchName}</td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${TIER_COLORS[r.tier]}`}
                    >
                      {KARTFLUENCER_TIERS.find((t) => t.tier === r.tier)?.label ?? r.tier}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[r.status]}`}
                    >
                      {STATUS_LABELS[r.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right text-muted">
                    {r.walletBalance != null ? `₹${r.walletBalance.toLocaleString()}` : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right text-muted">
                    {r.totalEarned != null ? `₹${r.totalEarned.toLocaleString()}` : '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    {r.qrCode ? (
                      <span title="QR assigned">
                        <QrCode size={14} className="text-accent" />
                      </span>
                    ) : (
                      <span className="text-muted/40">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-muted">
                    {new Date(r.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => navigate(`/kartfluencer/profile/${r.id}`)}
                        className="p-1 rounded hover:bg-surface"
                        title="View profile"
                      >
                        <Eye size={14} className="text-muted" />
                      </button>
                      <button
                        onClick={() => handleDelete(r.id)}
                        className="p-1 rounded hover:bg-surface"
                        title="Delete"
                      >
                        <Trash2 size={14} className="text-critical" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Influencer Modal */}
      {showAddModal && (
        <AddInfluencerModal
          token={token}
          locations={locations}
          onClose={() => setShowAddModal(false)}
          onCreated={() => {
            setShowAddModal(false)
            void load()
          }}
        />
      )}

      {/* Detail Drawer */}
      {selectedRecord && (
        <InfluencerDetailDrawer
          record={selectedRecord}
          token={token}
          onClose={() => setSelectedRecord(null)}
          onUpdated={() => {
            setSelectedRecord(null)
            void load()
          }}
        />
      )}
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────

const StatCard = ({ label, value, color }: { label: string; value: number; color?: string }) => (
  <div className="rounded-xl border border-border/50 bg-surface/80 px-4 py-3">
    <div className="text-[10px] text-muted uppercase tracking-wide">{label}</div>
    <div className={`text-xl font-bold ${color ?? 'text-text'}`}>{value.toLocaleString()}</div>
  </div>
)

const AddInfluencerModal = ({
  token,
  locations,
  onClose,
  onCreated,
}: {
  token: string
  locations: Array<{ branchId: string; displayName: string; slug: string }>
  onClose: () => void
  onCreated: () => void
}) => {
  const [handle, setHandle] = useState('')
  const [phone, setPhone] = useState('')
  const [countryCode, setCountryCode] = useState('+91')
  const [branchId, setBranchId] = useState(locations[0]?.branchId ?? '')
  const [visitDate, setVisitDate] = useState('')
  const [followersRange, setFollowersRange] = useState('10k-25k')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const branch = locations.find((l) => l.branchId === branchId)
      await kartfluencerApi.create(token, {
        instagramHandle: handle,
        phoneCountryCode: countryCode,
        phoneNumber: phone,
        branchId,
        branchName: branch?.displayName ?? '',
        visitDate,
        followersRange,
      })
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create influencer')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-base/70"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-base border border-border/50 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-text mb-4">Add Influencer</h3>
        {error && (
          <div className="mb-3 rounded-lg border border-critical/45 bg-critical/10 px-3 py-2 text-sm text-critical">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted mb-1">Instagram Handle</label>
            <input
              type="text"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              className="ui-field w-full"
              placeholder="@username"
              required
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Code</label>
              <input
                type="text"
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value)}
                className="ui-field w-full"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-muted mb-1">Phone Number</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="ui-field w-full"
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Branch</label>
              <select
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className="ui-field w-full"
              >
                {locations.map((loc) => (
                  <option key={loc.branchId} value={loc.branchId}>
                    {loc.displayName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Visit Date</label>
              <input
                type="date"
                value={visitDate}
                onChange={(e) => setVisitDate(e.target.value)}
                className="ui-field w-full"
                required
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1">Followers Range</label>
            <select
              value={followersRange}
              onChange={(e) => setFollowersRange(e.target.value)}
              className="ui-field w-full"
            >
              {KARTFLUENCER_TIERS.filter((t) => t.tier !== 'not_eligible').map((t) => (
                <option
                  key={t.tier}
                  value={`${Math.floor(t.minFollowers / 1000)}k-${t.maxFollowers === Infinity ? '' : Math.floor(t.maxFollowers / 1000) + 'k'}${t.maxFollowers === Infinity ? '+' : ''}`}
                >
                  {t.label} — {t.reward}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={onClose} className="ui-btn ui-btn-neutral text-xs">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="ui-btn ui-btn-primary text-xs">
              {saving ? 'Saving...' : 'Add Influencer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const InfluencerDetailDrawer = ({
  record,
  token,
  onClose,
  onUpdated,
}: {
  record: KartfluencerRecord
  token: string
  onClose: () => void
  onUpdated: () => void
}) => {
  const [reels, setReels] = useState<
    Array<{ id: string; reelLink: string; status: string; createdAt: string }>
  >([])
  const [statusAction, setStatusAction] = useState<KartfluencerStatus | ''>('')
  const [reason, setReason] = useState('')
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    void kartfluencerApi
      .listReels(token, record.id)
      .then(setReels)
      .catch(() => {})
  }, [token, record.id])

  const handleStatusChange = async () => {
    if (!statusAction) return
    setUpdating(true)
    try {
      await kartfluencerApi.updateStatus(token, record.id, statusAction, reason || undefined)
      onUpdated()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update status')
    } finally {
      setUpdating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-base/65" onClick={onClose}>
      <div
        className="w-full max-w-md bg-base border-l border-border/50 h-full overflow-y-auto p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-text">{record.instagramHandle}</h3>
          <button onClick={onClose} className="text-muted hover:text-text">
            &times;
          </button>
        </div>

        <div className="space-y-4">
          <DetailRow label="Status" value={STATUS_LABELS[record.status]} />
          <DetailRow
            label="Tier"
            value={KARTFLUENCER_TIERS.find((t) => t.tier === record.tier)?.label ?? record.tier}
          />
          <DetailRow label="Branch" value={record.branchName} />
          <DetailRow label="Phone" value={`${record.phoneCountryCode} ${record.phoneNumber}`} />
          <DetailRow
            label="Visit Date"
            value={record.visitDate ? new Date(record.visitDate).toLocaleDateString() : '—'}
          />
          <DetailRow label="Followers" value={record.followersRange} />
          {record.upiId && <DetailRow label="UPI ID" value={record.upiId} />}
          {record.upiName && <DetailRow label="UPI Name" value={record.upiName} />}
          <DetailRow
            label="Wallet Balance"
            value={record.walletBalance != null ? `₹${record.walletBalance.toLocaleString()}` : '—'}
          />
          <DetailRow
            label="Total Earned"
            value={record.totalEarned != null ? `₹${record.totalEarned.toLocaleString()}` : '—'}
          />
          <DetailRow
            label="Total Withdrawn"
            value={
              record.totalWithdrawn != null ? `₹${record.totalWithdrawn.toLocaleString()}` : '—'
            }
          />
          {record.qrCode && <DetailRow label="QR Code" value={record.qrCode} />}
          {record.disqualifiedReason && (
            <DetailRow label="DQ Reason" value={record.disqualifiedReason} />
          )}
          <DetailRow label="Registered" value={new Date(record.createdAt).toLocaleString()} />

          {/* Reels */}
          {reels.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted uppercase mb-2">
                Reels ({reels.length})
              </h4>
              <div className="space-y-2">
                {reels.map((reel) => (
                  <div
                    key={reel.id}
                    className="rounded-lg border border-border/50 bg-surface/80 px-3 py-2 text-xs"
                  >
                    <a
                      href={reel.reelLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline truncate block"
                    >
                      {reel.reelLink}
                    </a>
                    <div className="flex justify-between mt-1">
                      <span className="text-muted">
                        {new Date(reel.createdAt).toLocaleDateString()}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
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
                ))}
              </div>
            </div>
          )}

          {/* Status Change */}
          {record.status !== 'active' && record.status !== 'disqualified' && (
            <div className="border-t border-border/50 pt-4">
              <h4 className="text-xs font-semibold text-muted uppercase mb-2">Change Status</h4>
              <div className="flex gap-2">
                <select
                  value={statusAction}
                  onChange={(e) => setStatusAction(e.target.value as KartfluencerStatus)}
                  className="ui-field text-xs flex-1"
                >
                  <option value="">Select new status...</option>
                  {record.status === 'detailed' && <option value="visited">Mark Visited</option>}
                  {record.status === 'visited' && (
                    <option value="reel_submitted">Mark Reel Submitted</option>
                  )}
                  {record.status === 'reel_submitted' && <option value="verified">Verify</option>}
                  {record.status === 'verified' && <option value="active">Mark Active</option>}
                  <option value="disqualified">Disqualify</option>
                </select>
                <button
                  onClick={handleStatusChange}
                  disabled={!statusAction || updating}
                  className="ui-btn ui-btn-primary text-xs"
                >
                  {updating ? '...' : 'Apply'}
                </button>
              </div>
              {statusAction === 'disqualified' && (
                <input
                  type="text"
                  placeholder="Reason for disqualification..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="ui-field w-full mt-2 text-xs"
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const DetailRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between text-sm">
    <span className="text-muted">{label}</span>
    <span className="text-text font-medium">{value}</span>
  </div>
)

export default KartfluencerListView
