/**
 * Popup shell. Phase 1 only proves the extension loads and the popup renders.
 * Login, class code, consent, status and history arrive in later phases.
 * The "Monitoring" indicator is honest: nothing is monitored yet, so it shows inactive.
 */
export function App() {
  return (
    <main className="popup">
      <header className="brand">
        <span className="logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </span>
        <div>
          <h1>NotifEye</h1>
          <p className="tagline">Class presence, with your consent</p>
        </div>
      </header>

      <section className="card" id="status-card">
        <div className="row">
          <span className="dot dot-off" aria-hidden="true" />
          <strong>Monitoring inactive</strong>
        </div>
        <p className="muted">Not in session. Nothing is being sent.</p>
      </section>

      <footer className="muted small">v0.1 · Phase 1 shell</footer>
    </main>
  );
}
