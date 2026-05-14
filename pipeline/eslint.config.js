import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    'dist',
    'android',
    'ios',
    'functions/lib',
    'playwright-report',
    '_stash-recovery',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Honor the `_`-prefix convention for intentionally unused identifiers
      // (standard TS-ESLint pattern; matches what we already do at call sites).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      // jsx-a11y is introduced as `warn` in Sprint 2.8 — there is a backlog
      // of pre-existing violations and the CI lint step is informational
      // until that backlog is cleaned (see Sprint 2.9 / 3 work). Once the
      // codebase is clean, flip these to `error`.
      'jsx-a11y/alt-text': 'warn',
      'jsx-a11y/anchor-has-content': 'warn',
      'jsx-a11y/anchor-is-valid': 'warn',
      'jsx-a11y/aria-props': 'warn',
      'jsx-a11y/aria-role': 'warn',
      'jsx-a11y/click-events-have-key-events': 'warn',
      'jsx-a11y/heading-has-content': 'warn',
      'jsx-a11y/img-redundant-alt': 'warn',
      'jsx-a11y/label-has-associated-control': 'warn',
      'jsx-a11y/no-noninteractive-element-interactions': 'warn',
      'jsx-a11y/no-static-element-interactions': 'warn',
      'jsx-a11y/role-has-required-aria-props': 'warn',
      'jsx-a11y/tabindex-no-positive': 'warn',
      'jsx-a11y/no-autofocus': 'warn',
      'jsx-a11y/mouse-events-have-key-events': 'warn',
      'jsx-a11y/no-noninteractive-element-to-interactive-role': 'warn',
    },
  },
  // ───────────────────────────────────────────────────────────────────────────
  // Guard against raw `users/{id}` writes.
  //
  // Every user-doc write must funnel through userService.resolveOrCreateUserDoc
  // (or its sibling helpers in userService.ts), so that `phoneToUid` stays the
  // single source of truth for the canonical uid. Bypassing the helper is what
  // created the five-duplicates-per-phone mess the dedup sweep had to clean up.
  //
  // The selector matches `setDoc(doc(..., 'users', x))` and the same pattern
  // with `updateDoc`. Subcollection writes (e.g. `users/{id}/wallet/data`)
  // have a 5-argument `doc()` call and are intentionally not flagged — they
  // take the id as a parameter and never pick one themselves. Reads (`getDoc`)
  // are also not flagged.
  //
  // The `files` allowlist below covers the small set of locations that have
  // been reviewed and are known-safe. Adding a new file to the allowlist
  // requires the same reviewer scrutiny as adding a new auth path: verify the
  // id came from `phoneToUid`, a pre-canonical `user.id`, or an explicit
  // staff-onboarding flow.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      // The canonical helpers themselves.
      'src/services/userService.ts',
      'src/services/userMerge.ts',
      // walletService owns the `users/{id}.walletBalance` root mirror and
      // keeps it in lock-step with `users/{id}/wallet/data.balance` inside
      // every atomic transaction. It never creates duplicate user docs.
      'src/services/walletService.ts',
      // Context writes off the session's canonical `user.id`.
      'src/contexts/GamesContext.tsx',
      // POS first-visit path — gated on a phoneToUid lookup immediately above
      // every write.
      'src/lib/unified-booking.ts',
      // Admin CRUD helpers — take a caller-supplied userId.
      'src/pipeline/api/asquare-customers.ts',
      'src/pipeline/api/asquare-members.ts',
      // Owner customer-controls — userId always comes from a prior phoneToUid
      // lookup in lookupCustomerByPhone; toggle functions never pick their own id.
      'src/pipeline/api/customer-controls.ts',
      // Staff onboarding — always writes `role: 'staff'`, which pickCanonical
      // hard-skips, so it cannot create a customer duplicate.
      'src/pipeline/features/track/scanner/ScannerModule.tsx',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.name=/^(setDoc|updateDoc)$/] > CallExpression[callee.name='doc'][arguments.length=3]:has(Literal[value='users'])",
          message:
            'Do not write `users/{id}` directly. Route through userService.resolveOrCreateUserDoc / userService.mergeUserDoc so phoneToUid stays authoritative. If this write is a verified exception, add the file to the allowlist in eslint.config.js with a comment explaining why.',
        },
      ],
    },
  },
])
