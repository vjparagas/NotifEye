import React, { useEffect, useState } from 'react';
import type { MyClassDTO, StudentScheduleItemDTO, UserDTO } from '@notifeye/shared';
import { extensionApi, ExtensionApiError } from './api';
import { getStoredAuth, setStoredAuth } from './storage';

export function App() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserDTO | null>(null);
  const [loading, setLoading] = useState(true);

  // Auth form state
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [authConsent, setAuthConsent] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);

  // Classes & Join state
  const [classes, setClasses] = useState<MyClassDTO[]>([]);
  const [classCode, setClassCode] = useState('');
  const [joinConsent, setJoinConsent] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinSuccess, setJoinSuccess] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [activeSession, setActiveSession] = useState<StudentScheduleItemDTO | null>(null);
  const [currentStatus, setCurrentStatus] = useState<string>('not_in_session');

  // Initialize
  useEffect(() => {
    let mounted = true;

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get(['notifeye_active_session', 'notifeye_current_status'], (res) => {
        if (!mounted) return;
        setActiveSession((res.notifeye_active_session as StudentScheduleItemDTO) || null);
        setCurrentStatus((res.notifeye_current_status as string) || 'not_in_session');
      });
      chrome.runtime?.sendMessage?.({ type: 'REFRESH_SCHEDULE' });
    }

    getStoredAuth().then(async ({ token: storedToken, user: storedUser }) => {
      if (!mounted) return;
      if (storedToken && storedUser) {
        setToken(storedToken);
        setUser(storedUser);
        try {
          const res = await extensionApi.myClasses(storedToken);
          if (mounted) setClasses(res.classes);
        } catch (err) {
          if (err instanceof ExtensionApiError && err.status === 401) {
            await setStoredAuth(null, null);
            if (mounted) {
              setToken(null);
              setUser(null);
            }
          }
        }
      }
      if (mounted) setLoading(false);
    });

    return () => {
      mounted = false;
    };
  }, []);


  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthSubmitting(true);

    try {
      const res = await extensionApi.login(email, password);
      if (!res.token) throw new Error('No token returned from server.');
      await setStoredAuth(res.token, res.user);
      setToken(res.token);
      setUser(res.user);

      // Fetch enrolled classes
      const classRes = await extensionApi.myClasses(res.token);
      setClasses(classRes.classes);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    if (!authConsent) {
      setAuthError('You must accept the consent policy to create an account.');
      return;
    }

    setAuthSubmitting(true);
    try {
      const res = await extensionApi.register(email, password, name, authConsent);
      if (!res.token) throw new Error('No token returned from server.');
      await setStoredAuth(res.token, res.user);
      setToken(res.token);
      setUser(res.user);

      const classRes = await extensionApi.myClasses(res.token);
      setClasses(classRes.classes);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await setStoredAuth(null, null);
    setToken(null);
    setUser(null);
    setClasses([]);
    setClassCode('');
    setJoinConsent(false);
    setJoinError(null);
    setJoinSuccess(null);
  };

  const handleJoinClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setJoinError(null);
    setJoinSuccess(null);

    if (!joinConsent) {
      setJoinError('You must accept the consent notice to join this class.');
      return;
    }

    setJoining(true);
    try {
      const res = await extensionApi.joinClass(token, classCode.trim().toUpperCase(), joinConsent);
      setJoinSuccess(`Joined ${res.class.name}! Awaiting professor approval.`);
      setClassCode('');
      setJoinConsent(false);

      // Refresh classes list
      const classRes = await extensionApi.myClasses(token);
      setClasses(classRes.classes);
    } catch (err) {
      if (err instanceof ExtensionApiError && err.status === 404) {
        setJoinError('No class found with this code. Check the code and try again.');
      } else {
        setJoinError(err instanceof Error ? err.message : 'Failed to join class.');
      }
    } finally {
      setJoining(false);
    }
  };

  if (loading) {
    return (
      <main className="popup">
        <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--muted)', fontSize: '12px' }}>
          Loading NotifEye...
        </div>
      </main>
    );
  }

  return (
    <main className="popup">
      {/* Header */}
      <header className="brand">
        <div className="brand-main">
          <span className="logo" aria-hidden="true">
<img src="../icons/icon128.png" alt="" width="44" height="44" />
          </span>
          <div>
            <h1>NotifEye</h1>
            <p className="tagline">Student presence & attendance</p>
          </div>
        </div>

        {user && (
          <button type="button" onClick={handleLogout} className="btn-text" title="Sign out">
            Sign out
          </button>
        )}
      </header>

      {/* Honest Status Card */}
      <section className="card" id="status-card">
        {activeSession ? (
          <>
            <div className="row">
              <span className="dot dot-on" aria-hidden="true" />
              <strong style={{ fontSize: '13px' }}>Monitoring active</strong>
            </div>
            <p className="muted">In session: {activeSession.class_name} ({currentStatus})</p>
          </>
        ) : (
          <>
            <div className="row">
              <span className="dot dot-off" aria-hidden="true" />
              <strong style={{ fontSize: '13px' }}>Monitoring inactive</strong>
            </div>
            <p className="muted">Not in session. Nothing is being sent.</p>
          </>
        )}
      </section>


      {/* Unauthenticated View */}
      {!user ? (
        <section className="card">
          <div className="tabs" style={{ marginBottom: '12px' }}>
            <button
              type="button"
              className={`tab-btn ${tab === 'login' ? 'active' : ''}`}
              onClick={() => { setTab('login'); setAuthError(null); }}
            >
              Sign In
            </button>
            <button
              type="button"
              className={`tab-btn ${tab === 'register' ? 'active' : ''}`}
              onClick={() => { setTab('register'); setAuthError(null); }}
            >
              Register
            </button>
          </div>

          {authError && <div className="error-banner">{authError}</div>}

          {tab === 'login' ? (
            <form onSubmit={handleLogin}>
              <div className="form-group">
                <label className="form-label" htmlFor="popup-email">Email</label>
                <input
                  id="popup-email"
                  type="email"
                  className="input-text"
                  required
                  placeholder="student@institution.edu"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="popup-pass">Password</label>
                <input
                  id="popup-pass"
                  type="password"
                  className="input-text"
                  required
                  placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <button type="submit" disabled={authSubmitting} className="btn-ext" style={{ marginTop: '8px' }}>
                {authSubmitting ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegister}>
              <div className="form-group">
                <label className="form-label" htmlFor="reg-name">Your Full Name</label>
                <input
                  id="reg-name"
                  type="text"
                  className="input-text"
                  required
                  placeholder="e.g. Maria Santos"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="reg-email">Email</label>
                <input
                  id="reg-email"
                  type="email"
                  className="input-text"
                  required
                  placeholder="student@institution.edu"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="reg-pass">Password</label>
                <input
                  id="reg-pass"
                  type="password"
                  className="input-text"
                  required
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <div className="consent-box">
                <label className="consent-label">
                  <input
                    type="checkbox"
                    id="reg-consent"
                    checked={authConsent}
                    onChange={(e) => setAuthConsent(e.target.checked)}
                    style={{ marginTop: '2px' }}
                  />
                  <span>
                    <strong>Consent:</strong> I consent to NotifEye collecting presence (idle/active) and Zoom / Google Meet meeting join/leave events solely during scheduled class sessions.
                  </span>
                </label>
              </div>

              <button type="submit" disabled={authSubmitting} className="btn-ext">
                {authSubmitting ? 'Creating account...' : 'Create Student Account'}
              </button>
            </form>
          )}
        </section>
      ) : (
        /* Authenticated View */
        <>
          {/* User profile bar */}
          <div className="space-between" style={{ padding: '0 4px', fontSize: '11px', color: 'var(--muted)' }}>
            <span>Signed in as <strong style={{ color: 'var(--text)' }}>{user.name}</strong></span>
            <span>{user.email}</span>
          </div>

          {/* Join class card */}
          <section className="card">
            <strong style={{ fontSize: '12px', display: 'block', marginBottom: '8px' }}>Join a Class</strong>

            {joinError && <div className="error-banner">{joinError}</div>}
            {joinSuccess && <div className="success-banner">{joinSuccess}</div>}

            <form onSubmit={handleJoinClass}>
              <div className="form-group">
                <input
                  type="text"
                  className="input-text input-code"
                  maxLength={12}
                  required
                  placeholder="CLASS CODE"
                  value={classCode}
                  onChange={(e) => setClassCode(e.target.value)}
                />
              </div>

              <div className="consent-box">
                <label className="consent-label">
                  <input
                    type="checkbox"
                    id="join-consent"
                    checked={joinConsent}
                    onChange={(e) => setJoinConsent(e.target.checked)}
                    style={{ marginTop: '2px' }}
                  />
                  <span>
                    I consent to attendance monitoring for this class during scheduled sessions.
                  </span>
                </label>
              </div>

              <button type="submit" disabled={joining || !classCode.trim()} className="btn-ext">
                {joining ? 'Joining...' : 'Join with Code'}
              </button>
            </form>
          </section>

          {/* Enrolled classes */}
          <section className="card">
            <strong style={{ fontSize: '12px', display: 'block', marginBottom: '6px' }}>Enrolled Classes</strong>
            {classes.length === 0 ? (
              <p className="muted small">No enrolled classes. Enter your class code above.</p>
            ) : (
              <div>
                {classes.map((c) => (
                  <div key={c.id} className="class-item">
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 600 }}>{c.name}</div>
                      <div className="muted small" style={{ margin: 0 }}>
                        {c.platform === 'zoom' ? 'Zoom Web' : 'Google Meet'}
                        {c.section ? ` Â· Sec: ${c.section}` : ''}
                      </div>
                    </div>
                    <span
                      className={`chip ${
                        c.status === 'approved' ? 'chip-ok' : c.status === 'pending' ? 'chip-warn' : 'chip-off'
                      }`}
                    >
                      {c.status === 'approved' ? 'Enrolled' : c.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <footer className="muted small" style={{ textAlign: 'center', marginTop: '4px' }}>
        v0.2 Â· Phase 2 verified
      </footer>
    </main>
  );
}
