/**
 * Backfill `interaktTemplateId` on helicopter records so the new
 * per-activity template routing keeps the same day-1 behavior the legacy
 * hardcoded `hasHelicopter` branch in functions/lib/interakt.js used to
 * provide.
 *
 * Two collections are walked because helicopter rides exist in BOTH:
 *
 *   1. `locations/{locationId}/games/{gameId}/subgames/{subGameId}` —
 *      catches helicopter sub-games created via the Activities editor.
 *   2. `helicopterActivities/{id}` — the top-level legacy collection
 *      (see HELICOPTER_ACTIVITIES_COLLECTION in billing-firestore.ts).
 *
 * Match rule: name or parent game name contains "helicopter" (case-
 * insensitive). For collection (2) every doc qualifies by definition.
 *
 * Sets:
 *   interaktTemplateId       = "booking_confirm_pdf_util"
 *   interaktTemplateLanguage = "en"
 *
 * Idempotent: docs that already have a non-empty `interaktTemplateId`
 * are skipped, so re-running is safe and admin-set values are never
 * clobbered.
 *
 * Usage:
 *   node scripts/backfill-helicopter-interakt-template.cjs            # dry-run
 *   node scripts/backfill-helicopter-interakt-template.cjs --apply    # write
 */
const admin = require('firebase-admin')
const path = require('path')
const fs = require('fs')

const DATABASE_ID = 'asquare-app-db'
const TEMPLATE_ID = 'booking_confirm_pdf_util'
const TEMPLATE_LANGUAGE = 'en'

const apply = process.argv.includes('--apply')

const keyPath = path.resolve('serviceAccountKey.json')
if (!fs.existsSync(keyPath)) {
  console.error('serviceAccountKey.json not found in project root.')
  process.exit(1)
}
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))),
})
const db = admin.firestore()
db.settings({ databaseId: DATABASE_ID })

const isHelicopterText = (text) =>
  String(text || '').toLowerCase().includes('helicopter')

