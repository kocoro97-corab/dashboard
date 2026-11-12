# MY INVEST 통합 검증 및 운영 배포 준비

검증일: 2026-11-12 UTC. 대상: PR #2 → PR #3 순서의 통합 소스.
이 문서는 계획이다. main 병합, 운영 GAS 배포, 운영 Sheet 변경, 계좌 삭제/초기화를 실행하지 않았다.

## 1. 검토 대상과 의존관계

- PR #2: https://github.com/kocoro97-corab/dashboard/pull/2
  검토 시작 head `73b2a3a0d6b39c15557cab9c21d69fa1200d99db`, base main `bcd6fc7bafc9b37c7c9147ebb5ea1ffc9e492b1b`.
- PR #3: https://github.com/kocoro97-corab/dashboard/pull/3
  검토 시작 head `c546de412229d7f87348c40d71a0619a6aec6a29`, base PR #2 브랜치.
- compare 결과: PR #3은 PR #2보다 1 commit ahead / 0 behind. 최초 추가 변경은 OCR 관련 6파일이며 GAS 중복 수정 없음.
- 두 PR 모두 검토 시작 시 GitHub mergeable=true. 실제 병합은 수행하지 않음.
- 최종 승인 시 head가 바뀌면 이 결과를 그대로 재사용하지 말고 diff/CI를 다시 확인한다.

## 2. CI와 자동 테스트

- PR #2 최초 최신 CI는 failure였으나 regression job은 cancelled, 단계 로그는 보존되지 않아 HTTP 404였다. 코드 오류라고 단정하지 않았다.
- 해당 SHA의 PR run 43109085075와 push run 43109076781을 재실행했고 attempt 2에서 둘 다 success로 확인했다. 코드 수정으로 CI 취소 원인을 해결했다고 과장하지 않는다.
- PR #3 시작 SHA의 PR run 43113340688 / push run 43113212295는 success.
- 통합 로컬 Node 68개 + Python 28개 = **96개 통과**. GAS/JS 문법과 diff 공백 검사 통과.
- 합성 브라우저 **6개 통과**: ISA/연금저축/IRP × 모바일/PC. OCR 결과, GAS, NH는 mock.
- 저장·재조회·복원·편집 취소·교체 확인, 저장 실패/revision 충돌 시 저장 자료·revision 보존, 미저장 draft 보존을 확인했다.
- 일반계좌 국내/해외 코드·수량·USD 현재가·평가손익·수익률 및 해외 일부 실패 시 국내 자료 보존을 UI와 backend mock 회귀로 확인했다.
- 사용자별 분리/다른 사용자 복구 차단/정상 데이터 rollback은 GAS JS VM mock 회귀다. 실제 별도 두 사용자 연동 시험으로 과장하지 않는다.

## 3. 실제 이미지 OCR

Debian 13 / Chromium 156.0.8078.79 / Tesseract.js 5.1.1, 실제 파일 선택/업로드 버튼에서 시작했다.
기존 실제 이미지 두 장과 비공개 기대값을 저장소 밖에서 사용했다. 원문/계좌정보/금융값/캡처/trace를 공개 로그나 Git에 남기지 않았다.

| 검증 | 모바일 344×882 | PC 1440×882 |
| --- | --- | --- |
| 통합 정확히 7종목 | PASS | PASS |
| 7개 이름·코드·수량·평균매입가 원본 일치 | PASS | PASS |
| 현금/메뉴/계좌 헤더/가짜 종목/중복 0건 | PASS | PASS |
| 로딩 중 업로드 버튼 비활성화 | PASS | PASS |
| 확인 후 7종목 저장·재조회 | PASS (mock API) | PASS (mock API) |
| 결과 편집·확인 저장 | PASS (mock API) | PASS (mock API) |
| 인식 실패 후 기존 목록 유지 | PASS | PASS |

모바일에서 실제 잘린 머리글 이미지와 16×19 저해상도 파생 이미지를 메모리에서 만들어 실제 OCR로 검사했다.
두 경우 기존 목록/저장 자료 유지, 자동 저장 0회로 통과했다. 모든 저화질/잘림 형태를 보장하는 것은 아니다.
실제 Galaxy Fold6 기기 성능/메모리/터치/카메라 업로드는 미검증이다.

