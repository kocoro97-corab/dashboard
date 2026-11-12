# MY INVEST 운영 배포 실행 계획 — 승인 대기

2026-11-12 UTC. 이 문서는 준비/검토 결과다. 아래 단계는 아직 실행하지 않았다.
main 병합, 운영 GAS 배포, 운영 Sheets 변경/계좌 초기화, Pages 설정/게시 브랜치 변경을 수행하지 않았다.

## 1. 확인된 기준과 확인할 수 없는 항목

| 대상 | 확인된 사실 |
| --- | --- |
| PR #2 | head `73b2a3a0d6b39c15557cab9c21d69fa1200d99db`, main 대상, PR/push CI success, mergeable=true |
| PR #3 | 검토 시작 head `135c13ae4916b896f0eb1d65b2e2c5912dee79ea`, PR #2 대상, PR/push CI success, mergeable=true |
| 의존성 | PR #3은 PR #2보다 4 commits ahead / 0 behind, GAS 중복 변경 없음 |
| 실제 검증 | 소유자 PRIVATE_LOCAL 실행 24개 PASS. 실제 7종목 저장/시세/평가/수정/복원 및 일반계좌 코드·수량·통화 전후 일치 |
| 자동 검증 | 기존 통합 Node 68 + Python 30 =98개 및 mock PC/모바일 6흐름 통과. 이번 백업 도구 Python 4개 추가 후 102개 확인 |
| 현재 Pages | `legacy`, `main:/`, `built`. 마지막 게시 SHA `bcd6fc7bafc9b37c7c9147ebb5ea1ffc9e492b1b` = 현재 main |
| 운영 공개 메타데이터 | appVersion `v10-security`, securityVersion=1, 조회 전용/기존 기능 확인. 인증정보/계좌 조회 없이 확인 |
| 운영 불변 배포 버전/현재 private source | 이 환경에 Google 인증정보가 없어 **미확인**. 과거 버전 번호나 로컬 옛 파일을 현재 값으로 사용하지 않음 |
| 실제 운영 백업 | **미실행/미확인**. 소유자 체크리스트가 모두 완료되기 전 운영 실행 금지 |

공개 appVersion에 storeVersion이 없다는 사실만으로 저장 v1/v2를 판정할 수 없다.
승인된 배포 후 인증된 소유자 externalHoldings 응답에서 storeVersion=2/revision을 추가 확인한다.
이번 준비 변경은 백업 도구/테스트/문서뿐이며 application/GAS/NH 일반계좌 코드에는 추가 변경이 없다.

## 2. 소유자용 GAS 현재 소스/버전 확인 및 비공개 백업

