# MY INVEST V2 — 07:00 투자 브리핑 보관·조회 공통 형식 (독립 모듈)

## 1. 현재 프로젝트 사실과 목표

2026-11-21 기준 Codex 개발 브랜치 `feat/nh-integration-v2`의 `js/page-news.js`에는 이미 다음 기능이 구현되어 있다.

- 뉴스 메뉴의 **AI 투자 브리핑 패널**
- 날짜 선택, 사용자 수동 붙여넣기, 브라우저 localStorage에 30건 보관, 삭제
- 생성·시장 관측·조회시각의 수동 입력 및 알 수 없는 시각을 임의 생성하지 않는 처리
- 자동 수신 미연결을 명확히 표시하는 안내문
- 본문을 `textContent`로만 렌더링하는 XSS 방어 및 좁은 모바일 레이아웃

따라서 **기존 화면을 재작성하거나 같은 수동 입력 기능을 중복 개발하지 않는다.**

장기 목표는 기존 **매일 오전 07:00 ChatGPT 투자 브리핑**을 뉴스 메뉴에서 자동으로 보고, 날짜별 보관·출처·생성시각·시장 관측시각을 안전하게 조회하는 것이다. 기존 ChatGPT 예약 작업 자체는 유지하고, 별도 사용자 승인 없이 일정이나 프롬프트를 변경하지 않는다.

## 2. 이번 독립 개발 범위

- 모듈: `js/news-briefing-archive-v1.js`
- 테스트: `tests/news-briefing-archive-v1.test.cjs`
- 브랜치: `feat/news-briefing-archive-isolated` (운영 main 기준 독립)
- 구현: **순수 데이터 정규화·검증, 수동 기록 포맷 변환, 중복 저장 규칙, 최신/과거 조회, 공개 읽기 전용 피드 검증**
- 의도적으로 제외: `js/page-news.js`, `js/app-shell.js`, `js/transport.js`, GAS, Worker, Google Sheets API 호출, ChatGPT 예약 작업 변경, 실제 웹 게시·운영 배포, 개인계좌·인증·거래 주문

`js/page-news.js`는 Codex 작업 중이므로 이 모듈을 직접 연결하지 않았다. 새 모듈은 서버 및 뉴스 화면에서 따로 호출할 수 있는 **프로토콜 준비 작업**이다.

## 3. 간결한 V1 공통 JSON 스키마

```json
{
  "schemaVersion": 1,
  "date": "2026-11-21",
  "origin": "chatgpt-task",
  "visibility": "public-market-only",
  "timeZone": "Asia/Seoul",
  "scheduleLocal": "07:00",
  "title": "오전 7시 투자 브리핑",
  "generatedAt": 1795212120000,
  "observedAt": 1795208100000,
  "retrievedAt": 1795210500000,
  "rawText": null,
  "sources": [
    {
      "id": "s1",
      "title": "공개 시장정보 확인 링크",
      "url": "https://example.org/market",
      "publishedAt": null
    }
  ],
  "sections": [
    {
      "kind": "us-market",
      "heading": "미국시장 마감",
      "body": "실데이터 없음: 실제 보고서 생성 시스템이 내용을 채워야 함",
      "sourceIds": ["s1"]
    }
  ]
}
```

위 값과 URL은 **프로토콜 설명용 예시**이며 실제 시세·보고서·수집 출처가 아니다. 시간은 KST 문자열이 아니라 Unix milliseconds로 보관한다. 원천이 제공하지 않은 시각은 `null`로 두고 임의 생성하지 않는다.

지원 `origin`: `manual`, `chatgpt-task`, `dashboard-pipeline`. `origin`은 **출처 선언일 뿐 인증·서명·진위 검증이 아니다**. `normalize().verification.originAuthenticated`는 항상 false.

`rawText`를 사용하면 기존 ChatGPT 긴 텍스트를 손실 없이 보관할 수 있고, `sections`를 사용하면 나중에 미국시장·국내 대응·선물·환율·테마·단타·스윙·위험별 패널에 분류할 수 있다.

## 4. 저장 및 조회 계약

`normalize(record, {now})`:
- 필수 대상일·원천·KST 07:00 라벨·공개시장 자료 여부·제목·시각·본문/섹션·링크 검증
- 존재하지 않는 날짜, 미래시각, 관측보다 이른 조회시각, 잘못된 HTTPS 링크, 출처 ID 불일치, 알려진 시크릿 형태는 차단
- 출처 미인증, 시장 관측시각 미확인, 원문 출처 미제공 등은 `review`로 반환

`legacy(row, {now})`: Codex 기존 로컬 브리핑 `{date,text,at,generatedAt?,observedAt?,retrievedAt?}`를 V1 형식으로 변환. 수동 저장시각 `at`를 **ChatGPT 생성시각으로 간주하지 않음**.

`archive(existing, newRecord, {now})`: 같은 대상일/같은 origin은 신규 생성시각으로 교체, 같은 날짜라도 직접 등록과 자동 수신 자료는 구분 보관. 최대 90건. 이 함수는 실제 저장을 수행하지 않음.

