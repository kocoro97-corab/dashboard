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


## 5. 격리 개발 게시 가드 (승인 전 실행 금지)
- PR #17 게시자는 기존 개발 Worker 주소를 자동 상속하지 않는다. 별도 Worker의 검증된 공개 HTTPS 주소를 `--private-preview-relay`로 명시해야 하며, 기존 개발 Worker 또는 임의의 다른 주소는 게시 전에 거부한다. 이는 Worker 생성·활성화 또는 개발 Pages 게시를 승인하지 않는다.
- 게시 판단 전에 소스 SHA와 개발 대상 HEAD를 각각 다시 읽고, 동일 소스의 PR 및 push 회귀 CI가 모두 성공했는지 확인한다. Worker가 승인된 독립 TEST GAS에만 연결되는지 별도 검증한다.
- 이 미리보기 Worker는 기존 개발 Worker와 별개이며 Google OAuth 경로가 포함되지 않는다. 실제 격리 점검에는 승인된 테스트 관리자 세션을 사용한다. Google 로그인·캘린더 유지가 필요한 공용 개발 사용자에게 이 미리보기를 일반 개발 빌드로 안내하지 않는다.
- 대시보드에서 보이는 SHA-256은 전송 중 원문이 바뀌지 않았는지 검사한다. 예약 작업 내부 본문과 보관 파일의 동일 여부는 별개로 확인하고, 양쪽에 접근할 수 없거나 내보내기 변환이 발생하면 일치 확정으로 기록하지 않는다.

## 6. 실제 운영과 동일한 경로의 검수
- 원본은 기존 07:00 예약 작업이 실제 운영에 사용할 기존 비공개 폴더에 저장한 날짜별 파일만 사용한다. 표시용 최신 파일, 별도 폴더, 정적 공개 자료, 수동 업로드는 이 경로에 포함하지 않는다.
- 개발과 운영에 동일한 파일 조회와 원문 검증 코드를 사용한다. 테스트 빌드와 운영 빌드는 인증된 배포 주소와 설정만 분리하며, 개발 검수 시에 운영 GAS나 운영 게시본을 변경하지 않는다.
- 원문 텍스트 파일은 공식 Apps Script File 크기, Blob 바이트를 검사하고 UTF-8로 읽은 문자를 다시 바이트로 변환해 해시가 원본 바이트와 같은 경우만 전송한다. HTML을 실행하지 않고 사용자에게 정확한 보관일을 표시한다.
- 실제 검수 시작 전에 지정된 운영 보관함에 대한 서버 읽기 인증과 승인된 개발 대시보드 소유자 세션을 확인한다. 모의 서버 응답, 수동 복구 파일, 인증되지 않은 기존 페이지 열람은 자동 저장·표시 성공의 근거가 아니다.
- 최종 통과: 동일 예약 실행의 정상 완료 및 자동 저장, 고정 개인 폴더 확인, 파일의 정확한 KST 날짜, 원문/파일/브라우저 텍스트 SHA-256 일치, 비인가 계정 거부, 회귀나 장애 시 이전 날짜가 오늘로 표시되지 않음. 이 중 하나라도 미확인이면 그대로 기록한다.

