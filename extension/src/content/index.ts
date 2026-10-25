import { extractPlatformAndMeetingId } from '../config/platforms';

function initContentScript(): void {
  // Read meeting ID strictly from location.href (never the DOM/page content)
  const extracted = extractPlatformAndMeetingId(window.location.href);
  if (!extracted) {
    return;
  }

  const { meetingId } = extracted;

  // Send heartbeat function
  const sendHeartbeat = () => {
    try {
      chrome.runtime?.sendMessage?.({
        type: 'MEETING_HEARTBEAT',
        meetingId,
        timestamp: new Date().toISOString(),
      });
    } catch {
      // Service worker might be sleeping; will wake up or retry
    }
  };

  sendHeartbeat();

  // Periodic heartbeat every ~20s
  const intervalId = window.setInterval(sendHeartbeat, 20_000);

  // Send final message on pagehide (and beforeunload as fallback)
  let pageHideSent = false;
  const onPageHide = () => {
    if (pageHideSent) return;
    pageHideSent = true;
    window.clearInterval(intervalId);
    try {
      chrome.runtime?.sendMessage?.({
        type: 'MEETING_PAGEHIDE',
        meetingId,
        timestamp: new Date().toISOString(),
      });
    } catch {
      // Ignore if disconnected
    }
  };

  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('beforeunload', onPageHide);
}

initContentScript();
