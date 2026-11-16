# 상시 개발 중계 — 구현 및 소유자 연결 절차

**상태: 코드/합성 검증 완료, 실제 배포 및 GAS 연결 NOT_RUN.**
기존 Cloudflare 계정·Workers Free 플랜·소유자 인증이 확인되지 않았다.
새 계정/유료 플랜/운영 인프라/Google 프로젝트는 생성하지 않았다.
기존 GitHub Pages, 격리 GAS/Sheets/Properties와 사용자 인증을 재사용한다.

## 목표 구조

GitHub Pages → 고정 HTTPS Worker → 기존 격리 GAS.
공개 시세·뉴스는 기존 허용 GET만 Worker에서 읽되 먼저 GAS 세션을 확인한다.
GAS가 계속 로그인·사용자/관리자 권한·세션·계좌 저장 revision/복구의 최종 권한자다.
인증 코드를 새로 작성하거나 NH 인증/조회/AccountStoreV2를 교체하지 않는다.
Worker는 기존 Python relay의 플랫폼 어댑터이며, 정책 상수는 Python에서 생성하고
공개 경로 허용 판단을 두 구현 간 자동 비교한다.

소유자 설정 후에는 페이지에서 중계 주소/개발코드를 입력하지 않는다.
아이디·비밀번호만 입력하며 기존 5분 세션/새로고침/로그아웃 계약을 유지한다.
Worker 배포가 끝나면 Cloud Shell 터미널을 계속 열어둘 필요가 없다.

## 포함된 코드

- `relay/worker/worker.mjs`: 고정 upstream·격리 지문·GAS 인증·응답 경계·CORS·허용 경로.
- `relay/worker/wrangler.json`: 개발 Worker 및 SQLite Durable Object quota gate만 선언.
- `tools/build_worker_policy.py` / `relay/worker/policy.json`: 기존 relay auth/read/write 상수,
  운영 배포/시트 거부 식별자와 뉴스 쿼리의 호환 정책.
- `tools/nh_v2_persistent.py`: 기존 계정/격리 환경 검증, 비공개 secrets 배포, 중계 중지.
- `tools/build_dev_pages.py`: 검증된 고정 Worker 주소만 CSP에 추가해 공개 설정을 빌드.
- `js/dev_connect.js`: 고정 서버 자동 확인. 설정이 없으면 기존 임시 중계를 보존한다.
- `js/transport.js`: 고정 대상 변경 거부, 토큰은 Bearer만, 저장 응답 불명확 시 결과 미확정.

## 보안/조회 범위

- HTTPS·고정 Workers hostname·정확한 개발 Pages Origin. Origin은 인증을 대신하지 않는다.
  같은 github.io Origin의 프로젝트 경로는 클라이언트 의도 표시에 불과하다.
- `appVersion` 지문 확인 전 비밀번호 전달 없음. 30초 지문 캐시만 사용하며
  비밀번호·계좌 데이터·로그인/세션 결과를 캐시하지 않는다.
- 로그인/세션/로그아웃, NH 국내·해외 잔고, 외부계좌 읽기·시세·목록과
  검토/CAS가 있는 저장·복구만 기존 GAS 계약으로 전달한다.
- 시장지수·차트·환율·금리·뉴스·테마는 기존 `market_routes.py` 허용 경로만 사용한다.
  공급자 관측시각/출처와 지연 한계는 기존 화면이 표시하며 실시간이라고 꾸미지 않는다.
- 주문, 운영 GAS, 관리자 작업·회원가입·Drive·스냅샷 등 새 권한은 열지 않는다.
- 세션/비밀번호를 URL·로그에 출력하지 않는다. Google Content signed redirect는
  서버 내부에서만 원본 query를 유지해 GET으로 받고 POST body/인증 header를 재전송하지 않는다.
- 본문64KiB, 응답2MiB, 동시 요청4개, 전체240/분, IP별120/분,
  로그인 전체30/분 및 IP별6/분. 원본 IP 대신 해시와 카운터/짧은 lease만 DO에 저장한다.
  Gate 장애/미설정 시 닫힌다. 원문 계좌/토큰은 DO에 넣지 않는다.
- 기존 중계에서 고정 주소로 바뀔 때 이전 개발 세션을 정리해 토큰을 자동 재전송하지 않는다.
- Cloudflare observability는 꺼두고 앱의 body/token/금융정보 로그는 없다.

## 무료 범위와 승인 조건

Cloudflare 공식 문서에서 Workers Free의 일100,000 요청 및 CPU10ms/호출,
Durable Objects Free 한도 초과 시 작업 실패(자동 유료 전환 아님)를 확인했다.

- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/durable-objects/platform/pricing/

