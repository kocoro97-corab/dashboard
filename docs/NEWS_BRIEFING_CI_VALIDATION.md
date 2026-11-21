# MY INVEST V2 — 공개 브리핑 보관함 격리 CI 검증

이 브랜치는 fix/news-briefing-panel-v1-ci이며 feat/news-briefing-panel-v1-sandbox의 코드와 신규 테스트를 검증하는 용도입니다.

## 실행 범위

- GitHub Actions PR regression tests: `push: fix/**` 경로로 합성 회귀만 수행
- 신규 Node 데이터 단위 테스트 / Playwright 가상 브라우저 UI 테스트(PC 1440, 690, 모바일 344)
- PR 이벤트를 만들지 않으므로 `nh-staging-live` 조건이 false; 해당 작업은 실행되지 않아야 함
- 다른 워크플로우는 수동 workflow_dispatch 전용이고 실행하지 않음
- 실계좌 NH 인증/조회, 운영 GAS 및 Google Sheets/Properties, 운영 사이트 배포, 주문 호출 금지

현재까지 확인한 JavaScript 독립 검증: 48/48 통과(격리 V8, URL 테스트 shim), 정규 Node·Playwright의 CI 결과는 별도로 조회하여 기록해야 합니다.

브리핑 자동 전달은 구현하지 않았으며 공개용 JSON의 사용자 선택 가져오기·백업·기존 수동 기록 복사만 구현했습니다.
