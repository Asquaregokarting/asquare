/**
 * Debug script: trace `platforms` field through save → reload using Playwright.
 *
 * What it does
 * ------------
 *  1. Launches a real Chromium window pointed at your local dev server.
 *  2. You log in and drive the UI (open game, untick all platforms, save,
 *     reload, reopen). The script doesn't try to script auth or clicks.
 *  3. Logs every Firestore HTTP request/response to:
 *       - the terminal (filtered to platforms-mentioning traffic)
 *       - scripts/debug-platforms.log (full payload, every Firestore call)
 *  4. Also dumps any `[debug]` console messages from the browser.
 *
 * Prereqs
 * -------
 *   - Dev server running:  npm run dev   (default :5173)
 *   - Playwright browsers installed:  npx playwright install chromium
 *
 * Run
 * ---
 *   npx tsx scripts/debug-platforms.ts
 *
 * Optional env vars
 * -----------------
 *   BASE_URL    — defaults to http://localhost:5173
 *   APP_QUERY   — defaults to ?app=pipeline
 *   START_PATH  — defaults to /activities/list
 *   VERBOSE=1   — also print every Firestore call (not just platforms-related)
 *
 * Stop with Ctrl+C or by closing the browser window.
 */

import { appendFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, type Request, type Response } from 'playwright'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173'
const APP_QUERY = process.env.APP_QUERY ?? '?app=pipeline'
const START_PATH = process.env.START_PATH ?? '/activities/list'
const VERBOSE = process.env.VERBOSE === '1'
const LOG_PATH = resolve(process.cwd(), 'scripts', 'debug-platforms.log')

// Reset the log file at the start of each run.
writeFileSync(LOG_PATH, `# debug-platforms run @ ${new Date().toISOString()}\n`)

const FIRESTORE_HOST = 'firestore.googleapis.com'
const STORAGE_HOST = 'firebasestorage.googleapis.com'

const ts = (): string => new Date().toISOString().split('T')[1].slice(0, 12)

const writeLog = (line: string): void => {
  appendFileSync(LOG_PATH, line + '\n')
}

const tryParseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    // Long-poll channel framing: comma-separated JSON envelopes prefixed by
    // a length. Try to grab the largest brace-pair we can find.
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0])
    } catch {
      return null
    }
  }
}

// Walk JSON tree, collect every node whose key is `platforms`, and a few
// neighbours so we can tell which game it belongs to.
interface PlatformsHit {
  path: string
  value: unknown
  contextName?: string
}
const findPlatformsNodes = (
  node: unknown,
  path: string[] = [],
  out: PlatformsHit[] = [],
  ancestors: Array<Record<string, unknown>> = [],
): PlatformsHit[] => {
  if (node === null || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    node.forEach((child, i) => findPlatformsNodes(child, [...path, String(i)], out, ancestors))
    return out
  }
  const obj = node as Record<string, unknown>
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'platforms') {
      // Climb ancestors looking for a `name` we can attribute it to.
      let contextName: string | undefined
      for (let i = ancestors.length - 1; i >= 0; i--) {
        const candidate = ancestors[i]
        const nameField =
          (candidate.name as Record<string, unknown> | undefined)?.stringValue ??
          (typeof candidate.name === 'string' ? candidate.name : undefined)
        if (typeof nameField === 'string' && nameField.length > 0) {
          contextName = nameField
          break
        }
      }
      out.push({ path: [...path, key].join('.'), value, contextName })
    }
    findPlatformsNodes(value, [...path, key], out, [...ancestors, obj])
  }
  return out
}

// Pretty-print Firestore arrayValue / stringValue typed JSON into something
// readable: `{stringValue:"web"}` -> `"web"`.
const decodeFirestoreValue = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object') return value
  const obj = value as Record<string, unknown>
  if ('arrayValue' in obj) {
    const arr = (obj.arrayValue as { values?: unknown[] } | undefined)?.values ?? []
    return arr.map(decodeFirestoreValue)
  }
  if ('stringValue' in obj) return obj.stringValue
  if ('integerValue' in obj) return Number(obj.integerValue)
  if ('booleanValue' in obj) return obj.booleanValue
  if ('nullValue' in obj) return null
  if ('mapValue' in obj) {
    const fields =
      ((obj.mapValue as { fields?: Record<string, unknown> } | undefined)?.fields as Record<
        string,
        unknown
      >) ?? {}
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(fields)) out[k] = decodeFirestoreValue(v)
    return out
  }
  return obj
}

