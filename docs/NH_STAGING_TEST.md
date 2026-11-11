# PR #2 실제 NH / GAS 격리 연동 테스트

## 현재 결과와 실행 조건

**실제 연동 상태: BLOCKED / 미실행.** 테스트 GAS URL·스크립트 ID·별도 시트 ID가 제공되지 않았습니다.
실제 NH 요청은 하지 않았습니다. 운영 GAS를 테스트 대상으로 대체하지 않습니다.
GitHub Secret 이름 목록 조회도 연결 앱에서 HTTP 403으로 거부됐으므로, 별도 테스트 자격증명이 이미 있는지도 확인하지 못했습니다.

| 검증 | 현재 상태 |
| --- | --- |
| ISA 7종목 실제 NH 현재가 | 미실행 — 테스트 환경 필요 |
| 실제 GAS 저장 → 삭제 → 복원 → 초기상태 복구 | 미실행 — 테스트 환경 필요 |
| 실제 일반계좌 국내/해외 잔고 전후 비교 | 미실행 — 테스트 환경 필요 |
| 테스트 도구 자체의 모의 회귀/격리 가드 | 자동 테스트로 검증; 실제 NH 결과와 구분 |
| main 병합 / 운영 배포 | 미실행; 재검수·별도 승인 후 결정 |

## 이번 실행 결과 (2026-11-11 UTC)

- Node 회귀 **61개**, Python 회귀 **22개**, 합계 **83개 통과**.
- ISA / 연금저축 / IRP 모바일 브라우저 모의 흐름 **3개 통과**.
- JS/GAS 문법 검사 및 `git diff --check` 통과.
- 실제 실행 도구의 사전검사: `BLOCKED`, `STAGING_URL_SCRIPT_AND_SHEET_REQUIRED`, `liveNhRequested: false`.
- 7종목 `035720`, `037710`, `096240`, `103140`, `344820`, `352700`, `0008Z0`의 실제 현재가는 모두 **미조회**.
- 실제 GAS 저장/삭제/복원, 실제 일반계좌 국내/해외 잔고 비교도 **미실행**. 모의 통과로 대체하지 않습니다.
- 현재 작업 환경에는 주입된 Google/NH 인증정보가 없으며 새 테스트 프로젝트의 소유자 권한 승인도 필요합니다.

## 격리 구성

