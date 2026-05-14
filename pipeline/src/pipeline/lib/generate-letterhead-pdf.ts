import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { fmtDateIST } from "../../lib/date-format";
import { LetterheadConfig } from "../api/types";
import headerUrl from "../../assets/letter head top.png";
import footerUrl from "../../assets/letter head bottom.png";

const loadImageAsBase64 = (url: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("Canvas context unavailable")); return; }
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = url;
  });

const formatIndianAmount = (amount: number): string =>
  Math.round(amount).toLocaleString("en-IN");

const formatDate = (dateStr: string): string => {
  return fmtDateIST(dateStr);
};

// A4 dimensions in mm
const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 18;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

// Header: 1700x437 → aspect 0.257 → full-width at 210mm = ~54mm
const HEADER_HEIGHT = 54;
// Footer: 1700x485 → aspect 0.285 → full-width at 210mm = ~60mm
const FOOTER_HEIGHT = 60;

// Safe content zone — content must not render below this Y
const FOOTER_TOP = PAGE_HEIGHT - FOOTER_HEIGHT; // 237mm
const SAFE_BOTTOM = FOOTER_TOP - 5; // 232mm (5mm padding above footer)

/**
 * Generates a branded NEFT letterhead PDF matching A Square Entertainments' bank submission format.
 * A4 portrait with full-width branded header/footer banners on every page.
 * Supports multi-page pagination when vendor table exceeds available space.
 * Returns the jsPDF doc instance for preview (.output("bloburl")) or download (.save()).
 */
