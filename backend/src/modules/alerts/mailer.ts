import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../../config';

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE === 'true',
      auth: config.SMTP_USER
        ? {
            user: config.SMTP_USER,
            pass: config.SMTP_PASS,
          }
        : undefined,
    });
  }
  return transporter;
}

export interface SendAlertEmailOptions {
  to: string;
  professorName?: string | null;
  studentName: string;
  className: string;
  kind: 'absent' | 'late' | string;
  message: string;
}

export async function sendAlertEmail(options: SendAlertEmailOptions): Promise<void> {
  const { to, professorName, studentName, className, kind, message } = options;
  const kindUpper = kind.toUpperCase();
  const subject = `[NotifEye Alert] ${studentName} - ${kindUpper} in ${className}`;
  const greeting = professorName ? `Hello Professor ${professorName},` : 'Hello Professor,';
  const text = `${greeting}

An alert was triggered for your class "${className}":

${message}

Status: ${kindUpper}
Student: ${studentName}

View details on your NotifEye Dashboard:
${config.DASHBOARD_URL}
`;

  try {
    const transport = getTransporter();
    await transport.sendMail({
      from: config.EMAIL_FROM,
      to,
      subject,
      text,
    });
  } catch (err) {
    // Never write passwords or sensitive secrets to logs
    const msg = err instanceof Error ? err.message : 'Unknown mailer error';
    console.error(`[Mailer] Failed to send alert email to ${to}: ${msg}`);
  }
}
