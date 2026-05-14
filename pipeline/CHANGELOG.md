# Changelog

All notable changes to the A Square GoKarting platform are tracked here.

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) once `release-please`
starts cutting versions automatically. Until then, entries are grouped under
`Unreleased`.

## [Unreleased]

### Added

- `ErrorBoundary` component wired into both customer and pipeline app trees
  in `src/main.tsx`. Catches render errors and surfaces a recovery UI.
- Structured logger at `src/lib/logger.ts` with sensitive-key scrubbing
  (phone, OTP, payment tokens) and a pluggable reporter interface for
  Sentry/Crashlytics integration later.
- Vitest unit tests for `walletService`, `bookingService.updateBookingStatus`,
  `couponService.fetchCoupons`/`fetchUserCoupons`, and the new `logger`. 30
  tests covering the highest-risk financial code paths.
- Per-file coverage thresholds in `vitest.config.ts` acting as regression
  guards for the tested services.
- Playwright E2E scaffold (`playwright.config.ts`, `e2e/`) with a smoke test
  for the customer app boot path. The full OTP → checkout → Razorpay flow is
  defined in `e2e/booking-flow.spec.ts` but skipped pending test-Firebase +
  test-Razorpay credentials.
- `eslint-plugin-jsx-a11y` at warn level — surfaces accessibility issues
  without blocking the build until the existing backlog is cleaned.
- Husky `pre-commit` hook running `lint-staged` (eslint --fix + prettier).
- Prettier config + `.editorconfig` + `.prettierignore` for consistent
  formatting across the team.
- `.github/workflows/ci.yml` running lint (informational), typecheck, and
  unit tests on every PR plus a separate Playwright job.
- `.github/CODEOWNERS` enforcing review on the customer/pipeline boundary.
- `format` / `format:check` / `test:e2e` npm scripts.

### Changed

- Sensitive `console.log` calls in `AuthContext.tsx` (phone number leaks) and
  `razorpayService.ts` (full Razorpay response logging) replaced with
  scrubbed `logger.*` calls.
- `tsconfig.app.json`: enabled `noUnusedLocals` and `noUnusedParameters` to
  catch dead code at the type-check level.

### Notes

- `firestore.rules` remains intentionally permissive — the team has
  confirmed this is by design for the current architecture. CLAUDE.md should
  be updated to reflect this.
- The lint step in CI is `continue-on-error: true` while the pre-existing
  ~180 violations are cleaned up. Once that backlog is at zero, flip the
  flag to make lint a hard gate.
