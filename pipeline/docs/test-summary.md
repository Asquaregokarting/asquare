# A Square GoKarting -- Comprehensive Test Summary

**Platform:** Dual-app (Customer App + Pipeline Admin)
**Stack:** React 18 + TypeScript + Vite 6 + Firebase 12 + Razorpay + Capacitor 8
**Date:** 2026-03-31
**Author:** Generated via codebase scan

---

## 1. Scan Results

| Metric                                                                 | Value                                                                                         |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Total source files (`src/`)                                            | **316**                                                                                       |
| TypeScript files (`.ts`)                                               | 151                                                                                           |
| React/TSX files (`.tsx`)                                               | 165                                                                                           |
| Existing test files (`.test.ts`, `.test.tsx`, `.spec.ts`, `.spec.tsx`) | **0**                                                                                         |
| Test infrastructure files                                              | 4 (`vitest.config.ts`, `setup.ts`, `firebase.ts` mock, `capacitor.ts` mock, `test-utils.tsx`) |
| Current code coverage                                                  | **0%**                                                                                        |
| Testing stack                                                          | Vitest 1.6.1, @testing-library/react 14.1.2, @testing-library/jest-dom 6.2.0, jsdom 23.2.0    |

### Test Infrastructure (created)

| File                          | Purpose                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `vitest.config.ts`            | Vitest configuration with jsdom environment, path aliases, coverage settings |
| `src/test/setup.ts`           | Global test setup, jest-dom matchers, environment polyfills                  |
| `src/test/mocks/firebase.ts`  | Full Firebase mock (Auth, Firestore, Storage) -- zero network calls          |
| `src/test/mocks/capacitor.ts` | Capacitor native API mocks for mobile features                               |
| `src/test/test-utils.tsx`     | Custom render with providers (Auth, Cart, Games, Theme, Toast)               |

---

## 2. File Inventory

### 2.1 Customer App

#### Customer Pages (`src/pages/`) -- 22 files | Tests: No | Complexity: Medium-High

| #   | File                       | Description                     |
| --- | -------------------------- | ------------------------------- |
| 1   | `ActivityDetails.tsx`      | Activity detail view            |
| 2   | `CheckInPage.tsx`          | Check-in flow                   |
| 3   | `SpinAndWin.tsx`           | Gamification spin wheel page    |
| 4   | `PlayAndWin.tsx`           | Gamification play-to-win page   |
| 5   | `BoardingPassPage.tsx`     | Boarding pass display           |
| 6   | `PrivacyPolicy.tsx`        | Static privacy policy           |
| 7   | `TermsAndConditions.tsx`   | Static T&C                      |
| 8   | `ReturnRefundPolicy.tsx`   | Static refund policy            |
| 9   | `LeadCaptureBirthday.tsx`  | Birthday lead capture form      |
| 10  | `LeadCaptureCorporate.tsx` | Corporate lead capture form     |
| 11  | `LeadCaptureSchool.tsx`    | School lead capture form        |
| 12  | `Profile.tsx`              | User profile management         |
| 13  | `PrivacySecurity.tsx`      | Privacy/security settings       |
| 14  | `MyBookings.tsx`           | Booking history list            |
| 15  | `LinksPage.tsx`            | Links/social page               |
| 16  | `BookingDetails.tsx`       | Single booking detail           |
| 17  | `HelicopterBookings.tsx`   | Helicopter ride bookings        |
| 18  | `Wallet.tsx`               | Wallet balance and transactions |
| 19  | `Activities.tsx`           | Activity listing/browse         |
| 20  | `Cart.tsx`                 | Shopping cart                   |
| 21  | `WaitingListDashboard.tsx` | Waiting list management         |
| 22  | `Checkout.tsx`             | **Payment checkout (CRITICAL)** |

#### Customer Components (`src/components/`) -- 23 files | Tests: No | Complexity: Low-Medium

| #   | File                       | Description                    |
| --- | -------------------------- | ------------------------------ |
| 1   | `OfflineToast.tsx`         | Offline status notification    |
| 2   | `GokartIcon.tsx`           | Custom SVG icon                |
| 3   | `FlightStatusTracker.tsx`  | Flight/ride status tracker UI  |
| 4   | `icons/HelicopterIcon.tsx` | Helicopter SVG icon            |
| 5   | `GTMTracker.tsx`           | Google Tag Manager integration |
| 6   | `VerificationModal.tsx`    | OTP/phone verification modal   |
| 7   | `LocationSelectPopup.tsx`  | Branch location selector       |
| 8   | `ProfileGate.tsx`          | Profile completion gate        |
| 9   | `ui/LoadingScreen.tsx`     | Loading spinner/screen         |
| 10  | `TrackingProvider.tsx`     | Analytics tracking provider    |
| 11  | `NotifyModal.tsx`          | Notification permission modal  |
| 12  | `SEO.tsx`                  | SEO meta tags component        |
| 13  | `ui/LottieAnimation.tsx`   | Lottie animation wrapper       |
| 14  | `Header.tsx`               | App header/navbar              |
| 15  | `Layout.tsx`               | Page layout wrapper            |
| 16  | `SpinWheel.tsx`            | Spin wheel game component      |
| 17  | `BottomNav.tsx`            | Mobile bottom navigation       |
| 18  | `LeadCaptureForm.tsx`      | Reusable lead capture form     |
| 19  | `BoardingPass.tsx`         | Boarding pass card             |
| 20  | `FlightCertificate.tsx`    | Ride completion certificate    |
| 21  | `ActivityBottomSheet.tsx`  | Activity detail bottom sheet   |
| 22  | `Footer.tsx`               | App footer                     |
| 23  | `ExitIntentPopup.tsx`      | Exit intent lead capture       |

