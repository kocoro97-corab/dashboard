# MY INVEST V2 — Codex 최종 캘린더 통합·실데이터·배포 인수 지시서
**인수 기준일:** 2026-11-23 (KST)  
**저장소:** `kocoro97-corab/dashboard`  
**단일 개발 기준 브랜치:** `feat/nh-integration-v2`  
**운영:** `main`, `release/pages`, 운영 GAS/Sheets/Properties, 운영 NH는 변경 금지(별도 승인 필수).

## 0. 수행 원칙

1. 지금까지 GPT가 추가한 파일을 **우선 사용**한다. 처음부터 다시 만들거나 기존 파일을 삭제하지 않는다. 현재 브랜치 최신 HEAD를 반드시 다시 fetch하여 다른 작업자의 변경을 보존한다.
2. **개발 → 자동 테스트 → 오류 수정 → 재검증**은 별도 재승인 없이 진행한다. 기능 추가·개발계획 변경 또는 운영 반영·실계정 자격증명 설정은 사용자 승인 대상이다.
3. 계좌는 조회 전용. **주문 API 호출·NH 실계좌 변경·외부계좌 저장·증권사 유료 데이터 호출**은 이 작업에서 불허한다. 공공 일정은 필요한 최초 조회·강제 갱신 외에는 캐시 재사용.
4. **실데이터가 없는 항목은 미연결로 표시**하고 예정일·시각·경제 수치·예상치·실제치·매매 신호를 만들어내지 않는다.
5. 개인 Google 캘린더는 인증된 사용자만; 개인 일정/Google OAuth 토큰/계좌·보유수량은 절대 public JSON/GitHub Pages/로그/AI 전략 전송 금지.
6. 테스트에서 "PASS"라고 보고할 때는 실행한 명령, 커밋 SHA, 실제 출력/CI URL, 실패/미실행 구분 필수. 모의 브라우저는 실제 계정·실기기 검증으로 표현하지 않는다.

## 1. 이미 구현된 기능 — 재개발 금지

### 시장·휴장·일정/화면
- `js/page-news.js`: `#/news`의 투자 캘린더, 수동 일정, 개인 .ics, Google 연결 상태, BLS/BEA/BOK/FOMC/실적 배지, 출처 링크, 보유·관심종목 표시.
- `js/calendar-market-holidays.js`, `js/calendar-korean-holidays.js`: 미국 시장 휴일/한국 휴일·KRX 휴장. 확인된 연도만 사용.
- `js/calendar-ics-import.js`: 세션 내 ICS 읽기/중복 제거/삭제, 반복 규칙은 최초 DTSTART만 지원.
- `js/economic-bls-parser.js`, `js/economic-calendar.js`: BLS CPI·고용·PPI·JOLTS·ECI 공식 ICS, EDT/EST/UTC 변환, KST 스냅샷 검증.
- `js/economic-bea-parser.js`, `js/economic-bea-calendar.js`: BEA GDP·PCE·무역수지·기업이익 공식 JSON 발표시각/캐시/출처 검증.
- `js/economic-fomc-schedule.js`: 미국 FOMC 2026~27 공식 회의 종료일 **날짜만**; 2027-10-27 전략회의는 정례 금리결정 없음으로 별도 분류.
- `js/economic-bok-policy.js`, `js/economic-bok-stats-parser.js`, `js/economic-bok-stats-calendar.js`: 2026년 금통위 8회 및 한국은행 공식 통계 공표일정/한국시간.
- `js/earnings-calendar.js`: 확정/예상/미확인 구별, 보유·관심종목 **로컬 매칭**, 실적 설명회 여부, 보수적 단타·스윙 발표일 위험 표시.
- `js/invest-event-context.js`: 글로벌 시장·산업/테마·전략의 공통 **공식 근거 이벤트** 재사용. 개인 일정 제외, 추가 API 조회 없이 수신된 캐시 활용, 필요시 펼쳐보기에서 명시적 갱신.
- `js/page-market.js`, `js/page-sectors.js`, `js/page-strategy.js`: 공식 출처 확인 UI / 향후 14·21일 위험 점검. 매매 실행 없음.

