# 4B-1 소유자 실행 절차 — 운영 읽기 점검 / 격리 테스트

운영 기준 main: `4f4847fede4319faea97b90ae798fc4dfc60a82f`.
이 준비 브랜치는 GAS/프런트엔드/운영 배포 도구를 변경하지 않는다. 추가한 것은 비공개 백업의 오프라인 검사,
계좌유형별 staging 실행 옵션, 보고서 코드 제한, 합성 테스트, 설명서 및 이 준비 PR의 live CI 제외 조건이다.
main 병합·운영 GAS/Pages/Sheets/Properties 변경은 실행하지 않는다.

## 0. 현재 확인 결과와 중단 조건

Codex가 수행한 테스트 GAS 공개 appVersion 읽기 결과:

- testEnvironment, scriptHash, sheetHash: 지정된 격리 환경과 일치.
- storeVersion=2.
- **sourceDigest가 최신 main과 불일치.** 따라서 로그인·실제 NH 호출·저장을 진행하지 않았다.
- Google 인증은 소유자 Cloud Shell에만 있으므로 운영 버전/현재 private Code/백업 최신성 및 실제 연동 결과는 아직 미확인이다.
- 이전 24개 실계좌 PASS는 이전 코드의 증거다. 새 보안 코드 PASS로 재사용하지 않는다.

환경 분리, source digest, 기존 자료가 없는 전용 테스트 사용자 중 하나라도 확인하지 못하면 실제 테스트를 중단한다.
운영 GAS 버전이 26과 다르거나 HEAD/배포본/이전 소스 사본이 다르면 운영 배포 준비를 중단하고 변경 원인을 먼저 확인한다.

## 1. Cloud Shell에서 공개 검사 도구 받기

