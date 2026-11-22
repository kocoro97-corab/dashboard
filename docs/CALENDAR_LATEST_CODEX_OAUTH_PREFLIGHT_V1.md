# MY INVEST V2 — 최신 코덱스 통합 및 Google OAuth 사전점검

## 상태

2026-11-22 기준 `integration/news-strategy-20261121`의 SHA `a4fa241624baa6692dfaa3c41516315d2c6d7127`에서 독립된 `feat/calendar-latest-codex-oauth-readiness-isolated` 브랜치를 생성했습니다. 앞서 통과한 자체 캘린더, Google 휴일 구독, KRX·NYSE/FOMC 공식 일정, 연례 기념일, 시장 근거자료 조회를 **기존 최신 코덱스 개발 세션 및 5분봉 전략 코드와 함께** 검증하는 것이 목적입니다.

원본 `main`, `release/pages`, `integration/news-strategy-20261121`, 운영 GAS·Sheets·NH API·실제 GitHub Pages는 **변경/게시하지 않습니다**. 새 개발용 빌더 옵션도 기본값은 비활성입니다.

## 통합 대상

- `js/page-news.js`: 기존 상단 일정과 뉴스 이벤트 버튼은 유지하면서 새 캘린더로 위임. 일정 저장/수정 후 기존 뉴스 목록도 갱신. 페이지 이탈 시 Google 메모리 토큰과 리스너 정리.
- `tools/build_dev_pages.py`: 코덱스가 추가한 `js/dev_session.js`, 5분봉 패널, 기존 최신 전략 스크립트 순서와 CSP를 보존. `--include-calendar`일 때만 자체 캘린더 7개 JS 모듈을 추가.
- `--google-calendar-client-id PUBLIC_WEB_ID`: 필수는 아니며 지정 시에만 GIS SDK, Google Calendar REST API 도메인 및 제한 CSP를 임시 빌드에 허용. 기본 빌드와 운영 파일에는 Google SDK 요청도 추가되지 않음.
- 시장 일정 데이터는 API 요청 없는 공식 출처 스냅샷과 사용자가 명시적으로 승인한 Google 구독 캘린더에서만 읽음. `evidenceForRange(...)`는 글로벌 시장·투자전략이 **필요할 때만 근거자료로 사용할 수 있는 선택형 API**. 화면에는 아직 자동 노출하지 않음.

## Google 실제 연결에 필요한 작업

1. Google Cloud Console에서 프로젝트 선택 후 Calendar API 활성화, OAuth 동의화면과 테스트 계정 등록.
2. OAuth 클라이언트 유형 **웹 애플리케이션**. Authorized JavaScript origins에는 **`https://kocoro97-corab.github.io`** 를 등록. `https://kocoro97-corab.github.io/dashboard-v2-dev/`처럼 경로가 붙은 주소는 *Origin이 아님*. 다른 서브도메인·로컬 개발 주소는 필요할 때 별도 등록.
3. Google OAuth **공개 클라이언트 ID**만 개발 빌드 매개변수로 전달. `client_secret`, 브라우저 액세스·갱신 토큰, 사용자 이메일, 개인 캘린더 ID를 저장소·CI·대화에 남기지 않음.
4. 읽기 전용 동의 범위: `https://www.googleapis.com/auth/calendar.events.readonly`, `https://www.googleapis.com/auth/calendar.calendarlist.readonly`. Google 문서: https://developers.google.com/identity/oauth2/web/guides/use-token-model / https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid / https://developers.google.com/workspace/calendar/api/auth .
5. 운영/개발 웹사이트에서 직접 Google 연결 버튼 클릭 → 동의 → 구독 중인 대한민국의 휴일 캘린더 선택 → 월간 수신 검사. GitHub Pages의 COOP/CSP·팝업 정책이 실제 브라우저 환경에서 동작하는지는 별도 테스트가 필요하며 **CI 모의 OAuth만으로 실제 인증 성공을 주장하지 않음**.
6. Google 이벤트는 읽기 전용, 페이지당 200개까지. 추가 페이지는 일부 결과라고 표시. PC·폴드6 직접 동기화는 Google 재인증·재조회가 필요하고, 내 브라우저 로컬 일정은 여전히 자동 기기 간 공유되지 않음.

## 사전점검 명령 (로컬/CI 전용)

기본 검사: `python3 tools/calendar_oauth_preflight_v1.py` → `SETUP_REQUIRED` (정상: 사용자 웹 OAuth ID 설정 필요).

공개 ID를 이미 소유하고 있고 **이상 없는 개발 임시 빌드**를 만들 때:

```sh
python3 tools/build_dev_pages.py --output /tmp/myinvest-calendar-preview --include-calendar \
  --google-calendar-client-id '123456789012-EXAMPLE_PUBLIC_WEB_CLIENT_ID.apps.googleusercontent.com'
python3 tools/calendar_oauth_preflight_v1.py \
  --client-id '123456789012-EXAMPLE_PUBLIC_WEB_CLIENT_ID.apps.googleusercontent.com' \
  --origin 'https://kocoro97-corab.github.io' \
  --build-index /tmp/myinvest-calendar-preview/index.html
```

예시 Client ID는 설명용이며 실제로 작동하지 않습니다. 사전점검에서 `LOCAL_CONFIG_READY_LIVE_CONSENT_UNVERIFIED`가 나와도 **Google Cloud 실제 Origin 등록과 계정 동의는 확인되지 않은 상태**입니다. 실제 Client ID가 없을 경우 로컬 일정·기념일·공식 시장 일정·ICS 내보내기는 정상 이용 가능합니다.

## 이번 단계 검증

- 이전 달력 모듈과 공식 KRX/미국 시장 일정 25개 검증 유지.
- 최신 코덱스의 개발 세션 연장, 전략 비교·5분봉 참조 추가 코드를 **복사하거나 제거하지 않고** 개발 빌더 안전 변경.
- 기존 개발 빌더의 *옵션 없는 기본 출력*과 캘린더 추가 출력 파일·CSP 차이 검증. 캘린더가 꺼져 있으면 Google API 호출 0.
- OAuth 웹 ID·Origin·Google script-src/connect-src 구성 검사, 9개 독립 Python 사전점검.
- PC 1440/690/Fold6 344px 뉴스·전략·기본캘린더·Google 구독 휴일 모의 브라우저 검증. **실제 Google API·NH API·주문 호출 금지**.

## 출시/통합 기준

현재는 별도 개발 브랜치. 코덱스가 같은 `tools/build_dev_pages.py`와 전략/세션 코드를 계속 편집하므로 **최종 병합 직전 최신 SHA 재비교 및 CI 재검증**이 필요합니다. 운영 사이트나 개발 Pages 게시 및 Google Cloud 설정 변경은 이 브랜치에서 일어나지 않습니다.
