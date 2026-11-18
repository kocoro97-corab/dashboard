# Existing-owner KOSDAQ150 read verification

The probe reuses the existing private `fresh-plan.json` and its isolated GAS deployment. It verifies script/sheet/source fingerprints before asking for credentials. It calls only `appVersion`, `login`, exactly one `nhQuotes` A06 inquiry, and `logout`. It never queries accounts, deploys, writes holdings, changes credentials or creates a project.

Run in the existing owner Cloud Shell, from the existing development checkout:

```sh
git fetch origin feat/nh-integration-v2 &&
git merge --ff-only FETCH_HEAD &&
python3 tools/nh_v2_futures_probe.py --environment "$HOME/myinvest-v2-fresh-private-r2"
```

Enter the existing test user and password at the hidden local prompts. Share only the resulting safe JSON. Do not share `fresh-plan.json`, deployment URLs, passwords, API keys or tokens. `PARTIAL` means a dated public futures quote was verified but provider market-state/delay information remains unverified. A price without a verified observation date never passes.

The existing isolated deployment may still have the old futures module. The probe does not upgrade it or change the working persistent relay. If contract/time verification fails, first use the existing code-only isolated upgrade procedure after comparing the relevant source changes. Do not run project creation or initialization tools. Do not upgrade production. The existing persistent relay's fixed A01/A06 read capability must be explicitly enabled by the existing owner procedure; no browser toggle bypasses it.

Official N2 PLUG quote/day exposes `bsop_hour` without a trade date. The updated A06 module checks the same contract's last dated trade using the official read-only quote/dayPeriod endpoint (tick period, one row). Contract, price and calendar timestamp must agree; missing/future/old observations are rejected. The query date and receipt date are never used as a substitute trade date. This is tested source code until the owner deployment and actual response are verified.

After a failed quote, compare deployed and checked-out source without another inquiry:

```sh
python3 tools/nh_v2_futures_probe.py --environment "$HOME/myinvest-v2-fresh-private-r2" --describe
```

This reads the existing private plan locally and emits only public source revisions, the source-match boolean and zero-operation counters. `gasSourceMatches: false` means the checked-out futures source has not yet been applied to that isolated deployment; it is not a diagnosis of the operating relay.

## Coordinated existing-GAS / existing-Worker activation

The currently working Worker checks the GAS source fingerprint. Do not upgrade GAS alone. `nh_v2_futures_activate.py` defaults to a **local plan**, comparing the owner's deployed revision with the proposed bundle. It refuses unrelated GAS changes and any manifest/auth-scope change. Only `Nhplug`, `NhGatewayV2` and generated `StagingBridge` metadata may differ.

```sh
python3 tools/nh_v2_futures_activate.py --environment "$HOME/myinvest-v2-fresh-private-r2"
```

After reviewing that plan, the already-authorized development activation uses the same tool with `--apply --free-plan-confirmed`. It reads the existing Worker account ID from its private wrangler configuration and prompts for the existing API token locally if needed. It verifies the existing Worker role, old GAS/Worker isolation and a Worker dry build **before** any GAS change. It then reuses the existing code-only isolated upgrade and persistent relay procedures; enables only fixed futures reads and the verified public industry routes. No projects, authentication settings, OAuth scopes, account queries, holdings writes or NH calls are created/run.

If activation/readback fails after the GAS upgrade, it checks for concurrent changes, restores the previous immutable isolated GAS version/source/private plan, restores the old Worker fingerprint settings and verifies metadata. A failed recovery reports `OWNER_REVIEW_REQUIRED`; it never claims the connection recovered without readback. The actual owner runtime remains NOT_RUN until executed there; mock tests prove orchestration only. The old/new handover is a development change and may briefly require a page retry; it is not a production or zero-downtime deployment mechanism.
