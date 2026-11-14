export type Profile = {
  id: string;
  nickname: string;
  role: "mentor" | "mentee";
  timezone: string;
  contact: string;
  region: string;
  aid_consent: number;
};
export type Group = {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  category: string;
  study_topic: string;
  play_topic: string;
  study_minutes: number;
  play_minutes: number;
  capacity: number;
  platform: string;
  meeting_url?: string;
  timezone: string;
  mentor: string;
  member_count: number;
  my_status?: string;
  next_session?: number;
  saved: boolean;
  archived?: number;
};
export type Member = {
  user_id: string;
  nickname: string;
  status: string;
  joined_at: number;
  unannounced_absences: number;
  absence_dates: string[];
  absence_logs: {
    session_id: string;
    starts_at: number;
    recorded_at: number;
    day: string;
  }[];
  can_request_care: boolean;
};
export type Session = {
  id: string;
  starts_at: number;
  note: string;
  status: string;
  my_notice?: string;
  my_attendance?: string;
};
export type Proposal = {
  id: string;
  kind: "study" | "play";
  body: string;
  nickname: string;
  status: string;
  votes: number;
  voted: number;
};
export type Post = {
  id: string;
  user_id: string;
  body: string;
  nickname: string;
  created_at: number;
};
export type Detail = {
  group: Group;
  sessions: Session[];
  members: Member[];
  proposals: Proposal[];
  messages: Post[];
  attendance: {
    session_id: string;
    user_id: string;
    status: string;
    notice?: string;
  }[];
  absenceNotices?: { session_id: string; user_id: string; reason: string }[];
  audit: {
    id: string;
    target_name: string;
    action: string;
    reason: string;
    created_at: number;
    reporters: number;
    electorate: number;
  }[];
};
export type Care = {
  id: string;
  group_id: string;
  owner_id: string;
  target_id: string;
  target_name: string;
  title: string;
  status: string;
  request_count: number;
  requested: boolean;
  can_resolve: boolean;
  delivery_status?: string;
  delivered_at?: number;
  resolution?: string;
  requests: { nickname: string; reason: string; created_at: number }[];
};
export type Conduct = {
  id: string;
  group_id: string;
  owner_id: string;
  target_id: string;
  target_name: string;
  title: string;
  status: string;
  report_count: number;
  electorate: number;
  threshold: number;
  can_expel: boolean;
  reports: { nickname: string; category: string; reason: string }[];
};
export type Safety = { care: Care[]; conduct: Conduct[] };
export type Notice = {
  id: string;
  group_id?: string;
  body: string;
  read_at?: number;
  created_at: number;
};
export type Bootstrap = {
  user_id: string | null;
  profile: Profile | null;
  agency_configured: boolean;
};
