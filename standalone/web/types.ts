export type User = {
  id: string; username: string; nickname: string;
  role: 'participant' | 'moderator' | 'admin';
  age: number | null; age_group: string; district: string;
  interests: string[]; availability: string; participation_mode: string; intensity: string;
  created_at: number;
};
export type Group = {
  id: string; title: string; description: string; topic: string; age_group: string;
  mode: string; intensity: string; schedule: string; capacity: number; member_count: number;
  owner_id: string | null; created_at: number; status: string; my_status?: string;
  reasons: string[]; match_score: number;
};
export type Message = { id: string; user_id: string; nickname: string; body: string; created_at: number; hidden: boolean };
export type Session = { id: string; title: string; starts_at: number; duration_minutes: number; checked_in?: boolean; my_checkin?: boolean; attendance_count?: number };
export type Detail = { group: Group; members: { id: string; nickname: string; age_group: string; status?: string }[]; messages: Message[]; sessions: Session[] };
export type Organization = { id: string; name: string; region: string; phone: string; website: string; source_url: string; verification_status: string; min_age?: number; max_age?: number; description: string; verified_at?: number };
export type Referral = { id: string; organization_id: string; organization_name: string; status: string; created_at: number; note?: string; contact?: string; nickname?: string; applicant_nickname?: string };
export type Block = { target_id: string; nickname: string; created_at: number };
export type Report = { id: string; group_id: string; group_title: string; category: string; reason: string; status: string; created_at: number; target_id?: string; target_name?: string; message_id?: string; message_body?: string };
export type Invite = { id: string; label: string; age: number; age_group: string; expires_at: number; used: boolean; created_at: number; guardian_verified: boolean; revoked_at?: number };
