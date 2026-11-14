# wargether 프런트엔드

`public/index.html`이 공통 레이아웃을 제공하고, `app.js`가 hash 경로와 이벤트 위임으로 화면을 전환합니다. `safety-ui.js`는 안부·기관 전달 대기·참여자 신고 화면이며 `shared/safety-core.js`를 사용합니다.

`runtime-config.js`의 기본값은 브라우저 저장 모드입니다. 개발 서버가 같은 경로에 서버 모드 설정을 제공하면 `boot.js`가 `/api/state`를 불러온 뒤 앱을 시작합니다. 서버 기록을 읽을 수 없으면 빈 데이터로 덮어쓰지 않도록 시작을 중단합니다. 저장은 직렬화되고 오래된 revision은 새로고침을 안내합니다.

프로젝트 루트에서 `npm start` 또는 `npm run build`를 실행하세요. 프런트엔드 폴더만 직접 열면 공통 모듈 경로를 찾지 못하므로 빌드 결과를 제공해야 합니다.
