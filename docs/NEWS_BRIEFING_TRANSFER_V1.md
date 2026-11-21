# MY INVEST V2 — 투자 브리핑 JSON 가져오기·내보내기 (독립 데이터 계층)

## 목표

기존 `js/news-briefing-archive-v1.js`와 그 이전의 수동 브리핑을 **파일 포맷으로 이동/복원**할 수 있게 하고, 추후 ChatGPT 예약 작업→승인된 저장소→뉴스 메뉴 연동을 위한 사전 검증을 강화한다.

2026-11-21 현재 Codex가 개발 중인 `js/page-news.js`의 수동 등록·날짜별 목록은 **이미 구현되어 있어 재개발하지 않는다**. 이번 변경은 Codex 영역을 건드리지 않는 독립 신규 모듈만 다룬다.

- 소스: `js/news-briefing-transfer-v1.js`
- 단위 테스트: `tests/news-briefing-transfer-v1.test.cjs`
- 브랜치: `feat/news-briefing-archive-isolated`
- 변경 금지: `feat/nh-integration-v2`, PR #7, Worker, GAS, `js/page-news.js`, Pages, 운영 `main`, `release/pages`, NH/실계좌/주문, 현재 07:00 ChatGPT 예약 작업

## 무엇을 구현했나

| API | 기능 |
|---|---|
| `exportJSON(records, {now})` | 공개 브리핑 0~90건의 백업 JSON 문자열과 권장 파일명 생성 |
| `parseJSON(json, {now})` | 백업 JSON을 엄격히 검사하고 **저장하지 않고** 정규화된 목록 반환 |
| `mergeJSON(json, existing, {now, onConflict})` | 기존 목록과 가져온 목록의 중복·버전·충돌을 판정 |
| `parseLegacyJSON(json, {now})` | 기존 `page-news.js` localStorage 형식의 수동 등록 배열을 명시적 변환 |

**파일 읽기·쓰기 자체를 수행하지 않는다.** 화면에 파일 선택기·다운로드 버튼을 연결하는 코드는 Codex 작업 범위와 겹치므로 별도 승인 전까지 적용하지 않는다. 이번 결과는 파일에 쓰거나 읽을 수 있는 **JSON 문자열을 생성·검사**하는 부분이다.

## 백업 포맷

```json
{
  "type": "myinvest-public-briefing-backup-v1",
  "schemaVersion": 1,
  "exportedAt": 1795212120000,
  "records": []
}
```

`records`에는 `news-briefing-archive-v1.js`의 공개 브리핑 V1 데이터만 허용한다. 예시는 계약 설명을 위한 값으로 실제 오전 7시 브리핑이나 시세가 아니다. 최대 90건, 300만 자 이하. 자정 경계·생성시각의 기준은 KST이며 모든 시간은 Unix 밀리초 숫자다.

## 적용 예시 (샘플, 네트워크/저장 없음)

```js
const transfer = require('./js/news-briefing-transfer-v1.js');
const now = Date.now();
const outgoing = transfer.exportJSON(records, {now});
if (outgoing.ok) {
  // outgoing.json: 다운로드 파일에 넣을 문자열
  // outgoing.filename: myinvest-public-briefings-YYYY-MM-DD.json
}
const incoming = transfer.parseJSON(fileText, {now});
if (incoming.ok) {
  const merged = transfer.mergeJSON(fileText, existingRecords, {
    now,
    onConflict: 'keep-existing' // 기본값; 동일 날짜/출처/시각 내용 충돌은 유지
  });
  // 반드시 사용자가 결과를 확인한 뒤, 화면 어댑터에서만 저장
}
```

## 충돌 정책

- 같은 `date + origin`의 완전히 같은 기록: 변경 없음
- 같은 기록키의 더 늦은 `generatedAt`: 새 버전으로 업데이트 (생성시각은 **선언된 값**, 인증된 값이 아님)
- 더 오래된 선언 생성시각: 기존 유지
- 같은 생성시각이지만 다른 본문·출처: `equalTimeConflicts`로 별도 보고하고 **기존 유지**가 기본값
- 사용자가 명시적으로 선택했을 때만 `onConflict:'replace-on-equal'` 사용
- 같은 백업 파일 내부에서 동일 키인데 내용이 달라지면 **전체 파일 거부**
- 가져오기 이후 총 90건 초과: 암묵적 삭제·오래된 기록 자동 축출 대신 **전체 보류**

`storageModified:false`는 이 모듈이 어떠한 localStorage, Google Sheets, GAS, GitHub 파일도 저장하지 않는다는 뜻이다.

## 보안과 표시 제한

- 파일 최상단·브리핑·원문 출처·본문 섹션의 **알 수 없는 추가 필드**는 거부한다. 기존 archive normalizer가 무시할 수 있는 `accountNumber`·`holdings` 등의 유출 우려를 파일 전송 계층에서 차단한다.
- 계좌번호·주민등록번호·비밀번호·보안 토큰 등 **전형적인** 패턴을 탐지해 거부하며, URL의 일반적인 API Key/Token 쿼리도 차단한다. 이는 정규식 기반 방어여서 **모든 개인정보나 비밀정보를 완벽히 탐지하지 못한다**. 공개 저장소 업로드 전 별도 데이터 검토가 반드시 필요하다.
- 원문은 JSON 텍스트로만 처리한다. 브라우저 표시 시 반드시 `textContent`를 사용하고 `innerHTML`에 직접 전달하지 않는다.
- `origin:'chatgpt-task'`는 실제 ChatGPT 예약 작업에서 왔다는 **증명이 아니다**. 외부 파일은 누구나 임의로 작성할 수 있어 서명·인증된 전송 경로가 도입되기 전까지 `externalOriginAuthenticated:false`, `contentSignatureVerified:false`다.
- 시세·출처 URL의 진위와 최신성은 별도 검증 필요. 단순 과거 문서를 '오늘 실제 데이터'로 표시하지 않는다.
- 파일 업로드시 개인계좌·NH 잔고·주문권한·API 키·Properties와 결합하지 않는다.

## 자동화 경로 — 아직 구현하지 않은 영역

1. **기존 07:00 ChatGPT 예약 작업**의 외부 앱 연결 및 현재 사용자 계정의 쓰기 권한을 직접 확인. 사전 승인 없이 가능하다고 가정하지 않는다.
2. 승인된 격리 저장소로 브리핑 V1 JSON을 기록하는 전달 방식을 선택한다. 불가하면 별도 생성 엔진의 사용료와 자료 출처를 명확히 구분한다.
3. 뉴스 메뉴의 수동 등록 기능을 유지한 채 읽기 전용 공용 브리핑 피드를 연결한다.
4. 저장소·뉴스 화면 접근통제, 버전 충돌, 07:00 누락, 주말/휴장일, 데이터 관측시각, Fold6 화면, 원문 링크, 오프라인 상태를 검증한다.
5. 운영 반영은 사용자 별도 승인 후 수행한다.

**Codex 사용량 초과 상태에서는 Codex에 지시하거나 배포하지 않는다.** 향후 사용자가 "Codex 지시문 작성"을 명시적으로 요청할 때 이 문서와 현재 실제 저장소 상태를 확인해 중복 없는 지시문으로 작성한다.