#### Customer Contexts (`src/contexts/`) -- 4 files | Tests: No | Complexity: High

| #   | File                 | Description                                           |
| --- | -------------------- | ----------------------------------------------------- |
| 1   | `CartContext.tsx`    | Cart state, coupon validation, pricing **(CRITICAL)** |
| 2   | `GamesContext.tsx`   | Gamification state (tires, spins, streaks)            |
| 3   | `AuthContext.tsx`    | Authentication state, OTP flow **(CRITICAL)**         |
| 4   | `BookingContext.tsx` | Booking flow state management                         |

#### Customer Services (`src/services/`) -- 8 files | Tests: No | Complexity: High

| #   | File                     | Description                                            |
| --- | ------------------------ | ------------------------------------------------------ |
| 1   | `walletService.ts`       | Wallet transactions, atomic balance ops **(CRITICAL)** |
| 2   | `apiProxy.ts`            | API proxy/middleware                                   |
| 3   | `helicopterEarlyBird.ts` | Helicopter early bird pricing                          |
| 4   | `couponService.ts`       | Coupon validation and application **(CRITICAL)**       |
| 5   | `razorpayService.ts`     | Razorpay payment integration **(CRITICAL)**            |
| 6   | `waitingListService.ts`  | Waiting list operations                                |
| 7   | `activityService.ts`     | Activity CRUD operations                               |
| 8   | `bookingService.ts`      | Booking lifecycle management **(CRITICAL)**            |

#### Customer Hooks (`src/hooks/`) -- 2 files | Tests: No | Complexity: Low

| #   | File                 | Description                     |
| --- | -------------------- | ------------------------------- |
| 1   | `useOnlineStatus.ts` | Online/offline detection        |
| 2   | `usePlatform.ts`     | Platform detection (web/mobile) |

#### Customer Lib/Utils (`src/lib/`) -- 12 files | Tests: No | Complexity: Low-Medium

| #   | File                    | Description                        |
| --- | ----------------------- | ---------------------------------- |
| 1   | `storage.ts`            | Local storage abstraction          |
| 2   | `firebase.ts`           | Firebase config and initialization |
| 3   | `checkInConfig.ts`      | Check-in configuration             |
| 4   | `tracking.ts`           | Analytics tracking utilities       |
| 5   | `gamificationConfig.ts` | Gamification constants/config      |
| 6   | `useLocations.ts`       | Location hook                      |
| 7   | `native-permissions.ts` | Native permission handling         |
| 8   | `date-format.ts`        | Date formatting utilities          |
| 9   | `utils.ts`              | General utility functions          |
| 10  | `locations.ts`          | Branch location data (4 branches)  |
| 11  | `unified-booking.ts`    | Unified booking logic              |
| 12  | `platform.ts`           | Platform detection utilities       |

#### Customer Types (`src/types/`) -- 2 files | Tests: No | Complexity: Low

| #   | File        | Description                                              |
| --- | ----------- | -------------------------------------------------------- |
| 1   | `errors.ts` | Error class hierarchy (ApplicationError, APIError, etc.) |
| 2   | `index.ts`  | Shared type definitions                                  |

#### Customer Data (`src/data/`) -- 1 file | Tests: No | Complexity: Low

| #   | File            | Description                    |
| --- | --------------- | ------------------------------ |
| 1   | `spinPrizes.ts` | Spin wheel prize configuration |

#### App Entry Points -- 3 files | Tests: No | Complexity: Medium

| #   | File              | Description                          |
| --- | ----------------- | ------------------------------------ |
| 1   | `main.tsx`        | App bootstrap, app detection routing |
| 2   | `CustomerApp.tsx` | Customer app router                  |
| 3   | `PipelineApp.tsx` | Pipeline admin app router            |

---

### 2.2 Pipeline Admin App

#### Pipeline API Modules (`src/pipeline/api/`) -- 65 files | Tests: No | Complexity: High