;(async () => {
  const banner = apply ? 'APPLY' : 'DRY-RUN'
  console.log('\n══════════════════════════════════════════════════════════════')
  console.log(`  BACKFILL helicopter interaktTemplateId — mode: ${banner}`)
  console.log('══════════════════════════════════════════════════════════════\n')

  let scanned = 0
  let candidates = 0
  let skippedAlreadySet = 0
  let updated = 0

  // ── 1. Sub-games under locations/.../games/.../subgames ──────────────
  const locationsSnap = await db.collection('locations').get()
  for (const locationDoc of locationsSnap.docs) {
    const locationId = locationDoc.id
    const gamesSnap = await locationDoc.ref.collection('games').get()

    for (const gameDoc of gamesSnap.docs) {
      const gameData = gameDoc.data()
      const gameName = String(gameData.name || gameDoc.id)
      const gameLooksHeli = isHelicopterText(gameName)

      const subSnap = await gameDoc.ref.collection('subgames').get()
      for (const subDoc of subSnap.docs) {
        scanned += 1
        const subData = subDoc.data()
        const subName = String(subData.name || subDoc.id)

        if (!gameLooksHeli && !isHelicopterText(subName)) continue
        candidates += 1

        const existing = String(subData.interaktTemplateId || '').trim()
        if (existing) {
          skippedAlreadySet += 1
          console.log(
            `  SKIP   ${locationId} / ${gameName} / ${subName} — already set to "${existing}"`,
          )
          continue
        }

        console.log(
          `  ${apply ? 'WRITE ' : 'WOULD '}${locationId} / ${gameName} / ${subName} → ${TEMPLATE_ID} (${TEMPLATE_LANGUAGE})`,
        )
        if (apply) {
          await subDoc.ref.set(
            {
              interaktTemplateId: TEMPLATE_ID,
              interaktTemplateLanguage: TEMPLATE_LANGUAGE,
              updatedAt: new Date().toISOString(),
            },
            { merge: true },
          )
          updated += 1
        }
      }
    }
  }

  // ── 2. Legacy flat activityCatalog/* collection ──────────────────────
  // The legacy flat catalog mirrors per-activity records and is the
  // source of truth for some booking flows. Match on name OR category
  // containing "helicopter" — same rule the legacy hasHelicopter
  // dispatcher used.
  console.log('\n  --- activityCatalog/* ---')
  let catalogScanned = 0
  let catalogCandidates = 0
  let catalogSkipped = 0
  let catalogUpdated = 0
  const catalogSnap = await db.collection('activityCatalog').get()
  for (const catDoc of catalogSnap.docs) {
    catalogScanned += 1
    const data = catDoc.data()
    const name = String(data.name || data.bookingName || catDoc.id)
    const category = String(data.category || data.subcategory || '')
    if (!isHelicopterText(name) && !isHelicopterText(category)) continue
    catalogCandidates += 1
    const existing = String(data.interaktTemplateId || '').trim()
    if (existing) {
      catalogSkipped += 1
      console.log(`  SKIP   activityCatalog/${catDoc.id} (${name}) — already "${existing}"`)
      continue
    }
    console.log(
      `  ${apply ? 'WRITE ' : 'WOULD '}activityCatalog/${catDoc.id} (${name}) → ${TEMPLATE_ID} (${TEMPLATE_LANGUAGE})`,
    )
    if (apply) {
      await catDoc.ref.set(
        {
          interaktTemplateId: TEMPLATE_ID,
          interaktTemplateLanguage: TEMPLATE_LANGUAGE,
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      )
      catalogUpdated += 1
    }
  }

  // ── 3. Top-level helicopterActivities collection ─────────────────────
  console.log('\n  --- helicopterActivities/* ---')
  let heliScanned = 0
  let heliSkipped = 0
  let heliUpdated = 0
  const heliSnap = await db.collection('helicopterActivities').get()
  for (const heliDoc of heliSnap.docs) {
    heliScanned += 1
    const data = heliDoc.data()
    const heliName = String(data.name || heliDoc.id)
    const existing = String(data.interaktTemplateId || '').trim()
    if (existing) {
      heliSkipped += 1
      console.log(`  SKIP   helicopterActivities/${heliDoc.id} (${heliName}) — already "${existing}"`)
      continue
    }
    console.log(
      `  ${apply ? 'WRITE ' : 'WOULD '}helicopterActivities/${heliDoc.id} (${heliName}) → ${TEMPLATE_ID} (${TEMPLATE_LANGUAGE})`,
    )
    if (apply) {
      await heliDoc.ref.set(
        {
          interaktTemplateId: TEMPLATE_ID,
          interaktTemplateLanguage: TEMPLATE_LANGUAGE,
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      )
      heliUpdated += 1
    }
  }

  console.log('\n──────────────────────────────────────────────────────────────')
  console.log('  Sub-games (locations/*/games/*/subgames/*):')
  console.log(`    Scanned:                ${scanned}`)
  console.log(`    Helicopter candidates:  ${candidates}`)
  console.log(`    Already set (skipped):  ${skippedAlreadySet}`)
  console.log(`    ${apply ? 'Updated' : 'Would update'}: ${apply ? updated : candidates - skippedAlreadySet}`)
  console.log('  activityCatalog/*:')
  console.log(`    Scanned:                ${catalogScanned}`)
  console.log(`    Helicopter candidates:  ${catalogCandidates}`)
  console.log(`    Already set (skipped):  ${catalogSkipped}`)
  console.log(`    ${apply ? 'Updated' : 'Would update'}: ${apply ? catalogUpdated : catalogCandidates - catalogSkipped}`)
  console.log('  helicopterActivities/*:')
  console.log(`    Scanned:                ${heliScanned}`)
  console.log(`    Already set (skipped):  ${heliSkipped}`)
  console.log(`    ${apply ? 'Updated' : 'Would update'}: ${apply ? heliUpdated : heliScanned - heliSkipped}`)
  console.log('──────────────────────────────────────────────────────────────\n')

  if (!apply) {
    console.log('Re-run with --apply to write changes.')
  } else {
    console.log('Done.')
  }
  process.exit(0)
})().catch((err) => {
  console.error('\n[FATAL]', err)
  process.exit(1)
})