## 7. 기존 보관함에 대한 개발 대시보드의 전용 읽기 계정
- 원본 폴더는 기존 보관함 하나를 그대로 사용한다. 사용자가 승인한 범위는 이 폴더의 지정 서비스 계정 한 개에 대한 Viewer뿐이다. 무작위 계정, 개인 계정, 회사 전체, 링크 공유, 다른 폴더 권한은 금지한다.
- Google Cloud 프로젝트와 계정의 소유를 확인한 후 Drive API를 사용할 전용 서비스 계정을 설정한다. 도메인 전체 위임, 사용자 계정 대리, 프로젝트 편집자/관리자 역할은 부여하지 않는다. 민감한 인증정보는 저장소/채팅/Pages/로그로 넘기지 않는다.
- 격리 개발 Worker에는 서버 비밀 설정으로 정확한 폴더 ID와 전용 계정의 인증정보를 구성한다. 전용 계정으로 OAuth 토큰을 받고 Drive API에는 GET만 허용한다. 개발 GAS는 정해 둔 소유자의 로그인·관리자 여부만 판단하고 원문 읽기용 Drive OAuth를 받지 않는다.
- 설정 후 먼저 전용 계정으로 해당 폴더 읽기 성공을 확인하고, 지정 폴더 외 요청이 소스에서 불가능한지 확인한다. 기존 7시 예약의 ACL 검사도 실제 확인된 소유자 및 해당 전용 Viewer 한 명만 허용하도록 바꾼다. 전용 계정 ID가 검증되기 전에는 예약 정책을 바꾸지 않는다.
- 승인된 개발 사이트에서 날짜별 실제 원본·화면 일치를 비교하고, 로그아웃/다른 승인 사용자로는 접근이 거부되는지 확인한다. 모든 검증 전 운영 배포 금지. 장애 시 개발 Worker에서 기능을 끄고, 불필요해진 Viewer 권한은 사용자의 승인 범위에 맞춰 제거한다.

## 8. 기존 owner Cloud Shell 읽기 전용 연결 점검

`python3 tools/news_reader_owner_preflight.py`는 기존 gcloud 로그인과 Cloudflare 숨김 입력을 사용한다.
기존 프로젝트·전용 계정·Drive API·프로젝트 IAM 역할·사용자 관리 키의 개수와
개발 Worker/owner bundle/별도 원문 Worker의 존재를 확인한다.
일반 사용자 키 생성, 비밀값 업로드, Worker/GAS 배포, 권한 공유, 원문 파일 쓰기는 하지 않는다.
Cloudflare Account ID와 기존 API token을 숨김 입력하며 결과에는 값·원문·비공개 경로를 담지 않는다.
`PASS`는 메타데이터 읽기 점검만의 성공이다. `readyForActivation:false`,
`liveOriginalDisplay:NOT_RUN`을 유지하며, 이를 원문 표시나 예약 저장 성공으로 보고하지 않는다.
원문 Worker가 없으면 새로 만들지 않고 존재 여부만 보고한다.
다른 개발 작업의 미활성 Worker 후보가 있으면 이를 활성화하거나 덮어쓰지 않는다.

## 9. 기존 GAS/주 Worker를 변경하지 않는 전용 서버 설치

실제 owner 점검에서 주 Worker의 미활성 후보가 발견됐다. 이를 보존하기 위해
`tools/deploy_private_news_reader.py --apply`는 주 Worker와 GAS에 쓰기를 하지 않는다.
운영이나 Pages도 이 도구의 API 허용 범위에 없다.

전용 Worker는 같은 격리 GAS의 기존 login을 사용한다. 서버 비밀 설정으로 지정한
소유자의 login이 GAS에서 관리자·비밀번호 변경 불필요로 확인된 경우에만, 발급된
세션 token의 SHA-256을 전용 Durable Object에 최대 8시간 보관한다. 원문 조회 때마다
GAS sessionInfo의 유효성·관리자·비밀번호 상태를 다시 확인하고 이 token 해시도 확인한다.
다른 관리자·일반 회원·임의의 기존 주 Worker token은 원문 권한을 얻지 못한다.
GAS가 명시적으로 원문 권한을 거부한 경우에도 이를 우회하지 않는다.
원문이나 원문 캐시, 비밀번호, 원본 session token을 이 저장소에 보관하지 않는다.

도구는 다음만 수행한다.

1. 기존 Google 소유자·프로젝트·전용 계정·역할 없음·사용자 관리 키 0개와
   기존 owner bundle/주 Worker 배포/후보 이력을 읽기 검증한다.
2. 기존 격리 GAS에 지정 소유자의 로그인 가능 여부를 확인하고 임시 세션을 로그아웃한다.
3. 전용 계정 키 한 개를 IAM에서 생성해 프로세스 메모리에서만 읽고 전용 Worker Secrets로
   직접 전달한다. JSON 키 파일이나 원문 파일은 생성하지 않는다.
