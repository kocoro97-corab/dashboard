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