### 퍼블리셔·Google 연결 기반
- `scripts/collect-economic-calendar.cjs` → `data/economic-events.json` (BLS).
- `scripts/collect-bea-calendar.cjs` → `data/bea-events.json` (BEA).
- `scripts/collect-bok-calendar.cjs` → `data/bok-stats-events.json` (BOK).
- `scripts/build-earnings-snapshot.cjs` → `data/earnings-events.json` (**검증된 기업 발표 자료 입력 필수**, 더미 금지).
- `scripts/calendar-release-audit.cjs`: 파일·유효기간·메뉴 로딩 경로 인수 점검.
- `.github/workflows/{economic-calendar,economic-bea,economic-bok,earnings-calendar,calendar-tests}.yml`: 개발 브랜치 테스트·스냅샷 게시 워크플로 설계.
- `js/calendar-google-{sync,auth,transport}.js`: 기능 플래그 `googleCalendarReadOnly` 기본 꺼짐, 조회 전용 연결/확인/해제/캐시.
- `server/google-calendar-oauth-service.cjs`, `server/google-calendar-google-api.cjs`: Node 서버 측 OAuth PKCE + 암호화 토큰 + 읽기 전용 API **주입 가능한 코어 서비스**. 실제 HTTPS 라우트/신뢰 세션 인증/비밀정보 저장소는 아직 없음.

## 2. 최우선 작업 (P0) — 기존 회귀 실패부터 해소

1. 최신 개발 HEAD를 받아 기록한다. 다른 작업자의 커밋 덮어쓰기 금지.
2. Node tests:
```bash
node tests/economic-bls-parser.test.js
node tests/economic-bea-parser.test.js
node tests/economic-bea-calendar.test.js
node tests/economic-bea-collector.test.cjs
node tests/economic-fomc.test.js
node tests/economic-bok-parser.test.js
node tests/economic-bok-calendar.test.js
node tests/economic-bok-collector.test.cjs
node tests/earnings-calendar.test.js
node tests/earnings-publisher.test.cjs
node tests/invest-event-context.test.cjs
node tests/calendar-ics-import.test.js
node tests/calendar-google-sync.test.js
node tests/calendar-google-auth.test.js
node tests/calendar-oauth-backend.test.cjs
node tests/calendar-google-api.test.cjs
```
Node 22 구문/테스트, Python 저장·배포 테스트, 기존 전체 CI, 모의 브라우저를 **실제로** 실행한다.
3. 기존 PR regression GitHub Actions #45118286473은 Node·GAS·Python은 PASS였지만, 브라우저 마지막 `tests/browser_accounts_profile.py`에서 **1440/690/344px 각 `Page.wait_for_function: Timeout 12000ms`** 실패. 합성 계좌 프로필 시나리오 문제로 추정하되 정확한 재현/로그 식별 후 관련 없는 계좌 로직을 변경하지 말고 테스트 하네스·원인을 먼저 조사한다. 실제 계좌 호출 금지. 이후 CI 전체 PASS까지 재실행.
4. 캘린더 팝업의 344/690/1440px 스크린샷, Escape/Tab 포커스, 일정 근거 링크, 날짜 경계, 중복/강제갱신, 로그인/로그아웃 시 비공개 캐시 삭제 확인.
5. `node scripts/calendar-release-audit.cjs`로 현재 미연결 항목을 추적하고 실데이터 준비 완료 시 `--strict` 재검증.

## 3. P1 — 공식 경제 일정 실데이터 수집·검증·반영

