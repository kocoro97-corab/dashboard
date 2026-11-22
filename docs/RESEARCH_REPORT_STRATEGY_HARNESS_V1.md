# MY INVEST V2 — 연구 리포트와 Codex 통합 전략 메뉴 연결: 개발 검증 하네스

## 실제 기반 및 현황

- 기존 Codex 통합 기준: `integration/news-strategy-20261121` 커밋 `961aead93f13c6282cf19bc181c8e4e2da68c55f`.
- 추가된 기존 연구 리포트 자산: `feat/investment-research-report-ui-isolated` (`9aa5610193be54ab5696b8b836ac3aaf64c55487`), 210개 기존 단위 테스트와 PC/Fold6 독립 화면 테스트 PASS 이력.
- 신규 독립 브랜치: `feat/research-report-strategy-harness-isolated`.
- **기존 JS/HTML/Python 소스 수정 0개. 전부 새 파일만 추가.** 코덱스가 개발 중인 `page-strategy.js`, `page-news.js`, `app-router.js`, `app-shell.js`, `index.html`, `tools/build_dev_pages.py` 등에 손대지 않음.

## 목적과 검증 범위

반복해서 격리 모듈만 추가하는 대신, Codex가 병합 준비 중인 실제 MY INVEST V2의 로그인/페이지 라우터/기존 전략/뉴스 화면에서 연구 리포트가 같이 동작하는지 확인한다.

이는 **공개 개발 사이트 게시가 아닌** 로컬 CI용 테스트 아티팩트다. 실제 GitHub Pages `dev-pages`, 운영 `main/release/pages`, NH/GAS/Google Sheets/Properties는 전혀 수정하지 않는다.

## 구현 구조

1. `tools/build_research_report_review_v1.py`가 기존 Codex `build_dev_pages.build()`를 정상 실행한다.
2. 생성된 임시 아티팩트의 `index.html` 끝에 고정된 7개 자체 호스팅 JS만 추가한다. 원본 `index.html`은 수정하지 않는다.
3. 부팅용 `window.MYINVEST_RESEARCH_REVIEW='synthetic-only'`가 존재할 때만 `js/research-report-strategy-review-hook-v1.js`가 켜진다.
4. 기존 앱에 로그인하여 `#/strategy`에 들어가면 **투자전략 페이지 기존 `.str4` 컨테이너 안**에 `details` 항목이 보인다. 전용 새 메뉴나 운영 라우트는 없다.
5. 사용자가 항목을 펼치면 기존 `investment-research-report-v1.js`, 설명 엔진, 이력 엔진, 패널을 그대로 호출해 합성 US/한국 관찰 데이터를 표시한다. 별도의 NH 시세나 계좌정보를 전달하지 않는다.
6. 닫거나 뉴스/홈 등 다른 메뉴로 이동, 로그아웃하면 패널 인스턴스를 정리한다. 재진입할 때 기존 입력이나 화면을 복원하지 않는다.

## 정확한 파일 목록

- 기존 연구 원본을 **동일한 내용으로** 이 브랜치에 가져온 모듈: `market-sector-stock-alignment-v1.js`, `market-sector-stock-adapter-v1.js`, `investment-evidence-explanation-v1.js`, `investment-evidence-timeline-v1.js`, `investment-research-report-v1.js`, `investment-research-report-panel-v1.js`
- 기존 210개 회귀 테스트 및 2개 입력 점검 CLI를 재사용한다.
- 신규 개발용 합성 자료: `js/research-report-harness-fixture-v1.js`
- 신규 앱 화면 연결부: `js/research-report-strategy-review-hook-v1.js`
- 신규 임시 개발 빌드: `tools/build_research_report_review_v1.py`
- 신규 빌드 보안·변경범위 테스트: `tests/test_research_report_review_artifact_v1.py`
- 신규 PC(1440)/모바일(690)/폴드6(344) 브라우저 합성 여정: `tests/browser_research_report_strategy_harness_v1.py`

## 기존 기능 재사용 및 안전 통제

- 기존 `DashboardShell`, `AppRouter`, `DashboardPages`, 종목 워크플로와 전략 계산기 동작을 변경하거나 덮어쓰지 않는다.
- 뉴스 메뉴를 거쳐 다시 전략 메뉴로 돌아와도 합성 리포트가 자산 조회를 추가 호출하지 않는다.
- 기존 리포트의 시장→산업→종목 근거, 한국어 설명과 날짜별 변화 비교를 그대로 사용한다. 원천 진위·휴장일·실제 가격·분봉은 검증되지 않았음을 명확히 표시한다.
- 합성 샘플 시장전환(US/KR) 버튼은 애플리케이션 실제 시장/종목 선택 상태를 바꾸지 않는다.
- 최신일의 근거가 검증 보류 상태이면 이전 긍정적 결과를 현재 투자판단 근거로 사용하지 않는다.
- 연구 리포트는 현재 `mode='swing'`의 일봉 근거만 설명한다. 단타 분봉 근거/실제 계좌 보유종목 대응전략/실제 주문은 범위 밖이다.
- 실제 NH API, 거래/주문 권한, 비밀 키, 유료 시세 API, GAS/Sheets/Properties 쓰기를 수행하지 않는다.

## 검증

- 기존 정합성 39 + 재사용 어댑터 43 + 근거 설명 35 + 설명 CLI 9 + 이력 46 + 이력 CLI 8 + 리포트 모델 30 = **총 210개** 오프라인 Node 단위 테스트.
- 추가 Python 빌드 검증 5개: 기존 index 불변, 스크립트 삽입 순서/매니페스트, `SYNTHETIC_ONLY` 메타, 자산·보안 정보 제외.
- 실제 기존 MY INVEST V2 합성 로그인/투자전략/뉴스/홈 화면에 리포트를 붙이는 Playwright PC/690/폴드6 344 px 브라우저 검증.
- 실제 Fold6 실기기 검증은 하지 않았다. 브라우저 폭 344px 모의 검증으로만 표기한다.

## 미완료 항목 및 배포 제한

현재 연결은 **합성 데이터 개발 검증용 하네스**로, 실제 개발용 Pages나 운영 사이트에 붙지 않는다.
공개 데이터 수집·표본 대표성·휴장일·종목별 매핑을 검증하고, Codex 통합 브랜치 변경이 멈춘 뒤 통합 승인과 실기기 검증을 거쳐야 실제 메뉴에 적용할 수 있다.
별도 승인 전에는 PR/merge/deployment/실계좌 호출/주문 기능을 수행하지 않는다.