| #   | File                                  | Description                            |
| --- | ------------------------------------- | -------------------------------------- |
| 1   | `shift-workforce.ts`                  | Shift workforce management             |
| 2   | `track.ts`                            | Track operations API                   |
| 3   | `user-profiles.ts`                    | User profile API                       |
| 4   | `cache.ts`                            | API caching layer                      |
| 5   | `telecaller-performance.ts`           | Telecaller metrics API                 |
| 6   | `asquare-checkin.ts`                  | Check-in API                           |
| 7   | `asquare-gamification.ts`             | Gamification admin API                 |
| 8   | `asquare-notifications.ts`            | Notification dispatch API              |
| 9   | `asquare-revenue.ts`                  | Revenue reporting API                  |
| 10  | `contacts-firestore.ts`               | Contacts Firestore layer               |
| 11  | `todos-firestore.ts`                  | Todos Firestore layer                  |
| 12  | `telecaller-performance-firestore.ts` | Telecaller perf Firestore layer        |
| 13  | `tasks-firestore.ts`                  | Tasks Firestore layer                  |
| 14  | `asquare-customer-lookup.ts`          | Customer lookup API                    |
| 15  | `user-profiles-firestore.ts`          | User profiles Firestore layer          |
| 16  | `files-firestore.ts`                  | File management Firestore layer        |
| 17  | `asquare-coupons.ts`                  | Coupon admin API **(CRITICAL)**        |
| 18  | `event-coupon-notifications.ts`       | Event coupon notification API          |
| 19  | `vendor-details.ts`                   | Vendor details API                     |
| 20  | `vendor-registration.ts`              | Vendor registration API                |
| 21  | `lead-normalizers.ts`                 | Lead data normalization                |
| 22  | `client.ts`                           | API client base                        |
| 23  | `auth.ts`                             | Auth API                               |
| 24  | `todos.ts`                            | Todos API                              |
| 25  | `contacts.ts`                         | Contacts API                           |
| 26  | `tasks.ts`                            | Tasks API                              |
| 27  | `files.ts`                            | Files API                              |
| 28  | `print-log.ts`                        | Print logging API                      |
| 29  | `vendor-game-import-firestore.ts`     | Vendor game import Firestore           |
| 30  | `admin.ts`                            | Admin operations API                   |
| 31  | `asquare-firestore.ts`                | Core Firestore operations              |
| 32  | `asquare-customers.ts`                | Customer management API                |
| 33  | `vendor-details-firestore.ts`         | Vendor details Firestore layer         |
| 34  | `firestore-utils.ts`                  | Firestore utility helpers              |
| 35  | `accounting.ts`                       | Accounting API                         |
| 36  | `track-marshall-shifts-firestore.ts`  | Track marshall shifts Firestore        |
| 37  | `vendor-game-import.ts`               | Vendor game import API                 |
| 38  | `reports.ts`                          | Reporting API                          |
| 39  | `asquare-locations.ts`                | Location management API                |
| 40  | `billing.ts`                          | Billing API **(CRITICAL)**             |
| 41  | `auth-firestore.ts`                   | Auth Firestore layer                   |
| 42  | `interakt-templates.ts`               | Interakt webhook templates             |
| 43  | `shifts.ts`                           | Shift management API                   |
| 44  | `accounting-firestore.ts`             | Accounting Firestore layer             |
| 45  | `firestore-session.ts`                | Firestore session management           |
| 46  | `superfone-firestore.ts`              | Superfone integration Firestore        |
| 47  | `users-firestore.ts`                  | Users Firestore layer                  |
| 48  | `users.ts`                            | Users API                              |
| 49  | `reports-firestore.ts`                | Reports Firestore layer                |
| 50  | `serial-counters.ts`                  | Serial number counters **(CRITICAL)**  |
| 51  | `lead-import.ts`                      | Lead import API                        |
| 52  | `activities.ts`                       | Activities API                         |
| 53  | `activities-firestore.ts`             | Activities Firestore layer             |
| 54  | `activity-catalog-firestore.ts`       | Activity catalog Firestore             |
| 55  | `asquare-bookings.ts`                 | Bookings admin API                     |
| 56  | `reprint-approvals.ts`                | Reprint approval API                   |
| 57  | `shift-workforce-firestore.ts`        | Shift workforce Firestore              |
| 58  | `vendor-registration-firestore.ts`    | Vendor registration Firestore          |
| 59  | `billing-firestore.ts`                | Billing Firestore layer **(CRITICAL)** |
| 60  | `asquare-members.ts`                  | Members admin API                      |
| 61  | `device-sessions.ts`                  | Device session tracking                |
| 62  | `lead-scoring.ts`                     | Lead scoring algorithm **(P2)**        |
| 63  | `shifts-firestore.ts`                 | Shifts Firestore layer                 |
| 64  | `lead-auto-assign.ts`                 | Lead auto-assignment                   |
| 65  | `leads.ts`                            | Leads API                              |
| --  | `types.ts`                            | Pipeline-specific type definitions     |
| --  | `lead-config-firestore.ts`            | Lead config Firestore layer            |
| --  | `leads-firestore.ts`                  | Leads Firestore layer                  |

#### Pipeline Pages (`src/pipeline/pages/`) -- 56 files | Tests: No | Complexity: Medium-High

**Dashboard Pages (9):**

| #   | File                                   | Description                   |
| --- | -------------------------------------- | ----------------------------- |
| 1   | `dashboard/AdminDashboard.tsx`         | Admin role dashboard          |
| 2   | `dashboard/TelecallerDashboard.tsx`    | Telecaller role dashboard     |
| 3   | `dashboard/TrackMarshallDashboard.tsx` | Track marshall role dashboard |
| 4   | `dashboard/EditorDashboard.tsx`        | Editor role dashboard         |
| 5   | `dashboard/DeveloperDashboard.tsx`     | Developer role dashboard      |
| 6   | `dashboard/OwnerDashboard.tsx`         | Owner role dashboard          |
| 7   | `dashboard/BackendDashboard.tsx`       | Backend role dashboard        |
| 8   | `dashboard/ThirdPartyDashboard.tsx`    | Third-party role dashboard    |
| 9   | `dashboard/CashierDashboard.tsx`       | Cashier role dashboard        |
| 10  | `dashboard/RoleDashboardScene.tsx`     | Dashboard role routing        |

**Module Pages (16):**

| #   | File                           | Description                            |
| --- | ------------------------------ | -------------------------------------- |
| 1   | `modules/LeadsModule.tsx`      | Lead management module                 |
| 2   | `modules/AccountingModule.tsx` | Accounting module                      |
| 3   | `modules/CouponsModule.tsx`    | Coupon management module               |
| 4   | `modules/FilesModule.tsx`      | File management module                 |
| 5   | `modules/SettingsModule.tsx`   | Settings module                        |
| 6   | `modules/TasksModule.tsx`      | Tasks module                           |
| 7   | `modules/WorkspacesModule.tsx` | Workspaces module                      |
| 8   | `modules/ReportsModule.tsx`    | Reports module                         |
| 9   | `modules/ShiftsModule.tsx`     | Shifts module                          |
| 10  | `modules/AdminModule.tsx`      | Admin module                           |
| 11  | `modules/BookingsModule.tsx`   | Bookings module                        |
| 12  | `modules/ActivitiesModule.tsx` | Activities module                      |
| 13  | `modules/BillingModule.tsx`    | Billing module **(CRITICAL)**          |
| 14  | `modules/TrackModule.tsx`      | Track operations module **(CRITICAL)** |
| 15  | `modules/shifts/LeaveDesk.tsx` | Leave desk feature                     |
| 16  | `LoginPage.tsx`                | Pipeline login page                    |

