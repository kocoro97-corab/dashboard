# MY INVEST V2 — 사용할 수 있는 투자 일정 캘린더 V2

## 구현 범위와 현재 상태

개발 브랜치 `feat/calendar-workspace-google-readonly-isolated`. 코덱스 통합 브랜치 `integration/news-strategy-20261121` 커밋 `e485fc9c89ee618590274d05b6710baa42a0bc1c`에서 분기했습니다.

기존 뉴스·이벤트 메뉴의 '▦ 투자 캘린더' 버튼과 앱 상단 '▦ 일정' 버튼을 유지하면서 새 자체 캘린더를 열도록 연결했습니다. 원본 소스 중 `js/page-news.js`에 위임/변경 알림/페이지 나가기 시 인증 정리만 최소 수정했습니다. 그 외 일정·Google·화면·빌더·테스트는 새 파일입니다.

**현재는 독립 브랜치와 임시 CI 검증 아티팩트에만 적용**하며 `main`, `release/pages`, Codex 통합 브랜치, `dashboard-v2-dev/dev-pages`, 운영 GAS/Sheets/Properties, 실제 NH API 또는 주문을 변경하거나 배포하지 않습니다.

## 기능

| 구분 | 실제 제공 기능 | 제약 |
| --- | --- | --- |
| 자체 투자 캘린더 | 날짜별 월간 보기, 이전/다음 달, 오늘, 날짜별 일정 표시 | 표시는 서울 시간 |
| 수동 일정 | 등록·수정·삭제, 날짜/시간(선택)/분류/메모 | 최대 100개, 이 브라우저의 localStorage |
| 기존 일정 연결 | 기존 `myinvest_events_manual_v1` 데이터를 그대로 읽고 같은 저장소에 기록 | 다른 기기 자동 동기화는 안 됨 |
| 기존 뉴스 연계 | 캘린더에서 바꾼 수동 일정이 기존 뉴스·이벤트 목록에도 즉시 반영 | 기존 내용은 지우지 않음 |
| Google ICS 가져오기 | 사용자가 직접 선택한 최대 2MB `.ics` 파일만 브라우저에서 파싱하여 병합 | 라이브 동기화가 아님. 일부 RRULE/낯선 TZID는 건너뜀 |
| 내 일정 ICS 내보내기 | 수동·가져온 로컬 일정을 Google로 가져갈 수 있도록 `.ics`로 내려받기 | Google에서 읽기 전용으로 조회한 개인 일정은 내보내기에 포함하지 않음 |
| Google 직접 조회 | Google Identity Services에서 사용자가 명시적으로 승인하면 **기본 캘린더(primary)**의 해당 월 이벤트만 읽기 전용으로 조회 | Google Cloud 웹 OAuth 클라이언트 ID 및 허용 origin 설정 필요 |
| 구글 연결 해제 | 단기 액세스 토큰 브라우저 메모리에서 제거 및 가능한 경우 OAuth 동의 철회 | 자동 재연결/백그라운드 폴링 없음 |

### 본인 PC/폴드6의 일정 동기화 주의

- 자체 수동 일정은 **브라우저 로컬 저장소**에만 저장되므로 PC와 폴드6 간 자동 공유되지 않습니다.
- `.ics` 파일 가져오기/내보내기는 수동 이동 기능이며 Google Calendar의 실시간 연동이 아닙니다.
- Google의 실시간 일정은 OAuth 승인 후 사용자 버튼을 눌러 읽기 전용으로 조회하므로, 브라우저 저장소에 동기화 기록을 남기지 않습니다.
- 실제 **양방향 Google 쓰기·자동 일정 생성·전 기기 공유**는 기존 `docs/invest-calendar-sync-design.md`에 정리된 별도 MY INVEST 캘린더 ID, 승인 정책, 서버 감사/토큰 저장을 갖춘 다음 작업입니다. 이 브랜치에서는 의도적으로 구현하지 않습니다.

## Google 실시간 읽기 연동 활성화 준비

