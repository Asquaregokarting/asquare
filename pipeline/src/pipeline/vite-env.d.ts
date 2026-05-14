/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_BUILD_TARGET?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_USE_MOCK_API?: string;
  readonly VITE_ROUTER_MODE?: string;
  readonly VITE_WEBSITE_API_URL?: string;
  readonly VITE_WEBSITE_API_KEY?: string;
  readonly VITE_WEBSITE_API_PASSWORD?: string;
  readonly VITE_WEBSITE_API_BRANCH_ID?: string;
  readonly VITE_WEBSITE_RECENT_LOGINS_TRANSAC?: string;
  readonly VITE_WEBSITE_INTERAKT_TRANSAC?: string;
  readonly VITE_WEBSITE_ALL_BRANCH_IDS?: string;
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_FIREBASE_FIRESTORE_DATABASE_ID?: string;
  readonly VITE_INTERAKT_PAYMENT_REQUEST_HEADER_IMAGE_URL?: string;
  readonly VITE_SUPERFONE_WEBHOOK_LIMIT?: string;
  readonly VITE_SUPERFONE_WEBHOOK_MODE?: string;
  readonly VITE_SUPERFONE_WEBHOOK_TOKEN?: string;
  readonly VITE_SUPERFONE_WEBHOOK_URL?: string;
  readonly VITE_USE_FIRESTORE_LEADS?: string;
  readonly VITE_USE_FIRESTORE_RECENT_LOGINS?: string;
  readonly VITE_USE_FIRESTORE_USERS?: string;
  readonly VITE_USE_FIRESTORE_TASKS?: string;
  readonly VITE_USE_FIRESTORE_CONTACTS?: string;
  readonly VITE_USE_FIRESTORE_TODOS?: string;
  readonly VITE_USE_FIRESTORE_SHIFTS?: string;
  readonly VITE_INTERAKT_LEADS_URL?: string;
  readonly VITE_INTERAKT_LEADS_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
