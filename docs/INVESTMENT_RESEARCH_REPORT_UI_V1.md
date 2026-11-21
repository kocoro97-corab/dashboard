# MY INVEST V2 — 투자 판단 근거 통합 리포트 화면 V1

## 현재 개발 상태

브랜치: `feat/investment-research-report-ui-isolated`.
기존 MY INVEST V2의 시장·산업·종목 지표를 **다시 계산하지 않고**, GPT 독립 개발의 정합성→설명→날짜별 관찰 이력 결과를 이어받아 PC/폴드6용 독립 리포트 패널을 구현했습니다.

**중요:** 개발 브랜치의 신규 파일과 독립 합성 미리보기만 있습니다. 현재 앱 `index.html`, 기존 `page-home.js`/`page-sectors.js`/`page-strategy.js`/NEWS, 실제 계좌, GAS, Sheets, Properties, `main`, `release/pages`, 개발 사이트에 붙였다는 의미가 아닙니다. PR 생성, 브랜치 병합, 운영 배포를 하지 않았습니다.

## 기존 계산 재사용 구조

```text
기존 Home / SectorInsights / WorkTradingStrategy (계산 소스, 기존 화면 유지)
  → market-sector-stock-adapter-v1.prepare() (관측일/출처/단위 검증, 별도 격리 모듈)
  → market-sector-stock-alignment-v1.examine() (계층별 관찰 분류)
  → investment-evidence-explanation-v1.explain() (한국어 근거/불확실성)
  → investment-evidence-timeline-v1.compile() (날짜별 관찰 이력 및 근거 차이)
  → investment-research-report-v1.build() (최신일 검증, 화면에 필요한 최소 정보만 정리)
  → investment-research-report-panel-v1.mount() (안전한 DOM 텍스트 표시)
```

리포트 모델은 전달받은 기존 어댑터 출력과 이력 배열만 검토하고, `timeline.compile` 및 `explanation.explain`을 **실제로 호출**합니다. 정규장 실시간 지수, 업종 구성원, 종목 급등을 별도로 수집하거나 계산하지 않습니다.

## 신규 파일 및 역할

| 신규 파일 | 역할 |
| --- | --- |
| `js/investment-research-report-v1.js` | `build({ market, mode:'swing', now, records })` 순수 리포트 모델. 최신 관측의 원천·거래일·기존 설명과 정제 이력이 일치하지 않으면 결과 보류 |
| `js/investment-research-report-panel-v1.js` | `mount(container,input)`, `update(input)`, `destroy()` 제공. 보고서 4개 섹션과 버튼 필터. `textContent`만 사용하며 이벤트/DOM을 독립 컨테이너에 제한 |
| `preview/investment-research-report-v1.html` | 로컬 정적 HTML 기반 독립 미리보기, 모바일 viewport 포함 |
| `preview/investment-research-report-demo-v1.js` | 2026-11-18~20 **합성** 미국/한국 시장 데이터와 검증 보류 사례를 기존 정합성 엔진으로 생성 |
| `tests/investment-research-report-v1.test.cjs` | 기존 설명·이력 재사용, KR/US 단위, 상이한 원천·자료 보류·보안 검증 |
| `tests/browser_investment_research_report_v1.py` | PC 1440 / 중간 690 / 폴드6 좁은 폭 344 브라우저, 필터 및 시장 변경·중단 상태·overflow 검사 |
| `.github/workflows/investment-research-report-ui-isolated.yml` | 기존 180개 + 신규 30개 단위 테스트와 3종 브라우저 폭의 합성 회귀 |
| `docs/INVESTMENT_RESEARCH_REPORT_UI_V1.md` | 현재 문서 |

## 사용자 화면 구조

