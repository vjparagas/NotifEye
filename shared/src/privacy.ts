export interface UserDataExportDTO {
  user: {
    id: string;
    email: string;
    name: string;
    consent_at: string | null;
    consent_version: string | null;
    created_at: string;
  };
  enrollments: Array<{
    id: string;
    class_id: string;
    class_name: string;
    role: string;
    status: string;
    consent_at: string | null;
    created_at: string;
  }>;
  attendance: Array<{
    id: string;
    session_id: string;
    class_name: string;
    session_starts_at: string;
    session_ends_at: string;
    joined_at: string | null;
    left_at: string | null;
    status: string;
    source: string;
    overridden_at: string | null;
    created_at: string;
  }>;
  events: Array<{
    id: string;
    class_id: string;
    session_id: string | null;
    type: string;
    state: string | null;
    timestamp: string;
    source: string;
    received_at: string;
  }>;
}
