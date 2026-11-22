# Korean five-minute source qualification — 2026-11-22 KST

Status: **offline format checks PASS; source qualification PARTIAL; application connection NOT_RUN**. AAPL owner-authenticated reception remains awaiting the user's browser result; its completed Worker activation and actual anonymous-auth guard checks are preserved separately. This work progresses an independent Korean source task without replacing that pending validation.

## Reused material

Uses the existing NAVER Samsung (`005930`) public capture and Yahoo `005930.KS` capture described in [FIVE_MINUTE_CANDIDATE_REVIEW.md](FIVE_MINUTE_CANDIDATE_REVIEW.md). No new source request, endpoint discovery, source-library copy, authentication, paid API or relay change was needed. Captured provider data remains local, not committed as fixtures or published.

`tools/inspect_korean_intraday_v1.py` is an offline inspector. It has no fetch, polling, subscription, browser, account, order or application-cache interface. It reuses the existing Yahoo inspector for optional cross-source facts; it is not exported by the development build.

## Request and listing binding

- Limited to the exact known `005930/minute5` date URL, with identical declared response URL, HTTP 200, no redirects and matching raw capture/master SHA-256 digests. Extra query, encoded/other instruments, extra secret-bearing context fields or date changes are rejected. This is validation of a **local declaration**, not independent verification that HTTP really returned those bytes.
- Uses the existing provenance-bearing KRX-listed master distributed by KIS: schema, known archive URLs/checksum shape, snapshot timestamp and an unambiguous `005930` / KOSPI / STOCK record. It does not call that distribution a direct KRX API or certify a current listing from an old master.
- NAVER's normal body does not echo code, currency or timezone. Contradictory echoes are rejected if present. Currency and `Asia/Seoul` are explicitly context; provider identity/timezone certification stays false. Wrapper `stockExchangeType: KRX` is only a provider label, not certification of each event's venue or aggregation coverage.

## Time, event and volume boundaries

- Strict local timestamps, same requested date, ascending unique points, five-minute clock grid, valid provider window, no future point, internally valid positive OHLC and nonnegative finite volume.
- Missing volume remains unknown; real zero volume stays zero. Non-monotone values are observed rather than treated as a day-cumulative series or converted without a contract.
- Optional actual receipt time is separate from inspection time and provider clock. The prior NAVER capture lacks an independently recorded receipt timestamp, so it is **null**, not inferred from file mtime or provider clock.
- 15:30 and the provider's final boundary are event points, not automatic extra full candles. The output has raw points / clock-reference buckets, not a normalized candle series or MA/VWAP/signal.
- Gaps are unobserved clock-grid slots. Do not interpret auction/event gaps as missing trades or fill them with zeros/forward prices. Official venue/session/auction, per-point timestamp and volume semantics remain unresolved.
- Cross-source comparison requires validated Yahoo symbol/currency/exchange/interval and the same requested Korean date, then compares identical timestamps only. Unknown native volume pairs are counted separately. No 30-minute shift, source stitching or VWAP computation.

## Existing real-capture replay

The November 20 NAVER capture passes the structural checks:

| Fact | Result |
| --- | --- |
| Declared provider window | 09:00–20:00 Seoul context |
| Raw points | 129; first 09:00, last 19:55 |
| Before / at 15:30 | 76 / 1 |
| After 15:30 and before 16:00 | 4 |
| At/after 16:00 | 48 |
| Unobserved five-minute clock slots between points | 3, not filled |
| Missing / zero volume values | 0 / 0 |
| Volume values monotone | false |
| Same-clock nonzero-Yahoo-volume pairs | 71 |
| Matching close / volume pairs | 68 / 11 |

These confirm the prior manual findings with repeatable validation. They do not establish why the providers differ, approve redistribution, or prove complete regular-session / trade-volume coverage. Every live, calendar, venue, provider identity/timezone, bar-time, volume, full-session, VWAP and signal verification flag remains false; the report stays **PARTIAL**.

Evidence is local under `/workspace/output/korean-intraday-qualification-20261122/`; original captures remain under the preceding task's output directories. The context file is explicitly an offline declaration reconstructed from the earlier capture record; receipt time is unknown. No new live API reception is claimed.

## Running and tests

```sh
python3 tools/inspect_korean_intraday_v1.py \
  --payload /path/to/naver-capture.json \
  --context /path/to/local-capture-declaration.json \
  --date 20261120 \
  --compare-yahoo /path/to/yahoo-capture.json
python3 -m unittest discover -s tests -p test_korean_intraday_inspector.py
```

The declaration's exact keys are `requestUrl`, `responseUrl`, `httpStatus`, `redirected`, `payloadSha256`, `masterSha256`, `receivedAt` (integer epoch milliseconds or null). No token/password parameter exists. CLI output contains counts and approved metadata, never prices, raw OHLCV, unknown provider strings or private fields. Successful exit means the offline report was produced; it does not turn PARTIAL into a live PASS.

Fifteen new synthetic tests cover provenance/digests, ambiguous or wrong listing/venue, malformed/duplicate/reversed/future/off-grid dates, zero/missing/invalid OHLCV, provider/receipt clocks, terminal events, same-day cross-source matching, private-field filtering and input preservation, no network calls, no new relay allowance, sanitized CLI errors, symlink and size refusal. Full regression / CI results are reported in the task result.

## Publication and next work

No frontend, authentication, GAS, Worker, active relay URL permission or account/order file was changed. Development site remains `c01822cf8be588d682c3707e14b883e53c342758` (frontend source `e6cc016d38d5cbd372bfa308bf71a9ec278c13c7`). A tool-only commit is not a new website deployment. No PR/branch creation, merge or 07:00 publication.

Next owner: **Codex** — resolve row venue / session-event / timestamp / volume semantics using the source contract before proposing a Korean reference connection. Preserve AAPL owner-session validation as pending until its actual browser result is available. New analysis formulas and buy/sell signals are not part of this task.
