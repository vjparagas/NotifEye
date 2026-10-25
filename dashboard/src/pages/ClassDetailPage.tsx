import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router';
import type { ClassDetailDTO, EnrollmentDTO } from '@notifeye/shared';
import { api, errorMessage } from '../api';
import { AppShell } from '../components/AppShell';
import { Button, Chip, CopyButton } from '../components/ui';

export function ClassDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [classDetail, setClassDetail] = useState<ClassDetailDTO | null>(null);
  const [enrollments, setEnrollments] = useState<EnrollmentDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const loadData = async () => {
    if (!id) return;
    try {
      setError(null);
      const detailRes = await api.classDetail(id);
      setClassDetail(detailRes.class);

      if (detailRes.class.role === 'professor') {
        const enrollRes = await api.enrollments(id);
        setEnrollments(enrollRes.enrollments);
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

  const handleUpdateStatus = async (enrollmentId: string, status: 'approved' | 'removed') => {
    if (!id) return;
    setProcessingId(enrollmentId);
    setActionError(null);

    try {
      const res = await api.setEnrollmentStatus(id, enrollmentId, status);
      setEnrollments((prev) =>
        prev.map((e) => (e.id === enrollmentId ? res.enrollment : e)),
      );
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setProcessingId(null);
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

        {/* Roster Section */}
        {isProfessor ? (
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
                            <Chip
                              tone={
                                isApproved ? 'ok' : isPending ? 'warn' : 'off'
                              }
                            >
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
                                    onClick={() => handleUpdateStatus(enr.id, 'approved')}
                                  >
                                    {isProcessing ? '...' : 'Approve'}
                                  </Button>
                                )}
                                {isApproved && (
                                  <Button
                                    variant="danger"
                                    size="sm"
                                    disabled={isProcessing}
                                    onClick={() => handleUpdateStatus(enr.id, 'removed')}
                                  >
                                    {isProcessing ? '...' : 'Remove'}
                                  </Button>
                                )}
                                {isRemoved && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={isProcessing}
                                    onClick={() => handleUpdateStatus(enr.id, 'approved')}
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
        ) : (
          <div className="glass p-6 rounded-2xl text-center py-10">
            <h3 className="text-base font-semibold text-white mb-2">Student View</h3>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              You are enrolled in this class as a student. Use the NotifEye Chrome extension popup to monitor your attendance and active sessions.
            </p>
          </div>
        )}
      </div>
    </AppShell>
  );
}
