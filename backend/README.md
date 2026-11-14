# wargether 백엔드

외부 의존성 없는 Node.js HTTP 서버입니다. 역할은 개발 중 화면 상태를 로컬 파일로 보존하는 것입니다. 인증된 여러 사용자에게 서비스를 제공하는 운영 서버는 아닙니다.

| API | 동작 |
| --- | --- |
| `GET /api/health` | 서버 모드와 실제 기관 발송 비활성 상태 |
| `GET /api/state` | `{revision, state}` 반환 |
| `PUT /api/state` | `{expectedRevision, state}` 검증 및 저장 |

먼저 브라우저로 `/`를 열면 임시 `HttpOnly; SameSite=Strict` 개발 쿠키가 설정됩니다. 상태 API에는 이 쿠키가 필요하고 쓰기에는 동일 출처 Origin과 JSON 본문이 필요합니다. 요청 크기는 1 MiB로 제한합니다. Host는 localhost 또는 127.0.0.1로 한정합니다. 이 조치는 사용자 인증이나 운영 환경 보안을 대체하지 않습니다.

`StateStore`는 revision 비교, 직렬 쓰기, 임시 파일의 원자적 rename으로 저장 충돌과 부분 저장을 줄입니다. JSON 파일이 손상되면 오류로 중단하며 빈 상태로 덮어쓰지 않습니다. 상태 파일과 환경 파일은 Git 추적 대상에서 제외했습니다. API에는 출석·신고의 진위를 판단하는 서버 권한 검사가 아직 없습니다.