const reportHits = (
  direction: 'REQ' | 'RES',
  url: string,
  parsed: unknown,
): { matched: boolean; lines: string[] } => {
  const hits = findPlatformsNodes(parsed)
  const lines: string[] = []
  if (hits.length === 0) return { matched: false, lines }
  lines.push(`[${ts()}] ${direction}  ${url.split('?')[0].slice(-90)}`)
  for (const hit of hits) {
    const decoded = decodeFirestoreValue(hit.value)
    const ctx = hit.contextName ? `  (${hit.contextName})` : ''
    lines.push(`        ${hit.path}${ctx} = ${JSON.stringify(decoded)}`)
  }
  return { matched: true, lines }
}

const main = async (): Promise<void> => {
  console.log(`Opening ${BASE_URL}${START_PATH}${APP_QUERY}`)
  console.log(`Full Firestore traffic log: ${LOG_PATH}`)
  console.log('A Chromium window will appear. Log in manually and drive the UI:')
  console.log('  1. Open Activities → Hierarchy')
  console.log('  2. Open a game, untick all platforms, click Save')
  console.log('  3. Reload (Ctrl+R inside the browser)')
  console.log('  4. Reopen the same game')
  console.log('  5. Close the browser window when done\n')

  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext()
  const page = await context.newPage()

  const seenRequests = { count: 0, platformsHits: 0 }

  page.on('request', (req: Request) => {
    const url = req.url()
    if (!url.includes(FIRESTORE_HOST)) return
    seenRequests.count++
    const body = req.postData() ?? ''
    writeLog(`\n>>> REQ ${ts()} ${url}`)
    writeLog(body || '(no body)')
    const parsed = tryParseJson(body)
    if (parsed !== null) {
      const { matched, lines } = reportHits('REQ', url, parsed)
      if (matched) {
        seenRequests.platformsHits++
        for (const line of lines) console.log(line)
        console.log() // blank line for readability
      } else if (VERBOSE) {
        console.log(`[${ts()}] REQ  ${url.split('?')[0].slice(-90)}  (no platforms in body)`)
      }
    }
  })

  page.on('response', async (res: Response) => {
    const url = res.url()
    if (!url.includes(FIRESTORE_HOST)) return
    let body = ''
    try {
      body = await res.text()
    } catch {
      writeLog(`\n<<< RES ${ts()} ${url}  (could not read body)`)
      return
    }
    writeLog(`\n<<< RES ${ts()} ${url}`)
    writeLog(body || '(empty)')
    const parsed = tryParseJson(body)
    if (parsed !== null) {
      const { matched, lines } = reportHits('RES', url, parsed)
      if (matched) {
        seenRequests.platformsHits++
        for (const line of lines) console.log(line)
        console.log()
      } else if (VERBOSE) {
        console.log(`[${ts()}] RES  ${url.split('?')[0].slice(-90)}  (no platforms in body)`)
      }
    }
  })

  // Filter the noisy `shifts_firestore.location_normalized` line — it's from
  // an unrelated module and floods the terminal. Keep useful debug lines.
  const NOISE_PATTERNS = [/shifts_firestore\.location_normalized/, /THREE\.WebGLProgram/]
  page.on('console', (msg) => {
    const text = msg.text()
    if (NOISE_PATTERNS.some((re) => re.test(text))) return
    const t = msg.type()
    if (
      t === 'error' ||
      t === 'warning' ||
      text.includes('[debug]') ||
      text.toLowerCase().includes('platform')
    ) {
      console.log(`[browser ${t}] ${text}`)
    }
  })
  page.on('pageerror', (err) => console.log(`[browser pageerror] ${err.message}`))

  await page.goto(`${BASE_URL}${START_PATH}${APP_QUERY}`)

  await new Promise<void>((resolveDone) => {
    browser.on('disconnected', () => resolveDone())
  })

  console.log('\n--- summary ---')
  console.log(`Firestore requests captured: ${seenRequests.count}`)
  console.log(`Of those, mentioning platforms: ${seenRequests.platformsHits}`)
  console.log(`Full log written to: ${LOG_PATH}`)
  if (seenRequests.count === 0) {
    console.log('\nNo Firestore HTTP requests at all — possible reasons:')
    console.log('  - You stayed on the login page and never saved anything.')
    console.log("  - Your dev server wasn't actually serving the app.")
    console.log('  - Firestore is using a long-poll channel (look in the log for')
    console.log('    URLs containing /Listen/channel — those carry data via')
    console.log(`    streamed POST bodies that aren't always parseable as JSON).`)
  } else if (seenRequests.platformsHits === 0) {
    console.log('\nFirestore traffic was captured, but nothing mentioned platforms.')
    console.log('Open the log file and grep for `platforms` to confirm:')
    console.log(`  Select-String -Path ${LOG_PATH} -Pattern platforms`)
    if (STORAGE_HOST) console.log() // satisfy lint, value referenced.
  }
}

main().catch((err: unknown) => {
  console.error('debug-platforms failed:', err)
  process.exit(1)
})
