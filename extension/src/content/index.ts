/**
 * NotifEye content script. Injected ONLY on the Zoom web client and meet.google.com
 * (see src/config/platforms.ts).
 *
 * Phase 1: intentionally does nothing. In Phase 4 it will only signal "a meeting page is
 * open/closed" to the service worker. It never reads page content.
 */
export {};