이 사실은 사용자의 실제 계정 플랜을 확인했다는 뜻이 아니다. 기존 계정이
Workers Free인지 소유자가 확인해야 하며 배포 CLI는 `--free-plan-confirmed`가
없으면 동작하지 않는다. 유료 플랜 활성화/계정 생성/결제 설정 API는 호출하지 않는다.
실제 계정이 없거나 비용/권한 조건을 확인할 수 없으면 배포를 중단한다.

## 소유자 Cloud Shell에서 1회 배포

기존 Cloudflare 계정의 계정 ID, 이미 설정된 workers.dev 서브도메인, 해당 계정의
Worker 배포 권한이 있는 기존 API token이 필요하다. API token은 터미널의 숨김
입력으로 받으며 채팅/명령 인자/공개 저장소에 넣지 않는다. 설정은 기존 Google
비공개 `fresh-plan.json`에서 읽고 기존 격리 source/deployment/settings를 확인한다.
아래는 **기존 계정과 Free 플랜이 확인된 뒤에만** 실행한다.

```bash
cd "$HOME/myinvest-v2-live" &&
git fetch origin feat/nh-integration-v2 &&
git merge --ff-only FETCH_HEAD &&
"$HOME/myinvest-v2-live-venv/bin/python" tools/nh_v2_persistent.py \
  --environment "$HOME/myinvest-v2-fresh-private-r2" \
  --account-id "기존_CLOUDFLARE_계정_ID_32자리" \
  --free-plan-confirmed
```

`MYINVEST_GAS_URL`/격리 지문 등 secrets는 wrangler stdin으로만 보낸다.
이름이 같은 다른 Worker는 역할 표식이 다르면 덮어쓰지 않는다. 새 Worker는
처음에는 닫힌 상태이고 secrets 설정 후 메타데이터를 검증한다. GAS/Sheets/
Properties/Calendar에는 쓰지 않으며 실제 NH 조회도 배포 과정에서 실행하지 않는다.
Google 설정이 기존 검증과 다르면 기존 격리 업데이트 절차부터 확인한다.

실제 플랫폼 배포는 아직 실행하지 않았다. Wrangler/Cloudflare API 호환, 계정
권한, 현지 공급자 응답은 실제 계정에서 검증이 필요하며 합성 테스트와 구분한다.

## 검증 후 Pages 활성화

CLI의 `PERSISTENT_RELAY_READY` 결과에서 **공개 endpoint만** Codex에 전달한다.
토큰·비밀번호·private plan은 전달하지 않는다. Codex가 해당 endpoint의 격리
metadata를 재확인한 뒤 다음 공개 파일을 기존 소스 브랜치에 저장/게시한다.

```json
{"profile":"isolated-persistent","endpoint":"https://검증된-Worker.기존-서브도메인.workers.dev/api"}
```

파일 위치: `config/development-relay.json`. 실제 고정 주소가 없는 현재는 이 파일을
생성하거나 임의 주소를 게시하지 않는다. 따라서 현재 개발 페이지를 셸 불필요
상태로 전환했다고 보고하지 않는다. 지원 코드 게시 후에도 임시 중계는 유지된다.

활성화 후 Codex: 실제 로그인/미인증 거부/국내·해외 조회/외부 시세/페이지 갱신/
세션 복원/로그아웃을 한 번 확인한다. 소유자 인증이 필요한 항목은 사용자가
개발 페이지에서 수행하고 결과를 공유한다. 기존 private NH 단독 검증을 반복하지 않는다.

## 중지

같은 소유자 CLI에 `--disable`을 추가하면 `MYINVEST_ENABLED=false`만 설정한다.
중지에는 Google 인증/계좌 조회가 필요 없다. 새 요청은 닫히며 이미 시작된 요청은
완료될 수 있다. 세션 폐기는 기존 GAS 로그아웃을 사용한다.

## 검증 증거

- Worker security Node 14 PASS, 기존 transport 확장19 PASS.
- 전체 Node305 PASS 후 추가 transport edge2 PASS(총307).
- Python275 PASS(기존269 + 정책 비교3 + 소유자 배포 계획3).
- 상시 연결 브라우저: 1440/690/344 모두 PASS. 주소/코드 입력 없음, 로그인,
  국내·해외 합성 잔고, 공개 시세, 새로고침 세션 유지, 이전 토큰 미재전송,
  운영 localStorage 불변, 로그아웃 확인.
- 관련 기존 브라우저5개(HTTPS, 연결 오류, 공개시장, 계좌 capability, shell) PASS.
- 실제 Cloudflare 배포·실제 GAS/시세·실계좌 조회: NOT_RUN.
- 운영 변경0, 실제 NH/주문0, 실제 저장0, 새 계정/유료 결제0.

다음 담당: **사용자 — 기존 Cloudflare 계정 유무 확인 및 소유자 환경 인증**.
계정/권한이 확보되면 **Codex — 실제 배포 연결·Pages 활성화·GAS 통합 검증**.
