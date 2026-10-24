# NotifEye

**A browser extension and web dashboard that monitor the status of online students and notify their professors**

Product Scope, System Structure and Integration Design
Systems Integration Architecture | Project Planning Document

---

## Contents

| No. | Section |
|---|---|
| 1 | Project overview |
| 2 | Product scope (in scope and out of scope) |
| 3 | Class structure and user roles |
| 4 | Features and functional requirements |
| 5 | How student status reaches the professor |
| 6 | Browser extension design |
| 7 | System integration design |
| 8 | System architecture |
| 9 | Data model and API |
| 10 | Technology stack and platform choice |
| 11 | Security, privacy and ethics |
| 12 | Feasibility assessment and risks |
| 13 | Implementation timeline |
| 14 | Testing and demo plan |
| 15 | Future work |

---

## 1. Project overview

**Problem.** In online classes, professors cannot easily tell which students are present, active, or leaving early. The signals are scattered across meeting platforms (Zoom and Google Meet), and checking each one by hand is slow.

**Solution.** NotifEye has two parts that talk to one backend. Students install a browser extension (Chrome or Edge) that detects when they are active and when they join a class meeting. Professors use a web dashboard organized into classes, similar to Google Classroom. A professor creates a class, students join with a class code, and the dashboard shows each student's live status and attendance. When something needs attention, such as a student being absent, the professor is notified automatically.

### Objectives

- Show the live status of every student in a class (In Class, Online, Idle, Away, Offline).
- Record attendance automatically when students join Zoom or Google Meet in the browser.
- Notify professors (and remind students) through the dashboard, email, chat and browser notifications.
- Demonstrate a clean system integration design: extension client, REST API, connectors, a common event format, and rule-based processing.
- Protect student privacy by collecting only consented, minimal data, and only during class sessions.

### Target users

| User | Uses | What they need |
|---|---|---|
| Professor | Web dashboard | Create classes, schedule sessions, see live student status, review attendance, receive alerts. |
| Student | Browser extension | Join classes by code, see own status and attendance, receive class reminders. |
| Administrator (seeded account) | Web dashboard | Manage users and review system health. Kept minimal in the first version. |

---

## 2. Product scope

> **Scope statement.** NotifEye is a student browser extension plus a professor web dashboard. Professors create classes and sessions, students join by code, and the extension reports browser activity state and Zoom or Google Meet meeting join and leave events during scheduled sessions. The backend turns these into live status and attendance, and sends alerts when simple rules are triggered.

### In scope (what will be built)

| Area | Included |
|---|---|
| Accounts | Sign up and login (email and password, plus Google sign-in), consent screen on first use |
| Classes (web) | Create class, class code, roster, per-class roles, session schedule, meeting link and platform |
| Join class (extension) | Student signs in through the popup and enters the class code |
| Presence (extension) | Active / Idle / Away reported through the browser idle API, during class sessions only |
| Meeting detection (extension) | Detects Zoom and Google Meet web meetings by URL and reports join and leave events |
| Attendance | Present / Late / Absent per session with a grace period; professor can override; CSV import fallback |
| Alerts | Alert rules (see Section 4), delivered by dashboard, email, browser notification and one chat webhook |
| Professor dashboard | Live class table, per-student page, attendance reports, 1 to 2 simple charts, CSV export |
| Privacy | Consent, limited permissions, students can see their own data |

### Out of scope (documented as future work)

- Native mobile app and SMS notifications. Mobile browsers generally cannot run these desktop extensions, so students must use a desktop or laptop browser.
- Zoom or Meet desktop apps (the extension can only see meetings joined in the browser).
- Camera, microphone, keystroke, screenshot or browsing-history monitoring.
- Firefox and Safari versions (Chrome and Edge first).
- Guardian or parent portal, AI or predictive risk scoring, LMS integration.
- Message brokers such as Kafka or RabbitMQ (not needed at class scale).

Listing these on purpose shows deliberate scope decisions and keeps the project achievable.

---

## 3. Class structure and user roles

NotifEye is organized around classes. The roster, schedule, meetings, status and alerts all belong to a class, which is how the system knows exactly which professor and which students are connected. Because every student is signed in to the extension with their own account, NotifEye knows **who** joined a meeting without having to guess from meeting display names.

### How a class works

