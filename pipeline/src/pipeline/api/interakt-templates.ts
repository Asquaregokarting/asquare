// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InteraktTemplateImage {
  templateName: string;
  label: string;
  fileName: string;
}

// All Interakt notification templates with their header images.
// Images live in public/interakt/ and are served as static files.
// Cloud Functions read from the same path on the deployed site.
// To update an image: replace the file in public/interakt/ and redeploy.
export const TEMPLATE_LIST: InteraktTemplateImage[] = [
  // Vendor notifications
  { templateName: "vendor_register_notification", label: "Vendor Registration", fileName: "vendor_register_notification.jpg" },
  { templateName: "game_adding_notification", label: "Game Adding", fileName: "game_adding_notification.jpg" },
  { templateName: "invoice_generate_notification", label: "Invoice Generated", fileName: "invoice_generate_notification.jpg" },
  { templateName: "payment_initiated_confirmation", label: "Payment Initiated", fileName: "payment_initiated_confirmation.jpg" },
  // Customer notifications
  { templateName: "feedback_form", label: "Feedback Form", fileName: "feedback_form.jpeg" },
  { templateName: "waiting_dashboard_ox", label: "Waiting Dashboard", fileName: "waiting_dashboard_ox.jpeg" },
  { templateName: "counter_checkin_20", label: "Counter Check-in", fileName: "counter_checkin_20.jpg" },
  { templateName: "150_coupons_", label: "150 Coupons", fileName: "150_coupons_.png" },
  { templateName: "payment_failed", label: "Payment Failed", fileName: "payment_failed.jpeg" },
  { templateName: "race_confirmed", label: "Race Confirmed", fileName: "race_confirmed.jpeg" },
  { templateName: "a_sqaure_payment_request", label: "Payment Request", fileName: "a_sqaure_payment_request.png" },
  // Kartfluencer notifications
  { templateName: "kartfluencer_welcome", label: "Kartfluencer Welcome", fileName: "kartfluencer_welcome.jpg" },
  { templateName: "kartfluencer_visited", label: "Kartfluencer Visited", fileName: "kartfluencer_visited.jpg" },
  { templateName: "kartfluencer_reel_verified", label: "Kartfluencer Reel Verified", fileName: "kartfluencer_reel_verified.jpg" },
  { templateName: "kartfluencer_milestone", label: "Kartfluencer Milestone", fileName: "kartfluencer_milestone.jpg" },
  { templateName: "kartfluencer_payment", label: "Kartfluencer Payment", fileName: "kartfluencer_payment.jpg" },
  { templateName: "kartfluencer_disqualified", label: "Kartfluencer Disqualified", fileName: "kartfluencer_disqualified.jpg" },
  // Partner/Franchise notifications
  { templateName: "partner_signup_success", label: "Partner Signup Success", fileName: "partner_signup_success.jpg" },
  { templateName: "srikakulam_brochure", label: "Srikakulam Brochure", fileName: "srikakulam_brochure.jpg" },
];
