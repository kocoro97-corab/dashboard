# MY INVEST V2 — 투자전략 재평가·위험 알림 판단 엔진 V1

## 구현 범위

이 단계는 **위험 알림 후보를 계산하는 독립 분석 모듈**이다. 실제 푸시/문자/이메일/앱 알림 전송을 수행하지 않는다. Codex가 기존 캘린더와 실데이터를 통합하는 동안 화면·계좌·운영 파일을 수정하지 않았다.

- `js/strategy-alert-planner.js`: `MYInvestAnalysisChangeTracker.compare()` 결과를 읽어 검토 알림을 계획한다. 외부 API·GAS·Google·NH·계좌 정보 조회, 알림 발송, 저장, 실제 주문 전부 없음.
- `tests/strategy-alert-planner.test.cjs`: 위험 신호, 보유/신규 후보, 일정 위험, 알림 중복 및 보류, 출처 악화, 개인정보 차단 테스트.
- `.github/workflows/strategy-alert-planner.yml`: Node 22 문법 및 독립 단위 테스트 자동 실행.

## 경고 분류와 작업 순서

| 등급 | 조건 | 의미 |
|---|---|---|
| `urgent` | 보유/후보 종목에 새 위험 차단조건 발생, 검증된 시장 위험 구간 상승 | **즉시 재검토 후보**. 매도·매수 지시 아님 |
| `review` | 시장 하락 방향 변화, 산업 5일 상대강도 -0.5%p 이상 변화, 과거 위험 해소 확인 필요, 후보 미관측, 검토 분류 변경 | 투자 판단 전 확인 |
| `informational` | 신규 관찰 종목, 개선된 기술 조건, 상대강도 개선 | 정보성 관찰 |

종목과 계좌는 별도로 구분하고, 같은 등급이면 **보유종목 위험 점검을 신규 후보보다 먼저** 표시한다. 알림 빈도나 수익 가능성/확률을 점수화하지 않는다.

확인된 위험 발표나 시장 경계가 있는 경우 나머지 데이터가 일부 누락되어도 **경고 후보는 유지**한다. 다만 출처가 불완전하면 자동 알림 전송에 사용하지 않도록 `eligibleForNotification:false`로 설정한다.

## 사용 예시 (이미 생성한 결과만 재사용)

```js
const comparison=MYInvestAnalysisChangeTracker.compare({
 previous:verifiedPreviousSnapshot,current:verifiedCurrentSnapshot,today:verifiedToday
});
const review=MYInvestStrategyAlertPlanner.plan({
 comparison,today:verifiedToday,
 delivered:[], // 호출자가 제공한 기존 처리 이력: [{id:'mi-v1-xxxxxxxx',day:'YYYY-MM-DD'}]
 allowNotifications:false, // 기본 비활성
 maxAlerts:50
});
// review.alerts, review.recheck, review.suppressed 을 검토 화면에 표시.
```

`review.delivery.executed`는 **언제나 `false`**이다. `allowNotifications:true`도 전송이 아니라 향후 명시적 사용자 동의·실제 수신자 확인·발송 채널 설정 시 사용할 **적격성 표시만 제어**한다. 이전 처리 이력은 함수 호출자가 전달하고, 이 모듈은 브라우저 저장소·서버·GAS에 어떤 정보도 저장하지 않는다.

## 중복·신뢰성 정책

- 경고의 `id`는 국가·단타/스윙·현재 거래일·종목·사건 유형·수준·위험 차단조건에서 만든 결정론적 식별자. **암호학적 식별자/사용자 ID가 아니다.**
- 정확히 같은 날짜·사건을 다시 계산하면 기존 이력에 의해 제거할 수 있다. 입력된 발송 이력은 최근 30일 이내, 최대 2,000건만 허용한다.
- 일부 출처 연결 실패, 실제 이전 분석의 검증 누락, 필수 출처 악화 시 `status:'partial'`로 유지하고 실제 알림 적격을 끈다. 이미 확인된 임박 위험은 수동 재검토 목록에 남긴다.
- 서술된 변화가 데이터 구조와 모순되거나 잘못된 날짜·시장이라면 잘못된 위험판정을 하지 않는다.
- 비교 자료에 계좌번호·평단·수량·토큰 등 사적 필드가 들어 있어도 출력은 사전에 정의된 공개 시장근거·종목코드·위험종류 필드만 허용한다.

## 테스트·통합 인수 기준

```sh
node --check js/strategy-alert-planner.js
node --check tests/strategy-alert-planner.test.cjs
node tests/strategy-alert-planner.test.cjs
```

이 단계는 신규 독립 모듈·테스트·CI 설정·문서만 반영했다. `index.html`, `js/page-*.js`, `main`, `release/pages`, 운영 GAS/Sheets/Properties, 주문 기능은 수정하지 않았다.

Codex 실연동이 끝나면 (1) 이전/현재 분석 결과의 정확한 거래일·시점, (2) 중복 시나리오에 대한 처리 이력, (3) 공개 일정의 부분 미연결, (4) 화면 내 수동 검토·확인 흐름, (5) PC 1440px / Fold6 690px·344px, (6) 기존 전체 CI를 확인한 뒤 화면에 통합한다. **알림 발송 채널·권한·수신 동의는 별도 승인 전까지 구현·활성화하지 않는다.**

**상태:** 독립 경고 판단 엔진 및 모의 단위 테스트 완료. 실제 화면/시세 및 알림 전송은 미연결.