| Step | Where | Action | Result |
|---|---|---|---|
| 1 | Dashboard | Professor creates a class (name, section) and chooses the meeting platform | Class created with a unique class code |
| 2 | Dashboard | Professor adds sessions (date, time, meeting link, grace period) | Schedule is stored for attendance tracking |
| 3 | Outside the app | Professor shares the class code | Students can find the class |
| 4 | Extension | Student installs the extension, signs in, accepts consent, enters the code | Student added to the roster (optionally after approval) |
| 5 | Extension | Extension downloads the student's session schedule | Monitoring is active only around those sessions |

### Per-class roles

Roles are stored on the **enrollment**, so the same account can be a professor in one class and a student in another. Professor features live on the web dashboard, and student features live in the extension.

| Permission | Professor (class owner) | Student |
|---|---|---|
| See all students' status and attendance | Yes | No |
| See own status and attendance | Yes | Yes (popup) |
| Edit class settings, schedule, alert rules | Yes | No |
| Approve or remove students | Yes | No |
| Override attendance, import CSV | Yes | No |
| Receive alerts about students | Yes | No |
| Receive class reminders | Optional | Yes |

---

## 4. Features and functional requirements

Priority key: **Must** = required for the demo, **Should** = build if time allows.

| ID | Feature | Description | Priority |
|---|---|---|---|
| F1 | Authentication | Email/password and Google OAuth. JWT sessions for the dashboard and the extension. | Must |
| F2 | Class management | Create class, generate code, roster, per-class roles (dashboard). | Must |
| F3 | Join class | Enter class code in the extension popup, consent screen. | Must |
| F4 | Session scheduling | Date, time, meeting link, platform and grace period per session. | Must |
| F5 | Presence reporting | Extension reports Active, Idle or Away during sessions. | Must |
| F6 | Meeting detection | Detect Zoom and Meet web meetings matching the session link; report join and leave. | Must |
| F7 | Attendance | Present / Late / Absent using join time and grace period. | Must |
| F8 | Alert rules | Configurable thresholds for the rules below. | Must |
| F9 | Notifications | Dashboard list, email, browser notification, one chat webhook. | Must |
| F10 | Professor dashboard | Live class table with status colors, filters, last seen. | Must |
| F11 | Student popup | Current class, own status, own attendance history, reminders. | Must |
| F12 | Attendance override and CSV import | Professor corrects records or imports a platform report. | Should |
| F13 | Reports | Per-session summary, CSV export, charts. | Should |
| F14 | Summary email | Per-session summary to the professor. | Should |
| F15 | Platform API cross-check | Optional verification against one platform's attendance report. | Should |
| F16 | Privacy controls | Consent record, visible monitoring indicator, student data view. | Must |

### Alert rules (version 1)

| Rule | Trigger | Sent to | Channel |
|---|---|---|---|
| Absent | No meeting join recorded within the grace period after session start | Professor | Email, dashboard, chat |
| Late arrival | Joined after the grace period | Professor (summary) | Dashboard, summary email |
| Idle during class | Student is in the meeting tab but idle for X minutes (default 10) | Professor | Dashboard flag, summary |
| Repeated absence | Absent in N sessions (default 3) | Professor | Email, dashboard |
| Left early (Should) | Left the meeting more than X minutes before session end | Professor (summary) | Dashboard, summary email |
| Class reminder | Session starts in 10 minutes | Student | Browser notification, optional email |

---

## 5. How student status reaches the professor

```
Step 1: Detect   ->  Step 2: Report   ->  Step 3: Compute   ->  Step 4: Evaluate  ->  Step 5: Deliver
idle state,          batched events       status +              alert rules          dashboard,
meeting tab          to REST API          attendance                                 email, chat
```

| Step | What happens | Details |
|---|---|---|
| 1. Detect | The extension observes two things on the student's device | Browser idle state (active, idle, locked), and whether a tab is open on the session's Zoom or Meet meeting link. |
| 2. Report | The service worker sends small events to the REST API | About once a minute, batched, only inside the session window. Example: `user_id, class_id, session_id, type (presence, meeting_joined, meeting_left), state, timestamp`. |
| 3. Compute | The backend calculates status and attendance | Status rules in the table below. Attendance compares the first join time with the session start plus grace period. |
| 4. Evaluate | The alert engine checks rules | Runs every minute during sessions and once when a session ends. |
| 5. Deliver | The professor is informed through two paths | (a) The dashboard refreshes every 15 to 30 s with a live class table. (b) Notifications by dashboard list, email and chat webhook. |

