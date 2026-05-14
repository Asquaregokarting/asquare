import { TransactionRecord } from '../../api/types'
import { ensureMember, MemberRecord } from '../../api/asquare-members'
import { fmtDateIST } from '../../../lib/date-format'
import { getLocationShortName } from '../../../lib/locations'
// Use the dark-text logo for print (white background) instead of the white-text logo
const logoUrl = '/logo_print.svg'
const GST_NUMBER = '37AQKPB9099G3ZB'

const currency = (amount: number): string => `INR ${Math.round(amount).toLocaleString('en-IN')}`

/** Mask phone: show only last 4 digits. "9876543210" → "XXXXXX3210" */
const maskPhone = (phone?: string): string => {
  if (!phone) return '—'
  const digits = phone.replace(/\D/g, '')
  if (digits.length <= 4) return digits
  return 'X'.repeat(digits.length - 4) + digits.slice(-4)
}

/**
 * Converts an image URL to a base64 data URL for embedding in standalone HTML.
 */
const loadLogoAsBase64 = (url: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Canvas context unavailable'))
        return
      }
      ctx.drawImage(img, 0, 0)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => reject(new Error('Failed to load logo'))
    img.src = url
  })

const formatDate = (iso: string): string => {
  return fmtDateIST(iso)
}

/** Simple checksum: sum of char codes mod 10000, zero-padded to 4 digits. */
const simpleChecksum = (str: string): string => {
  let sum = 0
  for (let i = 0; i < str.length; i++) sum += str.charCodeAt(i)
  return String(sum % 10000).padStart(4, '0')
}

/**
 * Returns the QR code value — invoice number + Go-Karting serials + checksum.
 * Format: INVOICE|GK:001,002,003|CHK:xxxx (backward compat: old format is just invoice)
 */
const getQrValue = (txn: TransactionRecord): string => {
  const items = txn.items ?? []
  const gkSerials: string[] = []
  for (const item of items) {
    if (item.serialStart == null) continue
    const n = (item.itemName || '').toLowerCase()
    const isGK =
      n.includes('gokarting') ||
      n.includes('go-karting') ||
      n.includes('go karting') ||
      n.includes('gokart') ||
      n.includes('go-kart') ||
      n.includes('go kart')
    if (!isGK) continue
    for (let s = 0; s < (item.quantity || 1); s++) {
      gkSerials.push(String(item.serialStart + s).padStart(3, '0'))
    }
  }
  if (gkSerials.length === 0) return txn.invoiceNumber
  const payload = `${txn.invoiceNumber}|GK:${gkSerials.join(',')}`
  return `${payload}|CHK:${simpleChecksum(payload)}`
}

/**
 * Generates the HTML for a clean, print-ready billing receipt.
 */
const SOCIAL_LINKS_URL = 'https://app.asquaregokarting.com/links'