1. 실제 BLS `https://www.bls.gov/schedule/news_release/bls.ics` ICS 파일의 **현재 2026-27 이벤트**로 `DTSTART` UTC/동부시간/종일 일정/취소/중복을 검증한다. 모호한 시간은 임의 8:30 ET 등으로 치환하지 않는다. `js/economic-bls-parser.js`는 UTC/Eastern 경로까지 구현했으며, 실제 콘텐츠 호환성 최종확인 필요.
2. 실제 BEA `https://apps.bea.gov/API/signup/release_dates.json`의 2026-27 GDP, Personal Income and Outlays(PCE), 무역 발표와 UTC/KST 변환을 확인한다. 공식 JSON이 공급하는 날짜만 사용.
3. 한국은행 `https://www.bok.or.kr/portal/stats/statsPublictSchdul/listCldr.do?menuNo=200775&year=2026`의 **실제 HTML 테이블**로 공표일·시각·분류를 검증한다. `js/economic-bok-stats-parser.js`가 HTML 변경 시 차단하도록 설계됨. 필요하면 현재 연도 및 **공식 확인된 2027년** 일정을 추가하되 날짜/시간 추정 금지.
4. 각 퍼블리셔가 실패하면 이전 자료를 침묵 속에 덮어쓰지 않아야 한다. 스냅샷마다 `sourceUrl, retrievedAt, source`와 목록의 `verified, startsAt, date` 일치 확인. BLS 48시간, BEA/BOK 72시간 유효기간 준수.
5. 개발 사이트 `dev-pages`의 정적 호스팅 경로에 위 JSON이 실제 게시·갱신되는지 **HTTP GET/캐시 만료 후 UI**로 확인한다. 현재 파일은 커밋되지 않았거나 조회 불가할 수 있으므로 파일이 없으면 `미연결`이 정상. 만료/누락 시 결과를 꾸며내지 않는다.
6. GitHub `schedule` 이벤트는 일반적으로 **기본 브랜치의 워크플로**에서 동작한다. 개발 브랜치의 `push/workflow_dispatch`만으로 정기 일일 수집이 되지 않는다. 안전한 별도 스케줄러/기본 브랜치 변경을 제안하고 **운영/main 변경 승인 후** 활성화할 것. 무단 PR 머지·운영 배포 불가.

## 4. P2 — 한국·미국 기업 실적 실제 공식 근거 수집

1. SEC EDGAR `https://data.sec.gov/submissions/CIK##########.json` 또는 OpenDART/거래소는 **공시 제출 이력**이며 미래 실적 발표의 확정일이 아니다. **기업이 직접 공시한 향후 실적발표/컨퍼런스콜 날짜**가 명시된 공식 IR·공시 원문만 verified confirmed로 취급한다.
2. 종목 마스터/보유 종목/관심 종목은 기존 읽기 전용 데이터 구조를 **브라우저 내에서만 조인**하고 서버/퍼블리셔에 계좌번호·보유 수량·평단가를 전달하지 않는다. 동일 종목·분기 중복을 제거한다.
3. 공식 소스의 실제 `sourceUrl` allowlist(SEC/DART/KRX + 검증된 발행사 IR)를 만든 뒤 수집 어댑터를 구현한다. 사이트 약관/robots/rate-limit/공시 라이선스를 준수한다.
4. 현재 실적 **예상일 공급자 라이선스가 확인되지 않아 추정 일정은 의도적으로 차단**되어 있다. 승인된 상업 공급자와 이용 조건이 확보될 때만 해당 어댑터를 활성화하고 확정과 별도 표기한다. **허구 도메인이나 무허가 크롤링 금지.**
5. 1건 이상 실제 근거 확인 → 내부 검토 입력(`verifiedAt`, `evidence`, 날짜) → `node scripts/build-earnings-snapshot.cjs /private/reviewed.json` → 공개 JSON에 비공개 필드가 없는지 확인 → 개발 사이트 표시.
6. 날짜가 미확인인 보유·관심 종목은 위험이 낮은 것이 아니다. 투자전략/산업·테마별 이벤트 영향은 **정량 확정값/시장 반응 데이터 없이 방향성 매매 신호를 생성하지 않는다**.

## 5. P3 — Google 캘린더 **진짜 읽기 전용 OAuth**

