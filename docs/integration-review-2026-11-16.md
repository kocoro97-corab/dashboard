# Codex 통합 검증 — 2026-11-16

**결론: PARTIAL.** 전달된 화면 코드는 보존했고 실행·개발 게시를 진행했다.
실제 owner GAS/Sheets/Calendar 권한이 없어 합성 서버 검증을 실제 연결 PASS로
표시하지 않는다. 역할별 작업은 [ChatGPT 인계서](chatgpt-integration-handoff.md)에 있다.

## 조사 기준 및 게시

- 개발 소스 `feat/nh-integration-v2`의 `aa8d399`까지 ChatGPT 신규 25커밋을
  fast-forward로 수용. 기존 계좌 CRUD/OCR/복구 코드는 유지.
- 기존 PR #7 열림, 해당 기준 CI `43779008423` PASS, live NH job SKIPPED.
- 조사 시 개발 게시 HEAD `85edba9`는 소스 `ddf660a`를 제공해 새 화면 25커밋이
  누락돼 있었다. 새 소스의 공개 자산을 기존 `dev-pages`에만 게시한다.
- 공개 자산 whitelist 및 `asset-manifest.json`/`development-only.json`으로 제공
  소스를 확인한다. 게시본의 과거 수동 캐시 편집에 있던 잘못된 스크립트 마크업도
  소스 기준 생성으로 정리한다. 실제 게시 SHA는 GitHub dev-pages/Pages build에 있다.

## 기능별 실행 결과

| 기능 | 이번 확인 | 제한/다음 담당 |
|---|---|---|
| 로그인·메뉴·라우트·로그아웃 | 합성 서비스 PASS | owner 실제 GAS 로그인은 NOT_RUN |
| 글로벌 시장 확대 차트 | 합성 서비스 PASS | 3개월/5년 중계 차단 수정, 기존 중계 재시작 필요 |
| 섹터·테마·관심종목→분석 이동 | 합성 서비스 PASS, 보유 연결 PARTIAL | H 배열 대신 계좌 context 연결은 ChatGPT C-02 |
| 종목분석·재검색·실패 표시 | 합성 서비스 PASS, 응답 검증 오류 | 다른 meta.symbol을 수용하므로 ChatGPT C-01 우선 |
| 계좌별 평단·전략 시나리오 | 합성 계좌 PASS | 실제 NH 계좌 결과와 별도 |
| 뉴스→일정·전체 헤더 팝업 | 합성 서비스 PASS | 캘린더 Escape/초점은 ChatGPT 보완 |
| 수동 일정 등록·삭제 | 브라우저 localStorage PASS | Sheets/Calendar 동기화가 아님 |
| 계좌관리 표·집계 | 기존 기능 유지, 관련 Node PASS | 종합 시각화는 ChatGPT A-01 |
| Calendar 승인·동기화 | 미구현 | 로컬 정책 scaffold만 존재, UI/서버 미연결 |
| Drive | 준비중 | 기존 합의대로 마지막 단계 |

1440/344/690 px에서 여섯 주요 화면 가로 넘침·이동 및 로그아웃 팝업 정리를
검사했다. 이는 뷰포트 검증이며 실제 Windows 앱·Fold6 기기 결과는 아니다.
테스트의 합성 가격은 테스트 fixture에만 있고 제공 페이지에는 삽입하지 않는다.

## 수행한 최소 수정·검증

- `relay/market_routes.py`: 기존 Yahoo GET 기간 allowlist에 화면이 이미 사용하는
  `3mo`, `5y`만 추가. host/path/query/메서드/세션/출처/개발코드 경계 유지.
- `tests/test_market_relay.py`: 정확한 기간 및 중복 query/토큰/임의 기간 거부 회귀.
  관련 보안 테스트 **9 PASS**.
- `tests/browser_work_handoff.py`: 실제 RelayApp/PublicDevelopment 정책으로
  전달된 화면들을 실행. `--published`는 실제 개발 HTML/JS를 가져오되 API는
  합성 서버로만 처리한다. 알려진 보완 사항은 findings로 별도 출력한다.
  `--evidence-dir`에는 합성 자료 화면만 캡처한다.
- 관련 Node: account-overview 13, work-portfolio 4, app-router 2 = **19 PASS**.
- JavaScript/GAS syntax 및 Python compile PASS. 정상 전체 테스트를 로컬에서
  반복하지 않았으며 변경 후 CI가 기존 전체 회귀를 수행한다.
- 알려진 C-01/C-02/캘린더 UI 문제는 성공으로 덮거나 기존 코드를 재작성하지 않았다.

## 실제 서비스 준비 상태

- 공개 Yahoo S&P 500 `interval=1d&range=3mo` 직접 GET 1회: HTTP 200,
  응답 심볼 일치, 65개 타임스탬프, 관측시각 존재. 가격 원문/값은 로그하지 않았다.
  이 결과는 **공급자 접근 확인만**이며 인증된 GAS/중계/브라우저 실데이터 PASS가 아니다.
- 현재 실행환경에 기존 owner `fresh-plan.json`과 Google 인증이 없다.
  실제 계좌조회·GAS 저장·Sheets 읽기쓰기·기존 중계의 현재 가동 여부는 NOT_RUN.
  이전 owner NH 검증 PASS는 과거 증거로 유지한다.
- 현재 GAS manifest에 Calendar OAuth scope가 없고 GAS/중계에 Calendar action도 없다.
  전용 MY INVEST 캘린더 ID·접근 권한도 확인되지 않았다. Google Drive 연결 도구가
  있다는 사실은 GAS/Calendar 인증을 대신하지 않는다.
- Calendar 서버 통합 전 DTO/POST action·권한·동시성·감사 계약을 확정하고 전용
  테스트 이벤트 범위를 구체화한다. 실제 Calendar 쓰기는 별도 승인이 필요하다.
- 기존 승인 범위의 계좌 연결은 [기존 owner 절차](external-account-management-plan.md#implementation-and-owner-continuation)
  를 사용한다. 새 프로젝트·인증 환경·운영 변경·실자료 초기화는 하지 않는다.

운영 브랜치·GAS·Sheets·Properties·Calendar 변경 없음. 실제 NH 호출 0,
실제 주문 0, 실제 저장/캘린더 쓰기 0. 인수인계 문서만으로 기능 완료를 선언하지 않는다.
