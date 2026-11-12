# 4B-1B/C 비공개 수동 검토 / 로컬 백업 비교

운영 GAS 수정·실행·배포, 테스트 GAS 변경, Sheets/Properties 수정, NH 호출, PR 병합을 하지 않는다.
소유자 보고로 확인된 운영 버전 26/HEAD·배포본/이전 소스 일치와 ZIP 무결성은 그대로 기록한다.
그 결과가 private Code 전체 보안 또는 데이터·설정 백업 최신성까지 증명하지는 않는다.

## 1. Code 38행 — 소유자 화면에서만 수동 판단

Cloud Shell 편집기의 Open Home Directory에서 이번 `myinvest-backup-...` 폴더 → `deployed` → `Code.js` 또는 `Code.gs`를 연다.
소스를 터미널에 cat/grep로 출력하거나 캡처/채팅/저장소에 보내지 않는다. 파일을 편집/저장하지 않는다.
38행의 응답 읽기에서 출발해 담긴 변수와 해당 변수를 받는 함수, return/catch 경로를 함께 확인한다.

공유 가능한 분류는 아래와 같다. 확인하지 못한 값은 UNKNOWN으로 둔다.

| 항목 | 선택 가능한 비민감 결과 |
| --- | --- |
| line38Purpose | PARSE_ONLY / PUBLIC_PROXY_RETURN / OTHER / UNKNOWN |
| rawTextReachesLoggerConsole | YES / NO / UNKNOWN |
| rawTextReachesErrorResponse | YES / NO / UNKNOWN |
| privateDataOrCredentialsReachPublicResponse | YES / NO / UNKNOWN |
| upstreamLimitedToApprovedPublicSources | YES / NO / NOT_APPLICABLE / UNKNOWN |
| authenticatedNormalAccountResponseSeparated | YES / NO / UNKNOWN |

JSON.parse 안에 있다는 사실만으로 전체 흐름을 PASS로 판정하지 않는다. 파싱 결과를 통째로 로깅하거나 공개 오류 응답에 다시 넣을 수도 있다.
공개 시장정보 프록시의 원문 반환은 URL/호스트/리다이렉트 제한, 인증정보가 붙지 않는 요청, 비공개 계좌 API 차단이 함께 확인돼야 한다.
인증된 사용자에게 정상 잔고를 반환하는 기능과 공개 로그·오류로 잔고가 새는 경우를 구분한다.

- **PASS:** 목적과 후속 흐름을 사람이 확인했고 비밀값/계좌/잔고 원문의 로그·오류·비인가 응답 전달이 없다고 판단한 범위만 기록한다.
- **FAIL:** 그런 전달 경로를 실제 코드에서 확인했다. 값·소스 대신 위치와 고정 분류만 보고하고 운영 수정은 별도 승인까지 하지 않는다.
- **추가 확인 필요:** 정적 위치만 확인했거나 변수/함수/호스트 제한을 추적하지 못했다. 자동 도구나 질문 응답만으로 사람이 읽지 않은 코드를 PASS 처리하지 않는다.

지금까지 Code의 우선 정적 후보는 deployed Code 38행 UPSTREAM_TEXT_REVIEW 한 곳이다.
이는 기본 패턴에 따른 결과이며, 별칭/다른 비공개 모듈/플랫폼 로그까지 위험이 없다는 증거가 아니다.

## 2. Sheets — 두 사본을 소유자 Cloud Shell에서만 비교

1. 운영 원본 Sheets와 기존 비공개 백업 Sheets를 각각 연다. 원본 값/서식/공유를 수정하지 않는다.
2. 각각 파일 → 다운로드 → Microsoft Excel(.xlsx)로 저장한다. 파일을 서로 다른 이름으로 유지하고 기존 백업을 덮어쓰지 않는다.
3. 원본에서 받은 파일을 `sheets-current.xlsx`, 기존 백업에서 받은 파일을 `sheets-backup.xlsx`로 구분한다.
4. 두 파일은 **본인 Cloud Shell 홈**으로만 업로드한다. Git 폴더·채팅·GitHub에는 올리지 않는다. 같은 파일을 두 번 비교하면 안 된다.

검증된 준비 도구 SHA를 checkout한 공개 저장소 폴더에서 실행한다. 실행 전 두 파일의 출처가 위 1~3과 맞는지 본인만 확인한다.

