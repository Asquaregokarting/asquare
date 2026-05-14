/**
 * Postbuild prerender script.
 *
 * Spins up a static server for the Vite `dist/` output, visits each
 * public route with headless Chrome (via Puppeteer), captures the
 * fully-rendered HTML, and writes it back so crawlers see real content
 * instead of an empty <div id="root">.
 *
 * Usage:  node scripts/prerender.mjs
 * Called automatically by `npm run build`.
 */

import { createServer } from 'http'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { resolve, join, dirname } from 'path'
import { fileURLToPath } from 'url'
import puppeteer from 'puppeteer'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(__dirname, '..', 'dist')
const PORT = 4173

/** Public routes worth prerendering (must match sitemap.xml). */
const ROUTES = [
  '/',
  '/activities',
  '/helicopter-bookings',
  '/birthday',
  '/corporate',
  '/school-groups',
  '/privacy',
  '/terms',
  '/refund-policy',
  '/links',
]

// ---------------------------------------------------------------------------
// Tiny static file server for the built dist folder
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.webp': 'image/webp',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.woff':  'font/woff',
  '.txt':  'text/plain',
  '.xml':  'application/xml',
}

function startServer() {
  return new Promise((res) => {
    const server = createServer((req, res2) => {
      let pathname = req.url.split('?')[0]
      let filePath = join(DIST, pathname)

      // SPA fallback — serve index.html for routes without file extensions
      if (!pathname.includes('.')) {
        filePath = join(DIST, 'index.html')
      }

      try {
        const data = readFileSync(filePath)
        const ext = '.' + filePath.split('.').pop()
        res2.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
        res2.end(data)
      } catch {
        // Fallback to index.html for any 404
        try {
          const data = readFileSync(join(DIST, 'index.html'))
          res2.writeHead(200, { 'Content-Type': 'text/html' })
          res2.end(data)
        } catch {
          res2.writeHead(404)
          res2.end('Not found')
        }
      }
    })
    server.listen(PORT, () => res(server))
  })
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function prerender() {
  console.log('\n⚡ Prerendering public pages...\n')

  const server = await startServer()
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  let rendered = 0

  for (const route of ROUTES) {
    const page = await browser.newPage()

    // Block external API calls that would hang (Firebase, analytics)
    // but allow all local assets (JS/CSS bundles)
    await page.setRequestInterception(true)
    page.on('request', (req) => {
      const reqUrl = req.url()
      const type = req.resourceType()
      const isLocal = reqUrl.startsWith(`http://localhost:${PORT}`)

      if (isLocal) {
        req.continue()
      } else if (
        ['image', 'font', 'media'].includes(type) ||
        reqUrl.includes('googleapis.com') ||
        reqUrl.includes('googletagmanager.com') ||
        reqUrl.includes('google-analytics.com') ||
        reqUrl.includes('razorpay.com')
      ) {
        req.abort()
      } else {
        req.continue()
      }
    })

    const pageUrl = `http://localhost:${PORT}${route}`
    try {
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 10_000 })

      // Wait for React to mount — the root div gets children once React renders.
      // Firebase auth may show LoadingScreen first, which is fine — we still
      // capture the shell + meta tags. For static pages (policy, lead capture),
      // the full content renders immediately.
      await page.waitForFunction(
        () => {
          const root = document.getElementById('root')
          return root && root.innerHTML.length > 100
        },
        { timeout: 8_000 }
      )
      // Give React a moment to finish any pending renders
      await page.evaluate(() => new Promise((r) => setTimeout(r, 1500)))

      let html = await page.content()

      // Inject a marker so we know this HTML was prerendered (only once)
      if (!html.includes('prerender-status')) {
        html = html.replace(
          '<head>',
          '<head><meta name="prerender-status" content="prerendered" />'
        )
      }

      // Determine output path
      const outDir = route === '/'
        ? DIST
        : join(DIST, route)

      if (!existsSync(outDir)) {
        mkdirSync(outDir, { recursive: true })
      }

      writeFileSync(join(outDir, 'index.html'), html, 'utf-8')
      rendered++
      console.log(`  ✓ ${route}`)
    } catch (err) {
      console.error(`  ✗ ${route} — ${err.message}`)
    } finally {
      await page.close()
    }
  }

  await browser.close()
  server.close()

  console.log(`\n✅ Prerendered ${rendered}/${ROUTES.length} pages.\n`)
}

prerender().catch((err) => {
  console.error('Prerender failed:', err)
  process.exit(1)
})
