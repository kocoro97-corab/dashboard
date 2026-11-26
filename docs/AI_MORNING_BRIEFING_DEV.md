# MY INVEST V2 — AI 아침 뉴스·투자전략 자동 게시 (개발환경 전용)

## 요구와 동작의 정확한 구분

- 사용자 입력 보고서가 아닌 **AI 모델이 새로 생성한** 공개 시장 브리핑을 화면에서 자동 조회한다.
- 기존 ChatGPT 07:00 예약 작업의 결과를 가져오는 기능은 아니다. 해당 작업은 외부 GitHub Pages/GAS로 자동 전송되는 경로가 **연결되지 않았다**.
- 이 백엔드는 **별도 OpenAI Responses API** 호출+웹 검색으로 작성한 공개 시장 브리핑을 독립적으로 생성한다. 호출 시 모델+웹 검색 요금이 발생할 수 있고 ChatGPT 구독과 별도로 관리한다.
- 사용자 계좌/보유잔고/회원정보/인증키 등은 AI 입력에도 공개 브리핑 JSON에도 넣지 않는다.
- 실 NH/실 GAS/운영 main/release/pages/개발 계좌 데이터는 변경하지 않는다.

## 처리 구조

1. **서버 측에만 보관**한 `OPENAI_API_KEY` GitHub Actions Secret으로 작업 실행.
2. AI 모델 `gpt-5.4-mini`의 Responses API + `web_search`에서 공개 시장 검색 후 JSON 구성.
3. 원천 웹 검색에 실제 등장한 HTTPS URL만 인용 허용. 6~9개 섹션; 출처 부족·API 실패·인증 실패·개인정보·Schema 오류 시 **게시 중단**.
4. 기존 공개보고서 포맷/필드 검사 재사용; 최초 자동 보고서 생성 시 해당 한국 날짜 `openai-api` origin으로 저장. 같은 날짜 중복 호출 금지.
5. 개발 전용 `dashboard-v2-dev`의 `dev-pages/data/myinvest-public-briefings-v1.json` **한 파일만** 원자적으로 생성·업데이트. 기존 날짜 데이터 보존, Git push 실패 시 강제 덮어쓰기 금지.
6. 대시보드 `뉴스·이벤트 → 오늘의 AI 뉴스·투자전략 보기`에서 날짜별 공개 보고서와 출처를 읽는다. 모바일·PC 동일 공개 JSON.
7. 모델 출처·시세가 완전히 독립 검증된 것은 아니다. `observedAt=null` 유지, 시세 확정/실시간/매매 신호라고 표시하지 않음.

## 현재 단계 — 비활성 사전 개발

- 실행 코드: `scripts/ai_morning_briefing.cjs`; 합성 테스트 `tests/ai-morning-briefing.test.cjs`.
- 배포 템플릿: `tools/workflows/ai-morning-briefing-development.yml`.
- 현재 템플릿 파일은 `.github/workflows` 아래에 **없어 자동 실행되지 않는다**.
- 활성화하려면 소유자가 유료 API 사용, 공개 보고서 게시, 호출 주기 및 예산 한도를 명시적으로 승인해야 한다.
- 승인 후에만 **별도 개발 저장소의 DEFAULT 브랜치** `.github/workflows`에 템플릿을 복사하고, `PIN_APPROVED_SOURCE_COMMIT_HERE`를 전체 CI가 성공한 소스 SHA로 교체한다.
- 소유자가 개발 저장소에 `OPENAI_API_KEY` Secret과 `MYINVEST_AI_BRIEFING_ENABLED=true` Actions Variable을 설정해야 한다. 키 값은 브라우저·ChatGPT 대화·GitHub 코드·공개 JSON에 입력하지 않는다.
- GitHub Actions 스케줄 `22:08 UTC = 다음날 07:08 KST`를 사용한다. GitHub 일정 작업은 지연될 수 있으며 정각 실행을 보증하지 않는다.
- 요금 및 호출 빈도는 소유자가 OpenAI 플랫폼의 별도 API 예산/사용량 제한으로 통제한다. 이 코드에는 월별 상한 초과를 자동 조회하는 기능이 없다.
- 초기 설정 이전에는 **오늘 AI 브리핑 미게시** 표시가 정상이며 가짜 AI 출력/샘플 시세를 공개하지 않는다.

## 시험 및 게시 수락 조건

- Node 및 브라우저 합성 검증 전체 통과. 테스트에서는 실제 API 호출 0, 실제 NH 0, 실계좌/주문 0.
- 실제 API 키·사용량 예산·개발 워크플로 활성화 승인 이후 1회 수동 실행 → 보고서 내용, 출처·시각·공개 데이터 안전성 검사 후 정기 실행 전환.
- 기존 ChatGPT 예약 브리핑과 **동일한 보고서 본문**이 반드시 필요하다면, 별도의 공식·승인된 결과 전달 경로를 설계해야 하며 현 자동 AI 생성기와 혼동하지 않는다.
