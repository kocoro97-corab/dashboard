# MY INVEST V2 — ChatGPT 07:00 **동일 원문** 비공개 저장·조회 개발

## 1. 목적 및 실제 연계 상태
- 기존 ChatGPT 예약 작업이 작성한 **최종 메시지 원문 자체**를 날짜별로 보관하고 뉴스 화면에서 다시 읽는다.
- 다른 AI가 시장자료를 재검색하거나 재작성하지 않는다. 유료 OpenAI API 호출도 없다.
- 현 ChatGPT 예약 작업에는 비공개 Google Drive 원문 저장 지시를 추가했다. **실제 다음 실행에서 파일 생성·동일 내용 저장이 성공하는지는 미검증이다.** 앱 권한·작업 환경에 따라 실패할 수 있다.
- 원문에는 ChatGPT 전용 마크업, 인용 참조 ID 및 구성요소가 들어갈 수 있다. 브라우저는 이를 HTML로 재실행하지 않고 **글자 그대로, 순서와 줄바꿈을 보존해 표시**한다. 원문 텍스트 동일성과 ChatGPT의 리치 UI 렌더링 동일성은 구별한다.

## 2. 비공개 저장소와 보안 경계
- 소유자 전용 Drive 폴더 `MY INVEST/ChatGPT-7AM-Original-Archive`, 본 작업 중 비공개 권한 확인.
- 폴더 ID는 **소스 코드에 기록하지 않는다.** 추후 소유자가 승인한 **분리된 테스트 GAS** ScriptProperties의 `MYINVEST_PRIVATE_BRIEFING_FOLDER_ID`로만 설정한다.
- 허용 파일명: `YYYY-MM-DD`, `YYYY-MM-DD.txt`, `YYYY-MM-DD.md`. 허용 형식: Google Docs 및 UTF-8 텍스트. 완전히 동일한 원문이 필요하므로 일반 텍스트 파일이 선호된다.
- `gas/PrivateOriginalBriefing.gs`는 DriveApp의 지정 폴더만 읽으며, 최대 탐색 수·파일 크기·미래 날짜·중복 파일을 검사한다. 실패 시 원문과 Drive ID를 반환하거나 로그하지 않는다.
- `gas/Security.gs`는 승인된 세션 **및 관리자 권한**을 검사한 후에만 `privateMorningBriefing` 읽기를 허용한다.
- 별도 `relay/private-original/worker-dev.mjs` (기존 `relay/worker/worker.mjs`의 해시·정책은 수정하지 않음)는 `MYINVEST_PRIVATE_BRIEFINGS=true`가 **분리 테스트 Worker**에 명시되고, 검증된 테스트 GAS appVersion에 해당 기능이 있을 때만 action을 전달한다. 기본 비활성화.
- 브라우저 역시 `MYINVEST_TRANSPORT_CONFIG.privateBriefings===true`인 격리 개발 연결에 한해 전송하며 인증 토큰은 기존 Authorization 헤더를 통해서만 취급한다.
- 비공개 원문은 공개 GitHub Pages, JSON 정적 자료, GitHub 저장소, 로컬스토리지, 계좌 스냅샷, 타이밍 로그에 저장하지 않는다.
- SHA-256으로 **전송 무결성**을 확인하며, 원문이 실제 ChatGPT 예약 작업의 결과인지 암호학적으로 증명하는 기능은 아직 없다. 자동화의 원본 대조 지시와 저장 실측으로 별도 검증한다.
- 뉴스 화면의 기존 공개 파일·수동 보관 영역은 **원문 자동연계와 별도**이며 기본 접힌 상태로 보관한다.

## 3. 배포 전 충족 조건 (현재 미완료)
1. 다음 예약 작업에서 비공개 Drive 파일 생성 성공과 실제 원문 일치 확인.
2. 운영 GAS v26가 아닌 **독립 테스트 GAS**에 `PrivateOriginalBriefing.gs`와 해당 `Security.gs` 검증된 버전 적용.
3. 테스트 GAS 앱 버전·서명·독립된 Sheets/Properties를 확인. 검증 대상이 운영 GAS가 아니어야 한다.
4. 해시가 고정된 기존 Worker를 변경하지 말고 새로운 독립 테스트 Worker를 검증한 뒤 `MYINVEST_PRIVATE_BRIEFINGS`를 소유자 승인 후 켠다.
5. 개발 사이트 전용 `privateBriefings=true`를 소유자 승인 후 켠다. 설정만 바꿔도 운영 사이트·GAS·NH 인증을 변경하면 안 된다.
6. 일반 승인 회원으로 원문 열람 거부, 관리자 세션으로 일자별 원문 수신, 로그아웃 시 UI 메모리 지움, 344/690/1440px 확인. 일자별 원문 텍스트 원본/수신 SHA-256 비교.
7. 별도의 CI 합성 PASS만으로 실제 Google Drive/GAS 연결 PASS를 주장하지 않는다.

## 4. 운영 정책
- `main`, `release/pages`, 운영 GAS/Sheets/Properties, NH 실계좌 및 주문 **어떤 변경도 하지 않는다**.
- 이 기능은 소유자만 볼 수 있는 비공개 데이터이며, 공개 게시를 허용하는 우회로를 만들지 않는다.
- API 키 발급·별도 AI 사용료·새 예약 작업은 필요 없다.