**Leads Sub-Pages (14):**

| #   | File                                      | Description             |
| --- | ----------------------------------------- | ----------------------- |
| 1   | `modules/leads/LeadScoreBadge.tsx`        | Lead score display      |
| 2   | `modules/leads/LeadPresenceIndicator.tsx` | Lead presence indicator |
| 3   | `modules/leads/LeadCard.tsx`              | Lead card component     |
| 4   | `modules/leads/KanbanColumn.tsx`          | Kanban column for leads |
| 5   | `modules/leads/LeadTimelinePanel.tsx`     | Lead activity timeline  |
| 6   | `modules/leads/LeadFeedbackForm.tsx`      | Lead feedback form      |
| 7   | `modules/leads/LeadMetricsView.tsx`       | Lead metrics dashboard  |
| 8   | `modules/leads/LeadImportView.tsx`        | Lead import view        |
| 9   | `modules/leads/ImportColumnMapper.tsx`    | CSV column mapper       |
| 10  | `modules/leads/ImportPreviewTable.tsx`    | Import preview table    |
| 11  | `modules/leads/LeadCreateForm.tsx`        | Lead creation form      |
| 12  | `modules/leads/LeadPipelineView.tsx`      | Lead pipeline kanban    |
| 13  | `modules/leads/LeadDetailSlideOver.tsx`   | Lead detail slide-over  |
| 14  | `modules/leads/QuickOutcomeButtons.tsx`   | Quick outcome actions   |
| 15  | `modules/leads/NextCallBanner.tsx`        | Next call banner        |
| 16  | `modules/leads/CallbackAlert.tsx`         | Callback alert          |
| 17  | `modules/leads/LeadInboxView.tsx`         | Lead inbox              |
| 18  | `modules/leads/LeadConfigView.tsx`        | Lead configuration      |

**Activities Sub-Pages (7):**

| #   | File                                             | Description             |
| --- | ------------------------------------------------ | ----------------------- |
| 1   | `modules/activities/VendorGameImportView.tsx`    | Vendor game import      |
| 2   | `modules/activities/ActivitySidebar.tsx`         | Activity sidebar        |
| 3   | `modules/activities/AddGameDialog.tsx`           | Add game dialog         |
| 4   | `modules/activities/GameDetailEditor.tsx`        | Game detail editor      |
| 5   | `modules/activities/LocationAssignmentPanel.tsx` | Location assignment     |
| 6   | `modules/activities/ThirdPartyActivityView.tsx`  | Third-party activities  |
| 7   | `modules/activities/VariantTableEditor.tsx`      | Activity variant editor |
| 8   | `modules/activities/SubGameDetailEditor.tsx`     | Sub-game detail editor  |
| 9   | `modules/activities/SaveStatusBar.tsx`           | Save status bar         |
| 10  | `modules/activities/ActivityHierarchyView.tsx`   | Activity hierarchy view |

**Other Pages (2):**

| #   | File                            | Description          |
| --- | ------------------------------- | -------------------- |
| 1   | `CleanupDeletedTelecallers.tsx` | Data cleanup utility |
| 2   | `ThirdPartyPortalPage.tsx`      | Third-party portal   |

#### Pipeline Components (`src/pipeline/components/`) -- 27 files | Tests: No | Complexity: Low-Medium

**UI Components (17):**

| #   | File                            | Description                             |
| --- | ------------------------------- | --------------------------------------- |
| 1   | `ui/Skeleton.tsx`               | Loading skeleton                        |
| 2   | `ui/StatusBadge.tsx`            | Status badge                            |
| 3   | `ui/SummaryCards.tsx`           | Summary card grid                       |
| 4   | `ui/ActionCard.tsx`             | Action card                             |
| 5   | `ui/ActionIconButton.tsx`       | Icon action button                      |
| 6   | `ui/CallTypeBadge.tsx`          | Call type badge                         |
| 7   | `ui/EmptyState.tsx`             | Empty state display                     |
| 8   | `ui/MetricStrip.tsx`            | Metric strip                            |
| 9   | `ui/DetailPanel.tsx`            | Detail panel                            |
| 10  | `ui/SourceBadge.tsx`            | Source badge                            |
| 11  | `ui/FilterBar.tsx`              | Filter bar                              |
| 12  | `ui/KpiCard.tsx`                | KPI card                                |
| 13  | `ui/AsyncContent.tsx`           | Async loading wrapper                   |
| 14  | `ui/FormDrawer.tsx`             | Form drawer                             |
| 15  | `ui/FeedbackBanner.tsx`         | Feedback banner                         |
| 16  | `ui/ConfirmDialog.tsx`          | Confirmation dialog                     |
| 17  | `ui/DataTable.tsx`              | Data table                              |
| 18  | `ui/PermissionGate.tsx`         | Permission gate **(CRITICAL for RBAC)** |
| 19  | `ui/GameDrillDownModal.tsx`     | Game drill-down modal                   |
| 20  | `ui/TaskChatPanel.tsx`          | Task chat panel                         |
| 21  | `ui/TaskNotificationCenter.tsx` | Task notification center                |
| 22  | `ui/ModalShell.tsx`             | Modal shell wrapper                     |

**Layout Components (5):**

