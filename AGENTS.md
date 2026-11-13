# Development rules

- Work on a feature branch and submit a PR. Do not merge main or deploy production GAS without explicit user approval.
- All NH functionality is inquiry-only. Never add order routes or order permissions.
- Never commit credentials, OAuth tokens, account numbers, screenshots of real accounts, or real holdings fixtures. Use synthetic fixtures only.
- Preserve NH domestic/overseas balance behavior. Keep frontend and GAS diagnostics distinct; unavailable quotes are null, not zero.
- Stock identity must be verified against a provenance-bearing listing master. Never guess OCR corrections or stock codes.
- Do not silently replace saved holdings. Require review, concurrency checks, deduplication, and recovery.
- Run Node tests, Python tests, and browser regression checks appropriate to changes. Report mock tests separately from live API verification.
- Do not fetch production private GAS source for this PR task. Do not run any production deployment workflow or modify repository protection settings.
- Keep deployment workflows manually triggered. CI must run on PRs without Google/NH secrets.
- Reuse the existing isolated GAS, Sheet, Properties and credentials. Do not recreate projects or reset existing data for validation.
- Choose local tests by changed scope and risk. Security/auth/permission/common-transport changes require related security regressions; do not repeat full suites, backups, browser checks or failed live probes for every edit. Use existing evidence; full validation is required before production deployment.
- Continue on the existing feature branch/PR. Development HTTPS must remain test-only and free; new billing or external accounts require explicit approval. Never treat simulated HTTPS as a live Pages/GAS PASS.
