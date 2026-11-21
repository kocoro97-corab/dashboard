# MY INVEST V2 — 투자 판단 근거·불확실성 설명 V1

## 목적

이미 개발된 시장→산업→종목 분석 코드를 **다시 계산하거나 대체하지 않고**, 그 결과를 사람이 점검할 수 있는 한국어 근거 보고서로 구조화한다. 거래소·공급자 데이터의 실제 진위를 추가 인증하지 않으며, 매수 순위·승률 확률·매매 승인으로 표시하지 않는다.

- 기준 브랜치: `feat/market-sector-stock-adapter-isolated`
- 새 브랜치: `feat/investment-evidence-explanation-isolated`
- 메인 파일: `js/investment-evidence-explanation-v1.js`
- API: `MYInvestInvestmentEvidenceExplanationV1.explain(adapterOutput)`
- `adapterOutput`은 **기존** `MYInvestMarketSectorStockAdapterV1.prepare()`가 반환한 구조이어야 한다.
- CLI: `tools/inspect_investment_evidence_v1.cjs`
- 입력·보고서는 개인정보, 계좌 및 주문과 무관한 **합성 또는 허가된 공개 데이터**로만 구성한다.

## 기존 코드 재사용·중복 방지

| 기존 모듈 | 담당하는 실제 계산 | 새 보고서 역할 |
| --- | --- | --- |
| `sector-insights.js` | 5·20일 상대강도, 산업 거래량 변화, 표본 폭 | 재계산하지 않고 어댑터가 검증한 결과 설명 |
| `work-trading-strategy.js` | 종목 추세, 모멘텀, 거래량·거래대금 배율, ATR 등 | 재계산하지 않고 해당 스윙 결과가 적합했는지 설명 |
| `market-sector-stock-alignment-v1.js` | 시장·산업·종목의 관찰 분류, 정책상 가상 위험배율 | 기존 분류의 이유를 층별 문장으로 변환하고 과도한 위험상한 변조 검사 |
| `market-sector-stock-adapter-v1.js` | 현지 거래일·출처·표본·원천 시계열·기술분석 수치 정합성 검증 | 허용된 어댑터의 정형 결과만 수용, 유효하지 않은 자료는 보류 |

## 출력 내용

- 시장이 supportive/mixed/defensive인지 **시장 계층의 근거와 제한**
- 산업이 strong/mixed/weak인지 **산업 계층의 근거와 제한**
- 종목이 strong/mixed/weak인지 **종목 계층의 근거와 제한**
- `aligned-watch`, `mixed-watch`, `defensive-watch`는 기존 상위 모듈의 관찰 분류 그대로 사용
- 가상 위험예산 정책 상한(스윙 최대 1.5%에 기존 분류별 1.0/0.75/0.5 배수)은 **사용자 매매비중 추천 아님**
- 필수 확인사항: 공급자/거래소 진위, 휴장·조기폐장, 수정주가/배당/분할, 실체결·세금, 분봉 부재
- 한국어 설명 텍스트와 Markdown 텍스트가 함께 제공되며, 어느 경우에도 매수·매도 주문과 연결되지 않음

## 실패 시 출력 규칙

1. 기존 어댑터가 `blocked`이면 새 보고서는 같은 검증 사유의 **사전 정의된 안전한 한국어 설명만** 표시한다. 계좌번호·원문 오류·URL·토큰은 복사하지 않는다.
2. 알 수 없는 오류코드나 추가 속성이 들어오면 원문 표시 없이 검증 보류한다.
3. 이미 생성된 분석이라도 거래일/시장 식별·수치·산업 ID·종목 ID·데이터 커버리지의 모순을 발견하면 보고서 작성을 거부한다.
4. 기존 후보의 위험배율·관찰 분류가 시장/산업/종목 계층과 맞지 않으면 이를 조용히 재보정하지 않고 거부한다.
5. 주어진 입력만으로 승률 확률·진입가·손절가·목표가·매수 수량·AI 종목 순위를 추가 생성하지 않는다.

## 로컬 오프라인 점검

기존 어댑터가 생성한 **합성·공개 연구용 출력**을 `safe-adapter-output.json`으로 준비한 경우:

```sh
node tools/inspect_investment_evidence_v1.cjs --stdin --ack-manual-review --json < safe-adapter-output.json
node tools/inspect_investment_evidence_v1.cjs --stdin --ack-manual-review --markdown < safe-adapter-output.json
```

- 표준입력은 128KiB 이하로 제한하며, 원문은 저장·다시 출력하지 않는다.
- 명시적인 수동 검토 인수 없이 CLI는 작동하지 않는다.
- 실패한 분석은 명확한 종료코드와 안전한 보류 사유를 반환한다.
- JSON/Markdown 출력 모두 기존 분석 근거의 **설명문**이며 실제 투자 브리핑이나 시세 제공 인증서가 아니다.

## 검증 계획 및 현재 범위

- 기존 `market-sector-stock-alignment-v1` 테스트 39개 + 재사용 어댑터 테스트 43개 포함
- 신규 설명 엔진 테스트 35개: 실제 기존 어댑터와 전략 모듈 출력을 사용한 통합 합성 검증, 3계층 방어적 근거, 통화·거래일 보호, 위험한 출력 변조 거부
- 신규 오프라인 CLI 테스트 9개: 정상/차단, Markdown, 원문·인증정보 미출력, 128KiB 제한
- 신규 독립 브랜치의 CI는 모든 테스트를 네트워크·NH/GAS 자격증명 없이 실행
- **기존 파일 0개 수정**, 새 파일만 추가. `main`/`release/pages`/운영 GAS·Sheets·Properties 및 개발 Pages 게시 없음.

## 다음 통합 단계

Codex가 `integration/news-strategy-20261121`에 뉴스·투자전략을 통합하는 동안 기존 `page-*.js`, `index.html`, 뉴스·주문·중계 파일을 변경하지 않는다. 이후 최신 소스에서 실제 제공 필드 확인 → 읽기 전용 연결 검증 → PC/폴드6 합성 브라우저 테스트 → 사용자 승인 후 개발 사이트에만 적용한다.

이 모듈은 실제 투자 성과나 계좌의 실시간 위험을 측정한 것이 아니며, 실제 인증되지 않은 출처에 대해 신뢰도·승률을 숫자로 제시하지 않는다.