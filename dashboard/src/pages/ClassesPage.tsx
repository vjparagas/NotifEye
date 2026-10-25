import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { CreateClassInput, MyClassDTO } from '@notifeye/shared';
import { api, errorMessage } from '../api';
import { AppShell } from '../components/AppShell';
import { Button, Chip, CopyButton, InputField, Modal, SelectField } from '../components/ui';

export function ClassesPage() {
  const navigate = useNavigate();
  const [classes, setClasses] = useState<MyClassDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create class modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [section, setSection] = useState('');
  const [platform, setPlatform] = useState<CreateClassInput['platform']>('zoom');
  const [discordWebhook, setDiscordWebhook] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchClasses = async () => {
    try {
      setError(null);
      const res = await api.classes();
      setClasses(res.classes);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClasses();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setCreating(true);

    try {
      const res = await api.createClass({
        name,
        section: section.trim() || undefined,
        platform,
        discord_webhook_url: discordWebhook.trim() || undefined,
      });

      // Add to list and close modal
      setClasses((prev) => [res.class, ...prev]);
      setIsModalOpen(false);
      setName('');
      setSection('');
      setPlatform('zoom');
      setDiscordWebhook('');
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        {/* Header bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">My Classes</h1>
            <p className="text-sm text-slate-400 mt-1">
              Select a class to view its roster, live student status, and attendance sessions.
            </p>
          </div>

          <Button onClick={() => setIsModalOpen(true)} className="sm:self-auto self-start">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>Create Class</span>
          </Button>
        </div>

        {/* Error notification */}
        {error && (
          <div className="p-4 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-sm flex items-center justify-between">
            <span>{error}</span>
            <Button variant="ghost" size="sm" onClick={fetchClasses}>
              Retry
            </Button>
          </div>
        )}

        {/* Content list */}
        {loading ? (
          <div className="py-16 text-center text-slate-400 text-sm flex flex-col items-center justify-center gap-3">
            <div className="w-8 h-8 rounded-full border-2 border-indigo-500/30 border-t-indigo-500 animate-spin" />
            <span>Loading classes...</span>
          </div>
        ) : classes.length === 0 ? (
          <div className="py-16 px-6 glass text-center rounded-2xl flex flex-col items-center max-w-md mx-auto">
            <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mb-4">
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-white mb-1">No classes yet</h3>
            <p className="text-sm text-slate-400 mb-6">
              Create a class to generate a join code for your students and schedule attendance monitoring.
            </p>
            <Button onClick={() => setIsModalOpen(true)}>Create your first class</Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {classes.map((cls) => (
              <div
                key={cls.id}
                onClick={() => navigate(`/classes/${cls.id}`)}
                className="glass glass-hover p-5 rounded-2xl cursor-pointer flex flex-col justify-between gap-4 group"
              >
                <div>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700/60 uppercase tracking-wide">
                      {cls.platform === 'zoom' ? 'Zoom' : 'Google Meet'}
                    </span>
                    <Chip tone={cls.role === 'professor' ? 'info' : 'ok'}>
                      {cls.role}
                    </Chip>
                  </div>

                  <h3 className="text-lg font-bold text-white group-hover:text-indigo-300 transition-colors">
                    {cls.name}
                  </h3>
                  {cls.section && <p className="text-sm text-slate-400 mt-0.5">Section: {cls.section}</p>}
                </div>

                <div className="pt-3 border-t border-indigo-500/10 flex items-center justify-between text-xs text-slate-400">
                  {cls.class_code ? (
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <span className="font-mono text-indigo-300 font-semibold">{cls.class_code}</span>
                      <CopyButton text={cls.class_code} label="Copy code" />
                    </div>
                  ) : (
                    <span>Code hidden</span>
                  )}

                  <span className="group-hover:translate-x-1 transition-transform text-indigo-400 font-semibold flex items-center gap-1">
                    Manage
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create class modal */}
        <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Create New Class">
          {formError && (
            <div className="mb-4 p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">
              {formError}
            </div>
          )}

          <form onSubmit={handleCreate} className="flex flex-col gap-4">
            <InputField
              label="Class Name"
              id="class-name-input"
              type="text"
              required
              placeholder="e.g. Systems Integration 101"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />

            <InputField
              label="Section (optional)"
              id="class-section-input"
              type="text"
              placeholder="e.g. BSIT-4A"
              value={section}
              onChange={(e) => setSection(e.target.value)}
            />

            <SelectField
              label="Meeting Platform"
              id="class-platform-select"
              value={platform}
              onChange={(e) => setPlatform(e.target.value as CreateClassInput['platform'])}
              options={[
                { label: 'Zoom (Web Client)', value: 'zoom' },
                { label: 'Google Meet', value: 'meet' },
              ]}
            />

            <InputField
              label="Discord Webhook URL (optional)"
              id="class-discord-input"
              type="url"
              placeholder="https://discord.com/api/webhooks/..."
              value={discordWebhook}
              onChange={(e) => setDiscordWebhook(e.target.value)}
            />
            <p className="text-xs text-slate-500 -mt-2">
              Receive absent and late alerts directly in your Discord channel. Visible only to you.
            </p>

            <div className="flex items-center justify-end gap-3 mt-4 pt-3 border-t border-indigo-500/10">
              <Button type="button" variant="ghost" onClick={() => setIsModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={creating}>
                {creating ? 'Creating...' : 'Create Class'}
              </Button>
            </div>
          </form>
        </Modal>
      </div>
    </AppShell>
  );
}
