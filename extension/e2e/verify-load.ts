/**
 * Loads the built extension (extension/dist) into a real Chromium and proves it works:
 *   - service worker starts
 *   - popup renders
 *   - manifest has ONLY the approved permissions
 * Saves screenshots to the given output directory (default: ./e2e-output).
 *
 * Usage: npm run build -w extension && npx tsx extension/e2e/verify-load.ts [outDir]
 */
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '../dist');
const outDir = path.resolve(process.argv[2] ?? path.join(here, '../e2e-output'));
mkdirSync(outDir, { recursive: true });

const manifest = JSON.parse(readFileSync(path.join(dist, 'manifest.json'), 'utf8')) as {
  permissions: string[];
  host_permissions: string[];
};

const APPROVED_PERMISSIONS = ['idle', 'alarms', 'storage', 'notifications'];
const FORBIDDEN = ['tabs', 'history', '<all_urls>', 'webRequest', 'cookies', 'identity', 'scripting'];

async function main(): Promise<void> {
  // ── Static permission audit ──
  const perms = [...manifest.permissions].sort().join(',');
  if (perms !== [...APPROVED_PERMISSIONS].sort().join(',')) throw new Error(`Unexpected permissions: ${perms}`);
  for (const h of manifest.host_permissions) {
    if (FORBIDDEN.includes(h) || h === '*://*/*' || h === 'https://*/*') throw new Error(`Too-broad host permission: ${h}`);
  }
  console.log('✔ manifest permissions:', manifest.permissions.join(', '));
  console.log('✔ host permissions:', manifest.host_permissions.join(', '));

  // ── Load in Chromium ──
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'notifeye-pw-'));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1100, height: 700 },
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });

  try {
    let [sw] = ctx.serviceWorkers();
    sw ??= await ctx.waitForEvent('serviceworker', { timeout: 15000 });
    const extId = new URL(sw.url()).host;
    console.log('✔ service worker running:', sw.url());

    // Extensions management page
    const mgmt = await ctx.newPage();
    await mgmt.goto('chrome://extensions');
    await mgmt.waitForTimeout(800);
    await mgmt.screenshot({ path: path.join(outDir, 'phase1-chrome-extensions.png') });

    // Popup rendered as a normal page (a popup window can't be screenshotted directly)
    const popup = await ctx.newPage();
    await popup.setViewportSize({ width: 340, height: 260 });
    await popup.goto(`chrome-extension://${extId}/popup/index.html`);
    await popup.waitForSelector('#status-card');
    const text = await popup.locator('#status-card').innerText();
    if (!/Monitoring inactive/.test(text)) throw new Error('Popup did not render the status card');
    await popup.screenshot({ path: path.join(outDir, 'phase1-popup.png') });
    console.log('✔ popup rendered:', text.replace(/\n/g, ' | '));
    console.log('Screenshots saved to', outDir);
  } finally {
    await ctx.close();
  }
}

main().catch((e) => {
  console.error('✖', e instanceof Error ? e.message : e);
  process.exit(1);
});