4. 정확한 전용 Worker가 없는 경우에만 해당 Worker와 새 SQLite RelayGate를 만든다.
   NH·계좌·저장·일반 공개시장 action은 이 Worker에서 차단하고 관측 로그도 끈다.
   기존 계정의 무료 Worker/SQLite 기능만 사용하며 과금 설정·요금제 변경 API는 없다.
5. 공개 metadata가 원래 격리 GAS와 일치하는지, 익명 차단, 실제 소유자 인증,
   2026-11-27 원문의 서버 수신·UTF-8 SHA-256, 로그아웃 후 차단을 점검한다.
6. 실패 시 생성 ID가 확인된 새 키만 회수한다. 결과가 불명확하면 자동 재생성하지 않는다.
   이미 존재하는 전용 Worker나 기존 키가 있으면 덮어쓰기·회전하지 않고 검토 대상으로 남긴다.

입력은 기존 Cloudflare Account ID/token, MY INVEST 소유자 ID/비밀번호, 승인된 보관함
주소 또는 ID이며 숨김 입력이다. Google 비밀번호나 서비스 계정 키를 채팅에 요청하지 않는다.
출력의 `PRIVATE_READER_LIVE_API_VERIFIED`는 서버 API 검증만 의미한다.
일반 회원 실제 시험·브라우저 원문 표시·다음 예약 저장은 각각 NOT_RUN으로 유지한다.
현재 개발 사이트의 승인된 성능 개선판과 주 Worker/OAuth 경로는 그대로 두며,
후속 프런트엔드 통합에서는 소유자 login/비공개 원문 action만 전용 경로로 연결해야 한다.

### 직접 업로드 패키지 호환성 보완

owner 최초 실제 실행은 Worker 업로드에서 HTTP 400으로 중단됐고 생성 키는 회수됐다.
기존 결과에는 제공자 코드가 없어 그 응답만으로 정확한 거부 사유를 확정할 수 없었다.
직접 업로드의 모듈 지원 형식에 맞춰 `policy.json`을 별도 application/json 모듈로 보내지 않고
공개 JavaScript 안에 포함한다. JSON MIME은 metadata에만 사용한다.
키 생성 전 이 실제 패키지를 외부 fetch가 차단된 Node에서 import·실행 검증한다.
컴파일 실패 시 키 생성·업로드는 0건이다. 서버 오류 시 원문 오류 메시지나 비밀값 대신
requestStage·숫자 providerCodes·고정 범주의 providerHints만 반환한다.

### 업로드 후 저장소/로그 확인 중단 상태

두 번째 owner 실행에서는 전용 Worker 업로드까지 성공했지만
`PRIVATE_STORAGE_OR_NO_LOGGING_UNCONFIRMED`로 중단됐고 새 키는 회수됐다.
이 결과만으로 저장소 바인딩 오류인지 관측 설정의 조회 위치 차이인지 확정하지 않는다.
`tools/inspect_private_news_worker.py`로 전용 Worker의 `/settings`,
`/script-settings`, 활성 버전 바인딩과 실제 업로드 코드만 GET으로 비교한다.
부재 값을 비활성화로 간주하지 않는다. 출력은 boolean/고정 상태/버전 ID만 포함하며
비밀값·namespace ID·원문·코드 본문은 출력하지 않는다.
이 점검은 Google 인증·키 생성·GAS·주 Worker·설정 쓰기를 수행하지 않는다.
현재 전용 Worker가 존재하므로 최초 설치 명령을 반복 실행하거나 Worker를 삭제하지 않는다.

### Resume the inspected private Worker (2026-11-27)

The owner inspection confirmed active/latest version
`b23968a4-80ee-4453-b061-8551d317b4a4`, exact uploaded modules, and matching
`RelayGate` namespace in both metadata views. Cloudflare omitted observability
fields while reporting Logpush false. Omission alone is not a logging-off proof.
The previous attempt revoked its new key; it did not delete this Worker.