### Status rules

| Status | Condition (during a session window) | Color |
|---|---|---|
| In Class | A tab is open on the session's meeting link on the matching platform (overrides the statuses below) | Blue |
| Online | Browser reports active and the extension has reported within the last 3 minutes | Green |
| Idle | No keyboard or mouse input for the idle threshold (default 5 minutes) | Amber |
| Away | Screen is locked | Orange |
| Offline | No report for more than 3 minutes (browser closed, extension disabled, or no internet) | Grey |
| Not in session | Outside the session window. Nothing is reported or shown as live | Light grey |
| Absent (session result) | Grace period passed and no meeting join was recorded | Red |

> **Important:** the idle state reflects keyboard and mouse activity on the whole computer, and an open meeting tab does not prove the student is paying attention. The dashboard labels each status with its source so the professor can interpret it correctly, and can override attendance.

### Example walk-through

- **8:50 AM:** Maria's extension shows a reminder that SIA101 starts in 10 minutes.
- **9:00 AM:** The session starts. Maria opens the Google Meet link at 9:03. The extension matches the URL to the session and reports a join, so she is In Class and Present.
- **9:10 AM:** The grace period ends and Juan has not joined. He is marked Absent, and the professor gets an email and dashboard alert.
- **9:12 AM:** Juan joins late. His record changes to Late and the dashboard updates on its next refresh.
- **10:00 AM:** The session ends and the professor receives a summary of present, late and absent students.

---

## 6. Browser extension design

The extension is the student-side client. It is built as a Chromium extension using Manifest V3, so it runs on both Chrome and Edge.

```
                    NotifEye backend (REST API)
                              ^
                              | HTTPS, batched events
+---------------------- STUDENT'S BROWSER (CHROME / EDGE) ----------------------+
|  Content script          Service worker                  Popup UI              |
|  runs only on Zoom       idle state, schedule,           login, join class,    |
|  and Meet web            batching, API calls             status, reminders     |
|                                                                                |
|  Browser APIs used: idle | alarms | storage | notifications | identity (opt.)  |
+--------------------------------------------------------------------------------+
```

| Part | Role |
|---|---|
| Popup UI | Login, enter class code, view the current class, own status, own attendance history and a visible 'monitoring active' indicator. |
| Service worker (background) | Holds the schedule, reads the idle state, runs periodic reports, queues events when offline, sends batches to the API, shows reminders. |
| Content script | Injected only on the Zoom and Meet web domains. Reports whether a meeting page is open or closed. Never reads page content. |

### Meeting detection

| Platform | Web client the extension watches | Join and leave signal |
|---|---|---|
| Zoom | Zoom web client (join from browser) | Meeting page opens or closes |
| Google Meet | meet.google.com meeting page | Meeting page opens or closes |

Exact URL patterns differ by platform and change over time, so confirm them during development and keep them in a configuration file that is easy to update. The extension compares the page's meeting link or ID to the link the professor entered for the session. If it does not match, the event is discarded on the device and never sent.

### Manifest V3 design notes

- **Service workers sleep.** Use `chrome.alarms` for the periodic report, not long timers, and store state in `chrome.storage`.
- **Offline queue.** If the API is unreachable, keep events in storage and send them when back online, with their original timestamps.
- **Minimal permissions.** Request idle, alarms, storage and notifications, plus host access only for the two meeting domains and the NotifEye API. Do not request all-sites access or tab history.
- **Sign-in.** Email and password in the popup, or Google sign-in through the identity API. The token is stored in extension storage.
- **Distribution.** Load the unpacked extension in developer mode for development and the demo. Publishing to the Chrome Web Store is optional, requires a developer account (a small one-time fee) and a review, so verify the current process before planning on it.

Check the current Chrome extension documentation for exact API behavior and limits before building.

---

## 7. System integration design

NotifEye integrates the student's browser, the meeting platforms, identity, and notification services through one backend. Each external source is handled by a **connector** that converts its data into the same event format.

### Meeting platform integration

