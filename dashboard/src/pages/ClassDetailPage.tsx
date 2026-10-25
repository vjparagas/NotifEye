import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router';
import type {
  AttendanceRecordDTO,
  AttendanceStatus,
  ClassDetailDTO,
  EnrollmentDTO,
  SessionDTO,
  StudentStatusDTO,
  StudentStatusKind,
} from '@notifeye/shared';
import { api, errorMessage } from '../api';
import { AppShell } from '../components/AppShell';
import { Button, Chip, CopyButton, InputField, Modal, SelectField } from '../components/ui';

export function ClassDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [classDetail, setClassDetail] = useState<ClassDetailDTO | null>(null);
  const [enrollments, setEnrollments] = useState<EnrollmentDTO[]>([]);
  const [sessions, setSessions] = useState<SessionDTO[]>([]);
  const [statuses, setStatuses] = useState<StudentStatusDTO[]>([]);
  const [activeTab, setActiveTab] = useState<'status' | 'sessions' | 'roster'>('status');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Session modal state
  const [isSessionModalOpen, setIsSessionModalOpen] = useState(false);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [meetingLink, setMeetingLink] = useState('');
  const [graceMinutes, setGraceMinutes] = useState(10);
  const [sessionCreating, setSessionCreating] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  // Attendance state (Phase 4)
  const [selectedSession, setSelectedSession] = useState<SessionDTO | null>(null);
  const [attendanceList, setAttendanceList] = useState<AttendanceRecordDTO[]>([]);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceError, setAttendanceError] = useState<string | null>(null);
  const [isAttendanceModalOpen, setIsAttendanceModalOpen] = useState(false);

  // Attendance override state
  const [isOverrideModalOpen, setIsOverrideModalOpen] = useState(false);
  const [overrideRecord, setOverrideRecord] = useState<AttendanceRecordDTO | null>(null);
  const [overrideStatus, setOverrideStatus] = useState<AttendanceStatus>('present');
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideSaving, setOverrideSaving] = useState(false);
  const [overrideError, setOverrideError] = useState<string | null>(null);

  const loadData = async () => {
    if (!id) return;
    try {
      setError(null);
      const detailRes = await api.classDetail(id);
      setClassDetail(detailRes.class);

      const [sessRes, enrollRes] = await Promise.all([
        api.sessions(id),
        detailRes.class.role === 'professor' ? api.enrollments(id) : Promise.resolve({ enrollments: [] }),
      ]);
      setSessions(sessRes.sessions);
      setEnrollments(enrollRes.enrollments);

      if (detailRes.class.role === 'professor') {
        const statRes = await api.status(id);
        setStatuses(statRes.status);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [id]);

  // Live status polling every 20 seconds for professors (per spec)
  useEffect(() => {
    if (!id || classDetail?.role !== 'professor') return;

    const poll = async () => {
      try {
        const statRes = await api.status(id);
        setStatuses(statRes.status);
      } catch {
        // Silent catch on poll
      }
    };

    const timer = setInterval(poll, 20_000);
    return () => clearInterval(timer);
  }, [id, classDetail?.role]);

  const handleUpdateEnrollment = async (enrollmentId: string, status: 'approved' | 'removed') => {
    if (!id) return;
    setProcessingId(enrollmentId);
    setActionError(null);

    try {
      const res = await api.setEnrollmentStatus(id, enrollmentId, status);
      setEnrollments((prev) =>
        prev.map((e) => (e.id === enrollmentId ? res.enrollment : e)),
      );
      // Refresh status table after enrollment changes
      if (classDetail?.role === 'professor') {
        const statRes = await api.status(id);
        setStatuses(statRes.status);
      }
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setProcessingId(null);
    }
  };

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setSessionError(null);
    setSessionCreating(true);

    try {
      const res = await api.createSession(id, {
        starts_at: new Date(startsAt).toISOString(),
        ends_at: new Date(endsAt).toISOString(),
        meeting_link: meetingLink.trim(),
        grace_minutes: Number(graceMinutes),
      });

      setSessions((prev) => [...prev, res.session].sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()));
      setIsSessionModalOpen(false);
      setStartsAt('');
      setEndsAt('');
      setMeetingLink('');
      setGraceMinutes(10);

      // Trigger status refresh
      const statRes = await api.status(id);
      setStatuses(statRes.status);
    } catch (err) {
      setSessionError(errorMessage(err));
    } finally {
      setSessionCreating(false);
    }
  };

  const handleOpenAttendance = async (session: SessionDTO) => {
    setSelectedSession(session);
    setIsAttendanceModalOpen(true);
    setAttendanceLoading(true);
    setAttendanceError(null);
    try {
      const res = await api.sessionAttendance(session.id);
      setAttendanceList(res.attendance);
    } catch (err) {
      setAttendanceError(errorMessage(err));
    } finally {
      setAttendanceLoading(false);
    }
  };

  const handleStartOverride = (rec: AttendanceRecordDTO) => {
    setOverrideRecord(rec);
    setOverrideStatus(rec.status);
    setOverrideReason('');
    setOverrideError(null);
    setIsOverrideModalOpen(true);
  };

  const handleSaveOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!overrideRecord) return;
    setOverrideSaving(true);
    setOverrideError(null);
    try {
      const res = await api.overrideAttendance(overrideRecord.id, {
        status: overrideStatus,
        reason: overrideReason.trim() || undefined,
      });
      setAttendanceList((prev) =>
        prev.map((a) => (a.id === overrideRecord.id ? res.attendance : a)),
      );
      setIsOverrideModalOpen(false);
    } catch (err) {
      setOverrideError(errorMessage(err));
    } finally {
      setOverrideSaving(false);
    }
  };

  if (loading) {
    return (
      <AppShell>
        <div className="py-20 text-center text-slate-400 text-sm flex flex-col items-center justify-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-indigo-500/30 border-t-indigo-500 animate-spin" />
          <span>Loading class details...</span>
        </div>
      </AppShell>
    );
  }

  if (error || !classDetail) {
    return (
      <AppShell>
        <div className="py-12 px-6 glass text-center rounded-2xl max-w-lg mx-auto">
          <h2 className="text-lg font-bold text-rose-400 mb-2">Class Not Found or Inaccessible</h2>
          <p className="text-sm text-slate-400 mb-6">{error ?? 'Unable to retrieve this class.'}</p>
          <Link to="/classes">
            <Button variant="ghost">Back to My Classes</Button>
          </Link>
        </div>
      </AppShell>
    );
  }

  const isProfessor = classDetail.role === 'professor';
  const pendingCount = enrollments.filter((e) => e.status === 'pending').length;

  const statusTone = (kind: StudentStatusKind): 'ok' | 'warn' | 'off' | 'info' => {
    switch (kind) {
      case 'in_class':
        return 'info';
      case 'online':
        return 'ok';
      case 'idle':
      case 'away':
        return 'warn';
      case 'offline':
      case 'not_in_session':
      default:
        return 'off';
    }
  };

  const statusLabel = (kind: StudentStatusKind): string => {
    switch (kind) {
      case 'in_class':
        return 'In Class';
      case 'online':
        return 'Online';
      case 'idle':
        return 'Idle';
      case 'away':
        return 'Away';
      case 'offline':
        return 'Offline';
      case 'not_in_session':
        return 'Not in session';
    }
  };

  const inClassCount = statuses.filter((s) => s.status === 'in_class').length;
  const onlineCount = statuses.filter((s) => s.status === 'online').length;
  const idleCount = statuses.filter((s) => s.status === 'idle' || s.status === 'away').length;
  const offlineCount = statuses.filter((s) => s.status === 'offline').length;

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Link to="/classes" className="hover:text-white transition-colors">
            My Classes
          </Link>
          <span>/</span>
          <span className="text-slate-200 font-medium">{classDetail.name}</span>
        </div>

        {/* Class Header Banner */}
        <div className="glass p-6 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700/60 uppercase tracking-wide">
                {classDetail.platform === 'zoom' ? 'Zoom Web' : 'Google Meet'}
              </span>
              <Chip tone={isProfessor ? 'info' : 'ok'}>{classDetail.role}</Chip>
              {pendingCount > 0 && isProfessor && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-medium">
                  {pendingCount} pending approval
                </span>
              )}
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">{classDetail.name}</h1>
            {classDetail.section && (
              <p className="text-sm text-slate-400 mt-1">Section: {classDetail.section}</p>
            )}
          </div>

          {/* Class Code Widget */}
          {classDetail.class_code && (
            <div className="glass p-4 rounded-xl border border-indigo-500/30 bg-indigo-950/20 flex flex-col sm:flex-row items-start sm:items-center gap-3 self-start md:self-auto">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-indigo-300/80 block">
                  Student Join Code
                </span>
                <span className="text-xl font-mono font-bold tracking-widest text-indigo-200">
                  {classDetail.class_code}
                </span>
              </div>
              <CopyButton text={classDetail.class_code} label="Copy Code" />
            </div>
          )}
        </div>

        {actionError && (
          <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">
            {actionError}
          </div>
        )}

        {/* Tab Switcher */}
        {isProfessor && (
          <div className="flex border-b border-indigo-500/15 gap-4">
            <button
              type="button"
              onClick={() => setActiveTab('status')}
              className={`pb-3 text-sm font-semibold transition-colors border-b-2 flex items-center gap-2 ${
                activeTab === 'status'
                  ? 'border-indigo-400 text-indigo-300'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              <span>Live Status</span>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('sessions')}
              className={`pb-3 text-sm font-semibold transition-colors border-b-2 flex items-center gap-2 ${
                activeTab === 'sessions'
                  ? 'border-indigo-400 text-indigo-300'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              <span>Sessions ({sessions.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('roster')}
              className={`pb-3 text-sm font-semibold transition-colors border-b-2 flex items-center gap-2 ${
                activeTab === 'roster'
                  ? 'border-indigo-400 text-indigo-300'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              <span>Roster ({enrollments.length})</span>
              {pendingCount > 0 && (
                <span className="text-xs px-1.5 py-0.2 rounded-full bg-amber-500 text-slate-950 font-bold">
                  {pendingCount}
                </span>
              )}
            </button>
          </div>
        )}

        {/* 1. Live Status Table (Phase 3) */}
        {isProfessor && activeTab === 'status' && (
          <div className="glass p-6 rounded-2xl flex flex-col gap-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-indigo-500/10 pb-4">
              <div>
                <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                  <span>Live Student Presence</span>
                  <span className="text-xs font-normal text-slate-400">(Auto-refreshes every 20s)</span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Real-time presence and meeting join status during scheduled sessions.
                </p>
              </div>

              {/* Status summary pill indicators */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs px-2.5 py-1 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-300">
                  In Class: <strong className="text-white">{inClassCount}</strong>
                </span>
                <span className="text-xs px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                  Online: <strong className="text-white">{onlineCount}</strong>
                </span>
                <span className="text-xs px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300">
                  Idle/Away: <strong className="text-white">{idleCount}</strong>
                </span>
                <span className="text-xs px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-400">
                  Offline: <strong className="text-white">{offlineCount}</strong>
                </span>
              </div>
            </div>

            {statuses.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-sm">
                No approved students in this class yet. Share the class code and approve enrollments in the Roster tab.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-indigo-500/10 text-xs text-slate-400 uppercase tracking-wider">
                      <th className="py-3 px-3">Student</th>
                      <th className="py-3 px-3">Live Status</th>
                      <th className="py-3 px-3">Source Signal</th>
                      <th className="py-3 px-3">Activity State</th>
                      <th className="py-3 px-3 text-right">Last Reported</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-indigo-500/5">
                    {statuses.map((st) => (
                      <tr key={st.user_id} className="hover:bg-white/5 transition-colors">
                        <td className="py-3 px-3">
                          <div className="font-semibold text-white">{st.name}</div>
                          <div className="text-xs text-slate-400">{st.email}</div>
                        </td>
                        <td className="py-3 px-3">
                          <Chip tone={statusTone(st.status)}>
                            {statusLabel(st.status)}
                          </Chip>
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className="text-xs font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300"
                            title={`Reported source: ${st.source}`}
                          >
                            {st.source}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-xs capitalize text-slate-300">
                          {st.last_state ?? '—'}
                          {st.in_meeting && <span className="ml-1 text-indigo-400">(meeting open)</span>}
                        </td>
                        <td className="py-3 px-3 text-xs text-slate-400 text-right">
                          {st.last_seen
                            ? new Date(st.last_seen).toLocaleTimeString()
                            : 'No reports'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* 2. Sessions Tab (Phase 3) */}
        {isProfessor && activeTab === 'sessions' && (
          <div className="glass p-6 rounded-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-indigo-500/10 pb-4">
              <div>
                <h2 className="text-lg font-bold text-white tracking-tight">Scheduled Sessions</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Monitoring is active solely within these scheduled windows.
                </p>
              </div>
              <Button size="sm" onClick={() => setIsSessionModalOpen(true)}>
                + Schedule Session
              </Button>
            </div>

            {sessions.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-sm">
                No sessions scheduled. Click &quot;Schedule Session&quot; to set up meeting presence monitoring.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-indigo-500/10 text-xs text-slate-400 uppercase tracking-wider">
                      <th className="py-3 px-3">Date</th>
                      <th className="py-3 px-3">Window</th>
                      <th className="py-3 px-3">Meeting Link / ID</th>
                      <th className="py-3 px-3">Grace</th>
                      <th className="py-3 px-3 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-indigo-500/5">
                    {sessions.map((sess) => {
                      const start = new Date(sess.starts_at);
                      const end = new Date(sess.ends_at);
                      const now = new Date();
                      const isActive = now >= start && now <= end;
                      const isPast = now > end;

                      return (
                        <tr key={sess.id} className="hover:bg-white/5 transition-colors">
                          <td className="py-3 px-3 font-semibold text-white">
                            {start.toLocaleDateString()}
                          </td>
                          <td className="py-3 px-3 text-xs text-slate-300">
                            {start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} -{' '}
                            {end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="py-3 px-3 text-xs">
                            <a
                              href={sess.meeting_link}
                              target="_blank"
                              rel="noreferrer"
                              className="text-indigo-400 hover:underline max-w-xs truncate block"
                            >
                              {sess.meeting_id ? `ID: ${sess.meeting_id}` : sess.meeting_link}
                            </a>
                          </td>
                          <td className="py-3 px-3 text-xs text-slate-400">
                            {sess.grace_minutes} min
                          </td>
                          <td className="py-3 px-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {isActive ? (
                                <Chip tone="ok">Live Now</Chip>
                              ) : isPast ? (
                                <Chip tone="off">Completed</Chip>
                              ) : (
                                <Chip tone="info">Upcoming</Chip>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleOpenAttendance(sess)}
                                title="View attendance records"
                              >
                                Attendance
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* 3. Student Roster Tab */}
        {isProfessor && activeTab === 'roster' && (
          <div className="glass p-6 rounded-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-indigo-500/10 pb-4">
              <div>
                <h2 className="text-lg font-bold text-white tracking-tight">Student Roster</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Manage enrolled students. Only approved students can report presence and attend sessions.
                </p>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 border border-slate-700">
                Total: {enrollments.length}
              </span>
            </div>

            {enrollments.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-sm">
                No students enrolled yet. Share the join code with your students to have them join via the NotifEye Chrome extension.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-indigo-500/10 text-xs text-slate-400 uppercase tracking-wider">
                      <th className="py-3 px-3">Student</th>
                      <th className="py-3 px-3">Role</th>
                      <th className="py-3 px-3">Status</th>
                      <th className="py-3 px-3">Joined Date</th>
                      <th className="py-3 px-3">Consent</th>
                      <th className="py-3 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-indigo-500/5">
                    {enrollments.map((enr) => {
                      const isPending = enr.status === 'pending';
                      const isApproved = enr.status === 'approved';
                      const isRemoved = enr.status === 'removed';
                      const isProcessing = processingId === enr.id;

                      return (
                        <tr key={enr.id} className="hover:bg-white/5 transition-colors">
                          <td className="py-3 px-3">
                            <div className="font-semibold text-white">{enr.name}</div>
                            <div className="text-xs text-slate-400">{enr.email}</div>
                          </td>
                          <td className="py-3 px-3">
                            <span className="text-xs capitalize font-medium text-slate-300">
                              {enr.role}
                            </span>
                          </td>
                          <td className="py-3 px-3">
                            <Chip tone={isApproved ? 'ok' : isPending ? 'warn' : 'off'}>
                              {enr.status}
                            </Chip>
                          </td>
                          <td className="py-3 px-3 text-xs text-slate-400">
                            {new Date(enr.created_at).toLocaleDateString()}
                          </td>
                          <td className="py-3 px-3 text-xs text-slate-400">
                            {enr.consent_at ? (
                              <span className="text-emerald-400 font-medium">Consented</span>
                            ) : (
                              <span className="text-slate-500">None</span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right">
                            {enr.role !== 'professor' && (
                              <div className="inline-flex items-center gap-2 justify-end">
                                {isPending && (
                                  <Button
                                    variant="primary"
                                    size="sm"
                                    disabled={isProcessing}
                                    onClick={() => handleUpdateEnrollment(enr.id, 'approved')}
                                  >
                                    {isProcessing ? '...' : 'Approve'}
                                  </Button>
                                )}
                                {isApproved && (
                                  <Button
                                    variant="danger"
                                    size="sm"
                                    disabled={isProcessing}
                                    onClick={() => handleUpdateEnrollment(enr.id, 'removed')}
                                  >
                                    {isProcessing ? '...' : 'Remove'}
                                  </Button>
                                )}
                                {isRemoved && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={isProcessing}
                                    onClick={() => handleUpdateEnrollment(enr.id, 'approved')}
                                  >
                                    {isProcessing ? '...' : 'Re-approve'}
                                  </Button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Student View (if viewing as student) */}
        {!isProfessor && (
          <div className="glass p-6 rounded-2xl text-center py-10">
            <h3 className="text-base font-semibold text-white mb-2">Student View</h3>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              You are enrolled in this class as a student. Use the NotifEye Chrome extension popup to monitor your attendance and active sessions.
            </p>
          </div>
        )}

        {/* Schedule Session Modal */}
        <Modal
          isOpen={isSessionModalOpen}
          onClose={() => setIsSessionModalOpen(false)}
          title="Schedule Class Session"
        >
          {sessionError && (
            <div className="mb-4 p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">
              {sessionError}
            </div>
          )}

          <form onSubmit={handleCreateSession} className="flex flex-col gap-4">
            <InputField
              label="Session Start Time"
              id="session-start"
              type="datetime-local"
              required
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />

            <InputField
              label="Session End Time"
              id="session-end"
              type="datetime-local"
              required
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
            />

            <InputField
              label="Meeting URL"
              id="session-link"
              type="url"
              required
              placeholder={
                classDetail.platform === 'zoom'
                  ? 'https://zoom.us/wc/1234567890/join'
                  : 'https://meet.google.com/abc-defg-hij'
              }
              value={meetingLink}
              onChange={(e) => setMeetingLink(e.target.value)}
            />

            <InputField
              label="Grace Period (minutes)"
              id="session-grace"
              type="number"
              min={0}
              required
              value={graceMinutes}
              onChange={(e) => setGraceMinutes(Number(e.target.value))}
            />

            <div className="flex items-center justify-end gap-3 mt-4 pt-3 border-t border-indigo-500/10">
              <Button type="button" variant="ghost" onClick={() => setIsSessionModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={sessionCreating}>
                {sessionCreating ? 'Scheduling...' : 'Schedule Session'}
              </Button>
            </div>
          </form>
        </Modal>

        {/* Attendance Modal (Phase 4) */}
        <Modal
          isOpen={isAttendanceModalOpen}
          onClose={() => setIsAttendanceModalOpen(false)}
          title={`Session Attendance – ${selectedSession ? new Date(selectedSession.starts_at).toLocaleDateString() : ''}`}
        >
          <div className="flex flex-col gap-4 max-h-[75vh] overflow-y-auto pr-1">
            {selectedSession && (
              <div className="p-3 rounded-xl bg-slate-900/60 border border-indigo-500/10 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
                <div>
                  <span className="text-slate-400">Window: </span>
                  <strong>
                    {new Date(selectedSession.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} -{' '}
                    {new Date(selectedSession.ends_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400">Grace: </span>
                  <strong>{selectedSession.grace_minutes} min</strong>
                </div>
                {selectedSession.finalized_at && (
                  <Chip tone="off">Finalized</Chip>
                )}
              </div>
            )}

            {attendanceError && (
              <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">
                {attendanceError}
              </div>
            )}

            {attendanceLoading ? (
              <div className="py-12 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
                <div className="w-6 h-6 rounded-full border-2 border-indigo-500/30 border-t-indigo-500 animate-spin" />
                <span>Loading attendance records...</span>
              </div>
            ) : attendanceList.length === 0 ? (
              <div className="py-10 text-center text-slate-400 text-xs">
                No attendance records for this session yet. Approved students joining via Zoom or Meet will appear here.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-indigo-500/10 text-slate-400 uppercase tracking-wider">
                      <th className="py-2.5 px-2">Student</th>
                      <th className="py-2.5 px-2">Status</th>
                      <th className="py-2.5 px-2">Joined</th>
                      <th className="py-2.5 px-2">Source</th>
                      <th className="py-2.5 px-2">Flags</th>
                      <th className="py-2.5 px-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-indigo-500/5">
                    {attendanceList.map((rec) => {
                      const statusTone = rec.status === 'present' ? 'ok' : rec.status === 'late' ? 'warn' : 'off';
                      return (
                        <tr key={rec.id} className="hover:bg-white/5 transition-colors">
                          <td className="py-2.5 px-2">
                            <div className="font-semibold text-white">{rec.student_name}</div>
                            <div className="text-[11px] text-slate-400">{rec.student_email}</div>
                          </td>
                          <td className="py-2.5 px-2">
                            <Chip tone={statusTone} className="capitalize">
                              {rec.status}
                            </Chip>
                          </td>
                          <td className="py-2.5 px-2 text-slate-300">
                            {rec.joined_at
                              ? new Date(rec.joined_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                              : '—'}
                          </td>
                          <td className="py-2.5 px-2">
                            <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300">
                              {rec.source}
                            </span>
                          </td>
                          <td className="py-2.5 px-2">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {rec.conflict && (
                                <span
                                  className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40"
                                  title={JSON.stringify(rec.conflict)}
                                >
                                  Conflict
                                </span>
                              )}
                              {rec.overridden_by && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/40">
                                  Overridden
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 px-2 text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleStartOverride(rec)}
                              className="text-indigo-300 hover:text-white"
                            >
                              Override
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Modal>

        {/* Override Modal (Phase 4) */}
        <Modal
          isOpen={isOverrideModalOpen}
          onClose={() => setIsOverrideModalOpen(false)}
          title={`Override Attendance – ${overrideRecord?.student_name ?? ''}`}
        >
          <form onSubmit={handleSaveOverride} className="flex flex-col gap-4">
            {overrideError && (
              <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">
                {overrideError}
              </div>
            )}

            <SelectField
              label="New Attendance Status"
              id="override-status"
              value={overrideStatus}
              onChange={(e) => setOverrideStatus(e.target.value as AttendanceStatus)}
              options={[
                { value: 'present', label: 'Present' },
                { value: 'late', label: 'Late' },
                { value: 'absent', label: 'Absent' },
              ]}
            />

            <InputField
              label="Reason for Override (Optional)"
              id="override-reason"
              type="text"
              placeholder="e.g. Excused medical absence, technical issue"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
            />

            <div className="flex items-center justify-end gap-3 mt-4 pt-3 border-t border-indigo-500/10">
              <Button type="button" variant="ghost" onClick={() => setIsOverrideModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={overrideSaving}>
                {overrideSaving ? 'Saving...' : 'Save Override'}
              </Button>
            </div>
          </form>
        </Modal>
      </div>
    </AppShell>
  );
}