`tools/deploy_private_news_reader.py --apply --resume-private-version VERSION`
requires the exact still-active/latest version, original deployment marker,
expected public binding values and secret binding types, identical modules, and
matching namespace. Unknown bindings, foreign code, pending versions, or concurrent
changes stop before key creation. It explicitly PATCHes only this private Worker's
`script-settings` with `observability.enabled=false` and `logpush=false`. A successful
acknowledgement and two settings reads must report Logpush false, no tail consumers,
and observability false or the provider's omitted representation. The report names
that representation `ABSENT_AFTER_EXPLICIT_DISABLE`; read-only absence is never
accepted as equivalent evidence.

After this check, one replacement service-account key moves only through RAM to
Worker Secrets. The upload omits migrations and must retain the existing namespace.
Primary Worker code/settings, pending calendar version, GAS, folder permissions,
and original files remain untouched. Failure revokes only the newly created key.
The owner command still requires hidden existing Cloudflare credentials, dashboard
owner credentials, and the approved original folder address. No private key file
is created. Local provisioning simulations do not establish live API, browser,
general-member denial, or future scheduled-save success.

### Original receipt failure diagnostics (2026-11-27)

The owner successfully uploaded the resumed Worker, but the original receipt/hash
check failed. Its new key was revoked. This establishes neither a file-read success
nor a hash mismatch: the previous combined check hid the distinction.

Before any further upload, the installer now runs the exact existing Drive reader
in a local Node child process using the dedicated service-account key through an
anonymous stdin pipe. No key or original file is written. Only fixed stage names
(TOKEN, LIST, MEDIA), numeric HTTP status, fixed error categories, byte count and
SHA-256 can leave that process. It uses the same pinned folder, scope, date and
reader checks as the Worker, without owner impersonation. Newly created keys can
require 60 seconds or more to propagate, per Google's official key-management
documentation. Only token-stage transient failures are retried, with bounded
2/4/8/16/30 second backoff on the same RAM-held key; Drive permission/file/schema
failures stop directly. This is a possible cause to check, not an established
explanation of the owner's earlier failure.

The live server response is separately checked for HTTP status, success, no-cache
contract, date, content type, internal hash, source hash and source byte count.
Failures report only booleans and allowlisted codes. On success the output includes
source/server hashes and their equality; DOM and future scheduled-save validation
remain NOT_RUN. Failure still revokes only the newly created key.

`--resume-private-version inspected-active` selects the active private version by
read-only inspection at command start, then applies all existing exact code,
role, binding, namespace, latest-version and concurrency guards. This avoids
reusing the stale version ID after a preceding successful upload. It does not
permit foreign code or unreviewed bindings, and never changes the primary Worker.

Official reference: https://docs.cloud.google.com/iam/docs/keys-create-delete

### Worker-only archive failure and exact revision readiness (2026-11-27)

The owner's latest execution passed the dedicated service-account source read in
Cloud Shell, then the Worker returned HTTP 200 with success false and
`PRIVATE_BRIEFING_ARCHIVE_UNAVAILABLE`. No original content was returned. The false
hash flags therefore do not establish a hash mismatch. Its new key was revoked.

An actual workerd 1.20261127.1 local runtime probe (compatibility 2026-11-01) passed
PKCS8 import, JWT signing, token response validation, Drive list/media parsing and
original hash verification against synthetic transports. This is a runtime/mocked
transport check, not a successful Google request from Cloudflare.

The old appVersion readiness check only compared unchanged GAS metadata, so it
could accept a preceding Worker with the prior revoked key during propagation.
This is a confirmed readiness defect, but its contribution to the owner's failure
is not yet proven. Each upload now generates a new non-secret deployment marker;
the private appVersion advertises it, and the installer waits for that exact marker
before logging in or requesting the original. It never treats matching GAS metadata
alone as evidence that the new private upload is serving traffic.

The reader reports only allowlisted KEY_IMPORT/TOKEN_SIGN/TOKEN_REQUEST/
TOKEN_RESPONSE/LIST/MEDIA stages and numeric HTTP statuses to an already authorized
owner on failure. No provider message, URL, key, token, folder ID, file ID or content
is included. The Worker strips unexpected diagnostic fields and stages. Transient
Worker token failures retry with a bounded backoff on the same key/session; owner
permission denial and list/media failures stop without retry.