1. 기존 JS 브리지 / Node 코어를 재사용하고, **별도 HTTPS 신뢰 백엔드**를 구축한다. MY INVEST 로그인 토큰을 권위 있는 세션 발급자에게 검증하여 사용자별 Google ID와 바인딩하고 CSRF state/PKCE를 1회용 TTL 저장소에서 atomic consume.
2. Google Cloud OAuth 클라이언트/승인된 redirect URI/동의 화면 설정은 사용자의 실제 계정/프로젝트와 **명시적 동의** 필요. 클라이언트 secret, AES 키, refresh/access token은 서버 측 비밀 관리 도구에만 보관. GitHub/Pages/로컬 스토리지/URL/로그에 노출 금지.
3. 중계 서버에 5개 명시적 작업 구현·allowlist:
 `googleCalendarStatus`, `googleCalendarBegin`, `googleCalendarList`, `googleCalendarEvents`, `googleCalendarRevoke`.
 callback은 backend에서만 처리한다. 기존 GAS가 특정 사용자 개인 일정에 무인 소유자 권한으로 접근하도록 하지 말 것.
4. 연결/재확인/연결 해제/로그아웃/토큰 만료/다른 사용자 접근/동시 로그인/권한 거절/권한 쓰기 scope 차단, 캘린더 선택/다중 시간대/반복·취소 일정까지 테스트한다.
5. `googleCalendarReadOnly`은 기본 false를 유지하고 백엔드 + OAuth + 접근권한 테스트 완료 뒤 **개발 환경에서만** true. 개인 일정은 투자전략 입력으로 자동 전달하지 않는다.

## 6. P4 — 메뉴·전략 통합 실검증

1. `#/news`: 한국/미국 휴장, BLS/BEA/BOK/FOMC, 기업 확정 실적, 개인 ICS/Google 각각 정확히 구분. FOMC 미국 현지 **회의일**과 BEA/BLS의 **KST 정확한 시각** 혼동 방지.
2. `#/market`, `#/sectors`: 추가한 **공식 이벤트 근거자료 펼쳐보기**가 접힌 기본 상태에서 새 API 호출하지 않는지, 펼치면 공통 캐시/한 번의 조회만 실행되는지 확인. 근거 클릭 시 공식 URL.
3. `#/strategy`: 단타 2일/스윙 14일 실적 위험 구분, 14일 글로벌 경제 이벤트, 실제치/예상치/시장 반응 미연결 표시. **근거를 보여주는 것과 투자 결정을 자동화하는 것을 구분**한다.
4. 개인 Google 일정은 경제/실적 근거와 결합하지 않음. 전체 조회 로그에 개인정보·토큰 출력 0건, 주문 및 계좌 저장 호출 0건.

## 7. 릴리스 게이트·인수 보고

**아래가 모두 충족되기 전에는 운영 게시 금지:**
- 보유중인 모든 캘린더 단위 테스트·기존 CI·브라우저 합성 회귀 100% PASS
- 공식 BLS/BEA/BOK 실제 스냅샷 생성·신뢰성·기간·UI 표시 PASS
- 검증된 실적 발표일의 실데이터 1건 이상과 출처 PASS (없으면 '미연결' 명시 후 별도 사용자 의사결정)
- Google 인증은 사용자 동의/서버 배포 준비 없으면 기능 OFF 유지
- PC 1440, Fold6 접힘/펼침 344·690 등의 뷰포트/모바일 실제 점검
- `main`/`release/pages` 및 운영 GAS/Sheets/Properties 변경 **0건**, NH 주문·계좌 변경 **0건**
- 사용자에게 최종 운영 반영 승인 재요청

**최종 보고서 필수 항목:** 커밋 SHA 목록, 변경 파일, 실제 사용 데이터 소스/수집시각/표시 이벤트 건수, 테스트 실행 명령과 성공·실패/미실행, API 요청 횟수 및 캐시 효율, 개인정보 검증, 실계정 검증 유무, 잔여 차단 사항, 개발 사이트 캡처 및 운영 반영 승인 요청 여부.

위 범위 내 구현·수정·테스트는 계속 자율 진행하고, **추가 기능 또는 개발계획 변경**만 사용자 승인 요청.
