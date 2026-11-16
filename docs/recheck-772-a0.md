# R-01~R-04 재검증 — 77284db4 / a0e86882

**기존 12건 FAIL은 모두 해결됐다. 기존 63건 63 PASS / 0 FAIL.**
검증 기준은 `a0e86882c82edf7446da4e68a95fa6cc6b1fd726`이며 선행
`77284db484f382049da8e67f22ad332631228b56` 포함을 확인했다.
ChatGPT 제품 UI·분석 로직은 추가 수정하지 않았다.

## 결과

| 항목 | 상태 | 확인 내용 |
|---|---|---|
| 기존 PR #7 / 두 수정 커밋 포함 | PASS | 기존 개발 브랜치에서 fast-forward, 운영 브랜치 변경 없음 |
| 기존 리뷰 63건 | PASS | 21개 시나리오 × 1440/690/344 px, 이전 FAIL 12건 모두 PASS |
| 확장 리뷰 99건 | PASS | 기존63 + 추가36(12개 봉 검증 × 3개 뷰포트) |
| R-01: 평가액0·손익-100 계좌 | PASS | 일반계좌2의 -100원과 음수 막대 실제 표시 |
| R-02: 마지막 13번째가 최대 종목 | PASS | 100013이 최상단·최대 막대로 표시, 나머지1개 생략 문구 유지 |
| R-03: 미보유 국내 USD 응답 | PASS | 분석 불가, 이전 기술적 분석 결과 미표시 |
| R-04: 미래 봉 | PASS | 허용 시계오차5분을 넘는 미래 봉 배제, 모두 잘못됐으면 분석 불가 |
| 중복·역순·비정상 OHLC | PASS | 아래 추가 시나리오 참조 |
| 정상 국내 KRW / 해외 USD | PASS | 정상 분석 및 동일 통화 계좌 평단 비교 유지 |
| 계좌 집계·도넛 비율·반응형 | PASS | 평가액2000/원가1900/손익100/5.26%, 도넛50:50 및70:30 |
| 응답 역전·라우트·로그아웃 | PASS | 마지막 요청 유지, 화면 떠난 뒤/로그아웃 뒤 응답으로 화면 부활 없음 |
| NH·외부계좌 섹터 연결 | PASS | 합성 계좌 연결·갱신 구독·수량0/draft 제외 유지 |
| 관련 Node 회귀 | PASS | account-overview 13 + work-portfolio 4 =17 |
| 관련 Python 중계 회귀 | PASS | test_market_relay 9 |
| 수정 HEAD 기존 CI | PASS | Actions 43788726140 / head a0e86882 |
| 실제 owner GAS·NH·Sheets·Calendar | NOT_RUN | 현재 실행환경에 소유자 Google 인증·비공개 환경 없음 |
| 실제 Windows/Fold6 실기기 | NOT_RUN | Chromium에서 PC/Fold6 크기를 모의 검증함 |

## 추가 봉 검증

완전 불량 응답 8개 유형은 정상 분석으로 표시하지 않는다:

1. 모든 timestamp 중복
2. timestamp 전체 역순
3. 종가0
4. 음수 종가
5. 고가가 시가/종가보다 낮음
6. 저가가 시가/종가보다 높음
7. 비유한 가격
8. 문자열 epoch

정상70봉 중 일부만 잘못된 경우도 확인했다:

- 마지막 중복 봉 제외 → 69봉, 마지막 종가168
- 마지막 역순 봉 제외 → 69봉, 마지막 종가168
- 마지막5개 비정상 OHLC 제외 → 65봉, 마지막 종가164
- 마지막5개 미래 봉 제외 → 65봉, 마지막 종가164

위 숫자는 검증 fixture 전용이며 실제 시장값이 아니다. 제품 페이지에 합성값을
삽입하지 않았다. timestamp 검사에는 코드 정책상 5분의 시계 오차 허용이 있다.

## 자동화 및 증거

기존 스크립트는 기본 옵션에서 원래63건을 유지한다.
`--extended`가 추가 봉 시나리오36건을 포함한다.
이제 수정이 완료돼 기존 PR CI에도 확장 리뷰를 회귀 게이트로 추가했다.
FAIL이면 스크립트 종료코드1이며 알려진 결함을 무시하는 assertion은 없다.

```bash
PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/myinvest-playwright \
  .venv-ci-https/bin/python tests/browser_commit_review.py \
  --extended --output /tmp/recheck-772-a0
```

`--published` 옵션은 실제 개발 HTML/JS를 읽고 API는 합성 서비스로만 처리한다.
`report.json`, 포트폴리오·손실·집중도 PNG가 각 뷰포트별로 저장된다.
인증정보·실계좌번호·실제 보유정보는 저장하거나 로그하지 않는다.

## 개발 게시와 남은 작업

개발 URL: https://kocoro97-corab.github.io/dashboard-v2-dev/index.html#/accounts

검증 시작 시 개발 페이지는 이전 게시 `6e9cc17`이므로 두 수정이 미반영이었다.
기존 공개 자산 빌드 절차로 최신 수정과 검증 커밋을 기존 dev-pages에 반영한다.
게시 후 `development-only.json`, 파일 SHA256, 실제 URL의 99건 검증으로 확인한다.
실제 제공 SHA는 dev-pages 커밋 및 Pages build에 기록된다.

이번 R-01~R-04 범위에서 새 UI·분석 결함은 발견하지 않았다. ChatGPT의 추가 수정
요청은 없다. 기존 범위 밖 Calendar Escape/초점·실서비스 연결 등은 별도 인계 상태로
유지하며 이번 재검증으로 해결됐다고 표시하지 않는다.

다음 담당: **Codex — 실제 GAS 연결 후 실데이터 통합 검증**.
현재 필요한 소유자 Cloud Shell 인증·중계 실행은 사용자가 기존 환경에서 수행해야 한다.
이 검증은 신규 인증환경 생성, 운영 변경 또는 Calendar 쓰기 승인을 대신하지 않는다.
운영 GAS·Sheets·Calendar·main·실제 주문·기존 자료는 변경하지 않았다.
