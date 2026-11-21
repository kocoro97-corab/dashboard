# MY INVEST V2 — 시장 → 산업 → 종목 정합성 분석 V1 (독립 개발)

## 현재 단계

기존 사용자 기능을 **재구현하지 않고**, 이미 있는 지수·산업·종목 분석의 산출물을 나중에 검증된 자료 어댑터로 연결할 수 있도록 설계한 순수 분석 엔진입니다.

- 기반 브랜치: `feat/nh-integration-v2` (9f7efa132538)
- 독립 작업 브랜치: `feat/market-sector-stock-alignment-isolated`
- 신규 파일: `js/market-sector-stock-alignment-v1.js`, `tests/market-sector-stock-alignment-v1.test.cjs`, 이 문서 및 신규 CI
- **기존 HOME/SECTOR/STRATEGY/NEWS 코드를 수정하지 않음**. Codex의 PR #8 및 통합 브랜치·GAS/Worker/운영 배포에 손대지 않음.
- 이 분석은 **시장 정보·산업 정보·종목 정보를 서로 비교할 근거가 있는지** 점검합니다. 실제 매수/매도 신호나 포트폴리오 자동운용 로직이 아닙니다.

## 확인 후 재사용할 기존 모듈

| 기존 코드 | 확인된 산출물 | 이번 엔진 연결에 필요한 조치 |
| --- | --- | --- |
| `js/home-market-policy.js` | HOME 지수·지역·시장국면·출처/수신시각 | 동종 지수에서 5·20거래일 수익률 및 표본 폭을 검증한 뒤 공통 marketSnapshot에 합성 |
| `js/sector-insights.js` | 지수 대비 5·20일 상대강도, 섹터 표본 폭, 거래량 변화율 | 이미 계산된 상대강도와 표본 수를 재사용. 거래량 변화를 ratio로 변환할 때 단위 검증 |
| `js/industry-data.js` | 네이버 산업 그룹 및 구성종목, 폭, 구성종목의 localTradedAt | 산업 그룹 응답에 **원천 관측시각이 없을 수 있음**. 실제 시각을 모르면 close 확인이나 유효 판정하지 말고 blocked |
| `js/page-sectors.js` | 산업별 시장강도/테마/리더십 화면 | 기존 사용 화면 유지. 새 엔진의 판정값은 후속 승인된 진단 패널에서만 보조 표시 |
| `js/work-trading-strategy.js` | 종목의 추세·모멘텀·ATR·volumeRatio/turnoverRatio 및 진입/손절 가정 | 확정 OHLCV와 20일 MA·5/20일 상대강도, 종목 ID·원천 거래일을 검증한 읽기 전용 어댑터에서 연결 |
| `js/strategy-risk-capacity-v1.js` (별도 GPT 브랜치) | 단타/스윙 가상 위험 한도·갭 스트레스 | 이번 `hypotheticalPolicyRiskCeilingPct`는 참고값일 뿐이며 직접 매매계획 수량으로 전파하지 않음 |
| `js/strategy-evaluation-v1.js` (P4 독립 브랜치) | 과거 일봉 기반 스윙 시뮬레이션 | 데이터 품질·분할/수정주가·거래일 연결이 검증되기 전 자동 연결 금지 |

### 중요: 실제 연결 여부

이번 엔진은 위 기존 함수들을 **직접 호출하지 않습니다**. 기존 함수의 필드 구조를 분석해 **검증된 후속 어댑터용 입력 계약**을 만든 단계입니다. 현재 UI·실시세·기존 결과와 자동으로 연결되었다고 표현해서는 안 됩니다.

## 데이터 입력 계약

`MYInvestMarketSectorStockAlignmentV1.examine({now,market,mode,marketSnapshot,sectors,candidates})`