| Platform | Primary method (built) | Optional production path |
|---|---|---|
| Zoom | Extension detects the web client meeting page | Zoom webhooks and Reports API to confirm attendance |
| Google Meet | Extension detects the meeting page | Google Meet REST API for participant records |

Because the primary method works in the browser, neither platform needs developer or admin access to demo. The platform APIs are documented as the production path and, if time allows, one is implemented as a cross-check. API requirements and account types change, so confirm them in each platform's current developer documentation.

### Other integrations

| System | Purpose | Method |
|---|---|---|
| Google OAuth 2.0 | Sign-in for dashboard and extension | OAuth 2.0 |
| Email service (SendGrid free tier or Gmail SMTP) | Alerts, reminders, summaries | REST API or SMTP |
| Discord or Telegram | Chat alerts to the professor | Incoming webhook (one HTTP POST) |
| Browser notifications | Reminders to students | Extension notifications API |
| CSV import | Fallback attendance source | File upload on the dashboard |

### Connector pattern (the core integration idea)

Every attendance source, whether the extension, a platform API or a CSV file, produces the same normalized event, so the Attendance and Status services do not care where it came from:

```
{ user_id, class_id, session_id, type: meeting_joined | meeting_left | presence, state,
  timestamp, source: extension | zoom_api | meet_api | csv }
```

If two sources disagree (for example, the extension says joined but the CSV says absent), the dashboard shows the conflict and the professor decides. Professors can always override a record, and the change is logged.

---

## 8. System architecture

The backend is a **modular monolith**: one application split into clear modules. It keeps deployment simple while still showing the integration patterns (REST, OAuth, webhooks, scheduled jobs, notification services).

```
1. INPUTS
   Student extension (idle state + meeting tab) | Google OAuth (sign-in)
   Platform APIs (optional cross-check)         | CSV import (attendance fallback)
                                  |
2. INTEGRATION LAYER
   REST API + Connector Layer: authenticates, validates and normalizes
   everything into one event format
                                  |
3. BACKEND MODULES
   Class Service        Status Service        Attendance Service     Rules & Alert Engine
   classes, roster,     Online / Idle /       Present / Late /       triggers
   roles                In Class              Absent                 notifications
                                  |
4. DATA STORE
   PostgreSQL database + in-memory cache for live status
                                  |
5. DELIVERY
   Professor dashboard | Student popup | Email | Discord / Telegram | Browser alerts
```

Professors use the web dashboard; students use the extension. Both go through the same REST API with per-class access control.

| Component | Responsibility |
|---|---|
| Student extension | Detects idle state and meeting pages, reports events, shows the student's own status and reminders. |
| Professor web dashboard | Class and session management, live status table, attendance reports, alert settings. |
| REST API and Connector Layer | Authenticates users, validates input, receives extension events, platform webhooks and CSV files, and normalizes them. |
| Class Service | Classes, class codes, roster, per-class roles, sessions and schedules. |
| Status Service | Computes In Class / Online / Idle / Away / Offline from reported events. |
| Attendance Service | Calculates Present / Late / Absent using session time and grace period, and stores overrides. |
| Rules and Alert Engine | Checks alert rules, creates alert records, and sends them through email, chat and browser notification. |
| Scheduler | Runs periodic jobs: status recalculation, absent checks, reminders and summaries. |

> **Why not microservices or a message broker?** At class-project scale they add operational work without adding value. The modules are separated by interface, so they could be split out later.

---

## 9. Data model and API

### Core tables

| Table | Key fields | Purpose |
|---|---|---|
| users | id, name, email, auth_provider, consent_at | Accounts and consent record |
| classes | id, name, section, class_code, owner_id, platform | A class and its professor |
| enrollments | id, class_id, user_id, role (professor/student), status | Roster and per-class roles |
| class_sessions | id, class_id, starts_at, ends_at, grace_minutes, meeting_link | Scheduled meetings |
| attendance_records | id, session_id, user_id, joined_at, left_at, status, source, overridden_by | Present / Late / Absent |
| activity_events | id, user_id, session_id, type, state, timestamp, source | Presence and meeting events |
| extension_installs | id, user_id, version, last_seen_at | Which extension instances are reporting |
| alerts | id, class_id, user_id, rule, channel, sent_at, read_at | Generated notifications |
| alert_rules | id, class_id, rule, threshold, enabled | Per-class alert settings |
| import_aliases | id, class_id, csv_name, user_id | Name-to-student mapping for CSV imports only |