## 4. 발견 및 수정

- 외부계좌 평가손익은 계산됐으나 수익률 표시가 없었다. 먼저 실패 테스트를 확인하고 같은 계산 행에
  `수익률 = 평가손익 / 매입원가 × 100` 표시만 추가했다. 확정 현재가가 없거나 원가가 0이면 `—`다.
- 기존 정상 NH 일반계좌/GAS 코드는 변경하지 않았다. 미확인 시세는 여전히 `—`, 합계는 부분 합계다.
- 실제 OCR 테스트에 PC/재조회/잘림·저화질을 추가했다.
- 기존 실제 NH 테스트의 입력은 합성 7종목이며 실제 ISA 이미지와 1종목이 다르다는 검증 범위 차이를 발견했다.
  이전 PASS를 실제 캡처 7종목 전체의 NH 검증 PASS로 해석하면 안 된다.
- `tools/nh_staging_test.py --private-holdings /private/expected.json`은 정확한 실제 7종목 기대값을 외부 파일로 받아
  마스터 검증 후 **격리 테스트 Sheet에서만** 저장·조회·시세·삭제·복원·초기 상태 복구를 검사한다.
  private 모드 결과에는 종목코드/이름도 쓰지 않고 종목 순번별 PASS/FAIL만 남긴다.

## 5. 실제 NH/GAS 증거와 남은 검증

- 과거 소유자 Cloud Shell 실행: LIVE_NH_STAGING / PASS, 합성 fixture 7종목 가격, 저장/삭제/복원,
  일반계좌 국내·해외 전후 비교, cleanup PASS_BASELINE_EMPTY. 결과는 PR #2의 이전 실행 댓글과 사용자 제공 화면에 근거한다.
- 이번 appVersion 재확인: nh-staging, 스크립트/시트 지문, GAS 소스 digest 일치, storeVersion=2. NH 호출/로그인/저장은 하지 않았다.
- 이번 실제 NH/GAS 재실행: **BLOCKED / STAGING_TEST_CREDENTIALS_REQUIRED**, liveNhRequested=false.
  현재 Codex 환경에 로그인 Secrets가 없어 반복 로그인·토큰 추측·운영 대체 테스트를 하지 않았다.
- 따라서 최신 실제 이미지 → 사용자 확인 → 실제 GAS 저장/재조회 → 실제 NH 시세 → 평가/수익률이라는
  **하나의 최신 live E2E 흐름은 아직 미검증**이다. 이미지/브라우저 저장은 mock, 이전 실제 API 증거는 별도다.
- 실제 일반계좌의 최신 값 정확성 역시 이번 작업에서 재확인하지 못했다. mock은 전체 통과, 이전 실제 전후 비교는 통과다.

완료 방법: 소유자가 테스트 로그인 정보만 작업 환경 Secrets에 넣거나 Cloud Shell에서 숨김 입력으로 재실행한다.
비밀번호/키/토큰을 채팅에 보내지 않는다. NH 앱 키는 테스트 GAS 속성에만 둔다. 기존 운영 키 사용 시 예약/자동 조회를 겹치지 않게 하고
토큰 오류/유량 초과가 발생하면 반복 발급하지 않고 중단한다. 같은 키 장기 동시 사용의 독립성은 이 테스트로 보장하지 않는다.
Cloud Shell: https://shell.cloud.google.com

실제 OCR 기대값 파일은 Git 밖에서만 보관한다. 기본 fixture로 실행한 결과와 private-holdings 결과를 구분한다.
격리 실행기는 운영 스크립트/배포/Sheet 지문을 거부하고 초기 보유목록이 비어 있지 않으면 저장 전에 중단한다.
정리는 이번 실행 nonce를 가진 자기 fixture와 일치할 때만 수행한다. 외부 편집이 보이면 OWNER_RECOVERY_REQUIRED로 남기고 삭제하지 않는다.

## 6. 승인 후 병합/배포 순서

