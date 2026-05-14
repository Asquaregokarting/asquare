Run guide
1. Install dependencies

cd C:\Users\shree\Downloads\asquare\pipeline
npm install
You're on Node 24.14.1 / npm 11.11.0 — fine for this stack. Install will take a few minutes (Firebase, React, Three.js, Capacitor, etc.).

2. Create your env file

copy .env.example .env
Then open pipeline/.env and fill in real values. Minimum needed to boot:

VITE_FIREBASE_* — from your Firebase project console → Project Settings → General → "Your apps" → SDK config
VITE_FIREBASE_FIRESTORE_DATABASE_ID — leave as asquare-app-db if that's your DB name
Optional (only if you need those features): Razorpay, Google Maps, Interakt, Superfone, Website API keys.

3. Start the dev server

npm run dev
Vite starts on http://localhost:5173.

4. Open the pipeline app
The codebase serves both customer and pipeline from one bundle — main.tsx picks which one by hostname. Use either:

Query param (easiest): http://localhost:5173/?app=pipeline
Subdomain: http://pipeline.localhost:5173
(Chrome/Edge resolve *.localhost to 127.0.0.1 automatically; Firefox may need a hosts entry.)
Without the param/subdomain you'll see the customer app instead.

5. Other useful scripts

npm run build          # Production build into dist/
npm run preview        # Serve the prod build locally
npm test               # Vitest unit tests
npm run test:e2e       # Playwright E2E
npm run lint           # ESLint
Heads-up
Firebase auth/Firestore won't work until your .env has real keys — the app will load but auth screens and data fetches will error in the console.
No backend in this folder. functions/, firestore.rules, firebase.json, and the PHP webhooks were excluded. The pipeline app calls Firestore directly and external APIs; if any feature requires the deployed Firebase Functions or PHP endpoints, those need to be hosted elsewhere.
No native shells. android/ and ios/ weren't copied. If you later want a mobile build, run npx cap add android / npx cap add ios after a npm run build.