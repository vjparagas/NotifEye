/**
 * Build script. Produces a loadable unpacked extension in extension/dist:
 *   dist/manifest.json   – generated from src/config/platforms.ts (single source of URL patterns)
 *   dist/background.js   – MV3 service worker (ES module)
 *   dist/content.js      – content script (self-contained IIFE; content scripts cannot import)
 *   dist/popup/          – React popup
 *
 * Usage:
 *   npm run build -w extension                       dev/demo build (passes --allow-localhost, which
 *                                                    adds the http://localhost:4000 host permission)
 *   npm run build:prod -w extension                  production build (HTTPS-only, never localhost)
 *   NOTIFEYE_API_URL=https://api.example.com npm run build:prod -w extension
 *
 * Without --allow-localhost the API URL must be https; there is no implicit localhost.
 */
import { build, type InlineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ALL_MATCH_PATTERNS } from './src/config/platforms';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
const isProd = process.argv.includes('--production');
const allowLocalhost = process.argv.includes('--allow-localhost');

// ── API origin → host permission ────────────────────────────────────────────
// Localhost (plain http) is only possible for dev/demo builds that pass --allow-localhost.
if (isProd && allowLocalhost) {
  throw new Error('--production and --allow-localhost cannot be combined: production is HTTPS-only.');
}
const defaultApi = allowLocalhost ? 'http://localhost:4000' : undefined;
const rawApiUrl = process.env.NOTIFEYE_API_URL ?? defaultApi;
if (!rawApiUrl) {
  throw new Error('NOTIFEYE_API_URL (https) is required unless building with --allow-localhost.');
}
const apiUrl = new URL(rawApiUrl);
if (apiUrl.protocol !== 'https:') {
  if (!allowLocalhost) {
    throw new Error(`API URL must be https (got ${apiUrl.origin}). Dev builds may pass --allow-localhost.`);
  }
  if (!['localhost', '127.0.0.1'].includes(apiUrl.hostname)) {
    throw new Error(`Plain http is only allowed for localhost (got ${apiUrl.origin}).`);
  }
}

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };

/**
 * Minimal permissions by design: idle, alarms, storage, notifications.
 * Host access ONLY for the two meeting domains and the NotifEye API.
 * No "tabs", no "history", no "<all_urls>".
 */
const manifest = {
  manifest_version: 3,
  name: 'NotifEye',
  version: pkg.version,
  description: 'Shows your live class status and automatic attendance to your professor during scheduled Zoom and Google Meet sessions.',
  minimum_chrome_version: '120',
  icons: { '128': 'icons/icon128.png' },
  action: {
    default_title: 'NotifEye',
    default_popup: 'popup/index.html',
    default_icon: { '128': 'icons/icon128.png' },
  },
  background: { service_worker: 'background.js', type: 'module' },
  permissions: ['idle', 'alarms', 'storage', 'notifications'],
  host_permissions: [...ALL_MATCH_PATTERNS, `${apiUrl.origin}/*`],
  content_scripts: [
    {
      matches: ALL_MATCH_PATTERNS,
      js: ['content.js'],
      run_at: 'document_idle',
    },
  ],
};

const isDemo = process.env.DEMO_MODE === 'true';
const define = {
  __API_URL__: JSON.stringify(apiUrl.origin),
  __DEMO_MODE__: JSON.stringify(isDemo),
};

const common: InlineConfig = {
  configFile: false,
  logLevel: 'warn',
  define,
  resolve: { alias: {} },
};

async function main(): Promise<void> {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });

  // 1) Popup (React, regular HTML entry)
  await build({
    ...common,
    root: path.join(root, 'src/popup'),
    base: './',
    publicDir: false,
    plugins: [react()],
    build: { outDir: path.join(dist, 'popup'), emptyOutDir: true },
  });

  // 2) Service worker (ES module, single file)
  await build({
    ...common,
    root,
    publicDir: false,
    build: {
      outDir: dist,
      emptyOutDir: false,
      minify: false,
      lib: { entry: path.join(root, 'src/background/index.ts'), formats: ['es'], fileName: () => 'background.js' },
    },
  });

  // 3) Content script (self-contained IIFE)
  await build({
    ...common,
    root,
    publicDir: false,
    build: {
      outDir: dist,
      emptyOutDir: false,
      minify: false,
      lib: {
        entry: path.join(root, 'src/content/index.ts'),
        formats: ['iife'],
        name: 'NotifEyeContent',
        fileName: () => 'content.js',
      },
    },
  });

  // 4) Manifest + static assets
  writeFileSync(path.join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const icons = path.join(root, 'public/icons');
  if (existsSync(icons)) cpSync(icons, path.join(dist, 'icons'), { recursive: true });

  console.log(`[extension] built ${isProd ? 'PRODUCTION' : 'dev'} bundle → ${dist}`);
  console.log(`[extension] API origin: ${apiUrl.origin}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
