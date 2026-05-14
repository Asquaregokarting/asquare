# Mobile asset sources

This directory holds the **single source of truth** for app icons and splash
screens. Run `npm run assets:generate` to regenerate every Android density,
iOS @1x/@2x/@3x asset, and the adaptive-icon foreground/background from these
files.

## Required files

| File                | Size       | Format               | Purpose                                  |
| ------------------- | ---------- | -------------------- | ---------------------------------------- |
| `icon.png`          | 1024×1024  | PNG, transparent     | Square master icon (foreground)          |
| `icon-foreground.png` *(optional)* | 1024×1024 | PNG, transparent | Adaptive icon foreground (Android)       |
| `splash.png`        | 2732×2732  | PNG                  | Splash screen master (centered logo)     |
| `splash-dark.png` *(optional)* | 2732×2732 | PNG | Dark-mode splash variant                |

The brand colours are passed via the `npm run assets:generate` script flags
(`#0066FF` icon background, `#0a0e1a` splash background — keep these in sync
with `tailwind.config.js`).

## After regenerating

`@capacitor/assets` writes directly into `android/app/src/main/res/` and
`ios/App/App/Assets.xcassets/`. Commit those changes alongside the asset
update so CI sees the new icons.

## Why this exists

Until this script was added, icons were hand-edited in each platform's
native project, making them drift apart. Sprint 4.16 of the audit
remediation backlog set this up — see CHANGELOG.md.
