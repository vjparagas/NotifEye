# NotifEye demo script (5 to 7 minutes)

The flow below uses the features that have been tested on real sessions: join detection on Google Meet, Present / Late / Absent attendance, and the absent alert by dashboard and email.

## Before you start (15 minutes ahead)

1. Start **Docker Desktop** and wait for "Engine running".
2. Double-click `start-notifeye.bat`. Keep both windows open.
3. Check <http://127.0.0.1:4000/health> shows `{"status":"ok","db":"up"}`, and that <http://localhost:5173> loads.
4. Open Mailpit at <http://localhost:8025> in its own tab and **delete old messages**.
5. Create a real Meet link: go to meet.google.com, click **New meeting**, then **Create a meeting for later**, and copy the link.
6. Set up **two Chrome profiles** for students:
   - Load the extension in each (`chrome://extensions`, Developer mode, Load unpacked, `extension\dist`).
   - Profile A: sign in as `demo-student1@notifeye.local`.
   - Profile B: sign in as `demo-student2@notifeye.local`.
   - Both are already enrolled and approved in "Demo Class" by the seed script. If a popup says it isn't enrolled, run `npm.cmd run seed` again and reload the extension.
7. In your main profile, sign in to the dashboard as `demo-prof@notifeye.local` and open **Demo Class**.
8. Rebuild and reload the extension (`npm.cmd run build -w extension`), then check the student popup shows a **My attendance** list. To try the class reminder, create a session that starts about 12 minutes from now, reload the extension, and wait: a notification "starts in 10 minutes" should appear. Test it once before the check, because it has only been unit-tested.
9. Do a **full dry run once** before the real check, and record a screen recording of it as a backup.

## The demo

**1. The problem (30 seconds).** "In an online class, a professor can't tell who is present, active, or late without checking each meeting by hand. NotifEye shows it live and alerts the professor automatically."

**2. The professor creates a session (1 minute).**
- Open **Demo Class**, then the **Sessions** tab, and click **Schedule Session**.
- Start: 1 minute ago. End: 1 hour from now. **Grace: 2 minutes.** Paste your real Meet link.
- Point out: "Monitoring is active only inside this window."
- Open a student profile popup and show **Monitoring active**, or **Not in session** before the window starts. Mention the visible indicator and that nothing is sent outside a session.

**3. Student 1 joins (1 to 2 minutes).**
- In Profile A, open the Meet link and join the call. Reload the extension first if the popup still says "Not in session".
- On the dashboard **Live Status** tab, student 1 becomes **In Class** (it refreshes every 20 seconds).
- Open **Attendance**: student 1 is **Present**, with a join time and source `extension`. If more than 2 minutes have passed, it says **Late**, which also shows the grace period working.

**4. Student 2 never joins (2 to 3 minutes).**
- Keep Profile B out of the call.
- After the grace period ends, the scheduler (it runs every minute) marks student 2 **Absent**.
- Show the **Alerts** page and the bell badge: an Absent alert for student 2.
- Switch to Mailpit: the email "[NotifEye Alert] ... ABSENT in Demo Class" addressed to the professor.

**5. Late join and override (1 minute).**
- Have student 2 join the Meet now. Their record changes from **Absent** to **Late**, and a Late alert appears.
- Use the professor **Override** button on a record to show that the professor always has the final say. Mention that overrides are logged.

**6. Privacy (1 minute).**
- In a student popup, show the **My attendance** list (the student's own Present / Late / Absent history), then click **My data** to download the student's own data as JSON, and open it. Point out there is no password hash and no other user's data.
- Say: "Consent is required at sign-up and when joining. The extension collects only idle state and meeting join/leave, only during sessions. It collects no page content, browsing history, camera, microphone or keystrokes."

**7. Close (30 seconds).** Show the architecture diagram from `docs/NotifEye_Design.md`: extension, REST API with connectors, status and attendance services, alert engine, PostgreSQL. Mention what's next: CSV import, reports, mobile, and platform API cross-checks.

## If something goes wrong

| Problem | Fix |
|---|---|
| Dashboard says "Could not reach the server" | The backend window was closed. Run `npm.cmd run dev:backend` again |
| Dashboard page doesn't load | The dashboard window was closed. Run `npm.cmd run dev -w dashboard` |
| Popup says "Not in session" during a live session | Reload the extension in `chrome://extensions`, wait a minute, reopen the popup. Sign out and in again if needed |
| Student is not detected | The student must open the **same Meet link** as the session, in the **same Chrome profile** the extension is signed in on. Refresh the Meet tab (F5) and rejoin |
| No alert or email yet | Wait one more minute, since the scheduler runs once a minute. Check the Alerts page and Mailpit |
| Anything fails live | Show the backup screen recording |

## Things to say honestly if asked

- Alert thresholds are fixed defaults: the Absent and Late alerts work, but there is no settings screen to change thresholds, and the idle and repeated-absence alerts are not built.
- It reports presence and attendance, not attention. An open meeting tab doesn't prove attention, so every status shows its source and the professor can override.
- Zoom web detection is built but has only been tested on Google Meet.
- It currently runs locally. A real deployment would host the backend over HTTPS, and the extension would be published through the Chrome Web Store or Edge Add-ons.
- Student apps on phones or the desktop meeting apps are not detected. The professor can override those records.
