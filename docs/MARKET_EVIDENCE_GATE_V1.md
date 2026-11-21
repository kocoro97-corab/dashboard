# MY INVEST V2 — 시장 관측 증거 게이트 V1 (독립 개발)

## 개발 목적

코덱스가 작업 중인 뉴스·브리핑 PR #8과 별개로, 기존 홈 화면 시장국면 판정 전에 필수 지수의 관측 날짜·출처·갱신 상태를 비교하는 순수 분석 모듈을 구현했습니다.

새 파일: js/market-evidence-gate-v1.js, tests/market-evidence-gate-v1.test.cjs.
기존 파일(index.html, js/page-home.js, js/home-market-policy.js, 뉴스 파일, GAS, Sheets, Properties)을 변경하지 않습니다.

## 입력 계약

- API: MYInvestMarketEvidenceGateV1.assess({ market, now, quotes, sources, receivedAt })
- market: KR 또는 US; now: Unix 밀리초(실행자가 명시).
- quotes: 기존 홈 Q와 동형 {symbol:{p,prev,observedAt,phase,refreshFailed?}}. phase는 close/realtime/indicative 선언값이며 원천 확인으로 간주하지 않습니다.
- sources: 기존 홈 SRC와 동형 {symbol:'N' 또는 'Y' 등 출처 식별자}; receivedAt: 기존 QT 형식 {symbol:밀리초}.
- 한국 비교 핵심 2종: ^KS11(KOSPI), ^KQ11(KOSDAQ).
- 미국 비교 핵심 4종: ^GSPC(S&P 500), ^IXIC(NASDAQ), ^DJI(Dow), ^SOX(반도체).

## 검사 규칙

1. 모든 핵심 지수에 양수 가격과 비교 종가가 있어야 합니다. ±50% 초과 등락은 이상으로 차단.
2. 원천 관측시각은 현재보다 5분 이상 미래일 수 없으며, 120시간을 초과한 자료는 차단. 미국/한국 장기 휴장기에는 보수적으로 판단 유보.
3. 수신시각이 30분 넘게 지난 값은 재사용 가능해도 새 시장 방향 판정에는 사용하지 않음.
4. 과거 캐시의 refreshFailed=true이면 무조건 차단.
5. 필수 지수들의 원천 관측일이 동일해야 함. 한국은 Asia/Seoul, 미국은 America/New_York 현지 날짜를 사용하여 DST 경계 오류 방지.
6. 관측 시각 간격 최대 12시간. 동일 날짜라 해도 실제 관측 간격이 지나치면 차단.
7. phase=close가 모두 명시된 경우에만 qualified-close. 일부 종가 표기가 없다면 indicative-only(참고값).

## 출력

- qualified-close: 필수 지수 입력 형식·관측일·시각 일관성이 만족하며 종가로 선언됨. 실제 시장 가격을 인증한 것은 아님.
- indicative-only: 시계열은 비교 가능하나 종가 여부 미확인; 방향은 참고용이며 실시간/마감 확정 신호로 표시하지 않음.
- blocked: 누락, stale, refreshFailed, 원천 날짜 불일치, 출처 미식별 등의 문제 발생. direction='unavailable'.
- invalid: 잘못된 market 또는 now.

quoteTruthVerified, exchangeCalendarVerified, realTimeVerified, tradingRecommendation은 항상 false입니다.
원천 가격 진위, 거래소 휴장일, $TICK, 실제 주문, 뉴스 생성까지 검증했다고 주장하지 않습니다.

## 추후 통합 위치 (지금은 미연결)

홈 모듈에서 HomeMarketPolicy.regionAt(new Date(now))로 지역을 고른 후, Q/SRC/QT를 위 assessor에 전달해 기존 marketRegime 판정 전에 근거 상태를 표시할 수 있습니다.
이는 통합 위치 제안이며 현재 화면·운영 사이트에 연결하지 않았습니다.

## 검증

18개 회귀 테스트를 작성했습니다. 뉴욕 DST, KST 날짜, 수신·관측 유효기간, 서로 다른 거래일, 원천 누락, 시간차, 갱신 실패, 미확인 종가, 이상 수치, 원본 비변경, 외부 호출 금지를 검사합니다.
순수 JavaScript, fetch/네트워크/로컬 저장/계좌/주문 호출 없음.
테스트 실행: node tests/market-evidence-gate-v1.test.cjs

## 격리와 병합 조건

코덱스 뉴스 파일과 PR #8 및 개발·운영 기존 파일의 변경 금지. 신규 독립 브랜치에서 코드·테스트·문서만 추가합니다.
단독 리뷰 후 기존 홈 연동 및 운영 배포는 사용자 별도 승인 전까지 금지합니다.