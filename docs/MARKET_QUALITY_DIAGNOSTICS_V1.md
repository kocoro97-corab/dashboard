# MY INVEST V2 — 공개 시장데이터 진단 모듈 V1

## 목적

뉴스·브리핑 PR #8 및 Codex 진행 파일과 독립적으로, HOME/시장 분석의 증거 품질 문제와 공개 시세 API 오류를 이해하기 쉬운 원인·대응 지침으로 정리합니다.
새 개발 브랜치: feat/market-quality-diagnostics-isolated

## 독립 파일

- js/market-evidence-gate-v1.js : 이전 독립 작업에서 구현된 필수 지수 정합성 점검기
- js/market-quality-diagnostics-v1.js : 신규 공개 시장 전용, 개인 정보 없는 오류 진단 요약기
- tests/market-quality-diagnostics-v1.test.cjs : 신규 합성/안전 테스트 21개

기존 HOME, NEWS, GAS, NH 계좌, 투자전략, 운영 사이트 파일은 수정하지 않습니다. 이 모듈은 아직 UI에 연결되지 않았습니다.

## 입력

진입점: MYInvestMarketQualityDiagnosticsV1.diagnose({market, now, quotes, sources, receivedAt, events})

market=KR 또는 US, now=현재 시각 Unix 밀리초(명시적).
quotes/sources/receivedAt은 기존 HOME(Q/SRC/QT) 형식을 사용하며, 기존 시장 증거 게이트를 다시 사용합니다.
events는 50건 이하 공개시장 오류기록 배열입니다. 예시:

```json
{
  "scope": "public",
  "code": "NH_NO_PRICE",
  "target": "future:k3",
  "layer": "nh",
  "at": "2026-11-21T13:00:00.000Z",
  "http": null
}
```

실제 사용 시에는 확인된 오류 코드·시각만 사용하십시오. 이 예시는 구조 설명용입니다.

## 개인정보·보안

- scope='account'인 이벤트는 무조건 제외합니다. 알 수 없는 소스 원문·요청 URL·응답 본문·계좌번호·인증 헤더·메시지·사용자 제공 요청 ID를 출력하지 않습니다.
- 알려진 오류 코드만 정확히 매핑하고 미등록 코드는 UNKNOWN_PUBLIC_READ_FAILURE로 바꿉니다.
- 표준 대상명만 출력합니다. 알 수 없는 target은 UNKNOWN_TARGET(조회 대상 미확인)으로 치환합니다.
- ISO 발생시각 또는 유효 Unix 밀리초만 사용합니다. 미래 5분 초과, 과거 7일 초과 기록은 제외합니다.
- 동일 코드+대상 기록을 묶어 건수를 계산하고, 동일 오류 3건 이상은 반복 실패로 표시합니다.
- 강제 네트워크 재시도, 인증, 권한 변경, storage 기록, 주문 기능을 구현하지 않습니다.

## 진단 등급

| 등급 | 의미 |
|---|---|
| hold | 필수 지수의 시세·원천 관측일·수신 상태가 일치하지 않으므로 시장 방향 판정 보류 |
| review-required | 지수 입력은 형식상 일치해도 권한/중계 대상 경고가 있어 최신 상태 재확인 필요 |
| caution | 종가 여부·공개 시세 중계 품질이 불명확하거나 비차단 오류 발생 |
| evidence-coherent | 입력의 지수간 형식상 일관성 확인. 가격 진위나 실시간 상태 검증을 뜻하지 않음 |
| invalid | 요청 시장, 시각 또는 이벤트 배열이 불가능한 값 |

direction은 evidence-coherent일 때만 사용자에게 제공됩니다. caution/hold에서는 unavailable입니다.
비교 방향(comparedDirection)은 참고 메타데이터지만, 검증된 매매 신호가 아닙니다.

## 원인과 조치 매핑

- NH_NO_PRICE: KOSPI200/KOSDAQ150 선물 계약코드·만기·응답 가격 검증
- NH_CONTRACT_EXPIRY: 선물 만기와 연속 선물 전환 여부 확인
- NH_SYMBOL_MISMATCH: 응답과 요청한 종목 식별자 일치 여부 확인
- NH_OBSERVATION / NH_STALE: 관측시각·장 운영시간 확인
- RELAY_BUSY / RELAY_RATE_LIMIT / READ_QUEUE_FULL: 중복 호출 및 호출 간격 검증
- READ_NETWORK / READ_TIMEOUT: 공개 시세 조회 네트워크·시간 초과 확인
- AUTH_REQUIRED / RELAY_TARGET_MISMATCH / RELAY_PUBLIC_URL_DENIED: 원천 허용/권한 설정 검토. 무단 허용 목록 확장 금지
- SOURCE_UNIDENTIFIED / OBSERVATION_TOO_OLD / MARKET_DATE_MISMATCH: 원천 시각·현지 거래일 일치 검증

## 통합 설계(현재 미반영)

HOME 원시 시세(Q/SRC/QT)와 공개시장 ReadStatus의 안전한 코드 목록을 데이터 어댑터에서 합성한 뒤
MYInvestMarketQualityDiagnosticsV1.diagnose로 전달할 수 있습니다.
출력 cards, issues, events, safeHints는 모두 안전한 표준 텍스트이며, UI는 textContent로 그려야 합니다.
절대로 source error의 raw message/body를 기록하거나 새 엔드포인트를 허용하지 않습니다.
Codex가 NEWS 파일을 변경 중이므로 이 작업에서는 index.html, page-home.js, read-status.js, news 파일을 수정하지 않습니다.

## 테스트 및 완료 조건

기존 시장 증거 게이트 18개 테스트와 신규 오류 진단 21개 테스트를 Node에서 실행합니다.
새 CI는 이 격리 브랜치 push에서만 실행되며, GAS 비밀키·NH Staging·실계좌 테스트를 실행하지 않습니다.
운영 배포나 기존 HOME 연동은 사용자 승인 이후 별도 통합 단계에서만 수행합니다.

실제 시장 가격·거래소 휴장일·자동 매매·뉴스 진위는 어떤 경우에도 이 모듈이 검증했다고 주장하지 않습니다.