const buildReceiptHtml = (
  txn: TransactionRecord,
  locationLabel: string,
  qrDataUrl?: string,
  logoDataUrl?: string,
  member?: MemberRecord | null,
  socialQrDataUrl?: string,
): string => {
  const items = txn.items ?? []
  const isProtocol = txn.paymentMethod === 'Protocol'
  const subtotal = txn.subtotal ?? items.reduce((s, i) => s + i.unitPrice * i.quantity, 0)
  const discount = txn.discount ?? txn.couponDiscount ?? 0
  const gst = txn.gstAmount ?? txn.tax ?? 0
  const gstPercent = txn.gstPercent ?? 18
  const baseAmount = txn.baseAmount ?? Math.max(0, subtotal - discount)
  const status = isProtocol
    ? 'PROTOCOL'
    : txn.paymentStatus === 'pending'
      ? 'PENDING'
      : txn.paymentStatus === 'failed'
        ? 'FAILED'
        : 'PAID'
  const visitDate = txn.visitDate && txn.visitDate !== txn.transactionDate ? txn.visitDate : null

  const itemRows = items
    .map((item, i) => {
      const name = item.itemName || 'Item'
      const qty = item.quantity || 1
      const price = item.unitPrice || 0
      if (isProtocol) {
        return `
      <tr>
        <td colspan="2" style="padding:4px 0;text-align:left;font-size:11px;border-bottom:0.5px solid #000;word-break:break-word;">
          ${i + 1}. ${name} <span style="color:#000;">&times;${qty}</span>
        </td>
      </tr>`
      }
      return `
    <tr>
      <td style="padding:4px 0;text-align:left;font-size:11px;border-bottom:0.5px solid #000;word-break:break-word;">
        ${i + 1}. ${name} <span style="color:#000;">&times;${qty}</span>
      </td>
      <td style="padding:4px 0;text-align:right;font-size:11px;border-bottom:0.5px solid #000;vertical-align:top;min-width:60px;">${currency(price * qty)}</td>
    </tr>`
    })
    .join('')

  // Build dedicated serial number box section (Go-Karting items only).
  // Non-go-kart activities print their tokens as separate pages in the same
  // print document (see tokenHtmlPages in printTransactionReceipt) — they
  // must NOT appear here above "Base Amount". Some flows (e.g.
  // usePrintTicket on bookings) reserve a serial for every item regardless
  // of category, which is why we filter on item name here, not on whether
  // serialStart exists.
  const serialItems = items.filter(
    (item) => item.serialStart != null && isGoKartItem(item.itemName),
  )
  const serialGroups: Array<{ label: string; serials: number[] }> = []
  for (const item of serialItems) {
    const parts = (item.itemName || 'Item').split(' — ')
    const categoryLabel =
      parts.length >= 4
        ? parts[2].trim()
        : parts.length >= 2
          ? parts[1].trim()
          : item.itemName || 'Item'
    const start = item.serialStart!
    const qty = item.quantity || 1
    const itemSerials: number[] = []
    for (let s = 0; s < qty; s++) itemSerials.push(start + s)
    const existing = serialGroups.find((g) => g.label.toLowerCase() === categoryLabel.toLowerCase())
    if (existing) {
      existing.serials.push(...itemSerials)
    } else {
      serialGroups.push({ label: categoryLabel, serials: itemSerials })
    }
  }
  // Sort serials within each group
  for (const g of serialGroups) g.serials.sort((a, b) => a - b)

  let serialTicketSection = ''
  if (serialGroups.length > 0) {
    const colsPerRow = Math.min(3, serialGroups.length)
    const colWidth = Math.floor(100 / colsPerRow)
    let tableRows = ''
    for (let r = 0; r < serialGroups.length; r += 3) {
      const chunk = serialGroups.slice(r, r + 3)
      const headerCells = chunk
        .map((e) => {
          const count = e.serials.length
          const qtyLabel = count > 1 ? ` (x${count})` : ''
          return `<td style="width:${colWidth}%;padding:6px 4px 3px;text-align:center;font-size:10px;font-weight:700;letter-spacing:1px;color:#000;border:1.5px solid #000;border-bottom:none;border-radius:8px 8px 0 0;text-transform:uppercase;">${e.label}${qtyLabel}</td>`
        })
        .join('')
      const valueCells = chunk
        .map((e) => {
          const count = e.serials.length
          const formatted = e.serials.map((s) => String(s).padStart(3, '0'))
          if (count === 1) {
            return `<td style="width:${colWidth}%;padding:6px 4px 10px;text-align:center;font-size:36px;font-weight:900;color:#000;border:1.5px solid #000;border-top:0.5px solid #000;border-radius:0 0 8px 8px;letter-spacing:2px;">${formatted[0]}</td>`
          }
          const fontSize = count <= 3 ? 28 : count <= 6 ? 22 : 18
          return `<td style="width:${colWidth}%;padding:6px 4px 10px;text-align:center;font-size:${fontSize}px;font-weight:900;color:#000;border:1.5px solid #000;border-top:0.5px solid #000;border-radius:0 0 8px 8px;letter-spacing:2px;">${formatted.join(', ')}</td>`
        })
        .join('')
      const pad = 3 - chunk.length
      const emptyH = pad > 0 ? `<td colspan="${pad}" style="border:none;"></td>` : ''
      const emptyV = pad > 0 ? `<td colspan="${pad}" style="border:none;"></td>` : ''
      tableRows += `<tr>${headerCells}${emptyH}</tr><tr>${valueCells}${emptyV}</tr>`
    }
    serialTicketSection = `
    <div style="margin:10px 0;">
      <table style="width:100%;border-collapse:collapse;">${tableRows}</table>
    </div>`
  }

  const discountRow =
    discount > 0
      ? `
    <tr>
      <td style="padding:4px 0;text-align:left;font-size:11px;color:#000;font-weight:700;">Discount${txn.couponCode ? ` (${txn.couponCode})` : ''}</td>
      <td style="padding:4px 0;text-align:right;font-size:11px;color:#000;font-weight:700;">-${currency(discount)}</td>
    </tr>
  `
      : ''

  const walletRedeemed = txn.walletRedeemed ?? 0
  const walletRow =
    walletRedeemed > 0
      ? `
    <tr>
      <td style="padding:4px 0;text-align:left;font-size:11px;color:#000;font-weight:700;">Wallet Redeemed</td>
      <td style="padding:4px 0;text-align:right;font-size:11px;color:#000;font-weight:700;">-${currency(walletRedeemed)}</td>
    </tr>
  `
      : ''

  const pendingBadge =
    txn.paymentStatus === 'pending'
      ? `
    <div style="text-align:center;margin:10px 0;padding:6px 10px;background:#fff;color:#000;border:1.5px solid #000;border-radius:8px;font-size:11px;font-weight:800;">
      PAYMENT PENDING
    </div>
  `
      : ''

  const qrSection = qrDataUrl
    ? `
    <div style="text-align:center;margin:12px 0 6px;">
      <div style="display:inline-block;padding:6px;border:1.5px solid #000;border-radius:8px;width:30mm;height:30mm;">
        ${qrDataUrl}
      </div>
      <p style="font-size:8px;color:#000;margin:6px 0 0;letter-spacing:0.5px;">Scan QR at Track to verify access</p>
    </div>
  `
    : ''

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Receipt - ${txn.invoiceNumber}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  @media print {
    @page { margin: 5mm; size: 80mm auto; }
    html, body { height: auto !important; }
    .no-print { display:none !important; }
    div, table, tr, td, img, p { page-break-inside: avoid; break-inside: avoid; }
  }
  body {
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    background: #fff;
    color: #000;
    max-width: 265px;
    margin: 0 auto;
    padding: 10px;
    position: relative;
    word-wrap: break-word;
    overflow-wrap: break-word;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  ${
    isProtocol
      ? `
  body::before {
    content: "PROTOCOL";
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-35deg);
    font-size: 64px;
    font-weight: 900;
    color: rgba(0, 0, 0, 0.08);
    letter-spacing: 8px;
    pointer-events: none;
    z-index: 9999;
    white-space: nowrap;
    text-transform: uppercase;
  }`
      : ''
  }
</style>
</head>
<body>

<!-- Header with Logo -->
<div style="text-align:center;padding-bottom:10px;border-bottom:1.5px solid #000;">
  ${logoDataUrl ? `<img src="${logoDataUrl}" alt="A Square Go Karting" style="display:block;margin:0 auto 8px;width:160px;height:auto;" />` : `<h1 style="font-size:15px;font-weight:800;letter-spacing:3px;margin:0 0 6px;text-transform:uppercase;">A SQUARE GO KARTING</h1>`}
  <p style="font-size:10px;font-weight:600;color:#000;margin:3px 0;letter-spacing:1.5px;">${locationLabel ? ` ${locationLabel}` : ''}</p>
  <p style="font-size:8px;color:#000;margin:3px 0;letter-spacing:0.5px;">GST: ${GST_NUMBER}</p>
</div>

${
  socialQrDataUrl
    ? `
<!-- Follow Us -->
<div style="text-align:center;margin:10px 0 6px;">
  <p style="font-size:9px;font-weight:700;color:#000;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px;">Follow Us on Social Media</p>
  <div style="display:inline-block;padding:6px;border:1.5px solid #000;border-radius:8px;width:30mm;height:30mm;">
    ${socialQrDataUrl}
  </div>
  <p style="font-size:7px;color:#000;font-weight:600;margin-top:4px;">Scan to follow us on Instagram, Facebook & YouTube</p>
</div>
`
    : ''
}

<!-- Invoice title -->
<div style="text-align:center;margin:10px 0;">
  <span style="display:inline-block;font-size:10px;font-weight:700;letter-spacing:2px;background:#fff;color:#000;padding:4px 16px;border:1.5px solid #000;border-radius:20px;">${isProtocol ? 'PROTOCOL ENTRY' : 'BILLING RECEIPT'}</span>
</div>

<!-- Member Info -->
<div style="margin:10px 0;padding:10px;border:1.5px solid #000;border-radius:8px;background:#fff;">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
    <span style="font-size:9px;font-weight:700;letter-spacing:1.5px;color:#000;text-transform:uppercase;">Member Info</span>
    <span style="display:inline-block;font-size:8px;font-weight:700;background:#fff;color:#000;padding:2px 8px;border:1px solid #000;border-radius:10px;">${member?.membership ?? 'Silver'}</span>
  </div>
  <table style="width:100%;font-size:10px;border-collapse:collapse;">
    <tr>
      <td style="padding:2px 0;color:#000;">${txn.customerName ?? '—'}</td>
      <td style="padding:2px 0;text-align:right;font-weight:700;">${maskPhone(txn.customerPhone)}</td>
    </tr>
    <tr>
      <td style="padding:2px 0;color:#000;">Visits</td>
      <td style="padding:2px 0;text-align:right;font-weight:700;">${member?.totalVisits ?? 1}</td>
    </tr>
    <tr>
      <td style="padding:2px 0;color:#000;">₹150 Coupons Available</td>
      <td style="padding:2px 0;text-align:right;font-weight:800;color:#000;">${member?.coupons150Available ?? 0}</td>
    </tr>
    <tr>
      <td colspan="2" style="padding:2px 0;color:#000;font-size:8px;font-style:italic;">(can be redeemed on same day)</td>
    </tr>
  </table>
</div>

<!-- Info section -->
<table style="width:100%;font-size:10px;margin:10px 0;border-collapse:collapse;">
  <tr>
    <td style="padding:3px 0;color:#000;font-weight:700;">Invoice</td>
    <td style="padding:3px 0;text-align:right;font-weight:800;">${txn.invoiceNumber}</td>
  </tr>
  <tr>
    <td style="padding:3px 0;color:#000;font-weight:700;">Billing Date</td>
    <td style="padding:3px 0;text-align:right;">${formatDate(txn.transactionDate)}</td>
  </tr>
  ${
    visitDate
      ? `<tr>
    <td style="padding:3px 0;color:#000;font-weight:700;">Visit Date</td>
    <td style="padding:3px 0;text-align:right;">${formatDate(visitDate)}</td>
  </tr>`
      : ''
  }
  ${
    isProtocol
      ? `<tr>
    <td style="padding:3px 0;color:#000;font-weight:700;">Type</td>
    <td style="padding:3px 0;text-align:right;font-weight:900;color:#000;">PROTOCOL</td>
  </tr>`
      : `<tr>
    <td style="padding:3px 0;color:#000;font-weight:700;">Payment Mode</td>
    <td style="padding:3px 0;text-align:right;">${txn.paymentMethod}</td>
  </tr>
  ${txn.paymentMethod === 'Split' ? `<tr><td colspan="2" style="padding:3px 0;font-size:9px;color:#000;">${[txn.splitCash ? 'Cash: ' + currency(txn.splitCash) : '', txn.splitUpi ? 'UPI: ' + currency(txn.splitUpi) : '', txn.splitCard ? 'Card: ' + currency(txn.splitCard) : ''].filter(Boolean).join(' | ')}</td></tr>` : ''}
  <tr>
    <td style="padding:3px 0;color:#000;font-weight:700;">Status</td>
    <td style="padding:3px 0;text-align:right;font-weight:900;color:#000;">${status}</td>
  </tr>`
  }
</table>

<!-- Divider -->
<div style="border-top:0.5px solid #000;margin:10px 0;"></div>

<!-- Items -->
<table style="width:100%;border-collapse:collapse;">
  <tr style="border-bottom:1.5px solid #000;">
    <th style="padding:5px 0;text-align:left;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Item</th>
    ${isProtocol ? '' : `<th style="padding:5px 0;text-align:right;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Amount</th>`}
  </tr>
  ${itemRows}
</table>

${serialTicketSection}

<!-- Divider -->
<div style="border-top:0.5px solid #000;margin:10px 0;"></div>

${
  isProtocol
    ? ''
    : `<!-- Totals -->
<table style="width:100%;border-collapse:collapse;">
  <tr>
    <td style="padding:4px 0;text-align:left;font-size:11px;font-weight:700;">Base Amount</td>
    <td style="padding:4px 0;text-align:right;font-size:11px;font-weight:700;">${currency(baseAmount)}</td>
  </tr>
  ${discountRow}
  ${walletRow}
  <tr>
    <td style="padding:4px 0;text-align:left;font-size:11px;font-weight:700;">GST (${gstPercent}%)</td>
    <td style="padding:4px 0;text-align:right;font-size:11px;font-weight:700;">${currency(gst)}</td>
  </tr>
</table>`
}

<!-- Total + QR + Footer kept together to avoid page split -->
<div style="page-break-inside:avoid;break-inside:avoid;">

${
  isProtocol
    ? `<!-- Protocol badge -->
<div style="margin:10px 0;padding:10px 12px;background:#fff;color:#000;border:2.5px solid #000;border-radius:8px;text-align:center;">
  <span style="font-size:13px;font-weight:800;letter-spacing:2px;">PROTOCOL ENTRY — FREE</span>
</div>`
    : `<!-- Total highlight -->
<div style="margin:10px 0;padding:10px 12px;background:#fff;color:#000;border:2.5px solid #000;border-radius:8px;display:flex;justify-content:space-between;align-items:center;">
  <span style="font-size:13px;font-weight:800;letter-spacing:2px;">TOTAL</span>
  <span style="font-size:17px;font-weight:900;letter-spacing:1px;">${currency(txn.totalAmount)}</span>
</div>`
}

${pendingBadge}

<!-- QR Code -->
${qrSection}

<!-- Footer -->
<div style="text-align:center;margin-top:12px;padding-top:10px;border-top:0.5px solid #000;">
  <p style="font-size:9px;font-weight:600;color:#000;letter-spacing:0.5px;">Thank you for visiting A Square Go Karting!</p>
  <p style="font-size:7px;color:#000;margin-top:4px;line-height:1.4;">Near Sadhu Matham, National Highway, Vellanki, Anandapuram, Visakhapatnam, AP-53116</p>
</div>

</div>

</body>
</html>`
}

/**
 * Opens a clean print-only receipt in a new window and auto-triggers the print dialog.
 * Works for both Print and Reprint. Uses stored transaction data as-is — no recalculation.
 */
export const printReceipt = (
  txn: TransactionRecord,
  qrDataUrl?: string,
  logoDataUrl?: string,
  member?: MemberRecord | null,
  socialQrDataUrl?: string,
  tokenHtmlPages?: string[],
): void => {
  const locationLabel = txn.locationId ? getLocationShortName(txn.locationId) : ''
  let html = buildReceiptHtml(txn, locationLabel, qrDataUrl, logoDataUrl, member, socialQrDataUrl)

  // Append game token pages into the same print document (avoids popup blocking)
  if (tokenHtmlPages && tokenHtmlPages.length > 0) {
    // Insert token pages before closing </body> with page-break-before
    const tokenSection = tokenHtmlPages
      .map((tokenBody) => `<div style="page-break-before:always;">${tokenBody}</div>`)
      .join('')
    html = html.replace('</body>', `${tokenSection}</body>`)
  }

  // Use a hidden iframe to print without popups
  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.top = '-10000px'
  iframe.style.left = '-10000px'
  iframe.style.width = '300px'
  iframe.style.height = '700px'
  iframe.style.border = 'none'
  document.body.appendChild(iframe)

  const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document
  if (!iframeDoc) {
    // Fallback: open as blob if iframe document not accessible
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank')
    document.body.removeChild(iframe)
    return
  }

  iframeDoc.open()
  iframeDoc.write(html)
  iframeDoc.close()

  // Wait for content + QR image to fully load before triggering print
  iframe.onload = () => {
    setTimeout(() => {
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
      // Clean up iframe after printing
      setTimeout(() => {
        document.body.removeChild(iframe)
      }, 1000)
    }, 300)
  }
}

/**
 * Generates QR code SVG markup as a string for embedding directly in HTML.
 * Uses qrcode.react's QRCodeSVG rendered offscreen — produces crisp vector
 * output that scales perfectly on thermal printers.
 */
export const generateQrSvgMarkup = (value: string, size = 200): Promise<string> =>
  new Promise((resolve, reject) => {
    const container = document.createElement('div')
    container.style.cssText = 'position:fixed;left:-9999px;top:-9999px;'
    document.body.appendChild(container)

    import('react-dom/client')
      .then(({ createRoot }) => {
        import('react')
          .then(({ createElement }) => {
            import('qrcode.react')
              .then(({ QRCodeSVG }) => {
                const root = createRoot(container)
                root.render(
                  createElement(QRCodeSVG, { value, size, level: 'H', includeMargin: true }),
                )

                let attempts = 0
                const poll = () => {
                  const svg = container.querySelector('svg')
                  if (svg) {
                    try {
                      svg.setAttribute('width', '100%')
                      svg.setAttribute('height', '100%')
                      const markup = svg.outerHTML
                      root.unmount()
                      document.body.removeChild(container)
                      resolve(markup)
                    } catch (err) {
                      root.unmount()
                      document.body.removeChild(container)
                      reject(err)
                    }
                  } else if (attempts < 20) {
                    attempts++
                    requestAnimationFrame(poll)
                  } else {
                    root.unmount()
                    document.body.removeChild(container)
                    reject(new Error('QR SVG not found after timeout'))
                  }
                }
                requestAnimationFrame(poll)
              })
              .catch(reject)
          })
          .catch(reject)
      })
      .catch(reject)
  })

/** @deprecated Use generateQrSvgMarkup instead. Kept for backward compatibility. */
export const generateQrDataUrl = generateQrSvgMarkup

/**
 * Full print flow: generate QR + load logo, then open the receipt print window.
 * Used by both Print Receipt and Reprint buttons.
 */
export const printTransactionReceipt = async (txn: TransactionRecord): Promise<void> => {
  if (txn.paymentStatus !== 'completed') {
    throw new Error('Cannot print receipt — payment is not completed.')
  }
  // Load QR, logo, member data, and social QR in parallel for faster receipt generation
  const [qrResult, logoResult, memberResult, socialQrResult] = await Promise.allSettled([
    generateQrSvgMarkup(getQrValue(txn), 300),
    loadLogoAsBase64(logoUrl),
    txn.customerPhone
      ? ensureMember(txn.customerPhone, txn.customerName, txn.totalAmount)
      : Promise.resolve(null),
    generateQrSvgMarkup(SOCIAL_LINKS_URL, 300),
  ])
  const qrDataUrl = qrResult.status === 'fulfilled' ? qrResult.value : undefined
  const logoDataUrl = logoResult.status === 'fulfilled' ? logoResult.value : undefined
  const member = memberResult.status === 'fulfilled' ? memberResult.value : null
  const socialQrDataUrl = socialQrResult.status === 'fulfilled' ? socialQrResult.value : undefined

  // Build game token pages for non-Go-Karting items (appended to same print document)
  const tokenItems = (txn.items ?? []).filter((item) => !isGoKartItem(item.itemName))
  const tokenPages: string[] = []
  for (const item of tokenItems) {
    if (item.printIndividualTokens && item.quantity > 1) {
      for (let i = 0; i < item.quantity; i++) {
        tokenPages.push(buildTokenBodyHtml(item, txn, { individualIndex: i }))
      }
    } else {
      tokenPages.push(buildTokenBodyHtml(item, txn))
    }
  }

  printReceipt(txn, qrDataUrl, logoDataUrl, member, socialQrDataUrl, tokenPages)
}

/**
 * Generates the inner body HTML for a single game token.
 * Returns just the content (no <html>/<head>/<body> wrapper) so it can be
 * embedded into the main receipt document as an additional page.
 */
const buildTokenBodyHtml = (
  item: {
    itemName: string
    unitPrice: number
    quantity: number
    serialStart?: number
    printIndividualTokens?: boolean
  },
  txn: TransactionRecord,
  options?: { individualIndex?: number },
): string => {
  const locationLabel = txn.locationId ? getLocationShortName(txn.locationId) : ''
  const dateStr = formatDate(txn.transactionDate)
  const cashier = txn.createdByName ?? '—'
  const isIndividual = options?.individualIndex != null

  const qtyRow = isIndividual
    ? `<div style="text-align:center;font-size:12px;font-weight:bold;color:#000;margin-bottom:6px;">${(options!.individualIndex as number) + 1} of ${item.quantity}</div>`
    : item.quantity > 1
      ? `<div style="text-align:center;font-size:14px;font-weight:bold;color:#000;margin-bottom:6px;">Quantity: ${item.quantity}</div>`
      : ''

  let serialRow = ''
  if (item.serialStart != null) {
    if (isIndividual) {
      const serial = String(item.serialStart + (options!.individualIndex as number)).padStart(
        3,
        '0',
      )
      serialRow = `<div style="display:flex;justify-content:space-between;margin-bottom:3px;font-size:10px;overflow:hidden;word-break:break-word;"><span>Serial</span><span style="font-weight:bold;">${serial}</span></div>`
    } else {
      const serials: string[] = []
      for (let s = 0; s < (item.quantity || 1); s++) {
        serials.push(String(item.serialStart + s).padStart(3, '0'))
      }
      serialRow = `<div style="display:flex;justify-content:space-between;margin-bottom:3px;font-size:10px;overflow:hidden;word-break:break-word;"><span>Serial</span><span style="font-weight:bold;">${serials.join(', ')}</span></div>`
    }
  }

  return `
  <div style="font-family:'Segoe UI',system-ui,-apple-system,sans-serif;font-size:11px;width:68mm;background:#fff;color:#000;word-wrap:break-word;overflow-wrap:break-word;">
    <div style="text-align:center;padding-bottom:6px;border-bottom:0.5px solid #000;margin-bottom:8px;">
      <div style="font-weight:700;font-size:12px;letter-spacing:2px;">A SQUARE GOKART</div>
      <div style="font-size:11px;font-weight:600;letter-spacing:3px;margin-top:4px;">-- GAME TOKEN --</div>
    </div>
    <div style="text-align:center;margin:10px 0 6px;">
      <div style="font-size:15px;font-weight:700;line-height:1.3;">${item.itemName}</div>
    </div>
    ${qtyRow}
    <div style="border-top:0.5px solid #000;margin:8px 0;"></div>
    <div style="display:flex;justify-content:space-between;margin-bottom:3px;font-size:10px;overflow:hidden;word-break:break-word;"><span>Invoice</span><span style="font-weight:bold;">${txn.invoiceNumber ?? txn.id}</span></div>
    <div style="display:flex;justify-content:space-between;margin-bottom:3px;font-size:10px;overflow:hidden;word-break:break-word;"><span>Date</span><span style="font-weight:bold;">${dateStr}</span></div>
    <div style="display:flex;justify-content:space-between;margin-bottom:3px;font-size:10px;overflow:hidden;word-break:break-word;"><span>Cashier</span><span style="font-weight:bold;">${cashier}</span></div>
    ${locationLabel ? `<div style="display:flex;justify-content:space-between;margin-bottom:3px;font-size:10px;overflow:hidden;word-break:break-word;"><span>Location</span><span style="font-weight:bold;">${locationLabel}</span></div>` : ''}
    ${serialRow}
  </div>`
}

/**
 * Checks if an item name refers to a Go-Karting activity.
 */
const isGoKartItem = (name: string): boolean => {
  const n = name.toLowerCase()
  return (
    n.includes('gokarting') ||
    n.includes('go-karting') ||
    n.includes('go karting') ||
    n.includes('gokart') ||
    n.includes('go-kart') ||
    n.includes('go kart')
  )
}

/**
 * Prints compact token receipts for each non-Go-Karting game item in the transaction.
 * Go-Karting items already have serial numbers on the main receipt — they don't need tokens.
 * Tokens open in staggered windows after the main receipt.
 */
/**
 * @deprecated Token receipts are now embedded in the main receipt via printTransactionReceipt.
 * Kept as a no-op export so existing callers don't break.
 */
export const printVendorTokenReceipts = (_txn: TransactionRecord): void => {
  // Tokens are now appended as extra pages in the main receipt print document.
  // See printTransactionReceipt → printReceipt (tokenHtmlPages parameter).
}

// Keep legacy export for backward compat (unused now but safe)
export const generateBillingReceipt = async (
  transaction: TransactionRecord,
  options?: {
    locationLabel?: string
    qrDataUrl?: string
    logoDataUrl?: string
    member?: MemberRecord | null
  },
): Promise<Blob> => {
  const locationLabel =
    options?.locationLabel ??
    (transaction.locationId ? getLocationShortName(transaction.locationId) : '')
  const html = buildReceiptHtml(
    transaction,
    locationLabel,
    options?.qrDataUrl,
    options?.logoDataUrl,
    options?.member,
  )
  return new Blob([html], { type: 'text/html' })
}