[운영 GAS 편집기](https://script.google.com/home/projects/1WwqTZuH36L3sYdwmz8POXLmW-1Xw4oC4AGkFPSeueaEVBMB31ua_CkYL/edit)에서
배포 → 배포 관리의 운영 /exec 배포를 확인한다. 현재 불변 버전 번호를 비공개 운영 기록에 적는다.
삭제/새 배포/업데이트 버튼은 누르지 않는다. HEAD의 미게시 편집도 확인한다.

권한: 운영 프로젝트를 읽을 수 있는 소유자의 기존 clasp 인증이 필요하다.
[Cloud Shell](https://shell.cloud.google.com)에서 승인 검토용 PR #3의 최신 검증 SHA를 checkout한 뒤 실행한다.
이 도구 실행은 Google에 list-deployments/pull 읽기만 사용하고, 배포·원격 소스·Sheets는 수정하지 않는다.
실제 private source를 Codex로 보내지 않고 소유자 Cloud Shell에만 보관한다.

```bash
GAS_BACKUP_DIR="$HOME/myinvest-backup-$(date -u +%Y%m%dT%H%M%SZ)"
python3 tools/prepare_gas_backup.py --output "$GAS_BACKUP_DIR"
```

출력의 의미:

- status=GAS_SOURCE_BACKUP_CREATED, headMatchesDeployed=true, archiveIntegrity=PASS이어야 소스 백업 확인 통과.
- activeVersion은 배포 API에서 읽은 현재 번호다. UI의 운영 deployment 버전 번호와 일치해야 한다.
- STOP_REVIEW_UNPUBLISHED_GAS: 사본은 만들었지만 HEAD와 활성 배포 소스가 다름. **배포 중단** 후 소유자 검토. 자동으로 미게시 코드를 덮어쓰지 않는다.
- FAILED: 소스 백업 미확인. CLASP_READ_FAILED이면 기존 Google 인증/프로젝트 읽기 권한을 소유자가 확인한다.
  인증 URL·토큰·비밀번호를 채팅에 보내지 않는다. 새 권한 확대나 운영 설정 변경을 자동 수행하지 않는다.
- sourceBackupCreated=true여도 sheetsBackupVerified/propertiesBackupVerified는 false다. 전체 운영 백업 완료라는 뜻이 아니다.

백업 폴더는 700, 파일/ZIP은 600 권한이며 Git 저장소 안의 출력 경로는 거부한다.
head/와 deployed/ 소스, inventory.json의 파일별 SHA256, source-backup.zip이 생성된다.
Google 인증파일(.clasprc.json)은 복사하지 않는다. CLI 출력/원문 소스/에러 본문은 로그에 남기지 않는다.

Cloud Shell의 파일 다운로드로 source-backup.zip과 inventory.json을 본인 보안 저장소에 내려받고,
ZIP 열기/무결성과 복구에 필요한 파일이 있는지 확인한다. Cloud Shell 사본 하나만 유일한 백업으로 삼지 않는다.
ZIP/소스에는 private 설정·금융정보가 포함될 수 있으므로 GitHub·Actions artifact·공개 링크·채팅에 올리지 않는다.

## 3. Google Sheets 및 설정 백업

운영 GAS가 실제 사용하는 원본 Spreadsheet를 소유자가 확인한다. `NH-STAGING ...` 테스트 파일과 혼동하지 않는다.
모든 사용자의 저장/편집을 멈춘 유지보수 구간에 파일 → 사본 만들기로 전체 파일을 복제한다.
원본 ID는 바꾸지 않고, 사본 이름에 UTC 시각을 넣는다. 기존 공유자에게 공유하는 옵션은 끄고 소유자만 접근시킨다.

사본에서 Users, ExternalHoldings, ExternalHoldingHistory(있다면), 기타 운영 탭이 모두 복제됐는지 확인한다.
사용자별 행 수와 이름·코드·수량·매입가를 사본과 원본에서 소유자만 비교하고, 공개 보고에는 일치 여부만 남긴다.
History가 아직 없으면 '없음'으로 기록하며 백업을 이유로 새 탭이나 새 계좌를 원본에 만들지 않는다.

Script Properties, 트리거, 실행 사용자, 웹 앱 접근 권한은 코드 버전/Sheet 사본과 별개다.
필요한 설정은 소유자 보안 저장소에서 복구할 수 있는지 확인한다. 키·비밀번호·세션을 평문 문서/로그에 덤프하지 않는다.
기존 키/세션/Users는 백업 때문에 삭제·재발급·초기화하지 않는다.

### 소유자 완료 체크리스트 (현재 모두 확인 대기)

- [ ] 운영 GAS project/deployment/URL과 현재 불변 versionNumber 확인
- [ ] HEAD/활성 버전 소스 사본 생성 및 일치 확인, 미게시 변경 없음
- [ ] ZIP 무결성 PASS, 본인 보안 저장소로 다운로드 및 열기 확인
- [ ] 실제 운영 Spreadsheet ID 확인, 유지보수 시각 기록
- [ ] 전체 Sheet 사본 생성, 관련 탭/사용자별 행 수/내용 일치 확인
- [ ] 사본 접근권한 소유자 전용 확인, 비공개 위치에 사본 ID 기록
- [ ] Properties/트리거/배포 권한의 안전한 복구 수단 확인
- [ ] 직전 Pages 게시 SHA/기존 GAS 버전과 개별 rollback 대상 기록
- [ ] 백업 이후 정상 데이터 변경이 없거나 변경분을 별도 보존했음

## 4. 권장 게시 게이트: 프런트엔드 기준 브랜치 고정

현재 main 병합은 Pages 게시를 유발한다. 기존 workflow는 GAS를 main에서만 수동 배포하므로,
아무 게이트 없이 main을 먼저 병합하면 'GAS 적용 전 신형 프런트엔드 게시'가 일어날 수 있다.

**권장안(별도 승인 후에만 실행):**

1. 실제 현재 게시 SHA를 재확인하고 같은 SHA를 가리키는 `release/pages` 브랜치를 준비한다.
   기존 브랜치가 있다면 임의로 덮어쓰지 말고 현재 기준과 일치하는지 확인하거나 새 이름을 선택한다.
2. 소유자가 [Pages 설정](https://github.com/kocoro97-corab/dashboard/settings/pages)에서
   Deploy from a branch → release/pages → /(root)로 변경한다. 현재 이 설정은 변경하지 않았다.
3. 동일 소스 재게시 build success, 실제 사이트 URL/로그인/일반계좌 읽기가 기존대로인지 확인한다.
   github-pages 환경의 게시 허용 브랜치 규칙도 소유자가 확인한다.
4. 이 확인을 통과한 뒤에만 main 병합을 허용한다. main 변경은 게시 브랜치가 움직이지 않는 동안 Pages에 반영되지 않는다.
5. GAS v2 적용/검증 뒤 승인된 통합 main SHA로 게시 브랜치를 전진시킨다. 새 Pages build SHA와 UI를 확인한다.

GitHub는 저장소의 별도 브랜치와 루트 폴더를 게시 소스로 선택할 수 있으며 소스 브랜치 push가 게시를 유발한다.
[공식 설정 문서](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).
GitHub Actions의 기본 GITHUB_TOKEN으로 만든 커밋은 Pages build를 유발하지 않을 수 있으므로 build 완료를 확인해야 한다.

게이트 전환 실패/사이트 이상이면 source를 원래 main:/로 되돌리고 main은 병합하지 않는다.
이 게이트 방식에 동의하지 않으면 읽기/저장 제한 호환 구간 또는 별도 수동 Actions 방식의 계획을 먼저 승인받는다.
Pages를 비활성화하거나 계좌 데이터를 지우는 방식은 제안하지 않는다.

## 5. 호환성과 저장 제한

- 신형 frontend + 구형 GAS: revision/storeVersion이 없으면 외부계좌 교체 저장을 차단한다. 조회 실패와 데이터 삭제를 혼동하지 않는다.
- 구형 frontend + 신형 GAS: expectedRevision/confirmReplace 없는 저장은 거절된다. 기존 데이터는 유지하며 새로고침을 안내한다.
- 정상 일반계좌 읽기 경로는 보존되지만 인증 만료/API 장애 가능성은 배포 후 다시 확인한다.
- 서버 차원의 전체 유지보수 잠금은 새로 구현하지 않았다. 저장 중지는 소유자의 유지보수 통제가 필요하다.
  동시 저장/편집 유입을 통제할 수 없으면 백업·배포를 중단하고 별도 승인된 쓰기 차단 방안을 마련한다.
- 구형 탭은 새 GAS에서 저장을 거절할 수 있다. 업데이트 후 재로그인/새로고침하고 오래된 draft를 자동 재전송하지 않는다.

## 6. 승인 후 실행표

| 단계 | 수행 작업 | 예상 영향 | 정상 확인 | 실패 시 중단 조건 | 롤백/복구 |
| --- | --- | --- | --- | --- | --- |
| 1 | 사용자 승인 범위/최종 SHA 고정, PR #3 → PR #2 브랜치 통합, CI 재확인 | 운영 영향 없음 | 통합 tree/CI success, 다른 변경 없음 | 충돌/CI 실패/SHA 변경 | main 미병합 상태 유지, feature branch에서만 수정 |
| 2 | 유지보수 저장 중지 후 최종 GAS/Sheet/설정 백업 | 잠시 저장 자제, 조회 유지 가능 | 위 체크리스트 전부 확인 | 소스 불일치/백업 누락/동시 편집 | 운영 배포하지 않고 중지. 계좌 삭제/초기화 없음 |
| 3 | 현재 게시 SHA로 release/pages 게이트 구성 | 동일 소스 재빌드 가능 | 사이트 정상, source=release/pages, build SHA=기존 게시 SHA | 관리자 권한 없음/다른 소스 게시/빌드 실패 | source=main:/ 원복, main 병합 금지 |
| 4 | 승인된 PR #2 → main 병합, 확정 통합 SHA 재확인 | Pages는 기존 소스 유지 | main tree=승인 tree, CI success, 게시 SHA 그대로 | main에 다른 커밋/Pages 선행 게시 | GAS 실행 금지, 원인 정리. main force push 안 함 |
| 5 | deploy-gas.yml을 승인된 main SHA에서 수동 실행 | 코드/불변 버전 갱신, 구형 탭 저장 거절 가능 | recovery/previous/new version 기록, source/배포/URL 검증 | 미게시 변경/동시 편집/시험·probe 실패 | 도구의 조건부 자동 복구 확인; 필요 시 직전 호환 배포 버전 복구 |
| 6 | 운영 read-only smoke: 로그인, 일반계좌, 기존 외부계좌/revision | 소유자 조회만, 실제 계좌 수정 없음 | storeVersion=2/revision, 기존 코드·수량·원가·사용자 분리 유지 | 인증/계좌/시세/스키마 이상 | 프런트엔드 게시 보류, 필요 시 GAS 직전 버전 복구 |
| 7 | release/pages를 승인된 main SHA로 게시 | 신형 frontend 적용, 캐시된 구형 탭 존재 가능 | Pages build success/정확한 SHA, PC·모바일 정상 | build/JS/로그인/기존 자료 표시 이상 | 게시 브랜치에 직전 tree로 되돌리는 복구 commit, 강제 main reset 없음 |
| 8 | PC/실제 Fold6 검수 후 유지보수 종료 | 정상 조회·저장 재개 | 아래 검수표, 오류/변경 이력 확인 | 미확인 자료 삭제/중복/보안 오류 | 저장 중지 유지, 코드와 데이터 문제를 나눠 복구 |

각 단계는 앞 단계 통과 후에만 진행한다. GAS workflow가 실패했는데 Pages만 진행하지 않는다.
이 계획은 main/GAS/Pages 각각의 명시적 승인 범위를 넘겨 자동 실행하지 않는다.

## 7. 코드 rollback과 데이터 복원 구분

**코드:** 승인된 GAS 직전 호환 불변 버전으로 같은 deployment ID를 재지정하고 URL을 유지한다.
활성 배포 rollback에는 기록된 deployed 버전을 사용하고, 미게시 변경이 있을 수 있는 HEAD 사본을 임의로 배포하지 않는다.
Pages는 게시 브랜치에 직전 검증 tree로 되돌리는 새 commit을 만들고 재게시한다.
브랜치가 갈라졌다면 강제로 덮어쓰지 말고 현재 게시 head를 부모로 하는 검토된 복구 commit을 사용한다.
GAS와 frontend가 다른 버전인 동안 저장은 중지한다. 동시 편집이 있으면 자동 복구를 맹신하지 않고 소유자가 먼저 확인한다.

**데이터:** 코드 rollback은 Sheets/Properties를 되돌리지 않는다.
사용자별 History snapshot을 현재 자료와 비교하고 최신 revision/명시적 확인으로 해당 사용자 자료만 복원한다.
rollback한 구버전에 복구 API가 없으면 억지로 호출하지 않고 소유자가 사본/History를 비공개로 대조해 영향 범위만 복구한다.
복원 전 현행 자료도 보존한다. History가 없으면 전체 비공개 Sheet 사본을 참고해 영향받은 범위만 복원한다.
백업 이후 다른 사용자의 정상 변경을 통째로 과거 사본으로 덮어쓰지 않는다. Users/키/세션 초기화와 전체 Sheet 교체는 별도 승인이 필요하다.

## 8. 배포 후 PC·Fold6 검수표

- [ ] 기존 로그인/로그아웃/세션 만료 및 새로고침 안내
- [ ] 국내/해외 일반계좌 코드·수량·통화·현재가·손익, 일부 장애 시 정상 자료 유지
- [ ] ISA/연금저축/IRP 기존 자료 유지, 사용자 간 분리
- [ ] 실제 두 이미지 7종목 OCR 미리보기·로딩 상태·중복/현금 제외·취소
- [ ] 이름·코드·수량·평단 편집 UI, 저장 전 변경 비교와 명시적 확인
- [ ] 승인된 전용 smoke 자료에서만 저장/재조회/취소/복구. 실제 기존 계좌를 시험용으로 삭제하지 않음
- [ ] 잘림/저화질/실패 시 무인 저장 없음, 현재가 실패는 —/부분 합계
- [ ] PC 가로 화면과 실제 Fold6 접기/펼치기, 키보드/터치/스크롤/파일 선택/OCR 대기 상태
- [ ] 시크릿/새 탭에서 게시 버전과 캐시 갱신 확인, 키·토큰·개인정보 노출 없음

실제 Fold6 기기는 현재 미검증이다. 소유자가 위 표를 확인한 뒤에만 기기 검수 완료로 표시한다.

## 9. 필요한 승인과 현재 결론

**실행 계획 준비 완료 / 즉시 배포 조건은 아직 미충족.** 프로그램/CI/격리 실계좌 검증은 통과했으나 운영 백업은 미확인이다.
소유자의 백업 체크리스트 확인, Pages 게시 게이트 변경 승인, 최종 SHA/PR 병합 승인, 운영 GAS 및 Pages 게시 승인이 필요하다.
승인은 이 네 범위와 유지보수 구간을 명시해야 한다. 이번 작업에서는 어느 것도 실행하지 않았다.
