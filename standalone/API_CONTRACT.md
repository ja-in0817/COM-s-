# 모아 독립 웹앱 API 계약

This subproject is independent of ChatGPT/Sites. Node 24 HTTP server, SQLite file on a persistent disk, React/Vite UI. No legacy database or production Site is changed.

## Shared contracts

Timestamps are integer Unix milliseconds. IDs are random UUID strings. Database is node:sqlite DatabaseSync with foreign keys on and WAL. All API writes require same Origin + JSON + X-CSRF-Token matching a server-issued cookie. Core handler authenticates sessions and passes user, never a client-supplied identity. JSON errors are {error:string}. Domain throws errors with numeric status.

`export async function handleDomain({ req, url, body, user, db, now, config })` returns `{ status?:number, body:any }` or null when no domain route matches. req is Node IncomingMessage. url is a URL. body has already been parsed/size-limited. user is null or internal users row. db is DatabaseSync. Core checks CSRF for all writes before domain. Domain enforces every role and membership itself.

Core users columns: id TEXT PK, username TEXT UNIQUE COLLATE NOCASE, password_hash TEXT, nickname TEXT, role TEXT ('participant','moderator','admin'), age INTEGER (13..18 or null for staff), age_group TEXT ('13-15','16-18','staff'), district TEXT default '', interests TEXT JSON default '[]', availability TEXT default '', participation_mode TEXT default 'text', intensity TEXT default 'low', created_at INTEGER, disabled_at INTEGER nullable, consent_version TEXT, consent_at INTEGER.

Core audit_log columns: id TEXT PK, actor_id TEXT nullable, action TEXT, target_id TEXT, detail TEXT JSON, created_at INTEGER. Never put passwords or raw invite/session tokens in audit.

Public user shape includes id,username,nickname,role,age,age_group,district,interests(array),availability,participation_mode,intensity,created_at; never password_hash. Member responses expose nickname/id/age_group, not usernames, district or private profile fields.

## Core auth and administration APIs

- GET /api/health -> {ok:true,storage:'sqlite',version:'1.0.0'} (no paths/secrets)
- GET /api/me -> {user: PublicUser|null, csrf_token:string, capabilities:{registration:'invite', ai_enabled:false, external_referral:false}}
- POST /api/auth/register {username,password,nickname,invite_code,consent:true} -> {user,csrf_token}; invitation determines verified age. Min password12. No self-appointed staff.
- POST /api/auth/login {username,password} -> {user,csrf_token}
- POST /api/auth/logout {} -> {ok:true,csrf_token}
- POST /api/auth/password {current_password,new_password} -> {ok:true}; revokes other sessions
- DELETE /api/account {password} -> {ok:true}; anonymizes profile/messages and disables auth, preserves only minimal safety audit
- GET /api/admin/invites (staff) -> {invites:[{id,label,age,age_group,expires_at,used,created_at,guardian_verified}]}
- POST /api/admin/invites {label,age,guardian_verified:boolean,age_verified:true} (staff) -> {invite_code,expires_at}; one-use raw code shown once; age13 requires guardian_verified true
- POST /api/admin/invites/:id/revoke {} (staff) -> {ok:true}

## Domain routes and UI payloads

- PATCH /api/profile {nickname,district,interests:string[],availability,participation_mode,intensity} -> {user:PublicUser}; role/age immutable
- GET /api/groups?mine=1 -> {groups:Group[]}; requires login, participant sees only own age group. Group = {id,title,description,topic,age_group,mode,intensity,schedule,capacity,member_count,owner_id,created_at,status,my_status,reasons:string[],match_score:number}. No fake groups.
- POST /api/groups {title,description,topic,mode:'text',intensity,schedule,capacity:3|4} -> {group}; age_group derived from participant. Staff uses age_group and does not count as peer.
- GET /api/groups/:id -> {group,members:[{id,nickname,age_group}],messages:Message[],sessions:Session[]}; membership or staff required. Message={id,user_id,nickname,body,created_at,hidden:boolean}; paginate ?before=<timestamp>, latest100.
- POST /api/groups/:id/join {} -> {ok:true}; age,capacity,any mutual block enforced transactionally
- POST /api/groups/:id/leave {} -> {ok:true}; immediate, no reason; owner can leave; transfer owner to earliest active participant or archive if empty
- POST /api/groups/:id/pause {paused:boolean} -> {ok:true}; pause keeps seat but disables notifications; no penalties
- POST /api/groups/:id/messages {body,client_id:uuid} -> {message}; membership, block filters, max1000chars, idempotent
- POST /api/groups/:id/sessions {title,starts_at,duration_minutes:15|30|45|60} -> {session}; member may propose meeting, no forced attendance
- POST /api/sessions/:id/checkin {} -> {ok:true}; own attendance only, within meeting time (15 minutes before to 60 after end)
- POST /api/checkins {group_id,comfort:1..5,return_intent:1..5,note?:string} -> {ok:true}; optional private feedback
- POST /api/blocks {target_id} -> {ok:true}; no self, prevents matching/mutes messages
- GET /api/blocks -> {blocks:[{target_id,nickname,created_at}]}; DELETE /api/blocks/:id -> {ok:true}
- POST /api/reports {group_id,message_id?,target_id?,category,reason} -> {report_id}; message or target must belong to own group; no majority threshold; staff sees only
- GET /api/admin/reports -> {reports:[{id,group_id,group_title,category,reason,status,created_at,target_id,target_name,message_id,message_body}]}; staff role
- POST /api/admin/reports/:id/review {decision:'dismiss'|'hide_message'|'restrict_user'|'restore',note} -> {ok:true}; log evidence and decision; no AI enforcement
- GET /api/organizations -> {organizations:[{id,name,region,phone,website,source_url,verification_status:'directory_only',min_age,max_age,description,verified_at}]}; public directory, source labels and no false reservation
- POST /api/referrals {organization_id,consent:true,note?,contact} -> {referral}; save INTERNAL request status 'awaiting_connection', never claim external sent. Clear UI '기관 전송 전 · 운영자 확인 대기'.
- GET /api/referrals -> {referrals:[{id,organization_id,organization_name,status,created_at,note,contact}]}; self only
- POST /api/referrals/:id/cancel {} -> {ok:true}; own only
- GET /api/admin/referrals -> {referrals:[... with applicant nickname]}; staff read for follow-up, no automatic external transmission

Start with no participant/group fixtures in production. Official 1388 and support policy links may be seeded as directory information, clearly not partner verified. No fake AI, fake age verification, fabricated user numbers, synthetic reports or automatic family contact.