Resume accepts the exact current package or the one exact public package previously
uploaded by the owner (source 658803e), with both module SHA-256 values pinned in
the installer. Arbitrary historical versions and mixed packages are not accepted.
All role, bindings, existing namespace, latest-version and concurrency checks remain.
The namespace stays unchanged; the new marker is intentionally rotated on upload.

### Confirmed unsupported redirect option and fix (2026-11-27)

The owner reported `archiveStage=TOKEN_REQUEST, archiveHttp=null` after exact
revision readiness passed. A workerd Request-construction reproduction confirmed
that Workers rejects `redirect: 'error'` with TypeError before sending HTTP; it
supports only `follow` and `manual`. Node and the previous injected fetch mocks
accepted/bypassed this option, so their passing results missed the platform defect.

The token POST and both authenticated Drive GETs now use `redirect: 'manual'`.
Their existing `response.ok` checks reject all redirect responses without following
Location. Credentials therefore remain on the fixed Google endpoints. No OAuth
scope, archive ACL, account identity, original file or primary Worker change is
needed. Resume now pins the preceding owner-uploaded package from source 0640f48.

The committed opt-in runtime regression exercises actual workerd Request/fetch
semantics, with globalOutbound routed exclusively to an internal synthetic service
(no internet service configured). It reproduces the old TOKEN_REQUEST failure,
checks the successful original SHA-256, and rejects TOKEN/LIST/MEDIA 302 responses
without any request to the redirect destination. Five runtime scenarios passed.
All keys and texts in that fixture are newly generated synthetic test material;
real owner keys are never used or written by the test.

Example (using an already installed workerd 1.20261127.1):

```
python tests/workerd_private_reader.py \
  --workerd /path/to/node_modules/.bin/workerd \
  --schema /path/to/node_modules/workerd/workerd.capnp
```

Actual Cloudflare-to-Google success and original DOM display remain unverified
until the owner runs the corrected installer and the browser test is completed.

### Owner live API receipt and frontend integration (2026-11-27)

The owner-run corrected installer reported PASS, private Worker version
`61638b2a-0335-4b03-9822-2dbbf3840f4f`, Worker source
`f017593cb193be57a8a189811a7f5af96bba8bbc`. Original date 2026-11-27,
16,526 UTF-8 bytes; source and server SHA-256 both:
`688fb86de4e2d2f03c90703b69164c820d7e9c2147247cfc372dde5b35a2fff3`.
Anonymous and revoked/logout tokens were denied. Existing namespace and primary
pending version were preserved, no primary/GAS/archive/ACL/account writes or NH
calls occurred. This establishes a live API read and hash comparison, not DOM
rendering or a future scheduled save. The November 27 file is owner-recovered.

The already published performance implementation at source 34cc071 is reused via
file-level three-way integration from common ancestor 374a219, preserving the PR17
news reader and compact navigation/account-table UI. No new optimization is added.
For transport concurrency the currently published 34cc071 implementation (two
physical slots) is retained; the preceding unpublished third-lease rescue test is
updated to verify the published physical-slot rule. The published implementation's
existing regression fixtures are carried forward as well. No branch/PR is merged.

The PR17 development build now retains the primary relay for public market,
accounts, session metadata and Calendar, including existing Calendar form CSP.
A second exact endpoint is pinned only for appVersion capability probing,
login/logout and privateMorningBriefing. Before enabling it, both relays must
advertise the same isolated GAS script/sheet/source hashes; the private relay must
advertise its owner-login authority, feature and revision marker. Credentials are
sent once to the selected endpoint, without replay/fallback. Missing private
capability leaves the main dashboard available and disables the private reader.
Existing primary-issued sessions need a new login to obtain the private server's
hashed owner-session proof. Members and other admins do not acquire that proof.

Both origins are explicitly permitted by the development CSP. The private endpoint
is never substituted for the primary relay. Calendar data from the actual current
dev-pages checkout is still independently validated and preserved. Previous
publication markers from the user-approved performance source branch are accepted
only as existing target metadata, not as permission to publish arbitrary sources.

