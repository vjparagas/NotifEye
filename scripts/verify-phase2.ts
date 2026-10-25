import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createApp } from '../backend/src/app';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const distDashboard = path.join(root, 'dashboard/dist');
const distExtension = path.join(root, 'extension/dist');
const screenshotDir = path.join(root, 'docs/screenshots');

fs.mkdirSync(screenshotDir, { recursive: true });

async function main() {
  console.log('--- Starting Phase 2 Verification ---');

  // 1. Start Backend on port 4000
  const app = createApp();
  const backendServer = app.listen(4000, '127.0.0.1');
  await new Promise<void>((resolve) => backendServer.once('listening', resolve));
  console.log('✔ Backend API running on http://127.0.0.1:4000');

  // 2. Start Static SPA Server for Dashboard on port 5173
  const mimeTypes: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  };

  const dashboardServer = http.createServer((req, res) => {
    let filePath = path.join(distDashboard, (req.url || '/').split('?')[0]!);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
    if (!fs.existsSync(filePath)) {
      filePath = path.join(distDashboard, 'index.html');
    }

    const ext = path.extname(filePath);
    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  });

  dashboardServer.listen(5173, '127.0.0.1');
  await new Promise<void>((resolve) => dashboardServer.once('listening', resolve));
  console.log('✔ Dashboard SPA running on http://localhost:5173');

  // 3. Launch Chromium with extension loaded
  const userDataDir = fs.mkdtempSync(path.join(tmpdir(), 'notifeye-phase2-'));
  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1200, height: 750 },
    args: [`--disable-extensions-except=${distExtension}`, `--load-extension=${distExtension}`],
  });

  try {
    let [sw] = browser.serviceWorkers();
    sw ??= await browser.waitForEvent('serviceworker', { timeout: 15000 });
    const extId = new URL(sw.url()).host;
    console.log('✔ Extension service worker loaded:', extId);

    // 4. Verify Dashboard Login Page
    const page = await browser.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log('PAGE ERROR LOG:', msg.text());
    });
    page.on('pageerror', (err) => console.log('PAGE UNCAUGHT:', err));

    await page.goto('http://localhost:5173/login');
    await page.waitForSelector('#email-input');
    await page.screenshot({ path: path.join(screenshotDir, 'phase2-dashboard-login.png') });
    console.log('✔ Saved phase2-dashboard-login.png');

    // 5. Test Register / Login flow on Dashboard
    const rand = Math.floor(Math.random() * 100000);
    const profEmail = `prof_${rand}@university.edu`;
    const profPass = 'StrongPass123!';

    // Click "Create Account" tab
    await page.click('button:has-text("Create Account")');
    await page.fill('#name-input', 'Prof. Alan Turing');
    await page.fill('#email-input', profEmail);
    await page.fill('#password-input', profPass);
    await page.check('#consent-checkbox');
    await page.click('button[type="submit"]:has-text("Create Account")');

    // Wait for navigation to /classes
    await page.waitForSelector('h1:has-text("My Classes")');
    console.log('✔ Professor registered and redirected to /classes');

    // 6. Create a Class
    await page.click('button:has-text("Create Class")');
    await page.waitForSelector('#class-name-input');
    await page.fill('#class-name-input', 'Systems Integration 101');
    await page.fill('#class-section-input', 'BSIT-4A');
    await page.click('button[type="submit"]:has-text("Create Class")');

    // Wait for class card to appear
    await page.waitForSelector('h3:has-text("Systems Integration 101")');
    const classCodeEl = await page.waitForSelector('.font-mono');
    const classCode = (await classCodeEl.innerText()).trim();
    console.log(`✔ Created class "Systems Integration 101" with code: ${classCode}`);

    await page.screenshot({ path: path.join(screenshotDir, 'phase2-dashboard-classes.png') });
    console.log('✔ Saved phase2-dashboard-classes.png');

    // 7. Click class to view Class Detail and Roster
    await page.click('h3:has-text("Systems Integration 101")');
    await page.waitForSelector('h2:has-text("Student Roster")');
    await page.screenshot({ path: path.join(screenshotDir, 'phase2-dashboard-roster.png') });
    console.log('✔ Saved phase2-dashboard-roster.png');

    // 8. Test Extension Popup
    const popupPage = await browser.newPage();
    popupPage.on('console', (msg) => {
      if (msg.type() === 'error') console.log('POPUP ERROR LOG:', msg.text());
    });
    await popupPage.setViewportSize({ width: 360, height: 520 });
    await popupPage.goto(`chrome-extension://${extId}/popup/index.html`);
    await popupPage.waitForSelector('#status-card');

    const statusText = await popupPage.locator('#status-card').innerText();
    console.log('✔ Popup status card:', statusText.replace(/\n/g, ' '));

    // Register student in extension popup
    const studentEmail = `student_${rand}@university.edu`;
    await popupPage.click('button:has-text("Register")');
    await popupPage.fill('#reg-name', 'Maria Santos');
    await popupPage.fill('#reg-email', studentEmail);
    await popupPage.fill('#reg-pass', 'StudentPass123!');
    await popupPage.check('#reg-consent');
    await popupPage.click('button:has-text("Create Student Account")');

    // Verify student authenticated view in popup
    await popupPage.waitForSelector('button:has-text("Join with Code")');
    console.log('✔ Student signed in inside extension popup');

    // Join the class using the classCode
    await popupPage.fill('input[placeholder="CLASS CODE"]', classCode);
    await popupPage.check('#join-consent');
    await popupPage.click('button:has-text("Join with Code")');

    // Wait for joined class in list
    await popupPage.waitForSelector('.chip-warn:has-text("pending")');
    console.log('✔ Student joined class, status shows pending');

    await popupPage.screenshot({ path: path.join(screenshotDir, 'phase2-popup.png') });
    console.log('✔ Saved phase2-popup.png');

    // 9. Back on Dashboard, reload roster and approve student
    await page.reload();
    await page.waitForSelector('td:has-text("Maria Santos")');
    console.log('✔ Student Maria Santos appears in professor roster');
    await page.click('button:has-text("Approve")');
    await page.waitForSelector('.chip-ok:has-text("approved")');
    console.log('✔ Professor approved student enrollment!');

    console.log('--- Phase 2 Verification Completed Successfully! ---');
  } finally {
    await browser.close();
    dashboardServer.close();
    backendServer.close();
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {}
  }
}

main().catch((err) => {
  console.error('✖ Verification failed:', err);
  process.exit(1);
});
