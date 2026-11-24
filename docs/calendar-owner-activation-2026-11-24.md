# 기존 격리 Google Calendar 연결 적용

## 확인한 현 상태

사용자 제공 owner preflight: 활성 Worker `4d4f3cd7-02b5-427a-80aa-35217a5ce2cb`,
최신 버전과 일치, 기존 GATE 및 owner bundle 검증 성공, 개발 세션 60분.
Google client ID는 Text, client secret은 Secret으로 정상 등록됐다.
이 결과는 **이름·유형의 존재 확인**이며 OAuth 값의 유효성이나 실제 Google 동의 성공을 뜻하지 않는다.
남은 항목은 bridge/encryption 키와 `nodejs_compat`, 기존 GAS identity 모듈의 연결이다.

## 승인된 적용 범위

`tools/calendar_connection_activate.py --environment <기존 비공개 폴더> --apply`를
owner Cloud Shell 터미널에서 실행한다. 기본 실행은 로컬 준비·읽기 전용이다.
현재 개발 커밋으로 고정한 별도 임시 checkout을 사용하며 기존 checkout을 덮어쓰지 않는다.
입력은 Cloudflare Account ID/API token 및 **MY INVEST 대시보드** ID/비밀번호다.
Google/NH 비밀번호를 입력하지 않는다. 모든 입력은 숨김 처리하고 메모리에서만 사용한다.
기존 clasp owner 인증이 필요하며, 없으면 쓰기 전에 중단한다.

도구는 다음 순서로 기존 자원에만 적용한다.

1. 비공개 `fresh-plan.json`, bundle, 배포 revision/digest, 원격 GAS HEAD,
   기존 immutable version, Worker 활성/최신 버전과 바인딩을 교차 검증한다.
2. **현재 제공자가 보관한 Worker 코드**를 읽어 별도 overlay로 컴파일한다.
   기존 export·중계 동작을 유지하며 저장소의 과거 Worker로 대체하지 않는다.
3. 비공개 checkpoint에 원본·계획·새 키를 보관한다. 디렉터리 0700/파일 0600.
4. 기존 Google 값과 다른 바인딩을 strict inherit하고, 새 키 2개·기능 플래그·
   갱신된 expected metadata·Node 호환 설정을 포함한 미활성 후보를 생성한다.
5. 기존 격리 GAS에 identity helper/dispatcher만 연결하고 manifest 권한은 유지한다.
   현재 배포의 60분 세션 코드와 operating 기본 5분 정책을 그대로 보존한다.
6. 기존 지정 테스트 사용자이자 admin의 유효 세션에서 identity 설정 3개만 초기화한다.
   기존 키가 다르면 중단하고 회전·덮어쓰기하지 않는다.
7. GAS 확인 후 Worker 후보를 활성화하고 기존 capability/바인딩/세션을 재확인한다.
   인증된 calendar status로 서명 identity, 기존 DO 저장소 및 native AES-GCM을 점검한다.
8. 성공 후에만 로컬 bundle/계획을 갱신하고 작업용 MY INVEST 세션을 로그아웃한다.

설정 Properties 3건과 Worker 설정을 변경하는 작업이다. 계좌 저장은 하지 않는다.
Google Calendar API·NH·주문 호출은 0건이며, Google refresh/access token은 아직 생성하지 않는다.
실제 사용자 Google 동의는 개발 웹의 연결 버튼에서 별도로 진행한다.

## 실패 및 복구

단계별 실패에서는 원래 Worker를 먼저, GAS를 다음으로 복구한다.
다른 작업자가 변경한 HEAD/활성 버전이 발견되면 강제 복구하지 않고
`OWNER_REVIEW_REQUIRED_NO_BLIND_ROLLBACK`으로 남긴다.
설정 후 생성된 identity 키는 복구 시에도 비공개 checkpoint에 보존하며 자동 삭제하지 않는다.
부분 적용 이후 같은 도구를 무작정 재실행하지 않는다. 최종 비민감 JSON만 반환한다.
`private-checkpoint.json`, 원본 Worker/바인딩/키 파일을 채팅·Git에 올리지 않는다.
쓰기 전 PREPARED 단계에서 실패한 동일 계획만 검증 후 별도 백업 이름으로 보존하고 재준비한다.

## 검증 구분

- 합성: owner 권한·다른 사용자 차단·초기화 재시도·키 충돌·브라우저 콜백·
  사용자 ciphertext 바꿔치기·활성화 실패·동시 변경·원상복구 테스트.
- 로컬 컴파일: esbuild 0.25.12, native node:crypto/node:buffer import,
  기존 module/export/feature-OFF 동작 유지. CI에서 자격증명 없이 실행한다.
- 실제 owner 적용, 실제 Google 동의·목록·일정 조회: **NOT_RUN**.
  owner 적용 PASS도 `liveGoogleConsent: NOT_RUN`을 유지한다.
- 운영 main/release/pages/GAS/Sheets/Properties 및 실제 NH/주문: 변경·호출하지 않는다.

다음 담당은 Codex다. owner 적용 결과 확인 후 Google 실제 동의/선택/조회/해제와
사용자 격리를 검증한다. 공식 BLS 수집 실패 및 기존 공용 수동 메모의 사용자 격리는
별도 미완료 사항으로 유지한다. 현재 결과를 운영 배포 완료로 표시하지 않는다.

## 이번 로컬 실행 증거

- `for file in tests/*.test.cjs tests/*.test.js; do node "$file" || exit 1; done`: 90개 파일 PASS.
- JS/GAS 전체 구문 검사 및 새 Python 도구 컴파일 PASS.
- `python3 -m unittest discover -s tests -p 'test_*.py'`: 369건 PASS.
- `node tests/calendar-worker-build.cjs /workspace/security-tools/node_modules/esbuild`: PASS.
- `tests/browser_calendar_oauth_bootstrap.py`: 1440/690/344px 합성 인증 PASS.
- `tests/browser_calendar_final.py`: 1440/690/344px 공식 캡처 재생·캐시·페이지 이동·비공개 일정 제외·로그아웃 PASS, 콘솔 오류 0.
- 위 결과는 실제 owner 활성화/Google 계정 동의·실기기 결과가 아니다.

## owner 실행의 불명확한 준비 오류 보완

사용자 실행은 `BUILDING_CURRENT_WORKER_OVERLAY` 뒤 `OWNER_CALENDAR_STEP_FAILED`로
중단됐다. 기존 출력으로는 npm/Node 오류와 그 뒤 직접 GAS 조회·clasp 원본 검증
오류를 구분할 수 없었다. 서버 업로드 이전 구간이므로 이 실행에서 배포는 수행되지 않았다.
동일한 Python 설치→컴파일→import 경로는 공개 fixture로 실제 로컬 실행해 PASS했다.
사용자 환경의 실패 원인은 아직 확정하지 않았다.

도구는 npm의 fetch 대기/재시도를 제한하고 각 단계의 시간 초과·실행파일 누락·
권한·DNS·디스크 오류를 고정 코드로 분류한다. 컴파일 후 직접 GAS metadata,
owner clasp source, 대시보드 로그인도 별도 진행 단계로 표시한다.
실패 JSON의 `requestStage`, 안전한 `code`, 확인 가능한 `http`만으로 다음 원인을
식별하며, stderr/원문 응답/비공개 경로/인증정보를 출력하지 않는다.
기존 PREPARED 자료와 키 파일은 삭제하지 않는다. 서버 배포·권한 정책은 변경하지 않았다.
