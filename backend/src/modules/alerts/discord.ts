export interface DiscordAlertOptions {
  webhookUrl: string;
  studentName: string;
  className: string;
  message: string;
  timeoutMs?: number;
}

/**
 * Delivers an alert to a class's Discord webhook.
 * - Uses fetch with an AbortController timeout.
 * - Failure is caught and logged safely without breaking callers / scheduler.
 * - NEVER logs the webhook URL itself.
 */
export async function sendDiscordAlert(options: DiscordAlertOptions): Promise<boolean> {
  const { webhookUrl, studentName, className, message, timeoutMs = 5000 } = options;
  if (!webhookUrl) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `**[NotifEye Alert] Absent Student**\nClass: **${className}**\nStudent: **${studentName}**\n${message}`,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      // Never log the webhook URL
      console.error(`[Discord] Webhook returned status ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    // Never write the webhook URL into logs
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[Discord] Webhook delivery failed: ${errorMsg}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}
