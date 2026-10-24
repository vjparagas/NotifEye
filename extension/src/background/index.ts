/**
 * NotifEye service worker (Manifest V3).
 *
 * Phase 1: empty shell that loads. Later phases add:
 *   - schedule download (GET /me/schedule), chrome.alarms-driven ~1 min batched reports
 *   - chrome.idle state, offline queue in chrome.storage, meeting matching
 * MV3 service workers sleep, so NO long-lived timers: only chrome.alarms + chrome.storage.
 */
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[NotifEye] service worker installed:', details.reason);
});
