import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../auth';
import { Button } from './ui';
import { api } from '../api';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const [unreadCount, setUnreadCount] = useState<number>(0);

  useEffect(() => {
    if (!user) return;
    let mounted = true;
    const fetchAlerts = async () => {
      try {
        const { alerts } = await api.alerts();
        if (mounted) {
          setUnreadCount(alerts.filter((a) => !a.read_at).length);
        }
      } catch {
        // ignore errors in background badge polling
      }
    };

    fetchAlerts();
    const interval = setInterval(fetchAlerts, 20_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [user]);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top navigation */}
      <header className="border-b border-indigo-500/15 bg-slate-950/40 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link to="/classes" className="flex items-center gap-3 group">
              <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-teal-400 flex items-center justify-center text-slate-950 shadow-md shadow-indigo-500/20 group-hover:scale-105 transition-transform">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </span>
              <div>
                <span className="font-bold text-base tracking-tight text-white group-hover:text-indigo-300 transition-colors">
                  NotifEye
                </span>
                <span className="hidden sm:inline-block ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/25">
                  Dashboard
                </span>
              </div>
            </Link>

            <nav className="flex items-center gap-1">
              <Link
                to="/classes"
                className="text-sm font-medium px-3 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
              >
                My Classes
              </Link>
              <Link
                to="/alerts"
                className="relative text-sm font-medium px-3 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/5 transition-colors flex items-center gap-1.5"
                title="Alerts"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                <span>Alerts</span>
                {unreadCount > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-rose-500 text-white animate-pulse">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            {user && (
              <div className="hidden sm:flex flex-col items-end">
                <span className="text-sm font-semibold text-white leading-tight">{user.name}</span>
                <span className="text-xs text-slate-400">{user.email}</span>
              </div>
            )}
            <Button variant="ghost" size="sm" onClick={handleLogout} title="Sign out">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main body */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-indigo-500/10 py-6 text-center text-xs text-slate-500">
        <p>NotifEye · Classroom presence & automated attendance for Zoom and Google Meet</p>
      </footer>
    </div>
  );
}
