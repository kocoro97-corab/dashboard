# GitHub + 무료 상시 중계 시작하기

선택한 구조는 **GitHub Pages 화면 + Cloudflare Workers Free 중계 + 기존 격리 GAS**다.
GAS 화면 제공 방식으로 전환하지 않는다. 코드·보안·PC/Fold6 합성 검증은 준비됐다.
실제 상시 서버는 아직 없으며 계정 가입/인증/배포 후 활성화한다.

## 1. 사용자: 무료 계정 가입

1. https://dash.cloudflare.com/sign-up 에서 본인의 계정으로 가입하고 이메일을 인증한다.
2. Workers & Pages에서 **Workers Free**를 사용한다. 유료 플랜·결제를 신청하지 않는다.
3. workers.dev 최초 설정이 나오면 서브도메인을 정한다. 별도 도메인을 구매할 필요는 없다.

Workers & Pages 설정 후 ‘Cloudflare 무료 가입 완료’라고 알려주면 다음 연결 단계를
진행한다. 계정 비밀번호, API token, Google 비공개 설정은 채팅에 보내지 않는다.
이 단계에서 운영 GitHub/GAS/Sheets/Calendar는 변경하지 않는다.

## 2. 사용자 + Codex: 최초 한 번 연결

소유자 Cloud Shell의 기존 격리 GAS 환경을 그대로 사용한다.
Cloudflare API token은 소유자 터미널의 숨김 입력으로만 받으며,
Account ID는 명령어에 붙이지 않아도 실행 시 입력할 수 있다.
기존 계정에서 사용할 Worker 배포 권한 범위만 지정한다.

```bash
cd "$HOME/myinvest-v2-live" &&
git fetch origin feat/nh-integration-v2 &&
git merge --ff-only FETCH_HEAD &&
"$HOME/myinvest-v2-live-venv/bin/python" tools/nh_v2_persistent.py \
  --environment "$HOME/myinvest-v2-fresh-private-r2" \
  --free-plan-confirmed
```

CLI는 계정 ID를 확인하고 API token을 숨김 입력으로 받은 뒤 기존 격리 GAS의
지문·실행 주체·접근 권한을 재확인한다. 새 Google 프로젝트나 실제 주문은 만들지 않는다.
Cloudflare에 무료 개발 Worker를 배포하고 공개 endpoint만 결과로 출력한다.
GitHub Actions의 운영 GAS 배포 버튼은 이 절차에 사용하지 않는다.

### Cloudflare 접근 오류가 나온 경우

`EXISTING_CLOUDFLARE_ACCESS_REQUIRED`만으로 토큰 오류와 계정 권한 부족을
구분하지 않는다. 최신 소스에서 아래 읽기 전용 진단을 실행한다.
이전 환경변수의 토큰 대신 숨김 입력으로 새 토큰 값을 받는다.

```bash
"$HOME/myinvest-v2-live-venv/bin/python" tools/nh_v2_persistent.py \
  --environment "$HOME/myinvest-v2-fresh-private-r2" \
  --diagnose-cloudflare --prompt-token
```

결과에는 단계·HTTP 상태·Cloudflare 숫자 오류 번호만 포함한다. 응답 원문,
토큰, 계정 ID는 출력하지 않는다. 이 진단은 배포·GAS·NH 호출 없이 계정의
workers.dev 설정 및 기존 Worker 설정만 읽는다. PASS도 배포 권한이나 실제
로그인 성공을 의미하지 않는다. 실패 JSON을 바탕으로 필요한 설정만 수정한다.

## 3. Codex: 개발 페이지 활성화 및 실제 검증

검증된 고정 endpoint를 `config/development-relay.json`에 반영해 기존 dev-pages로
게시한다. 페이지에 주소/개발코드 입력창 없이 아이디·비밀번호로 접속하도록 전환한다.
실제 로그인·국내/해외 조회·외부 시세·뉴스·세션 복원·로그아웃을 확인한다.
실제 인증 전까지 해당 항목은 NOT_RUN이며 합성 PASS로 대체하지 않는다.

상시 연결 완료 후에는 **Cloud Shell을 닫아도 된다**. 기존 임시 터널에는 이 설명이
적용되지 않는다. 실제 활성화 전까지 현재 개발 페이지는 기존 임시 중계를 유지한다.

## 4. 사용량을 보고 나중에 재판단

Cloudflare 대시보드에서 요청 수·CPU·Durable Objects 사용량·오류를 확인한다.
공식 Free 플랜 한도를 넘으면 요청이 제한될 수 있다. 사용량이 늘어도 코드가 유료
플랜으로 자동 전환하지 않는다. 요금제 변경은 실제 사용량을 확인한 뒤 별도로 결정한다.
원문 금융정보·인증정보를 사용량 로그로 남기지 않는다.

보안 경계, 무료 한도 근거, 중지 방법: [상세 배포 절차](persistent-relay.md).

**다음 담당: 사용자 — Cloudflare 무료 가입/본인 인증. 이후 Codex가 연결·검증한다.**
