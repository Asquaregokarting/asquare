import ExcelJS from 'exceljs'
import type { AsquareBooking } from '../../api/asquare-bookings'
import { downloadBlob } from '../incentives-report/download'
import {
  buildBookingExportRows,
  type VendorColumn,
  type VendorLineItem,
  type VendorMetaEntry,
} from './aggregate'

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF0066FF' },
}
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' } }
const FOOTER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF3F4F6' },
}
const RUPEE_FORMAT = '"₹"#,##0'
const DATE_FORMAT = 'yyyy-mm-dd hh:mm'

const styleHeaderRow = (row: ExcelJS.Row) => {
  row.font = HEADER_FONT
  row.fill = HEADER_FILL
  row.alignment = { vertical: 'middle', horizontal: 'left' }
}

const addBookingsSheet = (
  wb: ExcelJS.Workbook,
  payload: ReturnType<typeof buildBookingExportRows>,
) => {
  const ws = wb.addWorksheet('Bookings')
  const baseHeaders = [
    'S.No',
    'Booking ID',
    'Booked On',
    'Session Date',
    'Activity',
    'Customer Paid',
    'Booking Status',
    'Company Share',
    'Company GST',
  ]
  const thirdPartyHeaders = payload.vendorColumns.map(
    (c, i) => `ThirdParty ${i + 1}: ${c.vendorName}`,
  )
  const subleaseHeaders = payload.subleaseColumns.map(
    (c, i) => `Sublease ${i + 1}: ${c.vendorName}`,
  )
  const headers = [...baseHeaders, ...thirdPartyHeaders, ...subleaseHeaders]
  styleHeaderRow(ws.addRow(headers))

  if (payload.bookingRows.length === 0) {
    ws.addRow(['No bookings match the current filters.'])
  }

  let totalCustomerPaid = 0
  let totalCompanyShare = 0
  let totalCompanyGst = 0
  const totalsByVendor = new Map<string, number>()

  for (const row of payload.bookingRows) {
    const cells: Array<string | number | Date | null> = [
      row.serial,
      row.bookingId,
      row.bookedOn,
      row.sessionDate,
      row.activity,
      row.customerPaid,
      row.bookingStatus,
      row.companyShare,
      row.companyGst,
    ]
    for (const col of payload.vendorColumns) {
      const amt = row.vendorAmounts[col.vendorId]
      cells.push(typeof amt === 'number' && amt > 0 ? amt : null)
      if (typeof amt === 'number' && amt > 0) {
        totalsByVendor.set(col.vendorId, (totalsByVendor.get(col.vendorId) ?? 0) + amt)
      }
    }
    for (const col of payload.subleaseColumns) {
      const amt = row.vendorAmounts[col.vendorId]
      cells.push(typeof amt === 'number' && amt > 0 ? amt : null)
      if (typeof amt === 'number' && amt > 0) {
        totalsByVendor.set(col.vendorId, (totalsByVendor.get(col.vendorId) ?? 0) + amt)
      }
    }
    ws.addRow(cells)
    totalCustomerPaid += row.customerPaid
    totalCompanyShare += row.companyShare
    totalCompanyGst += row.companyGst
  }

  if (payload.bookingRows.length > 0) {
    const totalsCells: Array<string | number | null> = [
      '',
      'Totals',
      '',
      '',
      '',
      totalCustomerPaid,
      '',
      totalCompanyShare,
      totalCompanyGst,
    ]
    for (const col of payload.vendorColumns) {
      totalsCells.push(totalsByVendor.get(col.vendorId) ?? 0)
    }
    for (const col of payload.subleaseColumns) {
      totalsCells.push(totalsByVendor.get(col.vendorId) ?? 0)
    }
    const totalsRow = ws.addRow(totalsCells)
    totalsRow.font = { bold: true }
    totalsRow.fill = FOOTER_FILL
  }

  // Column widths
  const widths = [
    { width: 6 }, // S.No
    { width: 26 }, // Booking ID
    { width: 18 }, // Booked On
    { width: 18 }, // Session Date
    { width: 36 }, // Activity
    { width: 16 }, // Customer Paid
    { width: 16 }, // Booking Status
    { width: 16 }, // Company Share
    { width: 14 }, // Company GST
  ]
  for (let i = 0; i < thirdPartyHeaders.length + subleaseHeaders.length; i += 1) {
    widths.push({ width: 22 })
  }
  ws.columns = widths

  // Numeric formats
  ws.getColumn(3).numFmt = DATE_FORMAT
  ws.getColumn(4).numFmt = DATE_FORMAT
  ws.getColumn(6).numFmt = RUPEE_FORMAT
  ws.getColumn(8).numFmt = RUPEE_FORMAT
  ws.getColumn(9).numFmt = RUPEE_FORMAT
  const firstVendorCol = baseHeaders.length + 1
  const lastVendorCol = baseHeaders.length + thirdPartyHeaders.length + subleaseHeaders.length
  for (let c = firstVendorCol; c <= lastVendorCol; c += 1) {
    ws.getColumn(c).numFmt = RUPEE_FORMAT
  }
  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }]
}