**아래는 모두 계획이며 아직 실행하지 않았다.** 각 승인에는 대상 SHA와 환경을 명시한다.

1. 위 live E2E/실제 7종목 재검증을 끝내고 사용자가 최종 head/변경 파일/결과를 검수한다.
2. 사용자 승인 후 PR #3을 PR #2 브랜치에 먼저 병합한다. PR #2의 새 통합 head CI를 다시 통과시킨다.
   squash/rebase를 쓰면 SHA가 바뀌므로 최종 배포 대상으로 새 SHA를 고정한다.
3. **GitHub Pages 게이트를 먼저 확인한다.** 현재 읽기 확인 결과 build_type=legacy, source=main:/, status=built다. main 병합은 Pages 게시를 유발할 수 있다.
   권장안은 기존 게시물을 유지한 채 frontend 배포를 수동 승인/보류하는 것이다. legacy 흐름에 환경 승인 게이트가 이미 있다고 가정하지 않는다. 필요하면 별도 승인 후 Actions 게시 방식/수동 workflow로 전환하고 기존 사이트 유지 여부를 검증한다. 현재 Pages 설정을 이 작업에서 변경하지 않았다.
   게이트 불가 시 신형 frontend가 구형 GAS에 대해 저장을 차단하는 호환 창을 허용할지 유지보수 계획으로 별도 승인받는다.
4. 사용자 승인 후 PR #2 → main 병합. 실제 승인된 통합 SHA의 CI 통과/작업 트리 고정 확인.
5. 소유자가 아래 운영 백업을 완료하고 쓰기 작업/자동 재조회/동시 편집을 중지한다.
6. 운영 GAS 수동 workflow를 **승인된 main SHA**에서 실행한다. 이 workflow는 main에서만 실행되며 이 검증 작업에서는 호출하지 않았다.
7. 인증된 소유자로 externalHoldings storeVersion=2/revision/기존 데이터 비변경을 확인한 뒤 GitHub Pages 게이트를 해제한다.
8. Pages의 실제 배포 SHA와 OCR cache query 버전을 확인하고 desktop/mobile smoke 검사를 수행한다. 유지보수 종료 후 자동 조회를 재개한다.

## 7. 버전 호환성/운영 백업

- 신형 frontend + 구형 GAS: storeVersion/revision이 없으면 저장을 차단한다. 데이터 삭제 대신 승인 배포 안내를 표시한다.
- 구형 frontend + 신형 GAS: expectedRevision/confirmReplace가 없는 저장을 거부한다. 사용자에게 새로고침을 안내하고 중복 저장을 피한다.
- appVersion의 기존 securityVersion/feature 확인만으로 저장 v2 적용을 증명할 수 없다. 소유자 로그인 후 externalHoldings의
  storeVersion=2와 revision, ExternalHoldings/ExternalHoldingHistory schema를 추가 확인한다.
- 기존 ExternalHoldings 8열 유지. History는 별도 6열. 저장 전 사용자별 백업 5개, optimistic revision/명시적 교체 확인을 사용한다.
- 배포 도구는 운영 source/배포가 동시에 바뀌면 중단하고 가능한 경우 자기가 쓴 source/배포만 rollback한다.
  공개 Git에 private Code.gs를 복사하지 않는다. 이 준비 작업에서는 운영 private source를 조회하지 않았다.

소유자 백업 체크리스트:

- 활성 deployment ID/URL/불변 versionNumber 및 현재 frontend 배포 SHA를 비공개 운영 기록에 적는다. 예전 숫자를 현재 버전으로 가정하지 않는다.
- 운영 GAS HEAD와 활성 배포가 다른지 확인하고 미게시 변경이 있으면 배포를 중단한다. 배포 도구의 recovery source version도 기록한다.
- 승인 시 소유자가 전체 Google Spreadsheet 사본을 만든다. Users/ExternalHoldings/History/관련 탭을 포함하고
  사본은 소유자만 접근하게 하며 링크 공유/다운로드 공개를 하지 않는다. 사본 ID/계좌자료/비밀번호 해시는 Git/Actions artifact에 올리지 않는다.