| #   | File                          | Description              |
| --- | ----------------------------- | ------------------------ |
| 1   | `layout/ModulePageLayout.tsx` | Module page layout       |
| 2   | `layout/Sidebar.tsx`          | Admin sidebar navigation |
| 3   | `layout/AppShell.tsx`         | App shell layout         |
| 4   | `layout/MobileNavDrawer.tsx`  | Mobile navigation drawer |
| 5   | `layout/Topbar.tsx`           | Top navigation bar       |

#### Pipeline Features (`src/pipeline/features/`) -- 63 files | Tests: No | Complexity: High

**Auth (1):**

| #   | File                    | Description                          |
| --- | ----------------------- | ------------------------------------ |
| 1   | `auth/auth-context.tsx` | Pipeline auth context **(CRITICAL)** |

**Billing (3):**

| #   | File                                | Description                                |
| --- | ----------------------------------- | ------------------------------------------ |
| 1   | `billing/validateCoupon.ts`         | Coupon validation logic **(CRITICAL)**     |
| 2   | `billing/BillingConfirmation.tsx`   | Billing confirmation UI                    |
| 3   | `billing/generateBillingReceipt.ts` | Receipt generation (576-line HTML builder) |

**Combos (3):**

| #   | File                        | Description                |
| --- | --------------------------- | -------------------------- |
| 1   | `combos/combo-types.ts`     | Combo type definitions     |
| 2   | `combos/combo-firestore.ts` | Combo Firestore operations |
| 3   | `combos/ComboBuilder.tsx`   | Combo builder UI           |

**Dashboard (2):**

| #   | File                          | Description                 |
| --- | ----------------------------- | --------------------------- |
| 1   | `dashboard/dashboard-data.ts` | Dashboard data fetching     |
| 2   | `dashboard/role-config.ts`    | Role-based dashboard config |

**Leads (12):**

| #   | File                            | Description                  |
| --- | ------------------------------- | ---------------------------- |
| 1   | `leads/lead-utils.ts`           | Lead utility functions       |
| 2   | `leads/useLeadFilters.ts`       | Lead filter hook             |
| 3   | `leads/useLeadList.ts`          | Lead list hook               |
| 4   | `leads/useLeadTimeline.ts`      | Lead timeline hook           |
| 5   | `leads/useLeadDetail.ts`        | Lead detail hook             |
| 6   | `leads/useLeadMetrics.ts`       | Lead metrics hook            |
| 7   | `leads/useLeadConfig.ts`        | Lead config hook             |
| 8   | `leads/useLeadImport.ts`        | Lead import hook             |
| 9   | `leads/lead-notifications.ts`   | Lead notification logic      |
| 10  | `leads/useLeadNotifications.ts` | Lead notification hook       |
| 11  | `leads/useLeadActions.ts`       | Lead action handlers         |
| 12  | `leads/lead-queue-sort.ts`      | Lead queue sorting algorithm |
| 13  | `leads/useCallbackReminders.ts` | Callback reminder hook       |
| 14  | `leads/lead-constants.ts`       | Lead constants               |

**Navigation (2):**

| #   | File                             | Description                           |
| --- | -------------------------------- | ------------------------------------- |
| 1   | `navigation/action-route-map.ts` | Action-to-route mapping               |
| 2   | `navigation/module-manifest.ts`  | Module manifest (RBAC) **(CRITICAL)** |

**Preferences (1):**

| #   | File                              | Description                 |
| --- | --------------------------------- | --------------------------- |
| 1   | `preferences/user-preferences.ts` | User preferences management |

**Shared (1):**

| #   | File                       | Description       |
| --- | -------------------------- | ----------------- |
| 1   | `shared/useAsyncAction.ts` | Async action hook |

**Tasks (4):**

| #   | File                            | Description              |
| --- | ------------------------------- | ------------------------ |
| 1   | `tasks/useTaskRealtimeChat.ts`  | Real-time task chat hook |
| 2   | `tasks/useTaskUnreadCounts.ts`  | Unread count hook        |
| 3   | `tasks/useTaskNotifications.ts` | Task notification hook   |
| 4   | `tasks/task-module-utils.ts`    | Task module utilities    |

**Theme (1):**

| #   | File                      | Description                |
| --- | ------------------------- | -------------------------- |
| 1   | `theme/theme-context.tsx` | Theme context (light/dark) |

**Toast (2):**

| #   | File                       | Description                  |
| --- | -------------------------- | ---------------------------- |
| 1   | `toast/ToastContainer.tsx` | Toast notification container |
| 2   | `toast/toast-context.tsx`  | Toast context                |

**Track -- Scanner (20):**

