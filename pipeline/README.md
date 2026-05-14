# A Square GoKarting

Dual-app platform for **A Square GoKarting** — a **Customer App** for booking activities, managing wallets, and playing games, plus a **Pipeline Admin App** for operations, billing, track management, and reporting across 4 branches.

## Tech Stack

| Layer     | Technology                                              |
| --------- | ------------------------------------------------------- |
| Framework | React 18 + TypeScript                                   |
| Build     | Vite 6                                                  |
| Styling   | Tailwind CSS 3 + Framer Motion                          |
| Icons     | Lucide React                                            |
| Backend   | Firebase 12 (Auth, Firestore, Storage, Cloud Functions) |
| State     | TanStack React Query v5 + React Context                 |
| Payments  | Razorpay                                                |
| Mobile    | Capacitor 8 (iOS + Android)                             |
| 3D/Visual | Three.js, OGL, Liquid Glass                             |
| Charts    | Recharts                                                |

## Getting Started

### Prerequisites

- Node.js >= 20
- npm

### Setup

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
# Fill in your Firebase, Razorpay, and Google Maps keys
```

### Development

```bash
npm run dev        # Start dev server (http://localhost:5173)
npm run build      # TypeScript check + Vite build + prerender
npm run lint       # ESLint
npm run preview    # Preview production build
```

### Environment Variables

| Variable                            | Purpose                                 |
| ----------------------------------- | --------------------------------------- |
| `VITE_FIREBASE_API_KEY`             | Firebase API key                        |
| `VITE_FIREBASE_AUTH_DOMAIN`         | Firebase auth domain                    |
| `VITE_FIREBASE_PROJECT_ID`          | Firebase project ID                     |
| `VITE_FIREBASE_STORAGE_BUCKET`      | Firebase storage bucket                 |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase messaging sender ID            |
| `VITE_FIREBASE_APP_ID`              | Firebase app ID                         |
| `VITE_FIREBASE_MEASUREMENT_ID`      | Firebase analytics measurement ID       |
| `VITE_RAZORPAY_KEY_ID`              | Razorpay payment gateway key            |
| `VITE_GOOGLE_MAPS_API_KEY`          | Google Maps API key                     |
| `VITE_USE_EMULATORS`                | Enable Firebase emulators for local dev |

## Architecture

### Dual-App Boundary

The platform runs two apps from the same codebase, strictly separated:

|            | Customer App          | Pipeline Admin                |
| ---------- | --------------------- | ----------------------------- |
| Entry      | `src/CustomerApp.tsx` | `src/PipelineApp.tsx`         |
| Pages      | `src/pages/`          | `src/pipeline/pages/modules/` |
| Services   | `src/services/`       | `src/pipeline/api/`           |
| Components | `src/components/`     | `src/pipeline/components/`    |
| State      | `src/contexts/`       | `src/pipeline/features/`      |

**Shared code** lives in `src/types/` (types) and `src/lib/` (utilities, Firebase config).

### App Detection

The admin app is activated by:

- Query param: `?app=pipeline`
- Subdomain: `pipeline.localhost` or `pipeline.asquaregokarting.com`

### Project Structure

```
src/
├── assets/              # Static assets
├── components/          # Customer app components
├── contexts/            # React Context providers (Auth, Booking, Cart, Games)
├── data/                # Constants and static data
├── hooks/               # Custom React hooks
├── lib/                 # Shared utilities, Firebase config
├── pages/               # Customer app pages
├── pipeline/            # Pipeline Admin app
│   ├── api/             # Firestore API layer
│   ├── app/             # Router, app shell
│   ├── components/      # Admin UI components
│   ├── features/        # Auth, billing, navigation, theme
│   ├── hooks/           # Admin hooks
│   ├── lib/             # Admin utilities
│   └── pages/
│       ├── dashboard/   # Role-specific dashboards
│       └── modules/     # Admin modules
├── services/            # Customer app service layer
├── styles/              # Global styles
└── types/               # Shared TypeScript types
```

### Databases

- **`asquare-app-db`** — primary database (bookings, users, activities, billing, wallet)
- **`pipeline`** — admin-specific operational data

## Customer App

Features available to end users:

| Feature                 | Description                                                   |
| ----------------------- | ------------------------------------------------------------- |
| **Activities**          | Browse and book go-karting and adventure activities           |
| **Bookings**            | Manage bookings, view details, reschedule                     |
| **Cart & Checkout**     | Multi-item cart with coupon support, Razorpay payments        |
| **Wallet**              | Digital wallet with balance, credits, and transaction history |
| **Games**               | Play & Win, Spin & Win reward games                           |
| **Helicopter Bookings** | Helicopter ride booking flow                                  |
| **Check-in & Boarding** | QR-based check-in with digital boarding pass                  |
| **Profile**             | User profile management                                       |
| **Lead Capture**        | Birthday, corporate, and school group inquiry pages           |

## Pipeline Admin

Operations dashboard for staff across all branches.

### Modules

| Module         | Description                                                     |
| -------------- | --------------------------------------------------------------- |
| **Dashboard**  | Role-specific dashboards with KPIs and quick actions            |
| **Billing**    | POS, transactions, reprint receipts, refunds, revenue analytics |
| **Bookings**   | Create, manage, and print booking tickets                       |
| **Activities** | Activity catalog management                                     |
| **Track**      | Live track board, QR scanner, ride validation                   |
| **Shifts**     | Staff shift management with check-in/out and settlement         |
| **Leads**      | Lead pipeline, inbox, follow-ups (Interakt webhook integration) |
| **Reports**    | Operational and financial reports                               |
| **Coupons**    | Coupon creation, validation rules, usage tracking               |
| **Accounting** | Ledger and invoice management                                   |
| **Workspaces** | Collaborative workspaces                                        |
| **Files**      | File library and management                                     |
| **Admin**      | User management, role assignments, branch access control        |
| **Settings**   | Profile and app settings                                        |

### Roles & Access Control

Each staff member has a role that gates module access:

| Role              | Access Level                                              |
| ----------------- | --------------------------------------------------------- |
| **Owner**         | Full access to all modules                                |
| **Admin**         | Operations management across modules                      |
| **Cashier**       | Billing POS and shift management                          |
| **Telecaller**    | Leads inbox and bookings                                  |
| **TrackMarshall** | Track board and ride scanning                             |
| **Editor**        | Content and file management                               |
| **Developer**     | Technical access across modules                           |
| **Backend**       | Backend operations and reports                            |
| **ThirdParty**    | Limited external access (activities, accounting, coupons) |

### Multi-Branch

All operations support branch filtering across 4 locations:

1. Visakhapatnam (Vizag)
2. Kakinada
3. Rajahmundry
4. Srikakulam

## Mobile

Built with Capacitor for native iOS and Android deployment.

- **App ID:** `com.asquaregokarting.app`
- Auth uses IndexedDB persistence on mobile
- Platform-aware APIs (camera, QR scanner, preferences)

## Build & Performance

Vite is configured with manual chunk splitting for optimal loading:

| Chunk                       | Contents                         |
| --------------------------- | -------------------------------- |
| `vendor-react`              | React, React DOM, React Router   |
| `vendor-query`              | TanStack React Query             |
| `vendor-firebase-auth`      | Firebase Auth                    |
| `vendor-firebase-firestore` | Firebase Firestore               |
| `vendor-ui`                 | Framer Motion, Lucide, utilities |
| `vendor-lottie`             | Lottie animations                |
| `vendor-3d`                 | Three.js, OGL, Liquid Glass      |

Chunk size warning threshold: **1600 KB**. All pages are lazy-loaded with `React.lazy()`.

## Key Conventions

- **No raw Firestore calls in components** — all data access goes through service/API layers
- **Atomic transactions** for wallet and tire balance changes
- **Strict TypeScript** — no `any`, no `.js` files
- **Tailwind only** — no inline styles or CSS modules
- **Lazy-loaded pages** — every route uses `React.lazy()`
- **Reprint approval system** — non-Owner users must get Owner approval before reprinting receipts
- **Never commit** `.env` files or API keys

## License

Proprietary. All rights reserved by A Square GoKarting.