[Cloud Shell 열기](https://shell.cloud.google.com). 기존 본인 Google 인증을 사용한다. 비밀번호·키·토큰은 채팅에 보내지 않는다.
이후 명령은 모두 이 Cloud Shell 터미널 안에서 실행한다. Codex의 별도 실행 환경과 인증 세션을 공유하지 않는다.

```bash
umask 077
PREFLIGHT_WORK=$(mktemp -d)
git clone --single-branch --branch fix/4b1-safety-checks https://github.com/kocoro97-corab/dashboard.git "$PREFLIGHT_WORK/repo"
cd "$PREFLIGHT_WORK/repo"
git diff --quiet 4f4847fede4319faea97b90ae798fc4dfc60a82f HEAD -- gas js index.html tests/staging/StagingBridge.gs
```

마지막 명령은 출력 없이 종료코드 0이어야 한다. 앱 파일 불일치 시 계속 진행하지 않는다.
검사 도구의 승인된 최종 커밋 SHA는 준비 PR 결과에 기록한다. 실제 실행 전 `git checkout <검증된 도구 SHA>`로 고정한다.
이 브랜치의 CI는 합성 검증만 실행하며 Google/NH 비밀값을 사용하지 않는다.

## 2. 이전 소스 사본 선택 → 새 읽기 전용 사본 생성 → 비교

아래 선택 명령은 본인 홈의 기존 `myinvest-backup-*` 중 운영 project/deployment 및 버전 26 메타데이터가 일치하는 최근 사본을 찾는다.
선택 경로를 화면에 출력하지 않는다. 새 사본 생성 전에 실행하므로 새 사본을 과거 기준으로 잘못 선택하지 않는다.
이것은 이전 사본이 소유자의 승인된 기준인지 대신 판단하지 않는다. 이어지는 안전 보고서의 이전 생성 시각을 본인 기록과 대조한다.

```bash
PREFLIGHT_PREVIOUS=$(python3 - <<'PY'
import json, pathlib, sys
sys.path.insert(0, 'tools')
from build_nh_staging import PRODUCTION_SCRIPT_ID, PRODUCTION_DEPLOYMENT_ID
candidates=[]
for folder in pathlib.Path.home().glob('myinvest-backup-*'):
    try:
        meta=json.loads((folder/'inventory.json').read_text())
        if meta.get('scriptId')==PRODUCTION_SCRIPT_ID and meta.get('deploymentId')==PRODUCTION_DEPLOYMENT_ID and meta.get('activeVersion')==26 and (folder/'source-backup.zip').is_file():
            candidates.append((meta['createdAt'], folder))
    except Exception:
        pass
if not candidates:
    raise SystemExit('PREVIOUS_BACKUP_NOT_FOUND_STOP')
print(max(candidates, key=lambda item:item[0])[1])
PY
)
```

`PREVIOUS_BACKUP_NOT_FOUND_STOP`이면 새 사본만으로 이전과 동일하다고 판정하지 않는다.
다운로드해 둔 이전 ZIP/inventory를 본인 비공개 홈 폴더에 복구하거나, 실제 이전 사본 경로를 `PREFLIGHT_PREVIOUS`에 직접 지정한다.
ZIP/소스를 채팅·GitHub에 올리지 않는다.

이전 기준이 확인됐을 때만 실행한다.

```bash
PREFLIGHT_CURRENT="$HOME/myinvest-backup-$(date -u +%Y%m%dT%H%M%SZ)"
python3 tools/prepare_gas_backup.py --output "$PREFLIGHT_CURRENT"
python3 tools/audit_private_gas_backup.py --current "$PREFLIGHT_CURRENT" --previous "$PREFLIGHT_PREVIOUS"
```

첫 명령의 결과가 `GAS_SOURCE_BACKUP_CREATED`, `headMatchesDeployed=true`, `archiveIntegrity=PASS`가 아니면 중단한다.
`prepare_gas_backup.py`가 Google에 수행하는 명령은 list-deployments/pull 뿐이다. push/version/deploy와 Sheet/Properties API는 호출하지 않는다.

두 번째 명령의 안전 출력에서 확인할 항목:

| 필드 | 의미 |
| --- | --- |
| activeVersion / matchesRecoveryVersion26 | 현재 운영 불변 버전 및 26 일치 여부 |
| headMatchesDeployed | 현재 편집 소스와 활성 배포 소스가 같은지 |
| sourceUnchangedSincePrevious | 두 사본의 HEAD/배포본 모든 파일 SHA256 일치 여부 |
| backupContentAndArchiveIntegrity | 현재 사본 파일/ZIP 내용이 inventory 해시와 같은지 |
| backupCreatedAtUTC / previousBackupCreatedAtUTC | 소유자 백업 기록과 비교할 생성 시각 |
| sourceBackupGatePassed | 소스/버전/이전 사본 비교 조건만 통과했는지 |
| stopProductionRelease | 항상 true. 코드 검토·데이터 백업·실제 테스트·별도 승인을 대신하지 않음 |

감사 도구는 로컬 사본을 읽기만 하며 source/ZIP/inventory/권한을 수정하지 않는다.
CLI 종료코드 0도 배포 승인이나 전체 보안 PASS가 아니다. 종료코드 2는 소스 기준 조건 미충족, 1은 검사 실패다.

## 3. 비공개 Code.gs 점검

보고서 findings에는 snapshot(`head`/`deployed`), module(`Code`), line, 고정 code만 들어간다. 소스 문장·함수명·값·경로는 출력하지 않는다.
각 위치는 본인 Cloud Shell 편집기에서만 확인한다. shell에 `cat`, `grep`로 원문을 출력하거나 화면을 공개 캡처하지 않는다.

| 진단 코드 | 소유자 확인 사항 |
| --- | --- |
| LOG_SINK_REVIEW | Logger/console의 인자에 계좌 끝자리·종목·금액·키·토큰·응답/예외가 들어가는지 |
| EXCEPTION_TEXT_REVIEW / THROW_REVIEW / CATCH_REVIEW | 원문 예외·URL·message/stack을 그대로 재전달하는지 |
| UPSTREAM_TEXT_REVIEW | rsp_msg/getContentText를 로그나 오류 응답에 사용하는지, 정상 JSON 해석에만 쓰는지 |
| RESPONSE_SINK_REVIEW | 인증된 정상 계좌 데이터와 공개 오류 응답이 분리되는지 |

이 검사는 보수적인 정적 패턴 검색이다. 정상 고정 로그/인증된 데이터 응답도 표시한다. 별칭·동적 실행·다른 파일까지 완전 분석하는 도구가 아니다.
패턴 0건도 `NO_PATTERNS_FOUND_NOT_AUDIT_PASS`로 표시하며 보안 완료로 판정하지 않는다.
소유자가 관련 함수 본문·로그 별칭·응답을 함께 검토해야 한다. `Code` 외 비공개 모듈이 있으면 그 모듈도 본인만 별도 검토한다.

문제 확인 시 공유할 것은 `snapshot=deployed, module=Code, line=<번호>, code=<고정 분류>, sensitiveOutputConfirmed=true/false`뿐이다.
소스/문장/실제 오류/실제 키·계좌번호를 보내지 않는다. 운영 소스는 별도 승인 없이 수정하지 않는다.

## 4. 운영 배포 설정과 데이터 백업 최신성 — 소유자 읽기 확인

[운영 GAS 편집기](https://script.google.com/home/projects/1WwqTZuH36L3sYdwmz8POXLmW-1Xw4oC4AGkFPSeueaEVBMB31ua_CkYL/edit)
→ 배포 → 배포 관리 → 기존 운영 `/exec` 배포 선택.

- deployment ID와 버전이 inventory/기존 버전 26인지 확인한다.
- 실행 사용자와 접근 권한을 기록된 운영 설정과 비교한다. **연필/업데이트/새 배포/삭제는 누르지 않는다.**
- clasp list-deployments의 JSON에는 실행 사용자/접근 권한이 포함되지 않는다. manifest만 보고 현재 실제 배포 설정으로 추정하지 않는다.

운영 Sheet는 기존 파일과 비공개 사본을 소유자만 비교한다. 백업 뒤 변경된 정상 데이터가 있으면 기존 사본은 최신이 아니다.
소유자 전용 새 사본/영향 범위 보존 계획을 준비하되 원본 파일 ID/데이터/Users/History를 수정하지 않는다.
Properties는 비공개 설정 백업과 필수 영구 설정을 UI에서 비교한다. 전체 값을 로그/JSON으로 덤프하지 않는다.
`S_*`, NHPLUG_TOKEN, NHPLUG_TOKEN_EXP 등 휘발성 세션/토큰을 복구 기준으로 삼지 않는다.

소스 코드 복구는 같은 deployment를 백업된 불변 버전 26으로 되돌리는 별도 승인 작업이다.
데이터는 별도 승인 후 현행 사본도 보존하고 영향받은 사용자/행만 복원한다. 코드 롤백이 Sheet/Properties 복원까지 수행한다고 생각하지 않는다.

## 5. 격리 GAS 최신 main 소스 반영

이 절차는 **격리 프로젝트만** 갱신한다. 운영 창/운영 Sheet를 사용하지 않는다.
사용자가 이미 제공한 테스트 스크립트 ID는 운영 ID와 다르며 빌더/서버/실행기가 운영 project/sheet를 거부한다.

```bash
PREFLIGHT_STAGING_BUILD=$(mktemp -d)
python3 tools/build_nh_staging.py --script-id '1Yt2DM0m4wObHnH0ZqgMh0KMzXnK_O3YH7beDGkEcUCN5gOY832AjSzmw' --revision '4f4847fede4319faea97b90ae798fc4dfc60a82f' --output "$PREFLIGHT_STAGING_BUILD/gas"
(cd "$PREFLIGHT_STAGING_BUILD/gas" && npx --yes @google/clasp@3.4.1 push)
```

setupNhStaging/비밀번호 초기화/새 Sheet 생성을 다시 실행하지 않는다. 기존 테스트 Properties/테스트 사용자/Sheet를 보존한다.
[테스트 GAS 편집기](https://script.google.com/home/projects/1Yt2DM0m4wObHnH0ZqgMh0KMzXnK_O3YH7beDGkEcUCN5gOY832AjSzmw/edit)
→ 배포 관리 → **기존 테스트 배포만** 새 버전으로 업데이트해 테스트 URL을 유지한다.
반영 전에는 아래 auth-only가 source mismatch로 중단되는 것이 정상이다. 운영 배포 workflow는 실행하지 않는다.

## 6. 인증만 먼저 검사 → 계좌유형별 실제 격리 검사

소유자가 Cloud Shell의 프롬프트에서 테스트 ID와 비밀번호를 입력한다. 비밀번호는 숨김 입력이고 명령행/채팅에 넣지 않는다.
현재 테스트 환경의 조회용 NH 키를 유지한다. 운영 키/토큰을 자동 복사하거나 재발급·교체하지 않는다.
같은 NH 키를 공유한다면 자동 조회와 겹치지 않게 하고 토큰/유량 오류 시 반복하지 말고 중단한다.

```bash
PREFLIGHT_TEST_URL='https://script.google.com/macros/s/AKfycbx5s1yhQGKUytKLAE8c6UdZA2wRzenCA3nB-EnP-BpvGGTdYMJvxY8hdzEuWEpWBXkFbQ/exec'
PREFLIGHT_TEST_SCRIPT='1Yt2DM0m4wObHnH0ZqgMh0KMzXnK_O3YH7beDGkEcUCN5gOY832AjSzmw'
PREFLIGHT_TEST_SHEET='1oQA2wD_0jtGVOezLclzUyejsYA2Z-3X_kkD7-by0tsY'
python3 tools/nh_staging_test.py --url "$PREFLIGHT_TEST_URL" --script-id "$PREFLIGHT_TEST_SCRIPT" --sheet-id "$PREFLIGHT_TEST_SHEET" --auth-only --report "$HOME/myinvest-auth-only.json"
```

auth-only가 PASS일 때만 아래 명령을 실행한다. 최신 main과 같은 GAS 소스 지문, 별도 Sheet 바인딩, 강한 테스트 관리자 인증을 매번 검증한다.

```bash
for PREFLIGHT_ACCOUNT in ISA PENSION IRP; do
  python3 tools/nh_staging_test.py --url "$PREFLIGHT_TEST_URL" --script-id "$PREFLIGHT_TEST_SCRIPT" --sheet-id "$PREFLIGHT_TEST_SHEET" --account-type "$PREFLIGHT_ACCOUNT" --allow-staging-write --report "$HOME/myinvest-$PREFLIGHT_ACCOUNT-result.json" || break
done
```

세 실행은 동일한 **합성 7행**을 계좌유형별로 따로 저장한다. 실제 ISA/연금/IRP 보유목록을 조회했다는 의미가 아니다.
NH 일반계좌 조회와 합성 종목 현재가 요청은 실제 API이며, 가격/잔고 값은 보고서에 쓰지 않는다.
각 실행은 24개 검사: 환경/빈 전용 저장소, 국내·해외 일반계좌 전후 비교, 7종목 저장·재조회·시세·평가,
수량 편집·복원·삭제·복원 및 원상 복구다. 세 유형 모두 PASS라면 총 72개 검사지만 **실행 전에는 통과 개수를 0으로 기록한다.**
각 결과의 cleanup=PASS_BASELINE_EMPTY도 확인한다. 복구 이력은 보존한다.
OWNER_RECOVERY_REQUIRED/충돌/기존 자료 발견 시 자동으로 지우거나 다시 실행하지 않는다.

일부 API 장애와 민감정보가 들어간 오류는 합성 자동/브라우저 회귀로 검증한다. 실제 NH 장애를 유발하기 위해 키·토큰·운영 설정을 바꾸지 않는다.
실제 장애를 재현하지 않았다면 합성 장애 검사와 구분해 미검증으로 기록한다.
테스트 GAS 실행 로그도 소유자만 보고 고정 코드/HTTP 상태 외 민감값이 없는지 확인한다. 원문 로그를 공유하지 않는다.

## 7. 공유 가능한 결과와 남은 게이트

- 감사 도구의 비민감 JSON, auth-only/계좌유형별 요약 JSON만 공유한다. 소스 ZIP·설정값·인증 URL·터미널 비밀번호·원문 금융 응답은 보내지 않는다.
- 운영 버전/소스 변경 여부와 Code 점검은 소유자 실행 결과가 오기 전까지 미확인이다.
- Sheets/Properties 백업 최신성과 실행 사용자/접근 권한은 수동 대조 결과가 오기 전까지 미확인이다.
- 최신 main 실제 격리 검사, 비공개 Code 검토, 백업/설정 확인, 필요한 위험 해결 및 별도 운영 승인이 모두 필요하다.
- 이전 웹사이트는 release/pages의 기존 SHA에 유지한다. 이 준비 PR도 별도 승인 전 main에 병합하지 않는다.
