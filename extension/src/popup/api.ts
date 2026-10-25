import type {
  ApiError,
  AuthResponse,
  ClassDetailDTO,
  MyClassDTO,
  UserDTO,
} from '@notifeye/shared';

const API_BASE = typeof __API_URL__ !== 'undefined' ? __API_URL__ : 'http://localhost:4000';

export class ExtensionApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, method = 'GET', body?: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return undefined as T;

  const data = (await res.json().catch(() => null)) as (T & Partial<ApiError>) | null;
  if (!res.ok) {
    let msg = data?.message ?? 'Request failed. Please try again.';
    if (data?.issues?.length) {
      msg = data.issues.map((i) => i.message).join(' ');
    }
    throw new ExtensionApiError(res.status, data?.error ?? 'unknown_error', msg);
  }

  return data as T;
}

export const extensionApi = {
  login: (email: string, password: string) =>
    request<AuthResponse>('/auth/login', 'POST', { email, password, client: 'extension' }),

  register: (email: string, password: string, name: string, consent: boolean) =>
    request<AuthResponse>('/auth/register', 'POST', { email, password, name, consent, client: 'extension' }),

  me: (token: string) =>
    request<{ user: UserDTO }>('/me', 'GET', undefined, token),

  myClasses: (token: string) =>
    request<{ classes: MyClassDTO[] }>('/classes', 'GET', undefined, token),

  joinClass: (token: string, class_code: string, consent: boolean) =>
    request<{ class: ClassDetailDTO }>('/classes/join', 'POST', { class_code, consent }, token),
};
