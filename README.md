# NotifEye

A browser extension and web dashboard that show professors which online students are present, and alert them when a student is absent or late.

- **Student side:** a Chrome/Edge extension (Manifest V3). During scheduled class sessions only, it reports whether the computer is active or idle, and whether the student has the session's Zoom or Google Meet web meeting open.
- **Professor side:** a web dashboard organized by class. It shows live student status, per-session attendance (Present / Late / Absent), and alerts.
- **Backend:** one Node.js + Express + PostgreSQL application that turns the reported events into status, attendance, and alerts.

**Prepared by:** VJ Evangelista, Diane Edge Buna, Loraine Militante · **Section:** BSIT 3-1 · **Subject:** Systems Integration Architecture

> NotifEye reports **presence and attendance**, not attention or focus. An open meeting tab does not prove a student is paying attention, so every status is labelled with its source and the professor can override any record.

---

## What is built

| Area | Status |
|---|---|
| Accounts: email/password for everyone, with consent recorded at sign-up | Built, tested |
| Google sign-in (dashboard only) | Built, tested with a mocked verifier (needs a Google client ID for real use) |
| Classes, join by class code, per-class roles, roster approve/remove | Built, tested |
| Sessions (start, end, meeting link, grace period), student schedule | Built, tested |
| Presence reporting (idle / active) inside session windows only | Built |
| Live status table (In Class, Online, Idle, Away, Offline) with source labels | Built, tested |
| Google Meet and Zoom web meeting detection (heartbeat-based, matched to the session link) | Built. Tested on a real Google Meet call. **Zoom web has not been tested on a real Zoom page.** |
| Attendance: Present / Late / Absent, Absent becomes Late on a later join | Built, tested on a real Meet call |
| Professor attendance override with an audit log | Built, tested |
| Scheduler: marks Absent when the grace period ends, finalizes at session end | Built, tested |
| Alerts: Absent and Late, on the dashboard and by email (Mailpit in development), with fixed default thresholds | Built, tested on a real session |
| Discord webhook alerts (failure-safe) | Built, tested with a mocked webhook only |
| Student "My data" export (JSON) | Built, tested |
| Student attendance history in the popup ("My attendance") | Built, API tested; not yet tried in a real browser |
| 10-minute class reminder (browser notification from the extension) | Built, reminder timing unit-tested; not yet seen live |
| Demo seed script | Built |

**Automated tests:** 123 backend tests were passing at the last full run. Tests were added afterwards for the student attendance view and the reminder timing. Run `npm.cmd run test -w backend` for the current count.

## What is not built (future work)

CSV attendance import, charts and reports, the per-session summary email, configurable alert thresholds (there is no alert settings screen, so the Absent and Late alerts use fixed defaults), the idle / repeated-absence / left-early alert rules, a browser notification on the dashboard, editing or deleting a session in the dashboard, a mobile app, Firefox/Safari support, and LMS integration. Platform API cross-checks (Zoom Reports, Meet REST) are documented in the design only. Teams is deliberately out of scope.

## Privacy by design

- Consent is required to register and to join a class, and is stored with a timestamp.
- The extension reports only inside scheduled session windows. Outside them it shows "Not in session" and sends nothing.
- Collected: idle/active/locked state and meeting join/leave events. **Not** collected: page content, browsing history, other tabs, camera, microphone, keystrokes, screenshots.
- Meeting events that do not match a scheduled session's link are dropped on the device.
- Extension permissions are minimal: `idle`, `alarms`, `storage`, `notifications`, plus host access to Zoom web, Google Meet and the API.
- Students can download their own data from the extension popup ("My data") and see their own attendance history there.
- Roles are per class. A professor in one class has no power in another, and a student never sees the class code.

See `docs/privacy-review.md` for the checklist.

---

## Requirements

- Windows with PowerShell (commands below use `npm.cmd` because PowerShell may block `npm.ps1`)
- Node.js 20 or newer
- Docker Desktop (runs PostgreSQL and Mailpit)
- Chrome or Edge on a desktop computer

## Setup (first time)

```powershell
cd C:\Users\vj\Documents\SIA\Activity2\NotifEye
npm.cmd install
Copy-Item .env.example .env      # then review the values in .env
docker compose up -d             # PostgreSQL + Mailpit
npm.cmd run migrate              # create the tables
npm.cmd run seed                 # demo accounts, prints the logins
npm.cmd run build -w extension   # builds extension\dist
```

Never commit `.env`. Only `.env.example` is tracked.

## Run (every session)

1. Start **Docker Desktop** and wait for "Engine running".
2. Double-click **`start-notifeye.bat`**. It starts the database, the backend and the dashboard in two windows. Keep both windows open.
3. Check the backend: <http://127.0.0.1:4000/health> shows `{"status":"ok","db":"up"}`.
4. Open the dashboard: <http://localhost:5173>.
5. Email in development is caught by Mailpit: <http://localhost:8025>.

Or run the parts by hand:

```powershell
docker compose up -d
npm.cmd run dev:backend          # window 1
npm.cmd run dev -w dashboard     # window 2
```

## Install the extension (unpacked)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `extension\dist` folder (not `extension`).
3. After any rebuild, click the reload icon on the NotifEye card.

To simulate two students on one computer, use a separate Chrome profile for each student, load the extension in each, and sign in with a different student account.

## Demo accounts (seed script, fake data only)

| Role | Email | Password |
|---|---|---|
| Professor | demo-prof@notifeye.local | demo-prof-password-123 |
| Student 1 | demo-student1@notifeye.local | demo-student1-password-123 |
| Student 2 | demo-student2@notifeye.local | demo-student2-password-123 |
| Student 3 | demo-student3@notifeye.local | demo-student3-password-123 |

The seed script creates a "Demo Class" on Google Meet with all three students approved and one session. Its meeting link is a placeholder, so to test real detection create a new session in the dashboard with a real Meet link (see `docs/DEMO_SCRIPT.md`). The script is safe to run more than once.

## Useful commands

| Command | What it does |
|---|---|
| `npm.cmd run test -w backend` | Runs the backend tests (Docker must be running) |
| `npm.cmd run typecheck` | Type-checks every workspace |
| `npm.cmd run db:check` | Verifies the database schema |
| `npm.cmd run build -w extension` | Development build of the extension (allows `http://localhost:4000`) |
| `npm.cmd run build -w dashboard` | Production build of the dashboard |

The production build of the extension is HTTPS-only. See `extension/package.json` for the production build script.

## Project layout

```
backend/     Express API, scheduler, alerts, tests, migrations, seed script
dashboard/   React + Vite + Tailwind professor dashboard
extension/   Manifest V3 extension (popup, service worker, content script)
shared/      Types and pure functions shared by all workspaces
docs/        Design document, implementation plan, privacy review, demo script
```

## Limits to know about

- The extension only sees meetings opened in the **browser** (Zoom or Meet web). The desktop apps and phones are not detected, so the professor can override any record.
- Everything runs locally for the demo. For other people's computers to reach the backend, it would have to be hosted over HTTPS.
- Meeting page URLs change over time. The patterns are in `extension/src/config/platforms.ts`.
- Sessions cannot be edited or deleted in the dashboard yet.
- The development servers only run while their windows are open.

## Documents

- `docs/NotifEye_Design.md`: full product scope and system design
- `docs/NotifEye_Extension_Product_Scope_and_Design_AsBuilt.pdf`: the design document with an as-built appendix (status, verification, differences from the design)
- `docs/implementation_plan.md`: build plan, decisions, and deviations from the design
- `docs/privacy-review.md`: privacy checklist
- `docs/DEMO_SCRIPT.md`: step-by-step demo