1. **시장환경**: 한국/미국 선택이 아닌 **호출자가 제공한 단일 시장**을 표시. 관측일, 지수/시장 폭 원천 표기, 상승종목 비율 및 표본 커버리지, 우호·혼조·방어적인 관찰 분류
2. **산업·테마**: 입력 자료에 포함된 산업 ID별 기존 5·20일 상대강도와 구성종목 상승폭, 커버리지. **전 시장 주도 산업 랭킹으로 간주하지 않음**
3. **관찰 종목**: 기존 계층별 시장·산업·종목 근거의 한국어 제목, 종목 ID와 산업 ID, 예시 정책 위험 상한. 버튼으로 전체/관찰 가능/검증 보류 필터. 주가·진입가·손절가·목표가·승률·매수 순위를 새로 만들지 않음
4. **관찰 변화 이력**: 최신 12개 관측일을 시각화하고, 직전 저장일 대비 분류 변화·종목 신규 관측·자료 누락 등을 표시. 실제 연속 거래일이나 수익률 그래프가 아님

## 화면 안전성과 오판 방지

- 설명 대상 기록의 **마지막 날짜**가 근거 검증 보류 상태이면 *과거의 긍정적인 관찰 정보를 최신 상태로 재사용하지 않고 화면 전체를 보류*합니다.
- 기간 간 원천 제공처 변경·자료 표본 급감·7일 초과 공백·검증 보류가 있으면 이전 날짜와 현재 날짜의 차이 값은 숨깁니다. 마지막 날짜가 유효하다면 최신일의 별도 근거만 표시할 수 있습니다.
- 모드 `day`는 차단합니다. 기존 `WorkTradingStrategy`의 단타는 분봉 기반이며 일봉 결론을 단타 시그널로 오인시키지 않습니다.
- 이전 모듈이 계산한 `aligned-watch`, `mixed-watch`, `defensive-watch`를 사람이 읽는 **관찰 분류**로 바꿀 뿐 투자 주문 추천·장중 시그널·승률로 사용하지 않습니다.
- 원천 ID와 거래일은 기존 분석에서 허용한 형태의 문자열만 표시합니다. 사용자 입력을 `innerHTML`/동적 외부 스크립트·URL로 연결하지 않습니다.
- 실제 계좌나 주문 권한을 연결하지 않습니다. API 호출, 저장, 알림, 자동 시간 갱신 없이 caller-controlled 입력 변경 시에만 재계산합니다.
- `canPlaceOrder`, `tradeApproved`, `investmentRecommendation`, `sourceAuthenticated`, `livePriceVerified`는 모두 false입니다.

## 로컬 독립 미리보기와 검증

저장소를 체크아웃한 환경에서 `preview/investment-research-report-v1.html`을 로컬 브라우저로 엽니다. 해당 파일은 `file://` 로드가 가능하도록 상대경로 스크립트만 사용합니다.
미리보기 위쪽의 미국/한국/검증 보류 버튼은 **가상 시나리오 변환 도구**일 뿐 실제 시장/종목정보 조회 기능이 아닙니다. 화면과 테스트가 모두 합성 자료임을 표시합니다.

Node 기본 회귀 테스트: 기존 39 + 43 + 35 + 9 + 46 + 8 = 180개. 신규 리포트 모델 30개. 총 **210개**를 CI에서 검증합니다.
Python Playwright로 PC(1440px), 중간 폭(690px), 폴드6 좁은 폭(344px)에서 동작·오류·반응형 레이아웃을 검증합니다.

## Codex 병렬 작업 안전선

코덱스의 `integration/news-strategy-20261121`, PR #7/#8, 기존 `js/page-*.js`와 `tools/build_dev_pages.py`, 뉴스·브리핑, index, 운영 `main`/`release/pages`, GAS·NH·Sheets·Properties는 건드리지 않습니다.
현재 리포트는 **미통합·미게시**이므로 다음에 코덱스 작업이 마무리되면 최신 소스의 충돌 여부 재확인 → 개발용 별도 연결 검증 → PC/Fold6 합성 브라우저 회귀 → 사용자 승인 후 게시 순으로 진행합니다.