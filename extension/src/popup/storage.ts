import type { UserDTO } from '@notifeye/shared';

const TOKEN_KEY = 'notifeye_token';
const USER_KEY = 'notifeye_user';

export interface StoredAuth {
  token: string | null;
  user: UserDTO | null;
}

export async function getStoredAuth(): Promise<StoredAuth> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const res = await chrome.storage.local.get([TOKEN_KEY, USER_KEY]);
    return {
      token: (res[TOKEN_KEY] as string) || null,
      user: (res[USER_KEY] as UserDTO) || null,
    };
  }

  // Fallback for dev / browser previews
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const userJson = localStorage.getItem(USER_KEY);
    return {
      token,
      user: userJson ? (JSON.parse(userJson) as UserDTO) : null,
    };
  } catch {
    return { token: null, user: null };
  }
}

export async function setStoredAuth(token: string | null, user: UserDTO | null): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    if (token && user) {
      await chrome.storage.local.set({ [TOKEN_KEY]: token, [USER_KEY]: user });
    } else {
      await chrome.storage.local.remove([TOKEN_KEY, USER_KEY]);
    }
    return;
  }

  try {
    if (token && user) {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    }
  } catch {
    // Ignore
  }
}
