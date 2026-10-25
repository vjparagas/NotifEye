import type {
  ApiError,
  AuthResponse,
  ClassDetailDTO,
  CreateClassInput,
  EnrollmentDTO,
  MyClassDTO,
  UserDTO,
} from '@notifeye/shared';

const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

/** Sent on every write. A cross-site page cannot add this header without a CORS preflight, which
 *  the API's origin allow-list denies; the API requires it on cookie-authenticated writes. */
const CSRF_HEADERS = { 'X-Requested-With': 'NotifEye-Dashboard' };

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiError['error'],
    message: string,
    readonly issues?: ApiError['issues'],
  ) {
    super(message);
  }
}

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    // The session is an httpOnly cookie: it is sent by the browser, and JavaScript can never read it.
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' ? CSRF_HEADERS : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as (T & Partial<ApiError>) | null;
  if (!res.ok) {
    throw new ApiRequestError(
      res.status,
      data?.error ?? 'internal_error',
      data?.message ?? 'Something went wrong. Please try again.',
      data?.issues,
    );
  }
  return data as T;
}

export const api = {
  me: () => request<{ user: UserDTO }>('/me'),
  login: (email: string, password: string) =>
    request<AuthResponse>('/auth/login', 'POST', { email, password, client: 'dashboard' }),
  register: (email: string, password: string, name: string, consent: boolean) =>
    request<AuthResponse>('/auth/register', 'POST', { email, password, name, consent, client: 'dashboard' }),
  google: (credential: string, consent: boolean) =>
    request<AuthResponse>('/auth/google', 'POST', { credential, consent }),
  logout: () => request<void>('/auth/logout', 'POST'),

  classes: () => request<{ classes: MyClassDTO[] }>('/classes'),
  createClass: (input: {
    name: string;
    section?: string;
    platform: CreateClassInput['platform'];
    discord_webhook_url?: string;
  }) => request<{ class: ClassDetailDTO }>('/classes', 'POST', input),
  classDetail: (id: string) => request<{ class: ClassDetailDTO }>(`/classes/${id}`),
  enrollments: (id: string) => request<{ enrollments: EnrollmentDTO[] }>(`/classes/${id}/enrollments`),
  setEnrollmentStatus: (classId: string, enrollmentId: string, status: 'approved' | 'removed') =>
    request<{ enrollment: EnrollmentDTO }>(`/classes/${classId}/enrollments/${enrollmentId}`, 'PATCH', { status }),

  sessions: (classId: string) =>
    request<{ sessions: import('@notifeye/shared').SessionDTO[] }>(`/classes/${classId}/sessions`),
  createSession: (classId: string, input: import('@notifeye/shared').CreateSessionInput) =>
    request<{ session: import('@notifeye/shared').SessionDTO }>(`/classes/${classId}/sessions`, 'POST', input),
  status: (classId: string) =>
    request<{ status: import('@notifeye/shared').StudentStatusDTO[] }>(`/classes/${classId}/status`),
  schedule: () =>
    request<{ schedule: import('@notifeye/shared').StudentScheduleItemDTO[] }>('/me/schedule'),
};


/** Turns an API error into one friendly sentence (field issues first). */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) {
    if (err.issues?.length) return err.issues.map((i) => i.message).join(' ');
    return err.message;
  }
  return 'Could not reach the server. Is the API running?';
}