1. Google Cloud Console에서 Calendar API를 사용 설정합니다.
2. Google Auth Platform에서 **웹 애플리케이션 OAuth 클라이언트 ID**를 생성합니다.
3. Authorized JavaScript origins에 검증용 웹사이트 Origin(예: `https://kocoro97-corab.github.io`)을 명시적으로 등록하고 OAuth 동의 화면에 테스트 계정을 설정합니다.
4. 검증 아티팩트 생성 시 **공개 OAuth 클라이언트 ID만** `build_calendar_review(..., google_client_id='...apps.googleusercontent.com')`로 전달합니다. 클라이언트 **시크릿, 액세스 토큰, refresh token, 구글 이메일은 전달하지 않습니다.**
5. 해당 설정이 있으면 임시 빌더가 GIS SDK와 `accounts.google.com`/`www.googleapis.com`용 최소 CSP 도메인을 **임시 결과물에만** 허용합니다.
6. 화면에서 직접 'Google 읽기 전용 연결' 버튼을 누르고 `calendar.events.readonly` 동의를 마친 후, '이 달 Google 일정 조회'로 해당 월의 기본 캘린더를 읽습니다.

설정이 없으면 Google 연결 버튼은 비활성화되고 안내문과 `.ics` 가져오기·내보내기는 정상 사용됩니다. OAuth가 연결되었다고 가정하거나 실제 계정 자료를 모의 데이터로 표시하지 않습니다.

공식 안내:
- https://developers.google.com/workspace/calendar/api/quickstart/js
- https://developers.google.com/workspace/calendar/api/v3/reference/events/list
- https://support.google.com/calendar/answer/37118?hl=ko

## 데이터 안전

- 메모는 로컬 저장소에만 보관하며, 캘린더 기능에서 새 NH/GAS API를 호출하지 않습니다.
- Google 토큰은 JS 클로저의 메모리에만 있고, `localStorage`, `sessionStorage`, Sheets, GitHub, GAS에 저장되지 않습니다.
- Google API는 `GET /calendar/v3/calendars/primary/events`만 호출합니다. 생성·수정·삭제·권한 변경은 불가합니다.
- Google 조회는 사용자 클릭이 있을 때만 발생하며 무제한 자동 폴링하지 않습니다. 최대 200개 이후 결과가 있으면 '일부 결과'라고 표시합니다.
- 로그아웃 및 뉴스 페이지 이탈 시 Google 연결을 해제합니다.
- 외부 `.ics`는 2MB 이하, 유효한 2000년대 날짜와 일정 이름/시간만 허용하며, 반복 이벤트/확인되지 않은 TZID는 건너뜁니다. 가져오기 중복은 UID/날짜 기반으로 방지합니다.

## QA

- `node tests/invest-calendar-core-v2.test.cjs` — 기존 일정 유지, 추가·수정·삭제, 날짜 검증, ICS 가져오기/내보내기, Google 이벤트 격리
- `node tests/invest-calendar-google-readonly-v2.test.cjs` — 완전 모의 Google OAuth, 토큰 수명·허용 범위·GET 요청·권한 오류·동의 해제
- `python3 -m unittest discover -s tests -p 'test_calendar_review_build_v2.py'` — 기존 파일/설정 보호, 선택적 공개 OAuth ID, CSP
- `python3 tests/browser_calendar_workspace_v2.py` — 기존 MY INVEST 뉴스/상단 일정 버튼, 브라우저 1440·690·344px, 일정 CRUD, ICS 파일 이동, 네비게이션/로그아웃 테스트

## 다음 검증 단계

임시 검증이 끝나도 `dashboard-v2-dev` 또는 운영 Pages에 아직 배포된 것은 아닙니다. 사용자가 만든 Google 웹 OAuth 클라이언트 ID로 검증용 도메인에서 **실제 Google 읽기 연동**을 동의한 후, 별도 MY INVEST 캘린더 쓰기/양방향 동기화 요구사항을 승인받아 진행해야 합니다.