- Script Properties/트리거/권한/웹 앱 실행 사용자·접근 설정은 GAS 코드 버전과 별개다. 필요한 복구 자료는 소유자의 보안 저장소에 보관한다.
  NH 키/토큰/Google OAuth를 로그·일반 문서에 덤프하지 않는다. 코드 배포가 이 값을 자동 백업/복원한다고 가정하지 않는다.
- 기존 세션/Users/키를 배포를 이유로 초기화하지 않는다. 운영 백업 사본 생성도 이번 작업에서는 실행하지 않았다.

## 8. 배포 직후 smoke

- 기존 운영 일반계좌 국내·해외 조회, 코드·수량·통화·현재가·평가손익·일부 실패 진단.
- 기존 ISA/연금저축/IRP 자료가 그대로 보이는지, 계정 간 데이터가 섞이지 않는지 확인.
- 소유자가 승인한 전용 운영 smoke 계정이 없다면 실제 보유자료를 테스트용으로 수정하지 않는다.
- 실제 이미지 OCR 7종목 미리보기, 확인 취소/편집, 현금·중복 제외. 무인 자동 저장 없음.
- 승인된 전용 smoke 자료에서만 저장/재조회/취소/복구. 실제 기존 계좌 삭제/초기화 금지.
- 시세 장애는 0원 평가가 아니라 —/부분 합계인지, 잘린/저화질 이미지 실패가 기존 자료를 지우지 않는지 확인.
- 오류/복구 안내에 비밀번호·토큰·키가 없는지 확인. desktop/mobile 체크 후 실제 Fold6은 별도 사용자가 검수한다.

## 9. 오류 시 rollback과 데이터 복원

1. 쓰기와 자동 조회를 멈추고 현재 버전/오류 code만 비공개 기록한다. 에러를 재현하려고 저장/삭제를 반복하지 않는다.
2. 배포 workflow가 자동 복구를 보고해도 활성 버전/소스/URL을 다시 확인한다. 동시 편집으로 복구가 중단되면 임의로 덮어쓰지 않는다.
3. 운영 GAS는 기록된 직전 **호환 가능한 보안 적용 버전**으로 기존 deployment ID를 재지정한다. frontend도 기록된 검증 SHA로 재배포한다.
   main 전체 reset/force push 대신 승인된 revert 또는 수동 배포를 사용한다. 둘의 전환 중 쓰기는 계속 막는다.
4. 코드 rollback은 Sheets/Properties를 되돌리지 않는다. History 탭을 삭제하거나 Users/키를 초기화하지 않는다.
5. 사용자 단위 자료 문제는 해당 사용자의 복구 snapshot을 미리 비교하고 최신 revision과 사용자 확인을 거쳐 복원한다.
   복원 전 현재 자료도 별도 보존한다. 다른 사용자 snapshot을 복원하지 않는다.
6. snapshot이 없으면 소유자 비공개 전체 Sheet 사본과 현행 자료를 사용자별로 비교한다. 백업 이후 다른 사용자의 정상 갱신은 유지하고
   영향을 받은 범위만 승인 후 복구한다. 통째로 과거 사본을 덮어쓰는 것은 별도 장애 대응 승인이 필요하다.
7. 재로그인/재조회/사용자 분리/코드·수량·매입가를 검증하고 백업과 History는 유지한다. 비밀번호/세션 복구는 별도 보안 영향 검토를 거친다.

## 10. 현재 판단

**조건부 가능 — 현재 운영 배포 실행은 금지.** 자동/실제 이미지 검증은 통과했지만 다음 운영 게이트가 남아 있다.

- 최신 실제 이미지 7종목의 격리 live NH/GAS E2E 재검증(인증정보 대기).
- 최종 통합 SHA CI 성공 확인 및 사용자 재검수/명시적 병합·운영 배포 승인.
- 소유자의 운영 백업 완료와 GitHub Pages 게시 순서/게이트 확인.

실제 Fold6/다른 캡처 배치/지속 부하/동일 NH 키 장기 동시 사용은 미검증이다.
