# MY INVEST V2 — 시장 거래시간·홈 우선순위 모듈 V1

## 목적

코덱스의 뉴스·브리핑 PR #8과 완전히 분리하여 **홈 화면 한국장/미국장 우선순위**와 **실제 정규장 시간대**를 구별하는 순수 모듈을 개발했습니다.
기존 홈 화면은 07:00~20:59 KST에 한국 지수를 먼저, 21:00~06:59 KST에 미국 지수를 먼저 보여줍니다. 이 규칙은 표시 우선순위일 뿐, 장이 실제 열려 있다는 증거가 아닙니다.

## 신규 소스 및 사용 방법

- `js/market-session-context-v1.js`: 네트워크·로컬저장소·실계좌 호출이 없는 순수 데이터 처리
- `tests/market-session-context-v1.test.cjs`: 시계·서머타임·주말·휴장일·애프터마켓 경계 테스트
- 진입점: `MYInvestMarketSessionContextV1.context({now, calendar})`
- `now`는 **명시적인 Unix 밀리초**입니다. 입력하지 않으면 시스템 시계를 사용하지 않고 INVALID_CLOCK 반환.
- `calendar`는 선택적 외부 제공 보조자료이며, 모듈은 해당 자료의 진위나 공식 승인 여부를 판정하지 않습니다.

## 실제 시간대 기준 (현물 주식의 정규장 구분)

| 구분 | 정규장 로컬 기준 | 별도 표시 규칙 |
|---|---|---|
| KRX 주식시장 핵심 정규장 | 한국시간 09:00~15:30 | 07:00~20:59에는 한국장 우선 정렬이지만 15:30 이후에는 정규장 종료 |
| 미국 NYSE 등 주요 주식시장 | 미국 동부시간 09:30~16:00 | 21:00부터 미국장 우선 정렬하더라도 22:30/23:30 이전에는 정규장 시작 전 |
| 미국 서머타임 기간 | 한국시간 22:30~익일 05:00 | UTC 기준 자동 시간대 변환 |
| 미국 표준시 기간 | 한국시간 23:30~익일 06:00 | UTC 기준 자동 시간대 변환 |
| KRX 일부 국내 주식 연장 거래시간(2026-09-14 이후) | 한국시간 16:00~20:00 | 일부 현물 주식 참고 구간. 코스피·코스닥 지수 정규장과 혼동 금지. ETF 등 상품별 대상 여부 별도 확인 |

공식·관련 출처:

- NYSE 핵심 정규장 및 휴장/단축장: https://www.nyse.com/trade/hours-calendars
- 한국거래소 정규장 거래시간: https://global.krx.co.kr/contents/GLB/06/0602/0602010201/GLB0602010201T1.jsp
- 2026-09-14 국내 주식시장 연장 거래 개시 관련 보도: https://en.yna.co.kr/view/AEN20260909009200320

## 안전장치

- **tradingOpenConfirmed, holidayVerified, exchangeStatusVerified, quoteFreshnessVerified는 항상 false**입니다.
- 미국 동부시간은 `America/New_York` 로컬 날짜와 Intl 시간대 데이터로 계산합니다. 서울 토요일 03:00가 뉴욕 금요일 13:00일 수 있습니다.
- 미국 서머타임 시작·종료 경계도 자동 처리합니다. 주말이나 외부에서 제공된 휴장일에는 가상의 정규장 개시/종료 시각을 계산해 표시하지 않습니다.
- 주중이라도 거래소 휴장·임시 휴장·단축장 여부는 자동 확인되지 않으므로 calendarBasis는 기본 `weekdays-only-holiday-unverified`입니다.
- 외부 제공 휴장 정보는 `calendar:{US:{'2026-11-27':{status:'early-close',closeMinute:780}}}` 같은 형식으로 전달할 수 있으나, **해당 정보의 공식 출처·정확성은 외부 호출자가 검증해야 합니다.**
- 연장 거래는 일부 종목만 해당하며 거래 가능한 상품·증권사·지수의 실시간 업데이트를 이 모듈만으로 확인하지 않습니다.
- 인증정보·계좌번호·보유 종목·매매 주문 데이터는 입력하지 않습니다.

## 출력 예시 설명

상태: `regular-clock-window`, `before-regular-window`, `after-regular-window`, `weekend`, `eligible-equities-afterhours-window`, `calendar-supplied-closed`.

반환값의 `focus`가 KR이더라도 `regions.KR.window`가 `weekend`일 수 있으며, `focus`가 US여도 `regions.US.window`는 `before-regular-window`일 수 있습니다.
이는 의도된 동작입니다. 화면의 표시 우선순위를 실제 거래소 개장 상태로 오인하지 않게 합니다.

## 격리·검증

기반 브랜치: `feat/market-quality-diagnostics-isolated`. 파생 브랜치: `feat/market-session-context-isolated`.
기존 HOME, NEWS, GAS, NH, Sheets/Properties, main 및 release/pages에 변경 없음.
새 모듈은 현재 운영 화면에 자동 연결되지 않으며 독립 소스와 단위 테스트로만 제공됩니다.
전용 GitHub Actions는 해당 격리 브랜치 push에서 **Node 구문 및 합성 단위 테스트만** 실행합니다.
운영 배포나 화면 통합은 코덱스의 뉴스 작업과 별도로 검토하고 사용자 승인 후 진행합니다.
