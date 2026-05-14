#!/usr/bin/env node

/**
 * Build script for separate Customer / Pipeline APKs.
 *
 * Usage:
 *   node scripts/build-app.mjs customer   — builds the Customer app
 *   node scripts/build-app.mjs pipeline   — builds the Pipeline app
 *
 * What it does:
 *   1. Copies the target-specific Capacitor config to capacitor.config.ts
 *   2. Runs Vite build with VITE_APP_TARGET set
 *   3. Runs `npx cap sync android` to push web assets to Android project
 *   4. Restores the original capacitor.config.ts
 *
 * After this script completes, open Android Studio and build the APK:
 *   npx cap open android
 */

import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const target = process.argv[2];
if (!['customer', 'pipeline'].includes(target)) {
  console.error('Usage: node scripts/build-app.mjs <customer|pipeline>');
  process.exit(1);
}

const mainConfig = resolve(root, 'capacitor.config.ts');
const backupConfig = resolve(root, 'capacitor.config.backup.ts');
const targetConfig = resolve(root, `capacitor.config.${target}.ts`);

if (!existsSync(targetConfig)) {
  console.error(`Missing config: capacitor.config.${target}.ts`);
  process.exit(1);
}

function run(cmd) {
  console.log(`\n> ${cmd}\n`);
  execSync(cmd, { cwd: root, stdio: 'inherit' });
}

try {
  // 1. Backup current config & swap in target config
  console.log(`\n=== Building ${target.toUpperCase()} app ===\n`);
  copyFileSync(mainConfig, backupConfig);
  copyFileSync(targetConfig, mainConfig);
  console.log(`Swapped capacitor.config.ts → ${target} config`);

  // 2. Build web assets with VITE_APP_TARGET
  run(`npx cross-env VITE_APP_TARGET=${target} npm run build`);

  // 3. Sync to Android
  run('npx cap sync android');

  console.log(`\n✅ ${target.toUpperCase()} build ready!`);
  console.log('   Open Android Studio to build the APK:');
  console.log('   npx cap open android\n');
} finally {
  // 4. Restore original config
  if (existsSync(backupConfig)) {
    copyFileSync(backupConfig, mainConfig);
    unlinkSync(backupConfig);
    console.log('Restored original capacitor.config.ts');
  }
}
