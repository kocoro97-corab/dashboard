# 산업·테마 사용자 제보 후속 — 2026-11-17 UTC

기준: 기존 개발 브랜치의 병렬 커밋 `3b7450b`, `897e138`을 fast-forward로 보존했다. 사용자 요청에 따라 산업·테마 버튼 배치와 미국 일반종목 테마를 이번 범위에서 직접 반영했다. 운영·인증·중계 권한·NH 저장·주문은 변경하지 않았다.

## 재현과 수정

- 국내 스윙: 실제 `^KS11` 응답의 2026-11-17 종가는 null, 개별 종목 `014990.KS`, `033340.KQ`에는 같은 날 종가가 있었다. 이전 코드는 각 시계열 마지막 날짜가 달라 전부 `DATE_MISMATCH`로 제외했다.
- 수정: 기준지수의 최근 n+1개 **실제 종가 관측일**과 일치하는 개별 종목 값을 조회하여 동일한 시작/끝/중간 거래일로 수익률을 계산한다. 중간 값이 없으면 해당 종목을 제외한다. 지수 결측을 채우거나 최신일 종목만으로 지수 수익률을 추정하지 않는다. 공통 관측일을 표시한다.
- 오류 종목은 중복 제거 후 접힌 상세 영역에 표시한다. 유효 종목의 결과는 유지한다.
- 새로고침은 제목 오른쪽. 지역은 현재 국가/전환 대상이 표시되는 단일 버튼. 오른쪽에 단타·스윙. 단타에는 기간 버튼을 숨긴다. 스윙 진입 시 기본 5일, 선택 5·20·60일. 시세 새로고침은 관련 캐시도 갱신한다.
- ChatGPT `897e138`의 KST 시간대 기본값을 유지하고 타이머를 분 경계에 맞췄다. 07:00~20:59 한국, 21:00~06:59 미국. 수동 선택은 해당 방문에서 유지, 재진입/자동 전환 시 단타 기본값 적용.

## 미국 일반종목 테마

공식 ARK Invest 공개 테마 구성자료의 2026-11-17 스냅샷을 `data/us-theme-instruments.json`에 저장했다. 출처 URL, 기준일, 수집시각, CSV SHA-256, 표본 선택 기준을 기록했다. 각 테마에서 공식 자료 순서 상위 5개 중 Yahoo 응답으로 USD/미국 거래소/EQUITY/심볼/충분한 이력이 확인된 일반종목만 사용한다.

- 자율주행·로보틱스
- 유전체·바이오 혁신
- 차세대 인터넷
- 핀테크 혁신
- 우주·방위 혁신

5개 테마, 중복 제거 19개 종목. 테마별 표본 동일가중 종가 수익률과 SPY 상대강도를 표시하고, 클릭하면 구성 일반종목 표와 기존 종목분석으로 연결한다. 기존 11개 ETF는 접힌 참고 영역에 유지한다. ETF 가격은 일반종목 테마 수익률로 사용하지 않는다.

제한: 운용사 테마 바스켓 표본으로 범위가 제한된다. 전체 미국 산업/테마 확정 순위나 당일 실제 자금유입 순위가 아니다. 구성목록은 고정 스냅샷이며 시세 새로고침으로 편입·편출이 갱신되지 않는다. 구성일과 관측일을 별도로 표시한다. 유료 API, 신규 서비스/인증 또는 중계 허용 목록 확대 없이 기존 Yahoo 공개 조회 경로를 사용한다. 이 파일은 공개 펀드 구성 분류자료이며 사용자 계좌 보유자료가 아니다.

## 검증

- `node --check js/page-sectors.js`: PASS
- `node tests/sector-series-runtime.test.cjs`: 7 PASS, 실제 공통 날짜 결측 회귀와 시간대 경계 포함.
- `python -m unittest discover -s tests -p test_public_dev.py`: 14 PASS, 공개 참조자료 빌드와 비공개 파일 제외.
- `tests/browser_integration_958.py --only sectors --widths 1440 690 344`: 15 PASS, 기존 계산/부분 실패/빠른 전환 회귀.
- `tests/browser_market_sector_recheck.py --area sectors --widths 1440`: 8 PASS, 기존 단타 수집/명시 새로고침/종목분석 연결.
- `tests/browser_sector_followup.py`: 17 PASS, 제목 우측 새로고침/단일 지역 버튼/스윙 기본 5일/코스피 최신일 null/일반주식 테마/ETF 오응답 거부/로그아웃/정각 전환/수동 선택/재진입, 1440·690·344.
- 실제 공개 응답: 산업·테마 네이버/Yahoo 78/78 HTTP 200. 공식 구성자료 확인 및 일반주식 식별 과정 40 HTTP 200, 19개 고유 일반종목 확인. 무료 공개 자료만 조회했다.
- 새 공개 응답 재생: 기존 산업·테마 계산 1440/344에서 6 PASS. 미국 일반주식 테마는 1440/690/344에서 3 PASS; 각 케이스는 5개 테마의 1·5·20·60일 수익률과 SPY 대비를 독립 계산해 대조했다.
- 합성 인증과 실제 공개 응답 재생을 실제 사용자 로그인 중계 PASS로 바꾸어 보고하지 않는다. 실제 사용자 인증 세션에서 최종 수신은 사용자 기기 확인 필요.

브라우저 실행 예:

```sh
PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/myinvest-playwright .venv-ci-https/bin/python tests/browser_sector_followup.py --output /workspace/output/sector-followup-new
PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/myinvest-playwright .venv-ci-https/bin/python tests/browser_sector_followup.py --public-feeds /tmp/myinvest-sector-followup/public-feeds.json --output /workspace/output/sector-followup-public-equities
```

공개 응답 원문은 임시 폴더에 보관하고 git에는 넣지 않았다. 스크린샷은 합성 계좌/인증을 사용하며 `/workspace/output/sector-followup-*`에 있다.

## 다음 담당

Codex: 개발 게시 SHA/파일 해시 확인, 사용자 실제 로그인 중계 수신 확인 후 실패 경로만 후속 분석. 이후 미국 테마 범위 및 구성목록 갱신 방식 확대가 남는다. 현재 범위의 UI 요청은 반영했으므로 ChatGPT에 중복 구현을 요청하지 않는다.

## CI에서 추가 재현한 병렬 변경 결함

`3b7450b`의 전역 캘린더 팝업은 뉴스 페이지 인스턴스 밖으로 이동했지만 대시보드 종료 시 닫는 호출이 빠져 `tests/browser_work_handoff.py:77`의 로그아웃 정리 검사가 실패했다. `js/app-shell.js`의 기존 `stop()`에서 공개 close API 호출과 미완료 UI 열기 플래그 초기화만 추가했다. 인증 코드·이벤트 저장·Calendar API는 변경하지 않았다. 산업·테마에서 전역 팝업을 연 채 로그아웃하는 회귀 검사도 기존 후속 검사에 포함했다.
