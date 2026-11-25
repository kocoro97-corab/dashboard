# MY INVEST V2 — 기존 웹 성능 최적화 1단계 (2026-11-24)

## 범위/목표
PWA 또는 네이티브 앱 개발은 **보류**한다. 현행 웹의 초기 로딩과 화면 이동을 우선 개선한다.
기존 로그인, NH 계좌, 시장 시세, 뉴스, 일정, 주문 차단, 보안 및 운영 경로를 바꾸지 않는다.

## 실제 수정
1. `index.html`의 모든 기존 1st-party classic `js/*.js` 스크립트에 `defer` 지정. 스크립트 사이의 *실행 순서*는 보존하면서 브라우저가 파일 **다운로드를 병렬화**하도록 허용한다. 브라우저 성능상의 이득은 네트워크·캐시·기기마다 다르며 아직 실측하지 않았다.
2. 공개 페이지의 선택적 Tesseract.js CDN 로딩을 `async`로 변경, 초기 HTML 구문분석 블로킹을 줄인다. 기존 이미지 업로드 시 `ocrImage`에서 로드 진행 중인 OCR 스크립트만 최대 8초 기다린다. OCR은 사용자가 직접 업로드할 때만 사용한다.
3. `tools/build_dev_pages.py`의 엄격한 스크립트 anchor 비교를 신규 `defer` 형식에 맞춰 유지한다. 개발 게시본의 고정된 **로컬 검증 OCR 파일**도 `async`로 생성한다. CSP·공개 자산 allowlist·민감 파일 유출 차단은 유지.
4. `js/web-performance-metrics.js`로 메뉴별 전환/갱신 소요시간을 **브라우저 메모리에만** 보관한다(50건 상한, 요청/개인정보/저장/전송 없음). `js/app-shell.js`에 성공·실패·취소·로그아웃 수명주기 연결. 사용자 본인 브라우저에서 `MYInvestWebPerformance.snapshot()`으로 요약을 읽을 수 있다. 로그인 정보/종목 수량 등은 포함되지 않는다.
5. 테스트 `tests/script-loading-performance.test.cjs` / `tests/web-performance-metrics.test.cjs` 추가.

## 검증 및 배포 게이트
- `node --test tests/script-loading-performance.test.cjs`
- `node tests/web-performance-metrics.test.cjs`
- GitHub PR regression CI의 Node·Python 보안/게시·PC 1440/Fold6 690/344px synthetic browser 전체 PASS 확인.
- 실제 개발 사이트 게시 전 기존 `dashboard-v2-dev/dev-pages`의 정상 HEAD·백업 SHA 확인. 소스 전체 `index.html` 덮어쓰지 말 것. 개발 사이트의 CSP·OAuth·릴레이·기존 JS `&dev` 캐시 무효화 정책 보존.
- 초기 표시 시간(FCP/LCP), DOMContentLoaded, 메뉴별 `snapshot()` 중위값, 계좌/뉴스/캘린더 동작 및 OCR 1장(실제 업로드) 확인. **속도 향상 %는 전/후 실측값이 생길 때만 제시한다.**
- 운영 `main`, `release/pages`, 운영 GAS/Sheets/Properties/NH 실계좌에 **직접 변경 금지**.

## 다음 성능 과제
실제 브라우저 Performance / Network 기준 데이터를 수집한 다음, 응답이 느린 **API와 화면별 계산 구간**을 분리한다. 중복 조회는 피하되 필요한 신규 데이터를 생략하지 않고, 서비스 워커/PWA는 추가 승인 전까지 개발하지 않는다.