```bash
python3 tools/compare_private_backups.py sheets \
  --current "$HOME/sheets-current.xlsx" \
  --backup "$HOME/sheets-backup.xlsx" \
  --provenance-confirmed
```

표준 Python만 사용하며 네트워크·파일 쓰기를 하지 않는다. 출력에는 시트명/셀값/수식/지문/경로가 없다.
두 XLSX의 시트 순서·이름, 상수 셀값·수식, 행·열/서식·병합·정의 이름 등의 내보낸 구조를 로컬 임시 HMAC으로 비교한다.
공유 문자열 인덱스는 실제 문자열로 풀어 비교한다. 파일 ZIP의 전체 SHA만 비교하는 방식은 아니다.

`PASS_EXPORTED_SCOPE`는 **확인된 두 export의 비교 범위만** PASS다.
수식의 캐시 평가값, Google 권한/버전 기록/연결된 Apps Script, 실제 복원 실행, 백업 생성 시각은 검증하지 않는다.
차트/그림/pivot/외부 링크/table 등 미지원 기능이 있거나 서식/구조가 다르면 추가 검토로 남긴다.
각 XLSX의 원본 Drive 출처/백업 생성 시각/접근 가능 여부는 소유자가 별도로 확인한다. 다운로드 시각을 백업 생성 시각으로 사용하지 않는다.

## 3. Script Properties — 값은 숨김 입력, 결과만 비교

Apps Script API의 projects/content는 Script Properties 값을 조회하는 API가 아니다.
운영 코드에 새 export 함수를 추가하거나 GAS 함수를 실행해 값을 덤프하지 않는다.
소유자가 운영 GAS 프로젝트 설정의 Script Properties를 **읽기만** 하고 기존 비공개 보안 메모와 대조한다. 값을 수정하거나 저장 버튼을 누르지 않는다.

```bash
python3 tools/compare_private_backups.py properties --complete-permanent-scope
```

입력 방법:

1. 현재 영구 속성의 이름을 붙여넣고 Enter, 이어서 값을 붙여넣고 Enter. 둘 다 화면에 표시하지 않는다.
2. 다음 속성을 같은 방식으로 반복한다. 모두 넣었으면 속성 이름에서 빈 Enter를 누른다.
3. 기존 백업 보안 메모의 속성 이름·값도 같은 방식으로 입력한다. 백업을 덮어쓰지 않는다.

`--complete-permanent-scope`는 소유자가 **현재와 백업의 모든 대상 영구 속성**을 빠짐없이 입력했다고 확인하는 의미다.
일부만 입력했거나 확신이 없으면 이 옵션 없이 실행한다. 그 경우 일치해도 전체 범위 PASS가 되지 않는다.
NHPLUG_APP_KEY/SECRET 등 필요한 영구 설정을 포함하되 `S_*`, NHPLUG_TOKEN, NHPLUG_TOKEN_EXP는 제외한다.
휘발성 키를 입력하면 값을 묻기 전에 중단한다. 여러 줄 값/인증서가 있는 경우 이 단일행 입력 방식을 사용하지 말고 추가 확인으로 남긴다.

이름/값은 메모리에서만 비교하며 파일·셸 기록·출력으로 저장하지 않는다. HMAC 키·지문도 출력하지 않는다.
`PASS_OWNER_ENTERED_SCOPE`는 **소유자가 입력한 완전한 단일행 영구 속성 범위**가 일치한다는 뜻이다.
API로 현재 값을 직접 읽은 증거가 아니며 휘발성 속성/백업 시각/실제 복원 성공을 증명하지 않는다.
모든 API 키/값을 명령행 인수·채팅·GitHub·로그에 넣지 않는다.

## 4. 결과 기록과 종료

공유 가능한 것: 두 비교 도구의 JSON, 소스 원문 없는 수동 판정 항목, 소유자가 확인한 백업 시각/복구 위치 접근 여부.
공유 금지: XLSX/CSV/소스/ZIP 원본, Properties 이름·값 목록, 비밀번호·토큰·원문 응답·계좌·잔고, 편집기의 비공개 화면.

기존 소스 백업 PASS / Code 수동 판단 / Sheets export 범위 / Properties 수동 입력 범위 / 백업 시각·Google 고유 기능·복원 실행을 따로 기록한다.
소유자 결과가 오기 전에는 실제 보안·데이터 백업 검증을 PASS로 표시하지 않는다.
다음 격리 테스트는 별도 단계이며 여기서는 시작하지 않는다. PR #6 병합과 운영 배포도 하지 않는다.
