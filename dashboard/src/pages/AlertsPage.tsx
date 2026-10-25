import { useEffect, useState } from 'react';
import type { AlertDTO } from '@notifeye/shared';
import { api, errorMessage } from '../api';
import { AppShell } from '../components/AppShell';
import { Button } from '../components/ui';

export function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | 'unread'>('all');
  const [filterKind, setFilterKind] = useState<'all' | 'absent' | 'late'>('all');
  const [markingAll, setMarkingAll] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);

  const fetchAlerts = async () => {
    try {
      setError(null);
      const res = await api.alerts();
      setAlerts(res.alerts);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 20_000);
    return () => clearInterval(interval);
  }, []);

  const handleMarkRead = async (alertId: string) => {
    try {
      setMarkingId(alertId);
      const res = await api.markAlertRead(alertId);
      setAlerts((prev) =>
        prev.map((a) => (a.id === alertId ? { ...a, read_at: res.alert.read_at } : a)),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setMarkingId(null);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      setMarkingAll(true);
      await api.markAllAlertsRead();
      const nowIso = new Date().toISOString();
      setAlerts((prev) => prev.map((a) => ({ ...a, read_at: a.read_at ?? nowIso })));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setMarkingAll(false);
    }
  };

  const unreadCount = alerts.filter((a) => !a.read_at).length;

  const filteredAlerts = alerts.filter((a) => {
    if (filterStatus === 'unread' && a.read_at) return false;
    if (filterKind !== 'all' && a.kind !== filterKind) return false;
    return true;
  });

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-white tracking-tight">Alerts & Notifications</h1>
              {unreadCount > 0 && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                  {unreadCount} unread
                </span>
              )}
            </div>
            <p className="text-sm text-slate-400 mt-1">
              Automatic alerts dispatched when students miss grace periods or join late.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="border border-indigo-500/30 text-indigo-300 hover:text-white"
                onClick={handleMarkAllRead}
                disabled={markingAll}
              >
                {markingAll ? 'Marking...' : 'Mark all as read'}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={fetchAlerts} title="Refresh">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
              <span className="ml-1.5 hidden sm:inline">Refresh</span>
            </Button>
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm">
            {error}
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <div className="inline-flex rounded-lg bg-slate-900/60 p-1 border border-indigo-500/15">
            <button
              onClick={() => setFilterStatus('all')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                filterStatus === 'all'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              All ({alerts.length})
            </button>
            <button
              onClick={() => setFilterStatus('unread')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                filterStatus === 'unread'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Unread ({unreadCount})
            </button>
          </div>

          <div className="inline-flex rounded-lg bg-slate-900/60 p-1 border border-indigo-500/15">
            <button
              onClick={() => setFilterKind('all')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                filterKind === 'all'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              All Types
            </button>
            <button
              onClick={() => setFilterKind('absent')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                filterKind === 'absent'
                  ? 'bg-rose-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Absent Only
            </button>
            <button
              onClick={() => setFilterKind('late')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                filterKind === 'late'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Late Only
            </button>
          </div>
        </div>

        {/* Alerts List */}
        {loading ? (
          <div className="py-12 flex justify-center text-slate-400">
            <div className="w-8 h-8 rounded-full border-2 border-indigo-500/30 border-t-indigo-500 animate-spin" />
          </div>
        ) : filteredAlerts.length === 0 ? (
          <div className="card py-12 text-center text-slate-400">
            <div className="w-12 h-12 mx-auto rounded-full bg-slate-900 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-3">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </div>
            <p className="text-base font-semibold text-slate-300">No alerts found</p>
            <p className="text-xs text-slate-500 mt-1">
              {filterStatus === 'unread'
                ? 'All caught up! There are no unread alerts.'
                : 'No alerts match your current filter.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredAlerts.map((alert) => {
              const isUnread = !alert.read_at;
              const isAbsent = alert.kind === 'absent';

              return (
                <div
                  key={alert.id}
                  className={`p-4 rounded-xl border transition-all ${
                    isUnread
                      ? 'bg-slate-900/90 border-indigo-500/30 shadow-lg shadow-indigo-950/20'
                      : 'bg-slate-950/50 border-indigo-500/10 opacity-80'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div className="flex items-start gap-3.5">
                      {/* Icon */}
                      <span
                        className={`mt-0.5 w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                          isAbsent
                            ? 'bg-rose-500/15 text-rose-400 border border-rose-500/25'
                            : 'bg-amber-500/15 text-amber-400 border border-amber-500/25'
                        }`}
                      >
                        {isAbsent ? (
                          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="15" y1="9" x2="9" y2="15" />
                            <line x1="9" y1="9" x2="15" y2="15" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <polyline points="12 6 12 12 16 14" />
                          </svg>
                        )}
                      </span>

                      {/* Content */}
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-semibold tracking-wide uppercase ${
                              isAbsent
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            }`}
                          >
                            {alert.kind}
                          </span>

                          {alert.class_name && (
                            <span className="text-xs font-medium px-2 py-0.5 rounded bg-slate-800 text-indigo-300 border border-indigo-500/20">
                              {alert.class_name}
                            </span>
                          )}

                          {isUnread && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-400">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                              Unread
                            </span>
                          )}
                        </div>

                        <p className="text-sm font-medium text-white pt-0.5">{alert.message}</p>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400 pt-1">
                          {alert.student_name && (
                            <span>
                              Student:{' '}
                              <strong className="text-slate-300">{alert.student_name}</strong>
                              {alert.student_email && ` (${alert.student_email})`}
                            </span>
                          )}

                          <span>
                            Time:{' '}
                            <time dateTime={alert.created_at} className="text-slate-300">
                              {new Date(alert.created_at).toLocaleString()}
                            </time>
                          </span>

                          <span className="text-slate-500">
                            Delivered via: {alert.channels_sent.join(', ') || 'dashboard, email'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Action Button */}
                    <div className="flex items-center sm:self-center shrink-0">
                      {isUnread ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="border border-indigo-500/30 text-indigo-300 hover:text-white"
                          onClick={() => handleMarkRead(alert.id)}
                          disabled={markingId === alert.id}
                        >
                          {markingId === alert.id ? 'Marking...' : 'Mark as read'}
                        </Button>
                      ) : (
                        <span className="text-xs text-slate-500 flex items-center gap-1 px-2.5 py-1">
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-teal-400">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          Read
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