Local validation: all 117 Node test files and 429 Python tests passed before the
additional build/live-receipt tests; private original browser synthetic scenarios
passed at 1440/690/344 (8 scenarios), including normal dual-endpoint bootstrap,
late capability, hash verification, no HTML execution and cleanup. Additional
publication and owner-browser receipt unit tests passed. These are synthetic.

`tools/verify_private_news_live_browser.py` is an owner-terminal, read-only browser
check for the real published news page. It requires only hidden existing dashboard
ID/password (no Google/Cloudflare keys). It checks the exact published source,
anonymous denial, source/server/DOM SHA-256 and byte count, 1440/690/344 layout,
no persistent original copy and logout cleanup. Its network guard permits only
fixed development assets plus appVersion/login/logout/sessionInfo/private reads;
NH/account/public-market requests are explicitly blocked rather than simulated.
No screenshots, browser traces, keys or original report files are written. The
printed result contains only hashes, counts and statuses; other-member and next
actual scheduled-save results remain NOT_RUN. It requires an installed Playwright
Chromium runtime and fails without exposing browser exceptions or credentials.

CI for integration source 2976a00 stopped in browser_native_snapshot's shell-less
synthetic fixture: the published implementation intentionally does not start hidden
account reads, but the old owner-browser helper/test waited for one. The fixture now
clicks its existing visible read button before the two exact account waits, matching
the currently published behavior. No account/GAS/owner-live helper was modified.
The fixture also explicitly aborts every remote request except its literal synthetic
GAS target (fulfilled in process); only loopback frontend assets may continue.
After this guard was inspected, all three native mock/browser/CORS scenarios passed.
The first unguarded local rerun was rejected by automatic approval review as a
possible live NH path; it was not run. The guarded offline variant was approved.

### Development publication receipt (2026-11-27)

Published frontend source: `388acca3725cb5f20f2cbecd8bc31a7ca96a9ccb`.
Development Pages commit: `bcb6fe971851973e04d76c00b6190cdb6af3be5f`.
URL: https://kocoro97-corab.github.io/dashboard-v2-dev/index.html#/news
Both source CI runs passed (push 45939891778, PR 45939899416); Pages reported built
for that exact development commit. Live HTTP hashes matched asset-manifest for
index, transport, connection bootstrap, private original reader, news page and four
representative calendar datasets. The build retained all prior validated public
calendar snapshots. The prior target was d9ddab96d3175fbae8dd4a5713a2d869c5ee84e5.
No source PR merge or operating deployment occurred.

