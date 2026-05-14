import React from 'react'
import type { Booking } from '../types'
import { formatCurrency, getLocationName } from '../lib/utils'
import { fmtDateIST, fmtTimeShortIST } from '../lib/date-format'
import { formatActivityLabel } from '../lib/format-activity'

interface BoardingPassProps {
  booking: Booking
  passengerName: string
  onDownload?: () => void
  paymentPending?: boolean
}

const BoardingPass: React.FC<BoardingPassProps> = ({
  booking,
  passengerName,
  onDownload,
  paymentPending,
}) => {
  // Derived data
  let sessionDate = new Date(booking.sessionDate)

  // Safety check for NaN sessionDate (sometimes string from API misses valid format)
  if (isNaN(sessionDate.getTime())) {
    sessionDate = new Date() // Fallback so it doesn't hard-crash the pass
  }

  let boardingTime = 'TBA'
  const itemWithTime = booking.items?.find((i) => i.timeSlot)
  const timeSlotStr = itemWithTime?.timeSlot

  if (timeSlotStr) {
    // timeSlot is usually "HH:MM AM/PM" or "HH:MM". Let's parse it manually to be safe.
    const timeMatch = timeSlotStr.match(/(\d+):(\d+)\s*([AP]M)?/i)

    if (timeMatch) {
      const [_, hoursStr, minutesStr, modifier] = timeMatch
      let hours = parseInt(hoursStr, 10)
      const minutes = parseInt(minutesStr, 10)

      if (modifier && modifier.toUpperCase() === 'PM' && hours < 12) {
        hours += 12
      } else if (modifier && modifier.toUpperCase() === 'AM' && hours === 12) {
        hours = 0
      }

      // Create a fake date just for time manipulation
      const tempDate = new Date()
      tempDate.setHours(hours, minutes, 0, 0)

      // Subtract 20 minutes for boarding time
      tempDate.setMinutes(tempDate.getMinutes() - 20)

      boardingTime = fmtTimeShortIST(tempDate)
    }
  } else {
    // Fallback to old behavior if no timeSlot exists
    const oldBoardingDate = new Date(sessionDate.getTime() - 20 * 60000)
    if (!isNaN(oldBoardingDate.getTime())) {
      boardingTime = fmtTimeShortIST(oldBoardingDate)
    }
  }

  const dateLabel = fmtDateIST(sessionDate)
  const locationName = getLocationName(booking.locationId)

  const startOfYear = new Date(sessionDate.getFullYear(), 0, 0)
  const dayOfYear = Math.floor((sessionDate.getTime() - startOfYear.getTime()) / 86400000)
  const flightNumber =
    booking.flightNumber || `H-${dayOfYear}-${booking.id.slice(-2)}`.toUpperCase()

  const qrData = booking.qrCode || booking.id
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}&color=000000&bgcolor=FFFFFF`

  return (
    <div className="w-full max-w-sm md:max-w-md lg:max-w-lg mx-auto perspective-1000">
      <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;700&family=Inter:wght@400;500;600&display=swap');

                .bp-card-shared {
                    width: 100%;
                    max-width: 320px;
                    margin: 0 auto;
                    background-color: var(--dark-700);
                    color: white;
                    border-radius: 20px;
                    overflow: hidden;
                    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
                    border: 1px solid rgba(234, 179, 8, 0.3);
                    position: relative;
                    font-family: 'Inter', sans-serif;
                }

                /* Header */
                .bp-header-shared {
                    background: linear-gradient(to bottom, #000000, var(--dark-700));
                    padding: 20px;
                    text-align: center;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                }
                .bp-logo-shared { max-width: 200px; height: auto; display: inline-block; margin-bottom: 8px; }
                .bp-title-shared {
                    font-family: 'Oswald', sans-serif;
                    font-size: 24px;
                    font-weight: 700;
                    letter-spacing: 2px;
                    color: white;
                    text-transform: uppercase;
                    margin: 0;
                }
                .bp-subtitle-shared {
                    font-size: 10px;
                    color: var(--gold-400);
                    letter-spacing: 4px;
                    margin-top: 4px;
                    font-weight: 600;
                }

                /* Route */
                .bp-route-shared {
                    padding: 24px 20px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    position: relative;
                }
                .bp-airport-code-shared {
                    font-family: 'Oswald', sans-serif;
                    font-size: 28px;
                    font-weight: 700;
                    background: linear-gradient(to bottom right, #ffffff, #9ca3af);
                    -webkit-background-clip: text;
                    background-clip: text;
                    -webkit-text-fill-color: transparent;
                }
                .bp-airport-name-shared { font-size: 10px; color: #a3a3a3; margin-top: 4px; text-align: center; }
                .bp-flight-path-shared { flex: 1; margin: 0 16px; position: relative; text-align: center; }
                .bp-path-line-shared {
                    height: 2px;
                    background-image: linear-gradient(to right, rgba(255,255,255,0.2) 50%, transparent 50%);
                    background-size: 8px 1px;
                    width: 100%;
                    position: absolute;
                    top: 50%;
                    transform: translateY(-50%);
                }
                .bp-plane-icon-shared { background-color: var(--dark-700); color: var(--gold-400); padding: 0 4px; position: relative; z-index: 10; font-size: 12px; }
                .bp-duration-shared { font-size: 9px; color: var(--gold-400); margin-top: 14px; display: block; font-weight: 600; text-align: center; }

                /* Details Grid */
                .bp-details-shared {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 16px;
                    padding: 0 20px 24px;
                }
                .bp-detail-item-shared { display: flex; flex-direction: column; text-align: left; }
                .bp-label-shared { font-size: 9px; color: #737373; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
                .bp-value-shared { font-size: 13px; color: white; font-weight: 600; }
                .bp-value-highlight-shared { color: var(--gold-400); font-family: 'Oswald', sans-serif; letter-spacing: 1px; }

                /* Tear-off */
                .bp-tear-off-shared { position: relative; margin: 0 0 20px; height: 20px; }
                .bp-tear-line-shared { border-top: 2px dashed rgba(255,255,255,0.1); position: absolute; width: 100%; top: 50%; }
                .bp-cut-notch-shared {
                    width: 20px; height: 20px;
                    background-color: #0c0c0c; /* Approx background color behind the card in checkin page */
                    border-radius: 50%;
                    position: absolute; top: 50%;
                    transform: translateY(-50%);
                    z-index: 10;
                }
                .bp-cut-notch-left-shared { left: -10px; }
                .bp-cut-notch-right-shared { right: -10px; }

                /* QR Section */
                .bp-qr-section-shared {
                    padding: 24px 20px;
                    background: linear-gradient(to bottom, rgba(255,255,255,0.03), transparent);
                    display: flex;
                    align-items: center;
                    gap: 16px;
                }
                .bp-qr-code-shared { width: 80px; height: 80px; background-color: white; padding: 4px; border-radius: 8px; }
                .bp-gate-info-shared { flex: 1; text-align: right; }
                .bp-gate-label-shared { font-size: 10px; color: #a3a3a3; letter-spacing: 2px; }
                .bp-gate-value-shared { font-family: 'Oswald', sans-serif; font-size: 32px; color: white; font-weight: 700; line-height: 1; margin-top: 4px; }
                .bp-gate-status-shared {
                    display: inline-block;
                    background-color: rgba(34, 197, 94, 0.1);
                    color: var(--success-400);
                    font-size: 9px;
                    padding: 2px 6px;
                    border-radius: 4px;
                    margin-top: 6px;
                    font-weight: 600;
                }

                /* Footer */
                .bp-footer-shared {
                    padding: 16px 20px;
                    border-top: 1px solid rgba(255,255,255,0.05);
                }
                .bp-items-section-shared { margin-bottom: 12px; }
                .bp-item-row-shared { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
                .bp-item-name-shared { font-size: 11px; color: #a3a3a3; }
                .bp-item-price-shared { font-size: 11px; color: white; font-weight: 600; }
                .bp-discount-row-shared { color: var(--success-400); }
                .bp-total-row-shared {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    background: linear-gradient(135deg, var(--gold-400), var(--gold-500));
                    margin: 0 -20px;
                    padding: 12px 20px;
                }
                .bp-total-label-shared { font-size: 11px; color: var(--dark-700); font-weight: 700; letter-spacing: 1px; }
                .bp-total-amount-shared { font-size: 16px; color: var(--dark-700); font-weight: 700; }

                /* Bottom notice */
                .bp-notice-shared {
                    text-align: center;
                    padding: 12px 20px;
                    font-size: 9px;
                    color: #737373;
                    line-height: 1.5;
                }
                
                /* Print Button */
                .bp-print-btn-shared {
                    margin-top: 20px;
                    padding: 12px 32px;
                    background: linear-gradient(135deg, var(--gold-400), var(--gold-500));
                    color: var(--dark-700);
                    border: none;
                    border-radius: 12px;
                    font-size: 14px;
                    font-weight: 700;
                    cursor: pointer;
                    font-family: 'Inter', sans-serif;
                    letter-spacing: 1px;
                    transition: transform 0.2s;
                    width: 100%;
                }
                .bp-print-btn-shared:hover { transform: scale(1.02); }

                /* Tablet */
                @media (min-width: 768px) {
                    .bp-card-shared { max-width: 400px; }
                    .bp-title-shared { font-size: 28px; }
                    .bp-airport-code-shared { font-size: 32px; }
                    .bp-value-shared { font-size: 14px; }
                    .bp-qr-code-shared { width: 100px; height: 100px; }
                    .bp-header-shared { padding: 24px; }
                    .bp-route-shared { padding: 28px 24px; }
                    .bp-details-shared { padding: 0 24px 28px; }
                    .bp-qr-section-shared { padding: 28px 24px; }
                    .bp-footer-shared { padding: 20px 24px; }
                    .bp-gate-value-shared { font-size: 36px; }
                }

                /* Desktop */
                @media (min-width: 1024px) {
                    .bp-card-shared { max-width: 460px; }
                    .bp-title-shared { font-size: 32px; }
                    .bp-airport-code-shared { font-size: 36px; }
                    .bp-value-shared { font-size: 15px; }
                    .bp-label-shared { font-size: 10px; }
                    .bp-qr-code-shared { width: 110px; height: 110px; }
                    .bp-print-btn-shared { font-size: 16px; padding: 14px 40px; }
                }
            `}</style>

      <div
        className="bp-card-shared"
        id={`boarding-pass-${booking.id}-${passengerName.replace(/\s+/g, '')}`}
      >
        {/* Header */}
        <div className="bp-header-shared">
          <div>
            <img
              src="/A Square logo icon black and white.svg"
              alt="A-Square"
              className="bp-logo-shared"
            />
          </div>
          <h1 className="bp-title-shared">Boarding Pass</h1>
          <div className="bp-subtitle-shared">SKY CLASS ACCESS</div>
        </div>

        {/* Route */}
        <div className="bp-route-shared">
          <div style={{ textAlign: 'center' }}>
            <div className="bp-airport-code-shared">H-PAD</div>
            <div className="bp-airport-name-shared">Helipad</div>
          </div>
          <div className="bp-flight-path-shared">
            <div className="bp-path-line-shared"></div>
            <span className="bp-plane-icon-shared">✈</span>
            <span className="bp-duration-shared">7 MIN FLIGHT</span>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="bp-airport-code-shared">SKY</div>
            <div className="bp-airport-name-shared">Sky View</div>
          </div>
        </div>

        {/* Details Grid */}
        <div className="bp-details-shared">
          <div className="bp-detail-item-shared" style={{ gridColumn: 'span 2' }}>
            <span className="bp-label-shared">
              Passenger{passengerName.includes(',') ? 's' : ''}
            </span>
            <span className="bp-value-shared" style={{ whiteSpace: 'normal', lineHeight: 1.2 }}>
              {passengerName}
            </span>
          </div>
          <div className="bp-detail-item-shared">
            <span className="bp-label-shared">Location</span>
            <span className="bp-value-shared">{locationName}</span>
          </div>
          <div className="bp-detail-item-shared">
            <span className="bp-label-shared">Date</span>
            <span className="bp-value-shared">{dateLabel}</span>
          </div>
          <div className="bp-detail-item-shared">
            <span className="bp-label-shared">Boarding Time</span>
            <span className={`bp-value-shared bp-value-highlight-shared`}>{boardingTime}</span>
          </div>
          <div className="bp-detail-item-shared">
            <span className="bp-label-shared">Flight No</span>
            <span className={`bp-value-shared bp-value-highlight-shared`}>{flightNumber}</span>
          </div>
        </div>

        {/* Tear-off */}
        <div className="bp-tear-off-shared">
          <div className="bp-cut-notch-shared bp-cut-notch-left-shared"></div>
          <div className="bp-tear-line-shared"></div>
          <div className="bp-cut-notch-shared bp-cut-notch-right-shared"></div>
        </div>

        {/* QR & Gate */}
        <div className="bp-qr-section-shared">
          <img src={qrUrl} alt="QR Code" className="bp-qr-code-shared" />
          <div className="bp-gate-info-shared">
            <div className="bp-gate-label-shared">GATE</div>
            <div className="bp-gate-value-shared">A1</div>
            <div className="bp-gate-status-shared">ON TIME</div>
          </div>
        </div>

        {/* Items & Total */}
        <div className="bp-footer-shared">
          <div className="bp-items-section-shared">
            {booking.items.map((item, i) => (
              <div key={i} className="bp-item-row-shared">
                <span className="bp-item-name-shared">{formatActivityLabel(item.activity)}</span>
                <span className="bp-item-price-shared">
                  {formatCurrency(item.activity.basePrice)} × {item.quantity}
                </span>
              </div>
            ))}
            {booking.discountAmount > 0 && (
              <div className="bp-item-row-shared bp-discount-row-shared">
                <span className="bp-item-name-shared" style={{ color: 'var(--success-400)' }}>
                  {booking.couponCode ? `Coupon: ${booking.couponCode}` : 'Discount'}
                </span>
                <span className="bp-item-price-shared" style={{ color: 'var(--success-400)' }}>
                  -{formatCurrency(booking.discountAmount)}
                </span>
              </div>
            )}
          </div>
          <div className="bp-total-row-shared">
            <span className="bp-total-label-shared">TOTAL PAID</span>
            <span className="bp-total-amount-shared">{formatCurrency(booking.finalAmount)}</span>
          </div>
        </div>

        {/* Bottom notice */}
        <div className="bp-notice-shared">
          GATE CLOSES 10 MINS BEFORE DEPARTURE
          <br />
          Show this pass at the venue counter for entry
        </div>
      </div>

      {onDownload && !paymentPending && (
        <button className="bp-print-btn-shared" onClick={onDownload}>
          🖨️ PRINT / SAVE AS PDF
        </button>
      )}
      {paymentPending && (
        <div
          style={{
            marginTop: 20,
            textAlign: 'center',
            color: 'var(--gold-400)',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Payment Pending — Ticket cannot be printed yet
        </div>
      )}
    </div>
  )
}

export default BoardingPass