const addLineItemSheet = (
  wb: ExcelJS.Workbook,
  sheetName: string,
  lineItems: VendorLineItem[],
  columns: VendorColumn[],
) => {
  const ws = wb.addWorksheet(sheetName)
  const headers = [
    'Booking ID',
    'Booked On',
    'Session Date',
    'Activity',
    'Vendor',
    'Share %',
    'Vendor Base',
    'Vendor GST',
    'Vendor Total',
  ]
  styleHeaderRow(ws.addRow(headers))

  if (lineItems.length === 0) {
    const note =
      columns.length === 0
        ? `No ${sheetName.toLowerCase()} vendor revenue in the filtered bookings.`
        : `No line items for the ${columns.length} ${sheetName.toLowerCase()} vendor(s).`
    ws.addRow([note])
  }

  let totalBase = 0
  let totalGst = 0
  let totalAmt = 0
  for (const item of lineItems) {
    ws.addRow([
      item.bookingId,
      item.bookedOn,
      item.sessionDate,
      item.activity,
      item.vendorName,
      item.sharePercent,
      item.vendorBase,
      item.vendorGst,
      item.vendorTotal,
    ])
    totalBase += item.vendorBase
    totalGst += item.vendorGst
    totalAmt += item.vendorTotal
  }

  if (lineItems.length > 0) {
    const totalsRow = ws.addRow(['', '', '', '', 'Totals', '', totalBase, totalGst, totalAmt])
    totalsRow.font = { bold: true }
    totalsRow.fill = FOOTER_FILL
  }

  ws.columns = [
    { width: 26 },
    { width: 18 },
    { width: 18 },
    { width: 36 },
    { width: 24 },
    { width: 10 },
    { width: 16 },
    { width: 14 },
    { width: 16 },
  ]
  ws.getColumn(2).numFmt = DATE_FORMAT
  ws.getColumn(3).numFmt = DATE_FORMAT
  ws.getColumn(6).numFmt = '0"%"'
  ws.getColumn(7).numFmt = RUPEE_FORMAT
  ws.getColumn(8).numFmt = RUPEE_FORMAT
  ws.getColumn(9).numFmt = RUPEE_FORMAT
  ws.views = [{ state: 'frozen', ySplit: 1 }]
}

export const exportBookingsExcel = async (
  bookings: AsquareBooking[],
  vendorMeta: VendorMetaEntry[],
  filename: string,
): Promise<void> => {
  const payload = buildBookingExportRows(bookings, vendorMeta)
  const wb = new ExcelJS.Workbook()
  wb.creator = 'A Square GoKarting'
  wb.created = new Date()
  addBookingsSheet(wb, payload)
  addLineItemSheet(wb, 'Vendor', payload.vendorLineItems, payload.vendorColumns)
  addLineItemSheet(wb, 'Sublease', payload.subleaseLineItems, payload.subleaseColumns)
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  downloadBlob(filename, blob)
}