`selection(records, {now,date?})`: 가장 최신 날짜를 기본 표시, 수동 날짜 선택 지원. 오늘 보고서가 없으면 지난 날짜의 보고서를 보여주되 **`ARCHIVED_NOT_TODAY`**로 명시. 오늘 보고서도 `TODAY_UNVERIFIED`로 표시하며 실제 시장데이터가 최신인 듯 보장하지 않는다.

시장 관측시각이 없다면 `marketObservationStatus:'UNKNOWN'`을 표시하고, **선언된 관측시각이 36시간을 넘으면** `DECLARED_OLDER_THAN_36H` 경고를 제공한다. 이는 가격원천을 직접 검증한 최신성 판정이 아니라 화면에 보여줄 참고 경고다.

`parseFeed(payload, {now})`: 아래 읽기 전용 서버 응답 규격을 엄격히 검사. 하나라도 부적합한 레코드가 있다면 전체 전달을 거부해 불분명한 데이터를 실데이터로 내보내지 않는다.

```json
{
  "type": "public-briefing-feed-v1",
  "schemaVersion": 1,
  "records": []
}
```

실제 정상 응답에서는 `records`가 1~90개의 V1 기록을 포함해야 한다.

## 5. 자동 저장 경로 — 사실 및 확인 필요사항

### A. 기존 ChatGPT 07:00 예약 작업 활용 (첫 번째 검증 후보)

OpenAI의 2026년 예약 작업 안내에 따르면 적격 예약 작업에서 Gmail·Slack·GitHub 등 **지원 앱**을 사용할 수 있으며, Work의 예약 작업은 사용 가능한 플러그인을 활용할 수 있다. 다만 **현재 사용자의 기존 07:00 작업이 Google Sheets/GAS에 바로 쓰기 권한을 갖는지는 아직 검증되지 않았다.**

1. 기존 07:00 작업이 외부 앱에 **사전 승인 없이** 쓰기가 가능한지 샌드박스/격리 실험으로 확인
2. 가능할 때만 작성한 공개시장 브리핑을 V1 JSON으로 변환해 **격리 데이터 저장소**에 저장. 비밀값·계좌정보는 제외
3. GAS 읽기 전용 공용 시장 피드가 V1 JSON 목록을 제공
4. 개발 뉴스 메뉴는 날짜·출처·생성/관측/조회시각을 함께 표시

**Gmail 알림을 받는 것만으로 원문이 구조화되어 GAS에 저장된다는 의미는 아니다.** 알림 이메일 자동 파싱이 가능한지, 권한/승인 조건이 어떤지 별도 확인이 필요하다.

### B. 대시보드 자체 생성 (대체 경로)

GAS의 시각별 실행기 + 공개 시장 데이터 수집 + 별도 AI API로 보고서를 생성해 V1 기록으로 저장할 수 있다. 기존 ChatGPT에서 생성한 보고서와 **동일한 원문을 보장하지 않는다**. ChatGPT 구독과 OpenAI API 사용 요금, 접근권한 및 데이터 비용은 별개로 취급한다.

어떤 방식을 선택하든 뉴스 메뉴는 같은 V1 읽기 전용 형식을 소비하도록 설계한다.

## 6. 개인정보 및 보안

- 브리핑 저장소에는 **공개 시장정보만** 보관. 계좌번호·잔고·개인 보유내역·NH 인증 토큰·Properties를 넣지 않는다.
- 공개 링크는 HTTPS만 허용하고 사용자 인증정보 포함 URL·localhost/내부 주소·기본 형태의 비밀키를 거부한다.
- 서식 문자열과 JSON을 HTML로 신뢰하지 않는다. UI에서 `textContent` / 안전한 DOM API로만 표시한다.
- origin/sourceProvider/작업 시각을 기록하더라도 원천이 **실제로 확인됐다는 증거는 아니다**. 게시 전 출처 URL과 시장 관측시각을 독립 검증해야 한다.
- 피드는 읽기 전용이고 인증·주문·실계좌 호출을 하지 않는다.

## 7. 향후 Codex 통합 작업 (사용자가 지시문을 요청하기 전까지 보류)

- Codex가 현재 변경 중인 `js/page-news.js`와 이번 신규 모듈 간 충돌·기존 데이터 마이그레이션 검증
- 실제 저장 위치(Google Sheets/GAS 또는 다른 승인 저장소), 쓰기 주체와 권한, 오류·중복·재시도·요일/휴장일·누락 브리핑 정책 확정
- 07:00 예약 작업으로부터 외부 저장 경로가 **정말 가능한지** 격리 환경 테스트
- 실패 시 '미수신' 상태를 표시하고, 지난 브리핑을 오늘 자료로 위장하지 않음
- 개발 Pages, PC·Fold6 모바일, XSS/출처 링크, 동시 중계 요청 제한, CI 및 운영 승인 검증
- 운영 `main`, `release/pages`, 운영 GAS/Properties/Sheets 변경 금지

**이 문서는 현재 Codex 지시문이 아니다.** 사용자가 후에 명시적으로 요청할 때만 그 시점의 코드·브랜치 상태에 맞춰 지시문을 새로 작성한다.