Live status is kept in the cache (or computed from the latest event) so the dashboard does not scan the full event log.

### Main API endpoints

| Method and path | Used by | Purpose |
|---|---|---|
| POST /auth/login, /auth/google | Both | Log in |
| POST /classes | Dashboard | Create a class |
| POST /classes/join | Extension | Join using class code |
| GET /me/schedule | Extension | Download the student's upcoming sessions |
| POST /events | Extension | Send batched presence and meeting events |
| GET /classes/:id/status | Dashboard | Live status of all students |
| POST /classes/:id/sessions | Dashboard | Create a session |
| GET /sessions/:id/attendance | Dashboard | Attendance for a session |
| PATCH /attendance/:id | Dashboard | Professor override (logged) |
| POST /sessions/:id/attendance/import | Dashboard | Upload a platform CSV |
| GET /me/data | Extension | Student views or exports their own data |
| GET /alerts | Both | List notifications |

---

## 10. Technology stack and platform choice

### Platform comparison

| Option | Verdict | Reason |
|---|---|---|
| Browser extension (students) | Chosen | Detects idle state and meeting pages directly, needs no meeting-platform admin access, can show reminders natively. |
| Web dashboard (professors) | Chosen | Best for tables, charts and class management. No installation for professors. |
| Mobile app | Future work | Better push notifications, but a second platform. Extensions generally do not run on mobile browsers. |
| Desktop app | Not recommended | Invasive, hard to deploy, ethical concerns. |

### Recommended stack

| Layer | Choice | Alternative |
|---|---|---|
| Extension | Manifest V3, JavaScript or TypeScript, popup in plain HTML or React | Vite build tooling |
| Professor dashboard | React with Bootstrap or Tailwind | Plain HTML/JS |
| Backend | Node.js with Express | Python with FastAPI |
| Database | PostgreSQL | MySQL or SQLite |
| Live updates | Dashboard polling every 15 to 30 s | WebSockets (optional) |
| Scheduler | node-cron | APScheduler (Python) |
| Auth | JWT sessions, Google OAuth 2.0 | - |
| Email and chat | SendGrid free tier or Gmail SMTP; Discord webhook | Telegram bot |
| Deployment | Docker Compose locally; Render or Railway for a public demo (the extension needs an HTTPS API address) | - |

---

## 11. Security, privacy and ethics

An extension runs on the student's own device, so privacy needs to be stricter than for a normal web app. NotifEye is designed to be transparent and minimal.

| Area | Measure |
|---|---|
| Consent | Clear consent notice at sign-in and when joining a class, explaining what is collected. Consent is stored with a timestamp. |
| Limited monitoring window | The extension reports only during scheduled session windows. Outside them it shows 'Not in session' and sends nothing. |
| Data minimization | Only idle state and meeting join and leave events. No page content, browsing history, other tabs, camera, microphone, keystrokes or screenshots. |
| Limited permissions | Host access only to Zoom, Meet and the NotifEye API. Meeting events that do not match a scheduled session are discarded on the device. |
| Transparency | A visible 'monitoring active' indicator in the popup. Students can view and export their own data. |
| Access control | Role-based access per class. Professors see only their own classes. |
| Security | Hashed passwords, JWT with expiry, HTTPS only, secrets in environment variables, logged professor overrides. |
| Retention | Event logs older than the term (for example, 180 days) are deleted or anonymized. |
| Legal | Aligned with Philippine Data Privacy Act of 2012 principles (transparency, legitimate purpose, proportionality), plus FERPA and GDPR where applicable. Confirm institutional requirements with your school. |

---

## 12. Feasibility assessment and risks

### Feasibility summary

| Dimension | Assessment |
|---|---|
| Technical | High. Browser extensions use standard web technologies, and URL-based meeting detection avoids the need for platform API access. |
| Schedule | Realistic for 8 weeks with a team of 3 to 4. The extension and the dashboard share one backend, so work can be split between members. |
| Cost | Free for development and demo. Load the extension unpacked; hosting, email, OAuth and webhooks have free tiers. |
| Operational | One backend deployment plus a sideloaded extension. Demo can run locally with Docker. |
| Legal and ethical | Addressed through consent, limited monitoring window and minimal permissions. |