- market: `KR` 또는 `US`; mode: `day` 또는 `swing`; now: 호출자가 제공하는 Unix 밀리초
- marketSnapshot: 필수 벤치마크 KR=`^KS11`, US=`^GSPC`, 수익률(5/20일), 실제 관측 자료 폭 및 상승 종목 수
- sectors(최대 25): 각 산업 ID, 5/20일 상대강도, 거래량 배율, 실제 구성종목 표본 수·상승 종목 수
- candidates(최대 60): 종목 ID·산업 ID, 5일 수익률, 5/20일 상대강도, 20일 평균 가격 대비 변화율, 거래량·거래대금 배율
- 세 계층의 기록에는 `source`, `asOf`, `phase='close'`, `observedAt`, `receivedAt`이 모두 필수
- 시세 날짜는 한국 `Asia/Seoul`, 미국 `America/New_York` 현지 거래일로 같아야 합니다.
- 사용자가 선언한 `close`는 **실제 거래소 최종 종가 인증**이 아닙니다. 원천 검증은 별도 단계가 필요합니다.
- 관측시간 96시간 초과, 수신시간 30분 초과, 누락/미래 시각은 보수적으로 차단합니다.
- 산업 구성표본은 예상 범위의 최소 60% 및 유효 구성종목 3개 이상. 시장 폭은 최소 관측 종목 20개가 필요합니다.
- 중복 산업 ID는 모든 중복 레코드를 차단합니다. 알 수 없는 산업이나 종목 중복도 차단합니다.

## 출력 해석

| 분류 | 의미 |
| --- | --- |
| `aligned-watch` | 입력 증거가 같은 거래일에 형식상 일관되고, 시장·산업·종목에서 설정한 강도 조건이 모두 긍정적 |
| `mixed-watch` | 입력 자료의 비교는 가능하지만 세 계층 중 어느 하나가 중립/혼조 |
| `defensive-watch` | 시장 약세·산업 약세·종목 모멘텀 저하 가운데 하나 이상 관측 |
| `unavailable` | 원천시간·출처·거래일·필수 데이터나 산업 연결이 충족되지 않아 의견 보류 |

시장 초기 분류 기본값(설계용): 20일 수익률이 -3% 이하이거나 시장 상승종목 비율 40% 미만이면 defensive. 20일·5일 수익률 모두 양수 및 상승종목 55% 이상이면 supportive, 나머지는 mixed.

산업과 종목 상대강도·활동 배율의 기본 임계값은 초기 **예시 정책값**입니다. 실거래 실증이나 최적화 결과가 아닙니다.

### 위험예산 배수 (예시 정책값)

- supportive + strong + strong: 1.00배
- 하나 이상 mixed: 최대 0.75배
- 하나 이상 defensive/weak: 최대 0.50배
- 단타 기본 상한 1.0%, 스윙 1.5%에 곱한 `hypotheticalPolicyRiskCeilingPct`만 반환
- 이 숫자를 실제 투자비율이나 매수 신호로 적용하지 않습니다. 업스트림 실제 데이터 품질/포지션/갭 손실 검증이 추가로 필요합니다.

## 검증 조건

- 합성 KR/US 현지 거래일, 미국 DST, 장 종료와 서울 토요일 시각 차이
- 산업·시장 폭 60% 미만, 미래·오래된 원천시각, 관측·수신시각 불일치
- 산업 ID·종목 ID 중복 및 시장별 종목·벤치마크 식별
- 잘못된 출처·임의 URL·개인계좌 필드 입력 시 미출력/차단
- 보수적 위험배수, 단타와 스윙 상한 구분, 입력 자료 불변
- Node 회귀 테스트: `node tests/market-sector-stock-alignment-v1.test.cjs`

## 통합·게시 금지선

뉴스 PR #8과 Codex의 새 통합 작업이 끝나기 전에는 기존 페이지, 신규 데이터 조회, 인증·NH·GAS·Worker·Sheets·Properties, 운영 Pages를 수정하지 않습니다.

다음 통합은 **Codex가 마무리한 실제 소스의 최신 SHA 확인 → 기존 계산 필드 어댑터 작성 → 품질/원천 일치 검사 → PC/Fold 합성 회귀 → 데이터 이용조건 검토 → 승인 후 개발 사이트 반영** 순서로 진행해야 합니다.

공식 거래소 시간/휴장·수정주가·시장 전체 산업 표본·분봉 VWAP 여부는 이 모듈이 확인했다고 주장하지 않습니다.