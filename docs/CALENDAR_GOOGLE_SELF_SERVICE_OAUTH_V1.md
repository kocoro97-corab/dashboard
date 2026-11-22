# MY INVEST V2 — Google 캘린더 웹 OAuth 셀프 설정 (개발 전용)

## 목적과 결과

2026-11-22 기준 최신 코덱스/캘린더 검증 브랜치 `feat/calendar-latest-codex-oauth-readiness-isolated` (SHA `1405adf32415612088803196ee0cfc71573dcd7d`)에서 파생한 **분리 검증 브랜치**이다.

기존에는 Google OAuth 클라이언트 ID가 빌드 시점에 미리 필요해서 Google 연결 버튼이 비활성화됐다. 이번 변경은 **개발 캘린더 화면에서 공개 웹 OAuth Client ID를 한 번 입력하면, 사용자 클릭 이후 Google Identity Services SDK를 가져와 읽기 전용 승인 화면을 열 수 있도록** 한다. OAuth 비밀 키·토큰·이메일을 사이트/CI/개발 브랜치에 넣지 않는다.

## 실제 사용 흐름 (개발 빌드에서만 가능)

1. Google Cloud 프로젝트에서 Calendar API 활성화, OAuth 동의화면과 테스트 사용자 설정. OAuth 클라이언트 유형은 **웹 애플리케이션**.
2. Authorized JavaScript origins에 `https://kocoro97-corab.github.io` 를 등록한다. `/dashboard-v2-dev/` 경로를 붙이면 잘못된 Origin이며, 다른 공개 호스트/로컬호스트는 각각 별도 등록이 필요하다.
3. 코덱스 최신 개발 빌더로 `--include-calendar` 옵션만 켜서 임시 개발 빌드를 만든다. **실제 배포는 별도 단계**이며, 일반 개발 빌드는 변하지 않는다.
4. 대시보드 → 뉴스·이벤트 → 투자 캘린더 → **Google 웹 OAuth 클라이언트 ID 설정(개발용)** 을 연다.
5. `...apps.googleusercontent.com`으로 끝나는 **공개 클라이언트 ID**만 입력해 **설정 적용·Google SDK 준비**를 누른다. 이 순간에만 공식 Google SDK 주소에서 스크립트를 가져온다. 이 단계에서는 **계정 접근, 동의 창, 이벤트 조회는 하지 않는다**.
6. 버튼이 활성화되면 **Google 읽기 전용 연결**을 눌러 본인 Google 계정으로 로그인·동의한다. 이때만 승인 요청을 수행한다.
7. 기본 달력과 `대한민국의 휴일` 같은 구독 중인 휴일 달력을 선택한 뒤 **이 달 Google 일정 조회**를 누른다. 그 외 개인정보 관련 달력은 직접 선택하지 않으면 조회하지 않는다.

## 인증 / 보안

- 허용 범위는 `calendar.events.readonly` 와 `calendar.calendarlist.readonly`. 생성·수정·삭제·권한 변경 금지.
- 공개 OAuth ID는 JS 메모리에만 존재하고 새로고침/로그아웃 후 사라진다. 접근 토큰도 기존 Google 읽기 전용 모듈의 클로저 메모리에서만 관리하며 저장소·GAS·GitHub·URL에 기록하지 않는다.
- **클라이언트 시크릿/액세스 토큰/Refresh token/계정 이메일은 입력하면 안 된다**. 문자열이 공개 웹 Client ID 형태가 아니면 SDK 호출 전에 거부한다.
- Google SDK URL은 고정값 `https://accounts.google.com/gsi/client`만 사용하며, 사용자가 제공한 ID/URL에서 로드할 스크립트를 구성하지 않는다.
- `--include-calendar`를 켠 개발 임시 빌드의 CSP에만 Google 도메인을 허용한다. Google ID가 없으면 메인 페이지 로딩 단계에 Google SDK `<script>` 태그가 추가되지 않는다.
- 같은 클라이언트 ID로 반복 설정해도 Google SDK를 중복 다운로드하지 않는다. 페이지 이탈/로그아웃에서 Google 연결 해제와 공개 ID 메모리 삭제를 실행한다.
- 개인 Google 일정은 실제 인증 완료 전까지 표시하지 않는다. 기존 로컬 일정과 미국·한국 공식 시장 출처 스냅샷은 Google OAuth 없이도 볼 수 있다.

## 검증 방법

`node tests/invest-calendar-google-oauth-setup-v1.test.cjs`

`python3 tests/browser_calendar_oauth_selfservice_v1.py`

브라우저 테스트는 Google SDK·Calendar API를 **모의 응답**으로 대체해 실제 Google 계정을 전혀 호출하지 않는다. PC 1440px/Fold6 344px의 입력 전 0회 Google 호출, 입력 형식 오류, 사용자가 설정 버튼을 누를 때만 SDK 요청, 별도 동의 버튼, 구독 휴일 달력 선택, 비선택 개인 달력 미조회, 로그아웃 시 저장소 무결성을 검증한다.

## 배포/실계정 검증 현황

**현재 코드 및 테스트만 준비된 상태다.** `main`, `release/pages`, 실제 `dashboard-v2-dev/dev-pages`, GAS, Sheets와 NH 계좌를 변경하지 않았으며, 사용자 Google Cloud 환경의 OAuth 등록·실제 로그인·동의 성공 여부는 검증하지 않았다. 이후 사용자가 준비한 Google Cloud 공개 웹 클라이언트 ID와 승인된 개발 도메인에서 직접 동의해야 한다.

공식 Google 가이드: https://developers.google.com/identity/oauth2/web/guides/use-token-model / https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid / https://developers.google.com/workspace/calendar/api/auth
