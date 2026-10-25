/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the NotifEye API. Defaults to http://localhost:4000. */
  readonly VITE_API_URL?: string;
  /** Google OAuth client id for the dashboard "Sign in with Google" button. Blank = button hidden. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