| #   | File                                                  | Description                 |
| --- | ----------------------------------------------------- | --------------------------- |
| 1   | `track/scanner/services/firestoreScans.ts`            | Scan Firestore operations   |
| 2   | `track/scanner/services/scannerApi.ts`                | Scanner API **(CRITICAL)**  |
| 3   | `track/scanner/hooks/useShift.ts`                     | Shift management hook       |
| 4   | `track/scanner/hooks/useScanHistory.ts`               | Scan history hook           |
| 5   | `track/scanner/hooks/useTodayBookings.ts`             | Today's bookings hook       |
| 6   | `track/scanner/hooks/useTransactionHistory.ts`        | Transaction history hook    |
| 7   | `track/scanner/hooks/useScannerApi.ts`                | Scanner API hook            |
| 8   | `track/scanner/hooks/useTransactionCounts.ts`         | Transaction count hook      |
| 9   | `track/scanner/components/ShiftStartVerification.tsx` | Shift start verification UI |
| 10  | `track/scanner/components/ShiftEndVerification.tsx`   | Shift end verification UI   |
| 11  | `track/scanner/components/LocationSelect.tsx`         | Location selector           |
| 12  | `track/scanner/components/ManualBillingInput.tsx`     | Manual billing input        |
| 13  | `track/scanner/components/ScanResultCard.tsx`         | Scan result display         |
| 14  | `track/scanner/components/SerialSelector.tsx`         | Serial number selector      |
| 15  | `track/scanner/components/ShiftBanner.tsx`            | Shift status banner         |
| 16  | `track/scanner/context/ShiftContext.tsx`              | Shift context provider      |
| 17  | `track/scanner/types/scanner.types.ts`                | Scanner type definitions    |
| 18  | `track/scanner/QRScannerView.tsx`                     | QR scanner camera view      |
| 19  | `track/scanner/Dashboard.tsx`                         | Scanner dashboard           |
| 20  | `track/scanner/HistoryView.tsx`                       | Scan history view           |
| 21  | `track/scanner/ScanDetails.tsx`                       | Scan detail view            |
| 22  | `track/scanner/ScannerModule.tsx`                     | Scanner module root         |

**Track -- Karts (5):**

| #   | File                               | Description             |
| --- | ---------------------------------- | ----------------------- |
| 1   | `track/karts/KartList.tsx`         | Kart listing            |
| 2   | `track/karts/KartDeepClean.tsx`    | Kart deep clean tracker |
| 3   | `track/karts/KartPhotoHistory.tsx` | Kart photo history      |
| 4   | `track/karts/KartDetails.tsx`      | Kart detail view        |
| 5   | `track/karts/KartForm.tsx`         | Kart add/edit form      |
| 6   | `track/karts/KartsDashboard.tsx`   | Karts dashboard         |
| 7   | `track/services/kartService.ts`    | Kart Firestore service  |

**Track -- Waiting List (1):**

| #   | File                                         | Description            |
| --- | -------------------------------------------- | ---------------------- |
| 1   | `track/waitingList/WaitingListDashboard.tsx` | Waiting list dashboard |

#### Pipeline Hooks (`src/pipeline/hooks/`) -- 2 files | Tests: No | Complexity: Low

| #   | File                     | Description            |
| --- | ------------------------ | ---------------------- |
| 1   | `useNativePermission.ts` | Native permission hook |
| 2   | `useLocations.ts`        | Locations hook         |

#### Pipeline Lib (`src/pipeline/lib/`) -- 7 files | Tests: No | Complexity: Medium

| #   | File                         | Description                |
| --- | ---------------------------- | -------------------------- |
| 1   | `firebase-storage.ts`        | Firebase Storage helpers   |
| 2   | `firebase-auth.ts`           | Firebase Auth helpers      |
| 3   | `search-params.ts`           | Search parameter utilities |
| 4   | `phone-otp.ts`               | Phone OTP utilities        |
| 5   | `firebase.ts`                | Pipeline Firebase config   |
| 6   | `generate-letterhead-pdf.ts` | PDF letterhead generation  |
| 7   | `ist-date.ts`                | IST date utilities         |

#### Pipeline App (`src/pipeline/app/`) -- 4 files | Tests: No | Complexity: Medium-High

| #   | File                 | Description                           |
| --- | -------------------- | ------------------------------------- |
| 1   | `runtime.ts`         | App runtime configuration             |
| 2   | `providers.tsx`      | Pipeline provider composition         |
| 3   | `RoleGuardRoute.tsx` | Role-based route guard **(CRITICAL)** |
| 4   | `router.tsx`         | Pipeline router config                |

---

### 2.3 Summary by Category

| Category             | Files   | Has Tests   | Estimated Complexity |
| -------------------- | ------- | ----------- | -------------------- |
| Customer Pages       | 22      | No          | Medium-High          |
| Customer Components  | 23      | No          | Low-Medium           |
| Customer Contexts    | 4       | No          | **High**             |
| Customer Services    | 8       | No          | **High**             |
| Customer Hooks       | 2       | No          | Low                  |
| Customer Lib/Utils   | 12      | No          | Low-Medium           |
| Customer Types       | 2       | No          | Low                  |
| Customer Data        | 1       | No          | Low                  |
| App Entry Points     | 3       | No          | Medium               |
| Pipeline API Modules | 65+     | No          | **High**             |
| Pipeline Pages       | 56      | No          | Medium-High          |
| Pipeline Components  | 27      | No          | Low-Medium           |
| Pipeline Features    | 63      | No          | **High**             |
| Pipeline Hooks       | 2       | No          | Low                  |
| Pipeline Lib         | 7       | No          | Medium               |
| Pipeline App         | 4       | No          | Medium-High          |
| Type Definitions     | 3       | No          | Low                  |
| Test Infrastructure  | 4       | N/A (infra) | N/A                  |
| **TOTAL**            | **316** | **0 tests** | --                   |

---

## 3. Priority Matrix (Risk x Complexity)

