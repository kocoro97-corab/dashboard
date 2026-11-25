# MY INVEST V2 — 웹 성능 개선 개발 게시 인계 (2026-11-25)

## 1. 게시 대상과 격리 정책

- **소스:** `kocoro97-corab/dashboard` / `feat/nh-integration-v2` (개발 브랜치만)
- **개발 프런트엔드:** `kocoro97-corab/dashboard-v2-dev` / `dev-pages`
- **개발 주소:** https://kocoro97-corab.github.io/dashboard-v2-dev/
- **운영 변경 금지:** `main`, `release/pages`, 운영 GAS v26, Sheets, Properties, NH 실계좌 및 주문 권한
- 개발 게시만으로 실제 NH/시장/GAS 연결이 검증되는 것은 아니다. 개발 중계의 정책·가용성은 별도로 확인한다.
- 이 파일은 배포 인계 문서이며 **게시 명령은 자동으로 실행하지 않는다.**

## 2. 검증된 기준과 배포 전 확인

2026-11-25 확인 기준: 개발 Pages `dev-pages` HEAD `722d0e23c2f4cffad4aa53ef4a7771b164c9d713`, 게시 소스 `development-only.json.sourceCommit=869f8f2c0da0fe8393bccde3e04e6b235c104d52`. 기존 백업 `backup/pre-web-performance-20261124` 확인. 이 기준은 다른 사용자나 Codex가 게시하면 **즉시 오래된 정보가 되므로 반드시 재확인**한다.

- 소스의 최신 GitHub Actions `push` 및 PR 회귀 검사 **모두 SUCCESS**여야 한다.
- 개발 Pages의 기존 `development-only.json`은 `myinvestDevelopmentOnly=true`, `sourceBranch=feat/nh-integration-v2`이어야 한다.
- `dev-pages` HEAD를 재확인하고, **명시한 SHA와 다르면 게시 중지**한다.
- 개발 Pages가 fixed `dev-pages:/`, legacy Pages, HTTPS 강제, 사용자 지정 CNAME 없음이어야 한다.
- 깨끗한 개발 소스 체크아웃과 기존 소유자 GitHub CLI 인증을 사용한다. 계정키·인증코드는 입력창에서만 취급하고, 채팅/CI/GitHub 파일에 기록하지 않는다.

## 3. 소유자 Cloud Shell에서만 실행하는 게시 명령

현재 연결된 GitHub 파일 편집 도구는 소유자 `gh` 인증으로 작동하는 배포 도구를 직접 실행하지 못한다. 따라서 소유자가 기존 Cloud Shell의 **깨끗한 소스 체크아웃**에서 아래와 같이 수행한다. `<APPROVED_SHA40>`은 최신 CI가 성공한 **개발 브랜치 전체 SHA**로 대체한다. 기존 개발 `dev-pages` HEAD도 직전에 재확인한다.

```bash
gh auth status
git status --short
git branch --show-current
git rev-parse HEAD
python3 tools/publish_dev_pages.py --publish-dev-pages \
  --expect-source-sha <APPROVED_SHA40> \
  --expect-dev-head <VERIFIED_DEV_PAGES_SHA40>
```

도구는 잘못된 소스 브랜치, 지정 SHA 불일치, 개발 Pages의 HEAD 변경, 비공개 저장소/다른 계정, 게시 마커 불일치, Pages 설정 충돌 또는 git push 실패 시 중단한다. 운영 저장소는 이 도구의 게시 대상이 아니다. `PASS`가 아닌 `DEV_PAGES_BUILD_PENDING`은 게시 성공으로 간주하지 않는다.

## 4. 게시 후 기능 및 기기 실측

1. 게시된 `development-only.json.sourceCommit`이 승인된 소스 SHA와 정확히 같은지 확인한다. 캐시를 무효화한 강제 새로고침에서 개발 메뉴가 보이는지 확인한다.
2. PC Chrome에서 로그인 후 `검증·진단 → 현재 PC·휴대폰 브라우저 속도 측정`을 펼쳐 **DOM 준비, load 이벤트, FCP, JavaScript/OCR/종목 디렉터리 요청 횟수, 메뉴별 처리시간**을 기록한다.
3. Galaxy Fold6의 펼친 화면과 접힌 화면에서 같은 메뉴의 측정값을 각각 확인한다. 네트워크 종류(Wi-Fi/5G), 캐시 상태(첫 접속/재접속), 측정 횟수와 시간을 함께 기록한다. 계좌 금액·토큰·실제 요청 URL·콘솔 원문은 기록하지 않는다.
4. 홈 → 글로벌 시장 → 산업·테마 → 뉴스 → 계좌 → 홈을 이동하고, 새로고침·로그아웃·다시 로그인 상태를 확인한다.
5. OCR은 실제 이미지 업로드 **시도 이후에만** OCR 다운로드가 발생해야 한다. 실계좌 이미지나 그 인식 원문은 CI/공개 저장소에 업로드하지 않는다.
6. 개발 환경의 NH/저장 쓰기/주문 기능은 현재 미허용 상태를 보존한다. 테스트 GAS 또는 기존 접근정책을 변경하지 않는다.
7. GitHub CI에서 관측한 합성 344/690/1440 px 수치는 실제 폴드6 실측으로 대체할 수 없다. 개선 전후 %는 같은 기기·브라우저·네트워크·캐시 조건의 측정값이 있어야만 계산한다.

## 5. 장애·보류 조건

게시 실패, 소스 식별자 불일치, 스크립트 오류, 로그인/새로고침 회귀, 자동 또는 비인가 NH 호출, 저장자료 변조, 개발 사이트 CSP/중계 불일치가 관찰되면 운영 배포는 계속 보류한다. 개발 Pages에는 기존 게시 HEAD와 백업이 있으며 복구 전 원인과 최신 타인의 변경 유무를 확인한다. `main`/운영 Pages/GAS를 되돌리는 방법으로 개발 오류를 복구하지 않는다.
