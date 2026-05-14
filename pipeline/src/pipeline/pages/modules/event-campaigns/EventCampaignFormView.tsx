import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../../features/auth/auth-context'
import { useLocations } from '../../../hooks/useLocations'
import { vendorDetailsApi } from '../../../api/vendor-details'
import {
  createEventCampaign,
  updateEventCampaign,
  deleteEventCampaign,
  getEventCampaign,
  isSlugUnique,
} from '../../../features/event-campaigns/event-campaigns-firestore'
import {
  generateEventSlug,
  validateEventCampaign,
} from '../../../features/event-campaigns/event-pricing'
import type {
  EventCampaignApplicability,
  EventCampaignCouponPolicy,
  EventCampaignRecord,
  EventCampaignStatus,
  EventPackage,
  EventPackageDiscount,
} from '../../../features/event-campaigns/event-campaign-types'
import type { VendorDetailsRecord } from '../../../api/types'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import EventDetailsSection from './EventDetailsSection'
import LocationSelectionSection from './LocationSelectionSection'
import PackagesSection from './PackagesSection'
import PackageDiscountSection from './PackageDiscountSection'
import ApplicabilitySection from './ApplicabilitySection'
import CouponPolicySection from './CouponPolicySection'
import PostEventNotificationSection from './PostEventNotificationSection'

interface Props {
  mode: 'create' | 'edit'
}

const today = () => new Date().toISOString().slice(0, 10)

const emptyApplicability = (): EventCampaignApplicability => ({
  showOnline: true,
  enableInBooking: true,
  enableInBilling: true,
})

const emptyCouponPolicy = (): EventCampaignCouponPolicy => ({
  allowCouponUsage: false,
  grantCoupons: false,
})

// A sensible default end-date so events go live for a couple of weeks
// without the user having to remember to extend them.
const defaultEndDate = () => {
  const d = new Date()
  d.setDate(d.getDate() + 14)
  return d.toISOString().slice(0, 10)
}