| Priority        | Module                                                                               | Risk Level         | Why                                                                     | Estimated Tests |
| --------------- | ------------------------------------------------------------------------------------ | ------------------ | ----------------------------------------------------------------------- | --------------- |
| **P0-CRITICAL** | Payment flow (`Checkout.tsx` + `bookingService.ts` + `razorpayService.ts`)           | Financial loss     | Real money transactions, Razorpay integration, booking creation         | ~40             |
| **P0-CRITICAL** | Coupon validation (`CartContext.tsx` + `couponService.ts` + `validateCoupon.ts`)     | Revenue leakage    | 15+ validation rules, discount calculations, expiry/usage/branch checks | ~35             |
| **P0-CRITICAL** | Wallet transactions (`walletService.ts`)                                             | Financial loss     | Atomic Firestore transactions, balance integrity, credit/debit logging  | ~15             |
| **P1-HIGH**     | Scanner/serial verification (`scannerApi.ts` + `serial-counters.ts` + scanner hooks) | Operational        | QR parsing, ride state machine, serial number allocation, shift context | ~30             |
| **P1-HIGH**     | Auth flow (customer `AuthContext.tsx` + pipeline `auth-context.tsx`)                 | Access control     | OTP verification, session management, device tracking, persistence      | ~25             |
| **P1-HIGH**     | RBAC (`module-manifest.ts` + `RoleGuardRoute.tsx` + `PermissionGate.tsx`)            | Security           | 9 roles, module permissions, route guards, permission gates             | ~20             |
| **P1-HIGH**     | Billing (`billing-firestore.ts` + `billing.ts` + revenue splits)                     | Financial accuracy | Vendor splits, GST calculation, invoice generation, serial tracking     | ~25             |
| **P2-MEDIUM**   | Lead scoring (`lead-scoring.ts` + `lead-queue-sort.ts`)                              | Business logic     | Multi-factor scoring algorithm, queue prioritization                    | ~10             |
| **P2-MEDIUM**   | Receipt generation (`generateBillingReceipt.ts`)                                     | Customer-facing    | 576-line HTML builder, QR code embedding, serial number display         | ~10             |
| **P2-MEDIUM**   | Booking status transitions (`bookingService.ts` states)                              | Operational        | State machine validation (confirmed/pending/cancelled/rescheduled)      | ~12             |
| **P2-MEDIUM**   | Gamification (`GamesContext.tsx` + `spinPrizes.ts` + `gamificationConfig.ts`)        | Engagement         | Tires, spins, streaks, offline sync, prize distribution                 | ~15             |
| **P2-MEDIUM**   | Lead management (14 lead hooks + lead-utils + lead-constants)                        | Business logic     | Filter logic, import parsing, timeline tracking, callback reminders     | ~15             |
| **P3-LOW**      | Pure utilities (`utils.ts`, `date-format.ts`, `locations.ts`, `ist-date.ts`)         | Low                | Helper functions, date formatters, branch data                          | ~20             |
| **P3-LOW**      | Static pages (`PrivacyPolicy`, `TermsAndConditions`, `ReturnRefundPolicy`)           | Low                | Read-only content, render verification only                             | ~8              |
| **P3-LOW**      | UI component smoke tests (customer + pipeline components)                            | Low                | Render verification, prop handling                                      | ~40             |
| **P3-LOW**      | Error hierarchy (`errors.ts`)                                                        | Low                | Error class instantiation and inheritance                               | ~5              |
|                 |                                                                                      |                    | **TOTAL**                                                               | **~305**        |

---

## 4. Recommended Implementation Order

### Phase 1: Test Infrastructure (DONE)

- [x] `vitest.config.ts` -- Vitest configuration with jsdom, path aliases, coverage
- [x] `src/test/setup.ts` -- Global setup, jest-dom matchers
- [x] `src/test/mocks/firebase.ts` -- Full Firebase mock (Auth, Firestore, Storage)
- [x] `src/test/mocks/capacitor.ts` -- Capacitor native API mocks
- [x] `src/test/test-utils.tsx` -- Custom render with all providers

### Phase 2: P3 Pure Utilities (Quick Wins -- ~25 tests)

Target files for immediate high-coverage:

- `src/lib/utils.ts` -- general helpers
- `src/lib/date-format.ts` -- date formatting
- `src/lib/locations.ts` -- branch data (4 branches)
- `src/pipeline/lib/ist-date.ts` -- IST date conversion
- `src/pipeline/api/lead-scoring.ts` -- scoring algorithm
- `src/pipeline/features/leads/lead-queue-sort.ts` -- queue sorting
- `src/pipeline/api/lead-normalizers.ts` -- data normalization
- `src/types/errors.ts` -- error class hierarchy
- `src/data/spinPrizes.ts` -- prize config validation

**Why first:** Pure functions with zero dependencies. Can reach 90%+ coverage instantly. Builds CI confidence.

### Phase 3: P0 Business Logic (~90 tests)

- `src/contexts/CartContext.tsx` -- coupon application rules, discount math, cart state
- `src/services/couponService.ts` -- expiry, usage limits, branch checks, min order
- `src/pipeline/features/billing/validateCoupon.ts` -- admin-side coupon validation
- `src/services/walletService.ts` -- atomic transactions, balance integrity
- `src/pipeline/api/billing-firestore.ts` -- revenue split computation, GST

**Why next:** These contain the highest-risk business logic. Mocking is already prepared.

### Phase 4: P0 Integration (~40 tests)

- `src/pages/Checkout.tsx` -- full payment flow
- `src/services/bookingService.ts` -- booking lifecycle
- `src/services/razorpayService.ts` -- payment gateway integration
- `src/pipeline/api/asquare-bookings.ts` -- admin booking management

**Why next:** Depends on Phase 3 mocks being proven. Tests real user flows end-to-end.

### Phase 5: P1 Auth and RBAC (~45 tests)

- `src/contexts/AuthContext.tsx` -- customer auth, OTP, session
- `src/pipeline/features/auth/auth-context.tsx` -- admin auth, role loading
- `src/pipeline/features/navigation/module-manifest.ts` -- role-to-module mapping
- `src/pipeline/app/RoleGuardRoute.tsx` -- route-level role enforcement
- `src/pipeline/components/ui/PermissionGate.tsx` -- component-level permission

**Why next:** Security-critical. 9 roles need systematic permission matrix testing.

