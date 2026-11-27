# 비공개 예약 원문 전용 Reader 통합 검증 — 2026-11-27 KST

상태: **PARTIAL — 실제 서버·화면 검증 전**.

## 소스·패치

- 기존 Draft PR #17, `feat/private-original-briefing-read-20261126`.
- 시작 SHA `e75ad986b646867ef40990c9769dd5434824f88e`, 원격 HEAD 일치 확인.
- 사용자 첨부 패치 SHA-256
  `ffd7b913bfa3a8e45b99d9b2f5f6582f490a5320be883ab8b1cfab56efd3d9c4` 일치.
- 패치 기존 파일 9개의 원본 Git blob 일치, `git apply --check` 성공 후 적용.
- 첨부 문서의 후속 제안은 자동 실행 권한으로 취급하지 않고 사용자의 요청 범위만 수행했다.

## 구현·보완

- 기존 고정 보관함의 날짜별 UTF-8 텍스트를 서비스 계정으로 직접 읽는 Worker 어댑터.
- JWT 사용자 대리 `sub` 없음, 요청 scope는 서비스 계정 `drive.readonly`만 사용.
  사용자 전체 Drive OAuth 동의를 새로 받는 경로가 아니며, 실제 파일 권한은 별도로
  지정 폴더의 Viewer 한 명으로 제한·검증해야 한다. 현재 계정 확인·공유는 미수행이다.
- GAS `sessionInfo`에서 지정 소유자·관리자·비밀번호 변경 상태를 확인한다.
  직접 GAS 원문 action도 같은 지정 소유자만 허용하도록 추가 보완했다.
- 브라우저는 `textContent`로 원문을 표시하며 HTML을 실행하지 않고 UTF-8 SHA-256을 검증한다.
  날짜 선택의 응답 역전, 연결 확인이 늦게 끝나는 경우의 최초 조회, 페이지 이탈과
  로그아웃 정리, local/sessionStorage 원문 미저장을 검증한다.
- 원본 크기·UTF-8·중복·지정 부모 폴더·저장시각 오류를 차단한다.
  서비스 계정 토큰 응답이 더 넓은 scope를 명시하면 거부한다.
- 새 `.test.mjs` 전용 Drive 테스트를 기존 CI Node 목록에 포함했다.

## 실행한 모의 검증

- `node tests/security.test.cjs`
- `node tests/private-original-briefing.test.cjs`
- `node tests/private-original-browser.test.cjs`
- `node tests/briefing-dedicated-drive.test.mjs`
- `node tests/worker-relay.test.cjs`
- 위 다섯 파일 총 **43건 PASS**, 실제 Google/NH 호출 없음.
- `python3 -m unittest discover -s tests -p 'test_dev_publish_gate.py'`: **24건 PASS**.
- `python3 -m unittest discover -s tests -p 'test_*.py'`: **399건 PASS**.
- `tests/browser_private_original.py`: **8개 시나리오 PASS**, 1440/690/344px,
  합성 텍스트·합성 인증·합성 서버만 사용했다. 실제 Fold6/사용자 로그인 결과가 아니다.
- JS/GAS 구문 검사 및 `git diff --check` PASS.

## 실제 확인과 차단

- Drive에서 기존 MY INVEST 하위 보관함과 소유자 한 명뿐인 비공개 ACL을 확인했다.
- 해당 보관함의 `2026-11-27.txt`(16,526바이트) 존재를 확인했다.
  원본을 수정·재생성·다른 장소에 게시하지 않았다.
  사용자 설명대로 복구 파일이며 **예약 자동 저장 성공으로 기록하지 않는다**.
- 기존 예약은 Asia/Seoul 매일 07:00, 다음 예정은 2026-11-28 07:00이다.
  브리핑 본문 지시·예약 시간·보관 위치·현재 권한 검사는 변경하지 않았다.
- 이 Cloud 환경에는 Google Cloud 관리 자격증명·gcloud·개발 Cloudflare 관리 바인딩이 없다.
  기존 owner Cloud Shell 비공개 폴더도 이 컴퓨터에는 없다.
  전용 계정의 프로젝트/이메일/역할을 추측하거나 새 IAM 관리자 역할을 부여하지 않았다.
- 따라서 지정 Viewer 추가, 서비스 계정 키 등록, 격리 GAS/Worker 활성화,
  실제 로그인 원문 표시·원본/서버/화면 해시 비교·실사용자 접근 차단은 **NOT_RUN**.
- 다음 07:00의 새 날짜 파일 자동 저장과 화면 표시는 **NOT_RUN**.

## 공유·예약 검사 적용 순서

실제 관리 인증이 연결된 환경에서 아래 전체 경로를 검증할 수 있을 때만 진행한다.

1. 기존 Google Cloud 프로젝트, 전용 계정의 실제 이메일·비위임·불필요한 IAM 역할 부재를 검증한다.
2. 원래 예약 prompt/schedule 및 보관함 ACL을 비공개로 보존한다.
3. 예약의 브리핑 생성 지시는 그대로 두고 ACL 검사만 수정한다. 정확한 기존 소유자 한 명과
   실제 확인한 전용 계정의 reader 권한 한 명만 허용하며, 전환 중 소유자 단독 상태도 허용한다.
   `shared=false`만으로 판정하거나 다른 사용자·domain·anyone·writer를 허용하지 않는다.
4. 예약 readback으로 본문 지시·07:00·고정 보관 위치 유지와 새 검사 적용을 확인한다.
   확인하지 못하면 공유를 변경하지 않는다.
5. 그 후 기존 폴더 하나에만 검증된 계정을 Viewer로 추가하고 폴더 및 날짜 파일의
   실제 ACL을 재확인한다. 파일에는 내용 변경을 하지 않는다.
6. 실패 시 확인된 자신의 변경만 복구한다. 소유자 단독 상태와 충돌하는 원래 검사로
   먼저 되돌려 다음 예약을 막지 않는다. 다른 작업자의 변경은 덮어쓰지 않는다.
7. 독립 개발 Worker의 서버 비밀 설정으로만 키를 등록하고, 격리 GAS의 지정 소유자
   인증 및 일반 회원/다른 관리자/로그아웃 거부를 실제로 확인한다.

## 개발 게시 보존

기존 개발 사이트는 `fix/verified-query-performance-20261126`의
`34cc071ac740b897aadaa27261e172e611894d76` 빌드다.
현재 개발 브랜치 HEAD는 `f89dfd39c329076a5a6e3314f9b4bdeedb89d635`로 확인했다.
PR #17의 예전 전체 프런트엔드나 검증되지 않은 별도 Worker 주소로 이를 덮어쓰지 않았다.
관리 인증 연결 후에는 현재 게시된 승인 코드와 캘린더/OAuth 경로를 보존하는 최소 통합을
검증하고, 정확한 게시 HEAD lease와 같은 소스의 PR/push CI 성공 후 개발 사이트만 게시한다.

운영 main/release/pages/Worker/GAS/Sheets/Properties 변경 0건.
실제 NH 인증·계좌·주문 호출 0건. 보관함 공유·키 등록·예약 변경 0건.