export const generateLetterheadPdf = async (config: LetterheadConfig): Promise<jsPDF> => {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

  // ── Load images in parallel ────────────────────────────────────────────────
  const [headerBase64, footerBase64] = await Promise.all([
    loadImageAsBase64(headerUrl).catch(() => null),
    loadImageAsBase64(footerUrl).catch(() => null),
  ]);

  // ── Helper: draw header banner on current page ─────────────────────────────
  const drawHeader = () => {
    if (headerBase64) {
      doc.addImage(headerBase64, "PNG", 0, 0, PAGE_WIDTH, HEADER_HEIGHT);
    }
  };

  // ── Page 1: Header banner ──────────────────────────────────────────────────
  drawHeader();

  let y = HEADER_HEIGHT + 10;

  // ── Bank address block ──────────────────────────────────────────────────────
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  const addressLines = [
    "To",
    "The Branch Manager",
    "The Visakhapatnam Co-operative Bank Ltd.",
    "Narasipatnam Branch"
  ];
  addressLines.forEach((line) => {
    doc.text(line, MARGIN, y);
    y += 5;
  });
  y += 3;

  // ── Date ────────────────────────────────────────────────────────────────────
  doc.text(`Date: ${formatDate(config.date)}`, MARGIN, y);
  y += 8;

  // ── Subject ─────────────────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  const subjectText = "Subject: Request for Third-party Payment Transfer via NEFT for A Square Entertainments.";
  const subjectLines = doc.splitTextToSize(subjectText, CONTENT_WIDTH);
  doc.text(subjectLines, MARGIN, y);
  y += subjectLines.length * 5 + 4;

  // ── Salutation ──────────────────────────────────────────────────────────────
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Respected Sir/Madam,", MARGIN, y);
  y += 7;

  // ── Body paragraph ──────────────────────────────────────────────────────────
  const bodyText =
    "We, A Square Entertainments, request you to facilitate the transfer of Third-party " +
    "Vendors through a single consolidated cheque to be disbursed into their respective " +
    "bank accounts via NEFT.";
  const bodyLines = doc.splitTextToSize(bodyText, CONTENT_WIDTH);
  doc.text(bodyLines, MARGIN, y);
  y += bodyLines.length * 5 + 5;

  // ── Cheque info (left-right aligned on one line) ────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(`Cheque No: ${config.chequeNumber}`, MARGIN, y);
  doc.text(
    `Period: ${formatDate(config.periodStart)} \u2013 ${formatDate(config.periodEnd)}`,
    PAGE_WIDTH - MARGIN, y, { align: "right" }
  );
  doc.setFont("helvetica", "normal");
  y += 6;

  // ── Instructions line ───────────────────────────────────────────────────────
  doc.setFontSize(9);
  const instrText =
    "Please find enclosed herewith the details of our Beneficiary\u2019s account detail along with " +
    "their account numbers, IFSC codes, and the amount to be credited to each account.";
  const instrLines = doc.splitTextToSize(instrText, CONTENT_WIDTH);
  doc.text(instrLines, MARGIN, y);
  y += instrLines.length * 4.5 + 3;

  // ── Vendor table ────────────────────────────────────────────────────────────
  const tableBody = config.vendors.map((v) => [
    String(v.sNo),
    v.vendorName,
    `"${v.accountNumber}"`,
    v.bankName,
    v.branch,
    v.ifscCode,
    formatIndianAmount(v.amount)
  ]);

  // Add total row
  tableBody.push(["", "", "", "", "", "Total", formatIndianAmount(config.grandTotal)]);

  autoTable(doc, {
    startY: y,
    head: [["S.No", "Company Name", "Account Number", "Bank Name", "Branch", "IFSC Code", "Amount"]],
    body: tableBody,
    theme: "grid",
    showHead: "everyPage",
    headStyles: {
      fillColor: [26, 38, 57],
      textColor: 255,
      fontStyle: "bold",
      fontSize: 7.5,
      cellPadding: 2.5,
    },
    styles: {
      fontSize: 7.5,
      cellPadding: 2,
      overflow: "linebreak",
      lineColor: [180, 180, 180],
      lineWidth: 0.2,
    },
    columnStyles: {
      0: { cellWidth: 10, halign: "center" },
      1: { cellWidth: 32 },
      2: { cellWidth: 30 },
      3: { cellWidth: 30 },
      4: { cellWidth: 24 },
      5: { cellWidth: 22 },
      6: { cellWidth: 18, halign: "right" },
    },
    margin: {
      left: MARGIN,
      right: MARGIN,
      top: HEADER_HEIGHT + 6,
      bottom: PAGE_HEIGHT - SAFE_BOTTOM,
    },
    didDrawPage: (data) => {
      // Draw header banner on continuation pages (page 1 already has it)
      if (data.pageNumber > 1) {
        drawHeader();
      }
    },
    didParseCell: (data) => {
      // Bold the total row with light background
      if (data.row.index === tableBody.length - 1) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [236, 240, 241];
      }
      // Alternate row shading for readability
      if (data.section === "body" && data.row.index < tableBody.length - 1 && data.row.index % 2 === 1) {
        data.cell.styles.fillColor = [248, 249, 250];
      }
    },
  });

  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  // ── Closing block — check if it fits above footer, else new page ───────────
  const closingBlockHeight = 45; // request text + thanking + signature ≈ 45mm
  if (y + closingBlockHeight > SAFE_BOTTOM) {
    doc.addPage();
    drawHeader();
    y = HEADER_HEIGHT + 10;
  }

  // ── Request line ────────────────────────────────────────────────────────────
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  const requestText =
    "We request you to kindly process the NEFT transactions on our behalf on submission of " +
    "the cheque along with the third-party Vendors.";
  const requestLines = doc.splitTextToSize(requestText, CONTENT_WIDTH);
  doc.text(requestLines, MARGIN, y);
  y += requestLines.length * 4.5 + 8;

  // ── Closing ─────────────────────────────────────────────────────────────────
  doc.setFontSize(10);
  doc.text("Thanking you,", MARGIN, y);
  y += 5;
  doc.text("Yours Faithfully,", MARGIN, y);
  y += 12;

  doc.setFont("helvetica", "bold");
  doc.text("BODDETI ANAND", MARGIN, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.text("Proprietor,", MARGIN, y);
  y += 5;
  doc.text("A Square Entertainment", MARGIN, y);

  // ── Footer banner (full-width, fixed at bottom of EVERY page) ──────────────
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    if (footerBase64) {
      doc.addImage(footerBase64, "PNG", 0, FOOTER_TOP, PAGE_WIDTH, FOOTER_HEIGHT);
    }
  }

  return doc;
};