### Risks and mitigation

| Risk | Impact | Mitigation |
|---|---|---|
| Student uses the Zoom desktop app | Meeting join is not detected | Require the web client for class, allow professor override and CSV import |
| Student uses a phone or unsupported browser | No data from that student | State the supported setup (Chrome or Edge on desktop); professor override |
| Platform changes its meeting URL or page | Detection stops working | Keep URL patterns in a config file; test each platform before the demo |
| Meeting tab is open but student is not attending | False Present | Combine with idle state; show source labels; professor override; optional API cross-check |
| Extension disabled or browser closed | Student appears Offline | Offline is shown as such, not as Absent, if the meeting was joined; professor can review |
| Service worker goes to sleep | Missed reports | Use chrome.alarms and an offline event queue |
| Students feel monitored | Low adoption | Session-only monitoring, visible indicator, minimal permissions, student data view |
| Store review or fee | Cannot publish | Demo with the unpacked extension; publishing is optional |
| Scope creep | Missed deadline | Strict Must / Should list and a future work list |

---

## 13. Implementation timeline

| Week | Deliverable | Done when |
|---|---|---|
| 1 | Requirements, architecture diagram, data model, repository, extension skeleton (Manifest V3) | Documents approved; empty extension loads in Chrome |
| 2 | Backend auth, class creation and join by code; dashboard shell | Professor creates a class; student joins from the extension |
| 3 | Sessions, schedule download, idle-state reporting, live status table | Dashboard status changes when the student is active or idle |
| 4 | Meeting detection for Zoom and Meet web clients; attendance calculation | Opening a meeting link records a join and Present or Late |
| 5 | Rules engine, email, chat and browser notifications; CSV import and overrides | Absent and idle alerts delivered |
| 6 | Dashboard polish, reports, charts, consent screens, student popup data view | Reports export; consent recorded |
| 7 | Testing on both platforms, offline queue, edge cases, privacy review | Test cases pass; no blocking bugs |
| 8 | Documentation, demo rehearsal, optional store packaging | Demo runs end to end |

---

## 14. Testing and demo plan

### Test cases

| Test | Expected result |
|---|---|
| Student joins class with a valid code in the extension | Added to roster; invalid code is rejected |
| Student is active, then stops input | Online, then Idle after the threshold (shortened in demo mode) |
| Student locks the screen | Away |
| Student closes the browser during a session | Offline after 3 minutes without reports |
| Student opens the session's meeting link before the grace period ends | In Class; attendance Present |
| Student opens it after the grace period | Attendance Late |
| Student never joins | Absent; professor alert sent |
| Student opens an unrelated meeting or website | Nothing is sent to the server |
| Outside a session window | Extension shows 'Not in session' and sends nothing |
| Test on Zoom and Meet web clients | Join and leave detected on each |
| Student tries to open another class's data | Access denied |
| Network drops, then returns | Queued events are sent with original timestamps |
| CSV import and professor override | Records update and the change is logged |

### Demo script (5 to 7 minutes)

- Professor creates a class and a session on the dashboard and shares the code.
- Two students install the unpacked extension in separate browser profiles, sign in and join with the code. Show the consent screen and monitoring indicator.
- Session starts. One student opens the meeting link, and the dashboard shows In Class and Present. The other goes idle and the status changes.
- A third student never joins. The absent alert arrives by email and chat.
- Show the professor override and CSV import, then present the architecture diagram, pointing out each integration, and the privacy design.

---

## 15. Future work

- Platform API cross-checks for both meeting platforms (Zoom Reports, Meet REST).
- Native mobile app for professors (push alerts) and a way to support students on phones.
- Firefox and Safari extension versions.
- Guardian or parent portal with attendance summaries.
- LMS integration (Moodle, Canvas) for submissions and grades.
- Predictive at-risk scoring based on attendance trends.
- Event streaming with a message broker if the system must scale to many schools.
- Admin console and multi-institution support.

> **Summary.** NotifEye is a class-based system with a student browser extension and a professor web dashboard sharing one backend. The extension detects idle state and both Zoom and Google Meet web meetings during scheduled sessions, the backend turns them into live status and attendance, and professors receive alerts. The scope is deliberately limited so it can be built, tested and demonstrated within one term.
