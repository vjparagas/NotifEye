import { z } from 'zod';
import { PLATFORMS, type Platform } from './events';

/** Roles live on the ENROLLMENT (per class). There is no global role anywhere. */
export const ENROLLMENT_ROLES = ['professor', 'student'] as const;
export type EnrollmentRole = (typeof ENROLLMENT_ROLES)[number];

export const ENROLLMENT_STATUSES = ['pending', 'approved', 'removed'] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

/** Class codes use an unambiguous alphabet (no 0/O, 1/I/L) so they are easy to read aloud and type. */
export const CLASS_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CLASS_CODE_LENGTH = 8;

/** Only genuine Discord incoming-webhook URLs are accepted. */
const DISCORD_WEBHOOK = /^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/;

export const createClassSchema = z.object({
  name: z.string().trim().min(1, 'Class name is required').max(100),
  section: z
    .string()
    .trim()
    .max(50)
    .optional()
    .transform((s) => (s ? s : null)),
  platform: z.enum(PLATFORMS),
  discord_webhook_url: z
    .string()
    .trim()
    .max(300)
    .regex(DISCORD_WEBHOOK, 'Must be a Discord webhook URL (https://discord.com/api/webhooks/...)')
    .optional()
    .nullable()
    .transform((s) => s ?? null),
});
export type CreateClassInput = z.infer<typeof createClassSchema>;

export const joinClassSchema = z.object({
  /** Free-form on purpose: ANY code that does not match gets the same generic 404. */
  class_code: z.string().trim().min(1, 'Enter a class code').max(64),
  /** Must be true; the API rejects with `consent_required` otherwise. Stored as enrollments.consent_at. */
  consent: z.boolean().default(false),
});
export type JoinClassInput = z.infer<typeof joinClassSchema>;

export const updateEnrollmentSchema = z.object({
  status: z.enum(['approved', 'removed']),
});
export type UpdateEnrollmentInput = z.infer<typeof updateEnrollmentSchema>;

/** One class as seen by the signed-in user, with THEIR role/status in it. */
export interface MyClassDTO {
  id: string;
  name: string;
  section: string | null;
  platform: Platform;
  role: EnrollmentRole;
  status: EnrollmentStatus;
  /** Only returned to the class's professor(s). Students never see the code. */
  class_code: string | null;
}

export interface ClassDetailDTO extends MyClassDTO {
  owner_id: string;
  /** Present ONLY for the owning professor; omitted for everyone else. Never logged. */
  discord_webhook_url?: string | null;
}

export interface EnrollmentDTO {
  id: string;
  user_id: string;
  name: string;
  email: string;
  role: EnrollmentRole;
  status: EnrollmentStatus;
  consent_at: string | null;
  /** When the person joined the class (the enrollment row's created_at). */
  created_at: string;
}