### Phase 6: P1 Scanner Subsystem (~30 tests)

- `src/pipeline/features/track/scanner/services/scannerApi.ts` -- core scanner API
- `src/pipeline/api/serial-counters.ts` -- serial number allocation
- `src/pipeline/features/track/scanner/hooks/useShift.ts` -- shift state
- `src/pipeline/features/track/scanner/context/ShiftContext.tsx` -- shift provider
- Scanner component smoke tests

**Why next:** Operational-critical. QR scanning + serial validation is the track operations backbone.

### Phase 7: P2 Remaining Business Logic (~62 tests)

- Lead management (scoring, filtering, import, timeline)
- Receipt generation
- Booking status state machine
- Gamification (spins, tires, streaks)
- Combo builder logic

### Phase 8: P3 UI Smoke Tests (~40 tests)

- All 23 customer components -- render without crash
- All 27 pipeline UI/layout components -- render without crash
- Static pages -- content rendering

---

## 5. Coverage Gap Analysis

### Current State

| Metric                    | Current | Target (Phase 1)       | Target (Full) |
| ------------------------- | ------- | ---------------------- | ------------- |
| Overall coverage          | 0%      | 40% on critical paths  | 60%+          |
| Pure function coverage    | 0%      | 90%+                   | 95%+          |
| Context/hook coverage     | 0%      | 50% (P0 contexts)      | 70%+          |
| Service layer coverage    | 0%      | 60% (P0 services)      | 80%+          |
| Component render coverage | 0%      | 0% (deferred)          | 50%+          |
| Pipeline API coverage     | 0%      | 30% (billing, scanner) | 50%+          |

### Key Coverage Gaps

1. **Pure functions (0% -> 90%):** Fastest ROI. `utils.ts`, `date-format.ts`, `locations.ts`, `lead-scoring.ts`, `ist-date.ts` are all side-effect-free and trivially testable.

2. **Firestore-dependent code:** Requires mocking (already set up in `src/test/mocks/firebase.ts`). Every service and API module depends on Firestore -- the mock must cover `getDoc`, `setDoc`, `updateDoc`, `deleteDoc`, `collection`, `query`, `where`, `getDocs`, `runTransaction`, `onSnapshot`.

3. **Context providers:** Need the wrapper utility in `src/test/test-utils.tsx` to render components with `AuthContext`, `CartContext`, `GamesContext`, `BookingContext`, and pipeline contexts. Already set up.

4. **9 admin roles:** Systematic permission matrix testing needed:
   - Owner, Admin, Cashier, Telecaller, TrackMarshall, Editor, Developer, Backend, ThirdParty
   - Each role x each module = 9 x ~15 modules = 135 permission assertions
   - `module-manifest.ts` and `RoleGuardRoute.tsx` are the single sources of truth

5. **Razorpay integration:** Cannot call real Razorpay in tests. Mock the payment SDK responses (success, failure, cancelled, network error).

6. **Capacitor/mobile:** Already mocked in `src/test/mocks/capacitor.ts`. Tests must verify graceful fallback when native APIs are unavailable (web mode).

7. **Multi-branch:** All branch-scoped operations (bookings, billing, reports, shifts) must be tested across branch variants (Vizag, Kakinada, Rajahmundry, Srikakulam).

---

## 6. Production Safety Note

All tests use fully mocked Firebase -- **ZERO network calls, ZERO production data access**.

- `src/test/mocks/firebase.ts` replaces all Firebase SDK imports with in-memory mocks
- No Firestore read/write operations touch live databases (`asquare-app-db` or `pipeline`)
- No Authentication calls reach Firebase Auth servers
- No Storage operations access Firebase Storage buckets
- No Razorpay API calls are made -- payment responses are mocked
- No Interakt webhook calls are dispatched
- Test data is created and destroyed entirely in memory per test run

**Environment isolation:** Tests run in jsdom with no access to environment variables containing production keys. The `vitest.config.ts` does not load `.env` files into the test environment.

---

## 7. Testing Stack

### Installed

| Package                     | Version | Purpose                                            |
| --------------------------- | ------- | -------------------------------------------------- |
| `vitest`                    | 1.6.1   | Test runner, assertion library, mocking            |
| `@testing-library/react`    | 14.1.2  | React component rendering and querying             |
| `@testing-library/jest-dom` | 6.2.0   | DOM assertion matchers (`toBeInTheDocument`, etc.) |
| `jsdom`                     | 23.2.0  | Browser environment simulation                     |

### Recommended Additions

| Package                       | Why                                                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| `@testing-library/user-event` | Better user interaction simulation (click, type, tab) vs. `fireEvent`. More realistic event dispatch. |
| `msw` (Mock Service Worker)   | If REST/HTTP API mocking is needed beyond Firestore (e.g., Razorpay API, Interakt webhooks).          |

### Future E2E Consideration

| Package      | Why                                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `playwright` | Already have `puppeteer` in devDeps. Playwright offers better cross-browser support, auto-waiting, and built-in trace viewer. Consider for full checkout flow E2E tests. |

---

## 8. File Count Summary

| Category                        | Count          |
| ------------------------------- | -------------- |
| Customer App files              | 77             |
| Pipeline Admin files            | 231            |
| Test infrastructure             | 4              |
| Type declarations (`.d.ts`)     | 3              |
| App entry points                | 1 (`main.tsx`) |
| **Total source files**          | **316**        |
| **Total test files**            | **0**          |
| **Estimated test cases needed** | **~305**       |

---

_Generated by scanning all 316 source files in `src/`. No tests exist yet -- this document serves as the roadmap for systematic test coverage introduction._