The managed Codex environment receives HTTP 403 when accessing the live Worker,
so real owner DOM rendering cannot be asserted from this machine. The owner was
asked to log out/re-login on the published news page (existing primary-only tokens
lack the private reader's server-side owner proof). Actual owner UI/DOM hash and
ordinary member denial remain NOT_RUN until evidence arrives. Next actual 07:00
save remains NOT_RUN; the recovered November 27 original is not scheduled-save proof.

The full owner-browser verifier is now itself tested with exclusively in-process
synthetic APIs and local frontend artifacts. It checks the original source/server/
DOM hashes and three viewport widths and logout removal. No real request is allowed
to continue in that fixture. Logout receipt is checked by HTTP status and DOM
removal: awaiting an ignored logout fetch body can hang CDP after the view unmounts.
Server token revocation is separately established by the owner's live API test;
the browser tool does not claim an additional revoked-token test. Phase progress
and bounded teardown expose no original content or credentials. The new fixture is
included in secret-free PR CI. These helper-only changes do not republish the UI;
the verified publication above continues to be the frontend source of record.

### Fold owner denied screen: visible logout control regression (2026-11-27)

The owner's Fold screenshot showed the private card's authorization-denied message.
The owner confirmed that the browser ID is the same ID used for the successful
Cloud Shell original read. This rules out assuming an ID mismatch; it does not
establish that the browser's token was issued through the private owner login.
The session timer resets on activity and is not proof of a fresh login.

A confirmed UI defect prevented the normal recovery action: dashboard-presentation
moves the session buttons into the app header, where DevelopmentInspection's broad
query/store-control disable selector also disabled logout. Prior browser regressions
called logout() directly and missed the broken button. The development-only control
filter now explicitly keeps that existing logout button enabled, regardless of its
position; other query/store controls retain their restrictions. No auth, GAS,
Worker, secret, permissions or account/order path is changed.

The private-card denial text now distinguishes a session without original-read
permission and directs an explicit logout/re-login using the same owner ID.
Browser fixtures now model primary-issued tokens without owner proof: they must
remain denied until the actual visible logout button and login form are used.
The 344px fixture opens/closes the existing header menu using its summary control;
it never force-clicks through overlays or bypasses the logout function. All eight
private-original browser scenarios and the owner-verifier synthetic scenario
passed at 1440/690/344. The read-only owner verifier also uses the visible button.
CSP-safe wait predicates are functions, avoiding string-evaluation restrictions.

This fixes the disabled recovery control and reproduces the primary-token recovery
path. The actual owner's original display remains FAIL/awaiting recheck until the
new development build and a real visible logout/re-login are verified. The screenshot
alone cannot establish every server-side denial cause; no privilege is broadened.

CI 45953830301 passed for 01ee180; its independent PR run 45953837882 reached the
new owner-verifier mock scenario, verified all original hashes, but timed out at
logout after rapidly resizing 1440→690→344. The viewport-dependent header menu is
updated on animation frames; an immediate visibility check could race its closure.
The verifier now waits for two animation frames after each viewport change, then
uses the actual menu/logout controls. It explicitly checks an enabled logout
button, reports separate control/response/DOM phases, and reports an attempted
browser failure as PARTIAL rather than NOT_RUN. Three independent fresh-context
synthetic repetitions passed with no external Google/NH calls. No timeout increase,
force click, test removal, permission change or additional application behavior
change was used for this timing correction.

### Formatted viewer for the original rich briefing (2026-11-27)

After development publication c7eb1d73 the owner confirmed that the original is now
visible, but the literal source display is not a usable viewer. A read-only format
inspection found Markdown headings/tables plus ChatGPT grid/grid-item, box, title,
row, caption, text, Cite, Link, icon/divider and SVG shape notation. No original
content was copied into fixtures or rewritten in Drive.

`js/private-briefing-viewer.js` maps that presentation into explicitly constructed
DOM nodes. It renders headings, emphasis, lists, tables, cards, captions and bounded
SVG shapes. It never uses innerHTML, DOMParser, eval, a component runtime or an
iframe. Supplied styles/JS props/events are not executed. Script/resource/form/
foreignObject/use tags are excluded; SVG attributes are restricted to bounded
numeric geometry, known paint values and path data. Image resources are never
loaded. Links permit absolute HTTP(S) only without embedded credentials and use
noopener/noreferrer. Unresolvable ChatGPT internal Cite IDs become plain original
citation markers; no citation URL, news item, calculation or market value is invented.
The viewer has text/node/depth limits and preserves the unchanged raw source if
formatting cannot be completed.

The default article is formatted; '원문 보기 · 서식 코드 포함' is collapsed. Its raw
pre text retains the exact receipt, including CRLF, markup and original SHA-256.
The file, private API contract, owner gate, backend key and original archive remain
unchanged. This is an in-memory presentation of the same response, not another
stored file or a public feed. Both article and source clear on refresh/logout.

Formatted visible text necessarily differs from markup bytes. The owner verifier
now labels hash scope as `unchanged-raw-source-details`, checks formatted content
is present, and reports heading/table/card/diagram structure. It does not claim
that formatted visible text has the original markup SHA. Synthetic fixtures assert
raw source hash, closed source details, safe structured DOM and no attempted image/
SVG-resource request at 1440/690/344. Malicious source scripts, event attributes
and remote resource values are included only in synthetic fixtures. Optional local
screenshots explicitly show SYNTHETIC ONLY content; live owner verification still
writes no screenshot, trace, original or credential file.

Validation before CI: all 118 Node files, all 432 Python tests, the eight private
original browser scenarios and the structured owner-verifier mock passed. Real
formatted owner display remains pending development publication/recheck. Next real
scheduled save remains NOT_RUN, independent of the owner's recovered November 27 file.
