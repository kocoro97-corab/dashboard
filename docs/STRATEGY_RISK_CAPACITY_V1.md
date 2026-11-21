# MY INVEST V2 — 단타·스윙 위험예산·가상 수량 계산기 V1

## 개발 배경

Codex가 NEWS/브리핑과 기존 전략 화면을 개발 중이므로 해당 파일들을 변경하지 않고, 기존 시장 관측 증거·거래시간 검증 모듈을 재사용하는 독립 위험관리 엔진을 추가합니다.

개발 브랜치: feat/strategy-risk-capacity-isolated
핵심 신규 파일: js/strategy-risk-capacity-v1.js
CLI: tools/inspect_strategy_risk_v1.cjs
기존 WorkTradingStrategy의 실제 OHLCV 기반 추세 신호를 대체하지 않으며, 본 엔진은 사용자가 지정한 가상 가격으로 손실·수량 상한만 계산합니다.

## 입출력 정책

- 진입점: MYInvestStrategyRiskCapacityV1.evaluate(input)
- 입력 필수: mode (day 또는 swing), market (KR 또는 US), currency (KRW 또는 USD), now (Unix ms)
- 자본: capital, cashAvailable, usedExposure, usedOpenRisk. 동일 통화 기준 숫자를 직접 지정해야 하며 빠뜨리면 차단합니다.
- 가정 가격: entry, stop, target. 롱 포지션만 지원하며 0 < stop < entry < target 순서여야 합니다.
- 요청 위험: riskPct, allocationPct. 사용자 요청치가 정책을 넘을 경우 정책 최대값으로 제한하고 경고합니다.
- 비용: feeBps(편도 수수료, 1bp=0.01%), slippageBps(편도 예상 슬리피지), stressGapPct(손절가보다 불리한 체결을 가정한 가격 하락폭), lotSize.
- 수수료·슬리피지·갭 시나리오는 **사용자가 명시해야 하며** 실제 체결·보장 손실이 아닙니다.
- KR은 KRW, US는 USD만 허용하며 FX 환산이나 다른 계좌 통화를 혼합하지 않습니다.
- 선택 입력: quotes/sources/receivedAt. 기존 관측 자료가 있을 때 형식 일관성만 확인하며 실제 시세 원천 진위는 인증하지 않습니다.

## 정책 상한 (설계 기본값 — 투자 권고 아님)

| 모드 | 위험예산 상한 | 종목당 배분 상한 | 최소 손익비(입력 가정 기준) |
|---|---:|---:|---:|
| 단타(day) | 자본 1.0% | 자본 20% | 1.5 |
| 스윙(swing) | 자본 1.5% | 자본 25% | 2.0 |

위 수치는 보수적인 개발 기본값으로 향후 사용자의 명시적 설정에 따라 별도 검토할 수 있습니다. 시장 국면이나 거래 신호를 자동으로 확정하지 않습니다.

## 주요 계산식

- 진입 체결가(가정): entry × (1+slippageBps/10000) × (1+feeBps/10000)
- 손절 실수령가(가정): stop × (1-slippageBps/10000) × (1-feeBps/10000)
- 갭 급락 손절가(가정): stop × (1-stressGapPct/100)
- 갭 급락 실수령가: 갭 손절가 × (1-slippageBps/10000) × (1-feeBps/10000)
- 1주 기본 손실: 진입 체결가 − 손절 실수령가
- 1주 스트레스 손실: 진입 체결가 − 갭 손절 실수령가
- 사용 가능 위험예산: max(0, capital × min(riskPct,모드 상한)/100 − usedOpenRisk)
- 사용 가능 배분예산: max(0, capital × min(allocationPct,모드 상한)/100 − usedExposure)
- 수량 상한: 위 위험예산/기본손실, 위험예산/스트레스손실, 배분예산/진입 체결가, cashAvailable/진입 체결가의 최소값을 lotSize 단위로 내림

손익비는 수수료·슬리피지를 반영한 예상 목표이익/기본 손절손실 비율입니다. 기준 미달 또는 유효 수량이 없으면 실제 시나리오 수량은 0입니다.
갭은 사용자가 입력한 단일 스트레스 가정이며 그보다 더 큰 급락, 정지·유동성 부족·상하한가·환율 급변은 모델을 초과할 수 있습니다.

## 출력 상태

- hypothetical: 입력된 가정·모드 정책을 충족한 가상 수량이 계산됨. 실제 거래 가능·승인 신호가 아닙니다.
- review-required: 손익비 미달, 잔여 위험예산 부족 또는 수량 0 등으로 계획을 다시 검토해야 함.
- invalid: 입력값·통화 혼합·허용되지 않은 필드·숫자 오버플로 등이 발생함.

canPlaceOrder, tradeApproved, executionAllowed, marketTruthVerified 등은 **항상 false**입니다.
실제 계좌 조회, 주문 권한, API 호출, 자동매매, 저장, 예약 배포는 없습니다.

## 로컬 검증 도구

JSON에 비밀정보·계좌번호를 넣지 말고 공개/합성 시나리오 숫자만 넣어 다음 방식으로 표준입력에서 검사합니다.

```bash
node tools/inspect_strategy_risk_v1.cjs --stdin --ack-hypothetical < public_synthetic_scenario.json
```

입력은 64KiB까지이며 원문은 저장하거나 출력하지 않습니다. 필수 수수료·슬리피지·갭 가정이 없으면 입력을 거부합니다.

## 테스트 및 격리

현재까지 25개 엔진 테스트 및 7개 CLI 테스트를 작성했습니다. 기존 시장 증거 게이트(18), 오류 진단(21), 거래시간(21), 거래시간 CLI(5)와 함께 별도 CI에서 실행합니다.
기반 브랜치 feat/market-session-context-isolated에서 **신규 파일만 추가**합니다.
Codex 뉴스·브리핑 PR #8, 기존 전략 페이지, 계좌·NH·GAS·Sheets, 운영 main/release/pages는 수정하지 않습니다.
실제 홈/전략 메뉴에 연결하거나 PR 병합·운영 배포하려면 사용자 별도 승인이 필요합니다.