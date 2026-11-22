# MY INVEST V2 — KRX 공식 시장 일정 근거·최신성 검증 연동

**개발 전용 브랜치** `feat/calendar-krx-provenance-readiness-isolated`, 원형 `feat/calendar-holidays-market-events-isolated` SHA `e9feba337d00ff45d4ebc4a702cf148bdb010121`. `main`, `release/pages`, 운영 GAS/Sheets/Properties, 실제 개발 사이트 미배포.

## 1. 도입 목적

Google Calendar '대한민국의 휴일' 구독 자료와 **한국거래소 거래일/휴장일은 서로 다른 데이터**이다. 공휴일이라는 이유만으로 KRX 휴장이라고 판정하지 않는다. 기존 미국 출처 스냅샷(연준·NYSE·BLS·BEA)과 한국거래소 공식 출처 스냅샷을 합쳐 **투자 캘린더의 선택형 근거자료**로 제공한다.

## 2. 현재 반영한 한국거래소 공식 문서 근거 데이터

| 날짜 (KST) | 일정 | 처리 | 근거 |
|---|---|---|---|
| 2026-05-01 | 근로자의 날 | KRX 휴장 | 2026년 KRX 코스닥 공시일정 달력 |
| 2026-12-25 | 성탄절 | KRX 휴장 | 동일 문서의 12월 페이지 |
| 2026-12-30 | 2026년 최종 매매거래일 | '시장 주요 일정' — **휴장 아님** | 동일 문서의 12월 페이지 |
| 2026-12-31 | 연말휴장 | KRX 휴장 | 동일 문서 및 거래소 규정 |

공식 원문: [KRX 2026년 코스닥시장 공시일정 달력](https://kind.krx.co.kr/external/dst/reference/11625/2026%20%EC%BD%94%EC%8A%A4%EB%8B%A5%EC%8B%9C%EC%9E%A5%20%EA%B3%B5%EC%8B%9C%EC%9D%BC%EC%A0%95%20%EC%BA%98%EB%A6%B0%EB%8D%94_vF.pdf), [KRX 휴장 관련 규정](https://www.krx.co.kr/contents/RGL/04/04030203/RGL04030203.jsp), [KRX 휴장일 공식 서비스](https://open.krx.co.kr/contents/MKD/01/0110/01100305/MKD01100305.jsp).

**중요:** 이 자료를 2026년 한국 시장의 **전체/완전 거래 달력으로 보지 않는다.** 아직 공식 문서 전체에서 모든 휴장일을 정규화하지 않았고, 예외적 임시휴장·거래시간 변경을 실시간으로 검증하는 API도 구축되지 않았다. 2027년의 날짜는 자료가 없어 **미검증**으로 표시하고 휴장 없음/개장 확정이라고 추정하지 않는다.

## 3. 구현

- `js/invest-calendar-krx-official-v1.js` — 한국거래소 공식 문서에서 확인한 최소 일정만 포함. 모든 원본 날짜·출처·KST·마지막 확인일(`2026-11-22`)을 보존하고 `verified:false`, `tradeSessionCertified:false`를 강제한다.
- `js/invest-calendar-unified-market-v1.js` — 기존 `MYInvestOfficialMarketEventsV1`(미국)과 KRX 자료를 재수집 없이 조합하여 시장별 근거를 표시한다. `list(year,month)`, `sourceStatus(year,month,{now})`, `exportMonthICS(year,month)`를 제공한다.
- `js/invest-calendar-workspace-v2.js` — 기존 '공휴일·휴장일' / '시장 주요 일정' 필터 재사용. KRX 일정은 '한국 현지 날짜 기준', NYSE/FOMC는 '미국 동부 현지 날짜 기준'으로 명확히 구분한다. 각 날짜별 공식 출처 링크를 표시하고 위변조·정확한 거래일 인증으로 오해하지 않도록 한다.
- **2026년 데이터 일부만 수록** 안내 및 2027년 **KRX 거래일표 미확인** 경고. 공표된 자료 확인일에서 21일 넘게 경과하면 '공식 출처 재확인 권장' 표시. 이 기간은 서비스 내부 사용자 알림 기준이며 **공급자의 공식 유효기간이 아니다**.
- '이 달 공식 시장 일정 .ics 내보내기'는 KR+US 양쪽 스냅샷을 함께 포함하고 `URL`, `DESCRIPTION`에 원천 링크와 확인일을 기록한다. KRX는 종일 일정으로, 미국의 확인된 발표시각은 KST/UTC 시차를 반영해 정확히 출력한다.
- Google 캘린더로 **자동 쓰기 0건**. 내보낸 `.ics`를 사용자가 Google 일정에 **직접 가져오기** 하는 방법만 제공한다. 이 파일은 실시간 자동 동기화가 아니다.

## 4. 데이터 최신성·자동 갱신 경계

Google 구독 달력은 기존 동의 후 월별 읽기 버튼과 메모리 TTL을 사용해 사용자 선택 시 갱신된다. KRX·NYSE/FOMC/BLS/BEA 일정은 아직 공식 사이트에서 **자동 수집·검증·업데이트하는 안정된 API를 연결하지 못했다.** 이번 기능은 공식 스냅샷을 정확히 구분하고, 21일 초과·연도 미검증 시 재확인을 유도하는 것이다.

KRX 공개 일별 종가 응답이 비어 있어도 무조건 휴장이라고 판정하지 않는다. 유효한 일정 조회를 위해서는 거래소가 명시적으로 제공하는 휴장일 원천이 필요하다. 일반 Google 기념일·공휴일은 참고자료이며 증시휴장 인증용으로 승격시키지 않는다.

## 5. 실제 Google OAuth 인증에 남은 항목

ChatGPT Google Calendar 커넥터 접근권한과 MY INVEST 웹사이트 OAuth는 **서로 독립**이다. 사용자가 Google Cloud 프로젝트에서 Calendar API를 활성화하고, 본인 개발 사이트의 정확한 Origin에 대한 **웹 애플리케이션 OAuth 클라이언트 ID**를 발급·등록한 뒤 사이트에서 직접 승인해야 한다. 프런트의 읽기 전용 범위는 `calendar.events.readonly`, `calendar.calendarlist.readonly`. 개인/구독 이벤트는 승인 이후 사용자가 선택한 것만 조회하며, 비선택 재정 달력·업무 달력을 자동 조회하지 않는다.

OAuth 클라이언트 ID는 공개 식별자지만, 클라이언트 시크릿·인증 토큰·Google 이메일은 GitHub/Pages/CI/GAS/이 대화에 넣지 않는다. 실제 브라우저 Google 인증 성공 테스트는 현재 하지 않았으며 모의 인증 회귀 테스트만 수행한다.

## 6. 완료 기준

- 이전 Node 테스트와 19개 새 KRX·KR/US 결합 테스트 PASS.
- 이전 Google 캘린더/뉴스·전략 호환성, PC·중간 690px·Fold6 344px 회귀 PASS.
- KRX 2026-12-30 폐장 vs 12-31 휴장 표시를 구분하고, 2027 KRX 상태는 미검증으로 표시.
- 양국 출처 링크·국가/시차, Google 사용자가 선택한 달력만 조회·개인정보 쓰기 금지.
- GitHub CI 외에 어떠한 운영 브랜치·실제 웹 사이트도 변경하지 않는다.
