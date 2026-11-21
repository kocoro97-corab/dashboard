"""On-demand PUBLIC provider capture. No login, NH, GAS, keys or publishing.

Fixed endpoints only; two workers; no retries or redirects. Feed composition is
left to the existing JS composer. Output paths must be new files.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import csv
from datetime import datetime, timezone
import io
import json
import math
from pathlib import Path
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo

US_URL = 'https://stock.naver.com/api/polling/worldstock/index?reutersCodes=.INX,.IXIC,.DJI,.SOX,.VIX'
KR_URL = 'https://polling.finance.naver.com/api/realtime/domestic/index/'
FRED_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS2,DGS10'
INDUSTRY_URL = 'https://m.stock.naver.com/api/stocks/industry?page=1&pageSize=100'
CHART = 'https://query1.finance.yahoo.com/v8/finance/chart/'
CORE = {'sp500': ('.INX', '^GSPC', 'SNP'), 'nasdaq': ('.IXIC', '^IXIC', 'NIM'),
        'dow': ('.DJI', '^DJI', 'DJI'), 'sox': ('.SOX', '^SOX', 'NIM')}
TARGETS = {'us': US_URL, 'kospi': KR_URL + 'KOSPI', 'kosdaq': KR_URL + 'KOSDAQ',
           'rates': FRED_URL, 'industries': INDUSTRY_URL}
for key, symbol in [('sp500', '%5EGSPC'), ('nasdaq', '%5EIXIC'), ('dow', '%5EDJI'),
                    ('sox', '%5ESOX'), ('esf', 'ES%3DF'), ('nqf', 'NQ%3DF'),
                    ('ymf', 'YM%3DF'), ('usdkrw', 'KRW%3DX')]:
    TARGETS[key] = CHART + symbol + '?interval=1d&range=1y'


class Invalid(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def number(value):
    if isinstance(value, bool) or value is None:
        return None
    try:
        n = float(str(value).replace(',', ''))
        return n if math.isfinite(n) else None
    except (ValueError, TypeError):
        return None


def stamp(value):
    if not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return int(dt.timestamp() * 1000) if dt.tzinfo is not None else None
    except ValueError:
        return None


def capture(key):
    url = TARGETS[key]
    headers = {'User-Agent': 'Mozilla/5.0', 'Accept': '*/*',
               'Referer': 'https://finance.yahoo.com/' if 'yahoo.com' in url else 'https://fred.stlouisfed.org/' if 'stlouisfed.org' in url else 'https://stock.naver.com/'}
    try:
        with urllib.request.build_opener(NoRedirect()).open(urllib.request.Request(url, headers=headers), timeout=25) as response:
            body = response.read(2 * 1024 * 1024 + 1)
            if len(body) > 2 * 1024 * 1024:
                return key, {'error': 'RESPONSE_TOO_LARGE'}
            return key, {'text': body.decode('utf-8-sig'), 'http': response.status,
                         'receivedAt': int(datetime.now(timezone.utc).timestamp() * 1000)}
    except urllib.error.HTTPError as e:
        status = e.code
        e.close()
        return key, {'error': 'PROVIDER_HTTP', 'http': status}
    except Exception:
        return key, {'error': 'PROVIDER_UNAVAILABLE'}


def chart(doc, symbol, currency, kind, exchanges):
    try:
        data = doc['chart']['result'][0]
        meta = data['meta']
        if meta.get('symbol') != symbol or meta.get('currency') != currency or meta.get('instrumentType') != kind or meta.get('exchangeName') not in exchanges:
            raise Invalid('CHART_IDENTITY')
        return data
    except (KeyError, TypeError, IndexError):
        raise Invalid('CHART_FORMAT') from None


def industry_sample(document):
    sectors = []
    groups = document.get('groups', [])
    if isinstance(groups, list):
        for group in groups:
            if not isinstance(group, dict):
                continue
            rate, total, up = number(group.get('changeRate')), number(group.get('totalCount')), number(group.get('riseCount'))
            down, flat = number(group.get('fallCount')), number(group.get('steadyCount'))
            name = group.get('name')
            if not isinstance(name, str) or not name.strip() or len(name) > 100 or rate is None or abs(rate) > 100:
                continue
            counted = all(n is not None and n >= 0 and int(n) == n for n in [total, up, down, flat]) and total > 0 and up + down + flat == total
            sectors.append({'name': name, 'changePct': rate, 'up': int(up) if counted else None,
                'total': int(total) if counted else None, 'observedAt': None, 'sourceId': 'industries'})
    return sorted(sectors, key=lambda row: row['changePct'], reverse=True)[:6]


def normalize(feeds, now):
    if not isinstance(now, int) or now <= 0:
        raise Invalid('INVALID_CLOCK')
    documents = {}
    failures = []
    for key in TARGETS:
        row = feeds.get(key, {})
        if row.get('http') == 200 and isinstance(row.get('text'), str):
            try:
                documents[key] = row['text'] if key == 'rates' else json.loads(row['text'])
            except ValueError:
                failures.append(key)
        else:
            failures.append(key)
    us = documents.get('us', {}).get('datas')
    if not isinstance(us, list):
        raise Invalid('US_CLOSE_SOURCE_UNAVAILABLE')
    quotes, sources = [], []
    source_ids = set()
    def source(key, title):
        if key not in source_ids:
            sources.append({'id': key, 'title': title, 'url': TARGETS[key], 'publishedAt': None})
            source_ids.add(key)
        return key
    def observation(row):
        t = stamp(row.get('localTradedAt'))
        if not t or t > now or now - t > 96 * 3600000:
            raise Invalid('STALE_OR_MISSING_OBSERVATION')
        return t
    def naver_quote(key, row, close_required=False):
        value = number(row.get('closePriceRaw', row.get('closePrice')))
        pct = number(row.get('fluctuationsRatioRaw', row.get('fluctuationsRatio')))
        if value is None or value <= 0 or pct is None or not -100 <= pct <= 100:
            raise Invalid('INVALID_PRICE_OR_CHANGE')
        if close_required and row.get('marketStatus') != 'CLOSE':
            raise Invalid('US_REGULAR_CLOSE_NOT_CONFIRMED')
        return {'key': key, 'value': value, 'changePct': pct,
            'phase': 'close' if row.get('marketStatus') == 'CLOSE' else 'indicative',
            'marketState': row.get('marketStatus') if row.get('marketStatus') in ['OPEN', 'CLOSE'] else 'UNKNOWN',
            'observedAt': observation(row), 'sourceId': 'us' if key in CORE or key == 'vix' else key}
    core_days = set()
    for key, (code, symbol, exchange) in CORE.items():
        matches = [r for r in us if r.get('reutersCode') == code]
        if len(matches) != 1:
            raise Invalid('US_CLOSE_IDENTITY')
        quote = naver_quote(key, matches[0], True)
        # Cross-check the actual daily close, not chartPreviousClose (which can
        # be the first close of a one-year range). Daily timestamps are bar-open
        # dates, never repurposed as a precise closing observation timestamp.
        if key not in documents:
            raise Invalid('CORE_CROSSCHECK_UNAVAILABLE')
        yahoo = chart(documents[key], symbol, 'USD', 'INDEX', {exchange})
        times = yahoo.get('timestamp', [])
        closes = yahoo.get('indicators', {}).get('quote', [{}])[0].get('close', [])
        bars = [(t, number(c)) for t, c in zip(times, closes) if isinstance(t, int) and number(c) is not None and number(c) > 0]
        if len(bars)<2 or any(t > now // 1000 for t, _ in bars) or any(a[0] >= b[0] for a, b in zip(bars, bars[1:])):
            raise Invalid('CORE_HISTORY_INVALID')
        day = datetime.fromtimestamp(quote['observedAt'] / 1000, ZoneInfo('America/New_York')).date()
        bar_day = datetime.fromtimestamp(bars[-1][0], ZoneInfo('America/New_York')).date()
        if day != bar_day or abs(bars[-1][1] / quote['value'] - 1) > 0.0002:
            raise Invalid('CORE_CLOSE_CROSSCHECK_MISMATCH')
        if abs((bars[-1][1] / bars[-2][1] - 1) * 100 - quote['changePct']) > 0.03:
            raise Invalid('CORE_CHANGE_CROSSCHECK_MISMATCH')
        core_days.add(day)
        quotes.append(quote)
        source(key, 'Yahoo 일봉 교차 확인 · ' + symbol)
    if len(core_days) != 1:
        raise Invalid('CORE_SESSION_DATE_MISMATCH')
    source('us', '네이버 미국 지수 · 공급자 마감 표시')
    for key in ['kospi', 'kosdaq', 'vix']:
        try:
            rows = us if key == 'vix' else documents[key]['datas']
            identity = '.VIX' if key == 'vix' else key.upper()
            matched = [r for r in rows if r.get('reutersCode', r.get('itemCode')) == identity]
            if len(matched) != 1:
                raise Invalid('OPTIONAL_IDENTITY')
            quotes.append(naver_quote(key, matched[0]))
            source('us' if key == 'vix' else key, '네이버 관측 지수')
        except (KeyError, TypeError, Invalid):
            failures.append(key)
    for key, symbol in [('esf', 'ES=F'), ('nqf', 'NQ=F'), ('ymf', 'YM=F'), ('usdkrw', 'KRW=X')]:
        try:
            kind = 'CURRENCY' if key == 'usdkrw' else 'FUTURE'
            data = chart(documents[key], symbol, 'KRW' if key == 'usdkrw' else 'USD', kind,
                         {'CCY'} if key == 'usdkrw' else {'CME', 'CBT'})
            meta = data['meta']
            price, observed = number(meta.get('regularMarketPrice')), meta.get('regularMarketTime')
            if price is None or price <= 0 or not isinstance(observed, int) or observed * 1000 > now or now - observed * 1000 > 96 * 3600000:
                raise Invalid('OPTIONAL_QUOTE_UNAVAILABLE')
            # An unverified live/delayed feed is an indicative quote. No invented
            # session close, delay classification or single-contract expiry.
            quotes.append({'key': key, 'value': price, 'changePct': None, 'phase': 'indicative',
                           'marketState': 'UNKNOWN',
                           'observedAt': observed * 1000, 'sourceId': source(key, 'Yahoo 공급자 참고 시세 · ' + symbol)})
        except (KeyError, TypeError, Invalid):
            failures.append(key)
    try:
        rows = list(csv.DictReader(io.StringIO(documents['rates'])))
        for key, column in [('ust2y', 'DGS2'), ('ust10y', 'DGS10')]:
            valid = [r for r in rows if number(r.get(column)) is not None and number(r.get(column)) > 0]
            row = valid[-1]
            day = row.get('observation_date', row.get('DATE'))
            date = datetime.strptime(day, '%Y-%m-%d').date()
            age = (datetime.fromtimestamp(now / 1000, ZoneInfo('America/New_York')).date() - date).days
            if age < 0 or age > 4:
                raise Invalid('DAILY_RATE_STALE')
            quotes.append({'key': key, 'value': number(row[column]), 'changePct': None, 'phase': 'indicative',
                'marketState': 'DAILY',
                'observedAt': None, 'observationDate': day, 'sourceId': source('rates', 'FRED H.15 일별 미국 국채 금리 · DGS2/DGS10')})
    except (KeyError, IndexError, ValueError, Invalid):
        failures.append('rates')
    kst = datetime.fromtimestamp(now / 1000, ZoneInfo('Asia/Seoul'))
    ny = datetime.fromtimestamp(now / 1000, ZoneInfo('America/New_York'))
    snapshot = {'type': 'myinvest-public-market-snapshot-v1', 'schemaVersion': 1,
        'visibility': 'public-market-only', 'timeZone': 'Asia/Seoul', 'reportDate': kst.date().isoformat(),
        'collectedAt': now, 'sources': sources, 'quotes': quotes,
        'calendar': {'kr': 'WEEKEND' if kst.weekday() >= 5 else 'UNKNOWN',
                     'us': 'WEEKEND' if ny.weekday() >= 5 else 'UNKNOWN'}}
    sectors = industry_sample(documents.get('industries', {}))
    if sectors:
        source('industries', '네이버 산업 등락 · 수신 상위 표본')
        snapshot['sectors'] = sectors
    return snapshot, sorted(set(failures))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        print(json.dumps({'status': 'NOT_RUN', 'code': 'OUTPUT_EXISTS'}))
        return 1
    with ThreadPoolExecutor(max_workers=2) as pool:
        feeds = dict(pool.map(capture, TARGETS))
    now = int(datetime.now(timezone.utc).timestamp() * 1000)
    try:
        snapshot, failures = normalize(feeds, now)
        with args.output.open('x', encoding='utf-8') as f:
            json.dump(snapshot, f, ensure_ascii=False, indent=2)
    except (Invalid, OSError) as e:
        print(json.dumps({'status': 'FAIL', 'code': str(e) if isinstance(e, Invalid) else 'OUTPUT_NOT_WRITABLE',
                          'actualNhCalls': 0, 'published': False}))
        return 1
    print(json.dumps({'status': 'CAPTURED_LOCALLY_NOT_PUBLISHED', 'quotes': len(snapshot['quotes']),
        'coreCrosscheck': 'PASS', 'calendarSpecialHolidays': 'UNVERIFIED', 'optionalFailures': failures,
        'actualNhCalls': 0, 'accountCalls': 0, 'published': False}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
