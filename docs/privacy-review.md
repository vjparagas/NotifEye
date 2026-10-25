# NotifEye privacy review

A checklist of what the system collects, what it does not, and how each measure is enforced. The "Evidence" column says how it was verified. Items marked **Not verified** are in the design but have not been checked in this build, so don't claim them as done.

## What is collected

| Data | When | Why |
|---|---|---|
| Name, email, password hash (bcrypt) | At sign-up | Accounts |
| Consent timestamp and version | At sign-up, and per class at join | Proof of consent |
| Idle / active / locked state | Only inside scheduled session windows | Live status |
| Meeting join and leave events (matched to the session link) | Only inside scheduled session windows | Attendance |
| Attendance records and professor override history | Per session | Attendance and accountability |
| Alerts sent to the professor | When a rule triggers | Notifications |

## What is not collected

Page content, browsing history, other tabs, camera, microphone, keystrokes, screenshots, and anything outside a scheduled session.

## Controls

| Control | Evidence |
|---|---|
| Registration is refused without consent, and nothing is stored | Automated test (auth) |
| Joining a class is refused without consent, and nothing is stored | Automated test (classes) |
| Events are rejected if the student has no recorded consent | Automated test (sessions and events) |
| Events are rejected outside the session window | Automated test (sessions and events) |
| Events are rejected if the student is not approved in that class, or if sent for another user | Automated test (sessions and events) |
| The extension sends nothing outside a session and drops events that don't match the session link | Extension logic tests; observed in the popup ("Not in session") |
| Extension permissions are only `idle`, `alarms`, `storage`, `notifications`, plus Zoom web, Google Meet, and the API | Checked in the built `manifest.json` |
| The production extension build is HTTPS-only (no localhost permission) | Build script; dev build adds localhost |
| A student can see and export their own data | Automated test (privacy); "My data" button in the popup |
| A student's attendance history is returned for the signed-in user only (the user ID comes from the session, never from the request) | Automated test (student attendance) |
| The class reminder is created and shown inside the extension from the downloaded schedule, and nothing is sent to the server for it | By design (extension code); not checked live |
| The export never contains the password hash or another user's data | Automated test (privacy) |
| Passwords are stored as bcrypt hashes | Automated test (auth) |
| Expired, wrong-secret, and `alg=none` tokens are rejected | Automated test (auth) |
| The dashboard session cookie is httpOnly; the token is never in the response body; writes are CSRF-protected; CORS uses an allow-list | Automated tests (auth) |
| Auth routes and the class-join route are rate-limited; invalid class codes always return the same 404 | Automated tests (auth, classes) |
| Roles are per class; a professor of one class has no access to another; students never see the class code | Automated tests (access control, classes) |
| Professor overrides are logged in `attendance_audit` and are not overwritten by later events | Automated test (attendance) |
| The Discord webhook URL is returned only to the owning professor and is never written to logs | Automated tests (classes, discord) |
| Secrets live in `.env`, which is not committed (only `.env.example`) | Checked in git history |

## Not verified in this build

- **Automatic deletion of event logs older than the term (design: 180 days).** Confirm whether the retention job exists before stating it.
- **The offline event queue** (keeping events while offline and sending them with their original timestamps).
- **The 10-minute class reminder in a real browser.** Its timing logic is unit-tested.
- **Zoom web detection on a real Zoom page.** Google Meet has been tested on a real call.
- **Compliance with the Philippine Data Privacy Act of 2012, FERPA, or GDPR.** The design follows their principles (transparency, legitimate purpose, proportionality), but it hasn't been reviewed by anyone qualified. Confirm your school's requirements before using real students' data.

## Honest limits

- The idle state reflects keyboard and mouse activity on the whole computer, and an open meeting tab doesn't prove attention. Statuses show their source, and professors can override records.
- Desktop meeting apps and phones are not detected.
- This is a prototype running locally. A real deployment needs hosting over HTTPS, school approval, and a published privacy policy.
