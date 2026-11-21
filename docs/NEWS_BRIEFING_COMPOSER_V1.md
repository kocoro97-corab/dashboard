# MY INVEST V2 — 오전 7시 공개시장 브리핑 생성기 V1

## 현재 구현 범위

- 개발 브랜치의 독립적인 오프라인 생성기입니다. 실제 증시 API를 호출하거나 GitHub/Google/GAS로 자동 게시하지 않습니다.
- 입력: 공개시장 전용 검토된 JSON 스냅샷, 출력: 기존 뉴스 메뉴의 공통 공개 브리핑 파일 형식(public-briefing-feed-v1).
- 미국 S&P 500, 나스닥, 다우, SOX의 정규장 종가·등락률 4종이 모두 입력되어야 생성합니다.
- 선택적 지표: 미국 3종 선물, KOSPI/KOSDAQ, 원/달러, 미국 국채 2년·10년, VIX. 미입력 시 미확인.
- NYSE $TICK 수치는 검증된 실시간 경로가 없어 표시하지 않습니다. 임의 수치나 ±1000 신호를 만들지 않습니다.
- 소스 링크를 보존하지만 출처·시장 수치를 독립 검증한 것은 아닙니다. 생성물은 '규칙 기반 초안·검증 전'으로 명시됩니다.
- 계좌, 주문, 고객 데이터, 로그인 세션, 운영 GAS/Sheets/Properties를 읽거나 수정하지 않습니다.

## 입력 구조

최상위 키:

- type = myinvest-public-market-snapshot-v1
- schemaVersion = 1
- visibility = public-market-only
- timeZone = Asia/Seoul
- reportDate = 실제 생성 당일 한국 날짜 YYYY-MM-DD
- collectedAt = 실제 데이터 수집 Unix 밀리초 (현재 시각 대비 12시간 이내)
- sources = [{id, title, url (HTTPS), publishedAt (Unix 밀리초 또는 null)}]
- quotes = [{key, value, changePct, phase, observedAt, sourceId}]

quotes.key: sp500, nasdaq, dow, sox, kospi, kosdaq, esf, nqf, ymf, usdkrw, ust2y, ust10y, vix.
phase는 close, realtime, indicative 중 하나입니다. 미국 4종 필수 지수는 phase=close여야 하며,
관측된 지 96시간 이내여야 합니다. 가격은 양수여야 하고 변화율은 -100%~+100% 범위여야 합니다.
이 규칙은 데이터의 물리적 타당성과 원천의 진위를 보장하지 않습니다.

## 로컬 사용

입력 JSON을 작성하고 공개 정보만 포함됐는지 직접 검토한 뒤 아래 명령으로 생성합니다.

```bash
node tools/compose_morning_briefing_v1.cjs --source REVIEWED_PUBLIC_SNAPSHOT.json --output REVIEWED_PUBLIC_FEED.json --ack-public
```

출력 파일은 명시한 새 경로에만 생성되며 기존 파일을 덮어쓰지 않습니다. 자동 전송이나 자동 게시 기능은 없습니다.
운영에 게시하려면 별도 승인된 정적 파일 배포 경로에 data/myinvest-public-briefings-v1.json을 배치해야 합니다.
이 작업에서는 해당 파일도, 공개 사이트도, 기존 07:00 ChatGPT 예약 작업도 변경하지 않았습니다.

## 아직 필요한 개발

1. 무료·공식 공개 시세 출처와 호출·라이선스·로깅 정책 결정.
2. 공급자별 종가·장중·선물 식별, 발표 시각/휴장일/시간대 검증 및 데이터 품질 교차 검증.
3. 실제 네트워크 수집 도구와 수집 실패 시 발행 차단(Fail closed).
4. 공개 데이터·비공개 계좌 데이터의 완전 분리 및 게시 승인 게이트.
5. 공개 브리핑 파일 게시 자동화와 모바일 반영 검증. ChatGPT 예약 작업 결과 직접 전송은 별도 지원 여부 검토.

개발 완료와 실거래 가능 여부는 별개입니다. 이 모듈은 투자 권유나 자동 매매 판단을 수행하지 않습니다.