1. [새 Apps Script 프로젝트](https://script.new)를 만듭니다. **빈 새 프로젝트**만 사용합니다.
2. 프로젝트 설정에서 새 스크립트 ID를 복사합니다. 기존 운영 ID는 빌더와 서버가 거부합니다.
3. [Cloud Shell](https://shell.cloud.google.com)에서 아래처럼 PR 소스를 별도 폴더에 받습니다.

```bash
STAGING_WORKDIR=$(mktemp -d)
git clone --single-branch --branch fix/issue-1-external-ocr https://github.com/kocoro97-corab/dashboard.git "$STAGING_WORKDIR/repo"
cd "$STAGING_WORKDIR/repo"
python3 tools/build_nh_staging.py --script-id '새_테스트_스크립트_ID' --revision "$(git rev-parse HEAD)" --output "$STAGING_WORKDIR/gas"
cd "$STAGING_WORKDIR/gas"
npx --yes @google/clasp@3.4.1 push
```

이미 진행한 clasp 로그인 인증을 사용합니다. `.clasprc.json`은 공개 Git이나 채팅에 올리지 않습니다.
빌더는 공개 PR 소스만 사용하고 운영 소스·Sheet·키를 읽거나 복사하지 않습니다.
생성 파일은 Security, SecurityKdf, ExternalHoldings, Nhplug, StagingBridge, manifest입니다.
운영용 `deploy-gas.yml`은 이 절차에서 실행하지 않습니다.

4. 새 테스트 프로젝트의 **스크립트 속성**에 다음을 직접 설정합니다.

| 이름 | 내용 |
| --- | --- |
| STAGING_TEST_USER | 테스트 전용 ID |
| STAGING_TEST_PASSWORD | 운영 계정과 다른 16자 이상 임시 비밀번호 |
| NHPLUG_APP_KEY | 별도 조회용 NH 테스트 앱 키 |
| NHPLUG_APP_SECRET | 해당 앱 비밀키 |
| NHPLUG_KEY_USAGE | `staging-readonly` |

운영 NH 앱 키를 자동 복사하지 않습니다. 별도 키 발급이 어렵다면 같은 키의 토큰 재발급·호출 제한 영향을 NH 정책에서 확인한 뒤 별도 승인을 받아야 합니다.
이 코드에는 주문 요청 경로가 없습니다. 키의 값은 채팅·PR·실행 로그에 넣지 않습니다.

5. 테스트 편집기에서 **setupNhStaging**을 선택해 소유자 본인이 실행하고 Google 권한을 승인합니다.
   새 `NH-STAGING PR2 ...` 스프레드시트를 만들고 테스트 관리자 계정만 추가합니다.
   초기 비밀번호 속성은 해시 저장 후 삭제합니다. 실행 로그에는 테스트 스크립트/시트 ID와 소스 revision만 나옵니다.
   새 프로젝트의 최초 Spreadsheet/외부 요청 권한 승인은 소유자가 해야 합니다. GitHub의 코드 편집 OAuth만으로 대신 승인되지 않습니다.
6. 테스트 프로젝트에서만 **배포 → 새 배포 → 웹 앱**을 만듭니다. 실행 사용자는 소유자, 접근은 모든 사용자로 설정하되,
   모든 데이터 요청은 내부 테스트 로그인·시트 바인딩을 요구합니다. 테스트용 회원가입은 차단합니다.
   또는 해당 테스트 빌드 폴더에서 `npx --yes @google/clasp@3.4.1 deploy`로 새 테스트 버전을 배포합니다.
7. 새 테스트 `/exec` URL, 스크립트 ID, 생성된 시트 ID를 기록합니다. 이 세 값만 공유해도 되며 키·비밀번호는 공유하지 않습니다.

## 실제 실행

```bash
cd "$STAGING_WORKDIR/repo"
python3 tools/nh_staging_test.py --url '테스트_EXEC_URL' --script-id '테스트_SCRIPT_ID' --sheet-id '테스트_SHEET_ID' --allow-staging-write --report "$STAGING_WORKDIR/nh-staging-report.json"
```

사용자 ID와 비밀번호는 터미널에서 입력합니다. 비밀번호는 숨김 입력이며 명령행 인자·보고서에 넣지 않습니다.
운영 배포 ID/스크립트 ID/시트 지문, 환경 표식, 소스 digest가 맞지 않으면 로그인 전에 중단합니다.
스테이징 사용자 보유목록이 처음부터 비어 있지 않아도 덮어쓰지 않고 중단합니다.

검증 순서:

1. 테스트 프로젝트·시트·소스 일치, 별도 NH 키 설정 선언 확인.
2. 실제 일반계좌 국내·해외 잔고 조회. 원문은 메모리에서만 사용합니다.
3. ISA fixture 7종목의 실제 현재가가 유효한 양수인지 확인. 영문 혼합 `0008Z0` 포함.
4. 합성 수량·매입가의 7종목 저장/읽기 일치 → 1종목 삭제 → 복구 기록에서 정확히 7종목 복원.
5. 일반계좌를 다시 읽고 코드·수량·통화가 유지되는지 비교. 시세·평가액의 시장 변동은 동일 비교 대상에서 제외합니다.
6. 이번 실행의 fixture만 초기 빈 상태로 정리하고 읽기 확인. 다른 실행/사용자가 수정한 자료가 보이면 삭제하지 않습니다.

종목별 PASS/FAIL 및 안전한 layer/HTTP/rsp_cd만 보고합니다. 일반계좌 종목명·수량·평가액·계좌번호·토큰은 출력하지 않습니다.
테스트 시트에는 합성 fixture와 복구 기록만 남고 일반계좌 실잔고는 저장하지 않습니다.
`OWNER_RECOVERY_REQUIRED`가 나오면 테스트 시트의 복구 기록을 소유자가 확인해야 합니다.

## GitHub CI에서 실제 실행하려면

GitHub의 `nh-staging` 환경을 만들고 **필수 검토자 승인**을 설정한 후, 아래를 해당 환경의 Secrets에 저장합니다.
`NH_STAGING_URL`, `NH_STAGING_SCRIPT_ID`, `NH_STAGING_SHEET_ID`, `NH_STAGING_USER`, `NH_STAGING_PASSWORD`.
NH 앱 키는 GitHub로 옮기지 않고 테스트 GAS 속성에만 둡니다.
저장소 변수 `NH_STAGING_ENABLED=true`는 소유자가 검토 후 켭니다.

그러면 같은 저장소의 PR 이벤트에서만, 일반 회귀 성공 뒤 승인 대기한 스테이징 job이 실행됩니다.
기본값은 비활성이며, **skipped는 실제 NH 테스트 성공이 아닙니다.**
main 병합이나 운영 배포 없이 PR 브랜치에서 테스트합니다. 운영 배포 job은 실행하지 않습니다.
결과는 job summary에서 확인하고 PR #2에 링크합니다. 안전한 결과 JSON만 공유하고 전체 터미널 화면·키·원문 잔고는 공유하지 않습니다.

최종 병합·운영 배포 여부는 사용자의 재검수 후 결정합니다.

## 로그인 단계 진단 보완

사용자 제공 실행 결과는 `FAIL / GAS_REJECTED`, `liveNhRequested=false`, 빈 checks였습니다.
이전 실행기는 실패한 action과 코드 없는 GAS 메시지를 구분하지 않아 정확한 실패 위치는 미확정입니다.
이 결과로 NH 키 오류나 실제 시세/잔고 조회 실패를 판단할 수 없습니다.

실행 도구의 `--auth-only` 옵션은 프로젝트·시트·소스 일치 → 로그인 → 로그아웃만 확인합니다.
NH 요청과 보유목록 쓰기는 하지 않습니다. 이 변경은 도구만 바꾸므로 테스트 GAS 재배포가 필요 없습니다.

- `failedAction=login`, `LOGIN_CREDENTIALS_OR_APPROVAL`: 테스트 Users의 ID/비밀번호 또는 approved 상태 확인.
- `LOGIN_RATE_LIMITED`: 15분 뒤 한 번만 재검사.
- `GAS_HANDLER_EXCEPTION`: 테스트 GAS의 서버 실행 오류 확인. 비밀번호 오류로 단정하지 않음.
- `GAS_REJECTED`: 알려진 안전한 메시지에 해당하지 않아 추가 진단 필요. 원문 응답은 출력하지 않음.

비밀번호는 터미널 숨김 입력만 사용하며 사용자 레코드의 비밀번호 해시도 PR/채팅에 올리지 않습니다.
추가 Python 회귀 4개를 포함해 Python 26개 통과. 기존 Node 61개와 합계 87개입니다.
