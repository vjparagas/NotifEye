import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../auth';
import { errorMessage } from '../api';
import { Button, InputField } from '../components/ui';
import { loadGoogleScript } from '../google';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

export function LoginPage() {
  const { user, login, register, googleLogin } = useAuth();
  const navigate = useNavigate();

  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const googleBtnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user) {
      navigate('/classes', { replace: true });
    }
  }, [user, navigate]);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;

    let mounted = true;
    loadGoogleScript().then((ok) => {
      if (!ok || !mounted || !window.google?.accounts?.id || !googleBtnRef.current) return;

      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (res) => {
          try {
            setError(null);
            await googleLogin(res.credential, consent);
            navigate('/classes', { replace: true });
          } catch (err) {
            setError(errorMessage(err));
          }
        },
      });

      window.google.accounts.id.renderButton(googleBtnRef.current, {
        theme: 'filled_black',
        size: 'large',
        shape: 'rectangular',
        width: 320,
      });
    });

    return () => {
      mounted = false;
    };
  }, [consent, googleLogin, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (tab === 'login') {
        await login(email, password);
      } else {
        if (!consent) {
          setError('You must accept the consent notice to create an account.');
          setSubmitting(false);
          return;
        }
        await register(email, password, name, consent);
      }
      navigate('/classes', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md glass p-8 shadow-2xl rounded-2xl relative overflow-hidden">
        {/* Glow backdrop accent */}
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-teal-500/15 rounded-full blur-3xl pointer-events-none" />

        {/* Brand header */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-teal-400 flex items-center justify-center text-slate-950 shadow-lg shadow-indigo-500/25 mb-3">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">NotifEye</h1>
          <p className="text-sm text-slate-400 mt-1">
            Professor web dashboard for class presence & automated attendance
          </p>
        </div>

        {/* Tabs */}
        <div className="flex p-1 bg-slate-900/60 rounded-xl mb-6 border border-indigo-500/10">
          <button
            type="button"
            onClick={() => { setTab('login'); setError(null); }}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              tab === 'login'
                ? 'bg-indigo-500 text-white shadow-md shadow-indigo-500/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => { setTab('register'); setError(null); }}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              tab === 'register'
                ? 'bg-indigo-500 text-white shadow-md shadow-indigo-500/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Create Account
          </button>
        </div>

        {/* Error notice */}
        {error && (
          <div className="mb-5 p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" className="flex-none">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {tab === 'register' && (
            <InputField
              label="Full Name"
              id="name-input"
              type="text"
              required
              placeholder="e.g. Professor Smith"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}

          <InputField
            label="Email Address"
            id="email-input"
            type="email"
            required
            placeholder="you@institution.edu"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <InputField
            label="Password"
            id="password-input"
            type="password"
            required
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {tab === 'register' && (
            <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-xs text-slate-300 space-y-2 mt-1">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  id="consent-checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5 rounded border-indigo-400/30 text-indigo-500 focus:ring-indigo-400"
                />
                <span className="leading-relaxed">
                  I agree to the <strong className="text-white">NotifEye Consent Policy</strong>: NotifEye records presence (idle / active) and meeting join/leave events solely during scheduled class sessions on Zoom and Google Meet. No web history, screen captures, or other tabs are ever monitored.
                </span>
              </label>
            </div>
          )}

          <Button type="submit" disabled={submitting} className="w-full mt-2">
            {submitting ? 'Please wait...' : tab === 'login' ? 'Sign In' : 'Create Account'}
          </Button>
        </form>

        {/* Google sign-in (dashboard only) */}
        {GOOGLE_CLIENT_ID && (
          <div className="mt-6 pt-5 border-t border-indigo-500/15 flex flex-col items-center">
            <span className="text-xs text-slate-400 mb-3 font-medium">Or continue with Google</span>
            <div ref={googleBtnRef} className="flex justify-center w-full" />
          </div>
        )}
      </div>
    </div>
  );
}
