export type AlertKind = 'absent' | 'late' | 'idle' | 'repeated_absence' | 'left_early' | 'class_reminder';

export interface AlertDTO {
  id: string;
  class_id: string;
  session_id: string | null;
  user_id: string | null;
  kind: string;
  message: string;
  channels_sent: string[];
  created_at: string;
  read_at: string | null;
  student_name?: string | null;
  student_email?: string | null;
  class_name?: string | null;
}