const EventCampaignFormView = ({ mode }: Props) => {
  const navigate = useNavigate()
  const { campaignId } = useParams<{ campaignId: string }>()
  const { session } = useAuth()
  const { enabledLocations } = useLocations()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [heroImageUrl, setHeroImageUrl] = useState('')
  const [promoText, setPromoText] = useState('')
  const [startDate, setStartDate] = useState(today())
  const [endDate, setEndDate] = useState(defaultEndDate())
  const [status, setStatus] = useState<EventCampaignStatus>('active')
  const [locationKeys, setLocationKeys] = useState<string[]>([])
  const [disabledLocationKeys, setDisabledLocationKeys] = useState<string[]>([])
  const [packages, setPackages] = useState<EventPackage[]>([])
  const [applicability, setApplicability] =
    useState<EventCampaignApplicability>(emptyApplicability())
  const [couponPolicy, setCouponPolicy] = useState<EventCampaignCouponPolicy>(emptyCouponPolicy())
  const [packageDiscount, setPackageDiscount] = useState<EventPackageDiscount | null>(null)
  const [notificationMessage, setNotificationMessage] = useState<string | null>(null)
  const [notificationSentAt, setNotificationSentAt] = useState<string | null>(null)
  // Per-campaign Interakt booking-confirmation template. Empty = inherit
  // BookingConfirmationConfig.defaultTemplateId in the dispatcher.
  const [interaktTemplateId, setInteraktTemplateId] = useState('')
  const [interaktTemplateLanguage, setInteraktTemplateLanguage] = useState('')

  const [vendors, setVendors] = useState<VendorDetailsRecord[]>([])
  const [vendorsLoading, setVendorsLoading] = useState(false)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pageLoading, setPageLoading] = useState(mode === 'edit')
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  // Load existing campaign in edit mode
  useEffect(() => {
    if (mode !== 'edit' || !campaignId) return
    let cancelled = false
    const load = async () => {
      setPageLoading(true)
      try {
        const c = await getEventCampaign(campaignId)
        if (cancelled || !c) {
          if (!cancelled) setError('Event campaign not found.')
          return
        }
        setTitle(c.title)
        setDescription(c.description)
        setHeroImageUrl(c.heroImageUrl)
        setPromoText(c.promoText)
        setStartDate(c.startDate)
        setEndDate(c.endDate)
        setStatus(c.status)
        setLocationKeys(c.locationKeys)
        setDisabledLocationKeys(c.disabledLocationKeys ?? [])
        setPackages(c.packages ?? [])
        setApplicability(c.applicability ?? emptyApplicability())
        setCouponPolicy(c.couponPolicy ?? emptyCouponPolicy())
        setPackageDiscount(c.packageDiscount ?? null)
        setNotificationMessage(c.endedNotificationMessage)
        setNotificationSentAt(c.endedNotificationSentAt)
        setInteraktTemplateId(c.interaktTemplateId ?? '')
        setInteraktTemplateLanguage(c.interaktTemplateLanguage ?? '')
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load.')
      } finally {
        if (!cancelled) setPageLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [mode, campaignId])

  // Load third-party vendors once for the package item vendor dropdown
  useEffect(() => {
    const token = session?.token
    if (!token) return
    let cancelled = false
    setVendorsLoading(true)
    vendorDetailsApi
      .list(token)
      .then((list) => {
        if (cancelled) return
        setVendors(list.filter((v) => v.vendorType === 'ThirdParty' || v.vendorType === 'SubLease'))
      })
      .catch(() => {
        if (!cancelled) setVendors([])
      })
      .finally(() => {
        if (!cancelled) setVendorsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [session?.token])

  const handleFieldChange = useCallback((field: string, value: string) => {
    switch (field) {
      case 'title':
        setTitle(value)
        break
      case 'description':
        setDescription(value)
        break
      case 'heroImageUrl':
        setHeroImageUrl(value)
        break
      case 'promoText':
        setPromoText(value)
        break
      case 'startDate':
        setStartDate(value)
        break
      case 'endDate':
        setEndDate(value)
        break
      case 'status':
        setStatus(value as EventCampaignStatus)
        break
    }
  }, [])

  const handleSave = async () => {
    setError(null)
    setSuccess(null)

    const errors = validateEventCampaign({
      title,
      locationKeys,
      packages,
      startDate,
      endDate,
    })
    if (errors.length > 0) {
      setError(errors.join(' '))
      return
    }

    setSaving(true)
    try {
      let slug = generateEventSlug(title)
      const excludeId = mode === 'edit' ? campaignId : undefined
      if (!(await isSlugUnique(slug, excludeId))) {
        slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`
      }

      const data: Omit<EventCampaignRecord, 'id' | 'createdAt' | 'updatedAt'> = {
        title: title.trim(),
        slug,
        description: description.trim(),
        heroImageUrl: heroImageUrl.trim(),
        locationKeys,
        disabledLocationKeys: disabledLocationKeys.filter((k) => locationKeys.includes(k)),
        startDate,
        endDate,
        status,
        packages,
        applicability,
        couponPolicy,
        packageDiscount,
        promoText: promoText.trim(),
        endedNotificationMessage: notificationMessage?.trim() || null,
        endedNotificationSentAt: notificationSentAt,
        interaktTemplateId: interaktTemplateId.trim() || undefined,
        interaktTemplateLanguage: interaktTemplateLanguage.trim() || undefined,
        createdBy: session?.user?.id ?? 'unknown',
      }

      if (mode === 'create') {
        await createEventCampaign(data)
        setSuccess('Event campaign created.')
      } else if (campaignId) {
        await updateEventCampaign(campaignId, data)
        setSuccess('Event campaign updated.')
      }

      setTimeout(() => navigate('/event-campaigns/manage'), 800)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!campaignId) return
    try {
      await deleteEventCampaign(campaignId)
      navigate('/event-campaigns/manage')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete.')
    }
  }

  const handleSendNotification = async () => {
    if (!campaignId || !notificationMessage?.trim()) return
    try {
      const now = new Date().toISOString()
      await updateEventCampaign(campaignId, { endedNotificationSentAt: now })
      setNotificationSentAt(now)
      setSuccess('Notification marked as sent.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send notification.')
    }
  }

  const previewSlug = useMemo(() => generateEventSlug(title), [title])

  if (pageLoading) {
    return <p className="py-8 text-center text-sm text-muted">Loading event campaign...</p>
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-critical/40 bg-critical/10 px-4 py-2 text-sm text-critical">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-success/40 bg-success/10 px-4 py-2 text-sm text-success">
          {success}
        </div>
      )}

      <EventDetailsSection
        title={title}
        description={description}
        heroImageUrl={heroImageUrl}
        promoText={promoText}
        startDate={startDate}
        endDate={endDate}
        status={status}
        onChange={handleFieldChange}
      />

      <LocationSelectionSection
        locations={enabledLocations}
        selectedKeys={locationKeys}
        disabledKeys={disabledLocationKeys}
        onChange={setLocationKeys}
        onDisabledChange={setDisabledLocationKeys}
      />

      <PackagesSection
        packages={packages}
        onChange={setPackages}
        locations={enabledLocations}
        disabledLocationKeys={disabledLocationKeys}
        vendors={vendors}
        vendorsLoading={vendorsLoading}
      />

      <PackageDiscountSection value={packageDiscount} onChange={setPackageDiscount} />

      <ApplicabilitySection value={applicability} onChange={setApplicability} />

      <CouponPolicySection value={couponPolicy} onChange={setCouponPolicy} />

      <PostEventNotificationSection
        message={notificationMessage}
        sentAt={notificationSentAt}
        status={status}
        onMessageChange={setNotificationMessage}
        onSend={handleSendNotification}
      />

      {/* Booking confirmation Interakt template (per-campaign override). */}
      <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
        <h3 className="mb-1 text-base font-semibold text-text">Booking Confirmation (WhatsApp)</h3>
        <p className="mb-4 text-sm text-muted">
          Approved Interakt template used to send the WhatsApp booking confirmation for purchases
          made on this campaign. Leave blank to inherit the global default from{' '}
          <span className="font-semibold">Settings → Template Images</span>.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
          <div>
            <p className="mb-1 text-[0.65rem] font-semibold uppercase tracking-[0.06em] text-muted">
              Template ID
            </p>
            <input
              type="text"
              value={interaktTemplateId}
              onChange={(e) => setInteraktTemplateId(e.target.value)}
              placeholder="e.g. event_booking_confirmation"
              className="ui-field min-h-11 w-full font-mono text-sm"
            />
          </div>
          <div>
            <p className="mb-1 text-[0.65rem] font-semibold uppercase tracking-[0.06em] text-muted">
              Language
            </p>
            <input
              type="text"
              value={interaktTemplateLanguage}
              onChange={(e) => setInteraktTemplateLanguage(e.target.value)}
              placeholder="en"
              className="ui-field min-h-11 w-full font-mono text-sm"
            />
          </div>
        </div>
        {interaktTemplateId.trim() && !interaktTemplateLanguage.trim() && (
          <p className="mt-2 text-[0.7rem] text-warning">
            Language is empty — the global default will be used.
          </p>
        )}
      </section>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="ui-btn ui-btn-primary min-h-10 px-6 text-sm disabled:opacity-50"
        >
          {saving ? 'Saving...' : mode === 'create' ? 'Create Event' : 'Update Event'}
        </button>

        {mode === 'edit' && (
          <button
            type="button"
            onClick={() => setShowDeleteDialog(true)}
            className="ui-btn ui-btn-neutral min-h-10 px-4 text-sm text-critical"
          >
            Delete Event
          </button>
        )}

        <button
          type="button"
          onClick={() => navigate('/event-campaigns/manage')}
          className="ui-btn ui-btn-neutral min-h-10 px-4 text-sm"
        >
          Cancel
        </button>

        {previewSlug && (
          <span className="ml-auto text-xs text-muted">Preview: /event/{previewSlug}</span>
        )}
      </div>

      <ConfirmDialog
        open={showDeleteDialog}
        title="Delete Event Campaign"
        description={`Permanently delete "${title}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteDialog(false)}
      />
    </div>
  )
}

export default EventCampaignFormView
