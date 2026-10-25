import { describe, expect, it } from 'vitest';
import { computeStudentStatus, type NormalizedEvent } from '@notifeye/shared';

describe('Status computation & transitions (injected clock)', () => {
  const session = {
    starts_at: '2026-10-25T10:00:00.000Z',
    ends_at: '2026-10-25T11:00:00.000Z',
  };

  const userId = '11111111-1111-1111-1111-111111111111';
  const classId = '22222222-2222-2222-2222-222222222222';

  function makeEvent(
    type: NormalizedEvent['type'],
    timestamp: string,
    state: NormalizedEvent['state'] = null,
  ): NormalizedEvent {
    return {
      user_id: userId,
      class_id: classId,
      session_id: null,
      type,
      state,
      timestamp,
      source: 'extension',
    };
  }

  it('1. Not in session when outside session window (before or after)', () => {
    // Before session start
    const beforeNow = new Date('2026-10-25T09:59:59.000Z');
    const res1 = computeStudentStatus([], session, beforeNow);
    expect(res1.status).toBe('not_in_session');
    expect(res1.source).toBe('system');

    // After session end
    const afterNow = new Date('2026-10-25T11:00:01.000Z');
    const res2 = computeStudentStatus([], session, afterNow);
    expect(res2.status).toBe('not_in_session');

    // Null session
    const res3 = computeStudentStatus([], null, new Date('2026-10-25T10:30:00.000Z'));
    expect(res3.status).toBe('not_in_session');
  });

  it('2. Offline when inside session but no reports have been received', () => {
    const now = new Date('2026-10-25T10:15:00.000Z');
    const res = computeStudentStatus([], session, now);
    expect(res.status).toBe('offline');
    expect(res.source).toBe('extension');
    expect(res.last_seen).toBeNull();
  });

  it('3. Online when active presence was reported within the last 3 minutes', () => {
    const now = new Date('2026-10-25T10:10:00.000Z');
    const events = [makeEvent('presence', '2026-10-25T10:09:00.000Z', 'active')]; // 1 min ago
    const res = computeStudentStatus(events, session, now);
    expect(res.status).toBe('online');
    expect(res.source).toBe('extension');
    expect(res.last_state).toBe('active');
    expect(res.in_meeting).toBe(false);
  });

  it('4. Idle when latest presence is idle and reported within 3 minutes', () => {
    const now = new Date('2026-10-25T10:15:00.000Z');
    const events = [
      makeEvent('presence', '2026-10-25T10:10:00.000Z', 'active'),
      makeEvent('presence', '2026-10-25T10:13:30.000Z', 'idle'), // 1.5 min ago
    ];
    const res = computeStudentStatus(events, session, now);
    expect(res.status).toBe('idle');
    expect(res.source).toBe('extension');
    expect(res.last_state).toBe('idle');
  });

  it('5. Away when screen is locked and reported within 3 minutes', () => {
    const now = new Date('2026-10-25T10:20:00.000Z');
    const events = [
      makeEvent('presence', '2026-10-25T10:15:00.000Z', 'active'),
      makeEvent('presence', '2026-10-25T10:19:00.000Z', 'locked'), // 1 min ago
    ];
    const res = computeStudentStatus(events, session, now);
    expect(res.status).toBe('away');
    expect(res.source).toBe('extension');
    expect(res.last_state).toBe('locked');
  });

  it('6. In Class when meeting_joined is active and report is fresh', () => {
    const now = new Date('2026-10-25T10:10:00.000Z');
    const events = [
      makeEvent('meeting_joined', '2026-10-25T10:05:00.000Z'),
      makeEvent('presence', '2026-10-25T10:09:00.000Z', 'active'),
    ];
    const res = computeStudentStatus(events, session, now);
    expect(res.status).toBe('in_class');
    expect(res.source).toBe('meeting tab');
    expect(res.in_meeting).toBe(true);
  });

  it('7. Meeting left reverts from In Class to presence state', () => {
    const now = new Date('2026-10-25T10:25:00.000Z');
    const events = [
      makeEvent('meeting_joined', '2026-10-25T10:05:00.000Z'),
      makeEvent('meeting_left', '2026-10-25T10:20:00.000Z'),
      makeEvent('presence', '2026-10-25T10:23:00.000Z', 'active'), // 2 min ago
    ];
    const res = computeStudentStatus(events, session, now);
    expect(res.status).toBe('online');
    expect(res.in_meeting).toBe(false);
  });

  it('8. CRITICAL: Offline overrides a stale In Class when no reports arrived for > 3 minutes', () => {
    const now = new Date('2026-10-25T10:20:00.000Z');
    // Joined meeting at 10:05, reported active at 10:10, now is 10:20 (10 minutes with no reports)
    const events = [
      makeEvent('meeting_joined', '2026-10-25T10:05:00.000Z'),
      makeEvent('presence', '2026-10-25T10:10:00.000Z', 'active'),
    ];
    const res = computeStudentStatus(events, session, now);
    expect(res.status).toBe('offline');
    expect(res.source).toBe('extension');
    // in_meeting is still noted for audit, but display status is strictly offline
    expect(res.in_meeting).toBe(true);
  });

  it('9. Future events beyond "now" are ignored', () => {
    const now = new Date('2026-10-25T10:15:00.000Z');
    const events = [
      makeEvent('presence', '2026-10-25T10:14:00.000Z', 'active'),
      makeEvent('presence', '2026-10-25T10:25:00.000Z', 'idle'), // future event
    ];
    const res = computeStudentStatus(events, session, now);
    expect(res.status).toBe('online');
    expect(res.last_seen).toBe('2026-10-25T10:14:00.000Z');
  });
});
