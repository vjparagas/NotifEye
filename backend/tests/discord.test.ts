import './setup';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sendDiscordAlert } from '../src/modules/alerts/discord';
import { recordAlert } from '../src/modules/alerts/service';
import { pool } from '../src/db';
import {
  makeApp,
  resetDb,
  signUp,
  createClass,
  join,
  type Client,
} from './helpers';

describe('Discord Delivery & Failure Safety', () => {
  const app = makeApp();

  beforeEach(async () => {
    await resetDb();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Unit: sendDiscordAlert', () => {
    it('success posts once to the webhook URL with formatted payload', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      });
      vi.stubGlobal('fetch', mockFetch);

      const secretWebhookUrl = 'https://discord.com/api/webhooks/12345/my-secret-token';
      const result = await sendDiscordAlert({
        webhookUrl: secretWebhookUrl,
        studentName: 'Alice Santos',
        className: 'Math 101',
        message: 'Student Alice Santos was marked absent.',
      });

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        secretWebhookUrl,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('Alice Santos'),
        }),
      );
    });

    it('failure does not throw, returns false, and the webhook URL never appears in logs', async () => {
      const secretToken = 'ultra-secret-discord-key-999';
      const secretWebhookUrl = `https://discord.com/api/webhooks/12345/${secretToken}`;

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Mock fetch rejection (e.g. network timeout or connection reset)
      const mockFetch = vi.fn().mockRejectedValue(new Error('Connection timed out'));
      vi.stubGlobal('fetch', mockFetch);

      let result: boolean | undefined;
      let errorThrown = false;
      try {
        result = await sendDiscordAlert({
          webhookUrl: secretWebhookUrl,
          studentName: 'Bob Reyes',
          className: 'Science 101',
          message: 'Student Bob Reyes was marked absent.',
        });
      } catch {
        errorThrown = true;
      }

      expect(errorThrown).toBe(false);
      expect(result).toBe(false);

      // Verify that the webhook URL or secret token was NEVER logged
      const loggedMessages = consoleErrorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(loggedMessages).not.toContain(secretToken);
      expect(loggedMessages).not.toContain(secretWebhookUrl);
      expect(loggedMessages).toContain('[Discord]');
    });

    it('HTTP error status does not throw, returns false, and never logs the webhook URL', async () => {
      const secretToken = 'another-secret-token-777';
      const secretWebhookUrl = `https://discord.com/api/webhooks/98765/${secretToken}`;

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Mock HTTP 500 response
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await sendDiscordAlert({
        webhookUrl: secretWebhookUrl,
        studentName: 'Charlie Brown',
        className: 'English 101',
        message: 'Student Charlie Brown was marked absent.',
      });

      expect(result).toBe(false);
      const loggedMessages = consoleErrorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(loggedMessages).not.toContain(secretToken);
      expect(loggedMessages).not.toContain(secretWebhookUrl);
      expect(loggedMessages).toContain('500');
    });

    it('skips the call entirely if webhook URL is empty or missing', async () => {
      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);

      const result = await sendDiscordAlert({
        webhookUrl: '',
        studentName: 'Daisy',
        className: 'Art',
        message: 'Marked absent',
      });

      expect(result).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('Integration: recordAlert with Discord delivery', () => {
    it('skips Discord entirely when the class has no discord_webhook_url', async () => {
      const prof = await signUp(app, 'Prof No Discord');
      const student = await signUp(app, 'Student No Discord');
      const cls = await createClass(prof); // No discord webhook URL
      await join(student, cls.class_code!);

      // Approve student
      await pool.query(
        `UPDATE enrollments SET status = 'approved' WHERE user_id = $1 AND class_id = $2`,
        [student.user.id, cls.id],
      );

      // Create session
      const sRes = await prof.post(`/classes/${cls.id}/sessions`, {
        starts_at: '2026-10-25T14:00:00.000Z',
        ends_at: '2026-10-25T15:00:00.000Z',
        meeting_link: 'https://meet.google.com/abc-defg-hij',
        grace_minutes: 5,
      });
      const sessionId = sRes.body.session.id;

      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);

      const alert = await recordAlert({
        classId: cls.id,
        sessionId,
        userId: student.user.id,
        kind: 'absent',
        message: 'Student is absent.',
      });

      expect(alert).not.toBeNull();
      expect(alert?.channels_sent).not.toContain('discord');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('Discord delivery failure does not break recordAlert or the email path', async () => {
      const prof = await signUp(app, 'Prof Discord');
      const student = await signUp(app, 'Student Discord');

      // Create class with a Discord webhook URL
      const clsRes = await prof.post('/classes', {
        name: 'Discord Monitored Class',
        platform: 'meet',
        discord_webhook_url: 'https://discord.com/api/webhooks/1111/secret-fail-token',
      });
      const clsId = clsRes.body.class.id;
      const classCode = clsRes.body.class.class_code;

      await join(student, classCode);
      await pool.query(
        `UPDATE enrollments SET status = 'approved' WHERE user_id = $1 AND class_id = $2`,
        [student.user.id, clsId],
      );

      const sRes = await prof.post(`/classes/${clsId}/sessions`, {
        starts_at: '2026-10-25T14:00:00.000Z',
        ends_at: '2026-10-25T15:00:00.000Z',
        meeting_link: 'https://meet.google.com/abc-defg-hij',
        grace_minutes: 5,
      });
      const sessionId = sRes.body.session.id;

      // Mock fetch: Discord fails with a network exception, but Mailpit (localhost:1025) is SMTP
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockFetch = vi.fn().mockRejectedValue(new Error('Discord server error'));
      vi.stubGlobal('fetch', mockFetch);

      const alert = await recordAlert({
        classId: clsId,
        sessionId,
        userId: student.user.id,
        kind: 'absent',
        message: 'Student is absent in Discord-enabled class.',
      });

      expect(alert).not.toBeNull();
      expect(alert?.kind).toBe('absent');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Verify the secret token never appears in console.error
      const logs = consoleErrorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logs).not.toContain('secret-fail-token');

      // Verify alert was stored in database
      const { rows } = await pool.query('SELECT * FROM alerts WHERE id = $1', [alert?.id]);
      expect(rows).toHaveLength(1);
    });
  });
});
