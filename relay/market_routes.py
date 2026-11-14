"""Exact GET routes used by the existing public-market UI; no arbitrary proxy."""
import re
import urllib.error
import urllib.request
from urllib.parse import parse_qsl, unquote, urlsplit

NEWS_QUERIES = frozenset({'코스피 OR 증시 OR 나스닥 when:2d',
                         '(삼성전자 OR SK하이닉스 OR 한미반도체 OR 알테오젠) when:2d'})


def allowed_market_url(value):
    if not isinstance(value, str) or len(value) > 2048 or re.search(r'[\x00-\x20\\]', value):return False
    try:
        p = urlsplit(value)
        if p.scheme != 'https' or p.port not in (None, 443) or p.username or p.password or p.fragment:return False
        if re.search(r'%(?![a-fA-F0-9]{2})', value):return False
        pairs = parse_qsl(p.query, keep_blank_values=True, strict_parsing=True)
        if len(pairs) != len(dict(pairs)):return False
        q = dict(pairs);path = unquote(p.path)
        if any(c in path for c in ('%', '\\', '?', '#')):return False
    except (ValueError, TypeError):return False
    host = p.hostname
    if host == 'polling.finance.naver.com':
        return not q and bool(re.fullmatch(r'/api/realtime/domestic/(?:index/(?:KOSPI|KOSDAQ)|stock/[0-9]{6}(?:,[0-9]{6}){0,19})', path))
    if host == 'stock.naver.com':
        if path == '/api/polling/worldstock/index':
            return set(q) == {'reutersCodes'} and bool(re.fullmatch(r'\.(?:INX|IXIC|DJI|SOX|VIX)(?:,\.(?:INX|IXIC|DJI|SOX|VIX)){0,4}', q['reutersCodes']))
        if path in ('/api/securityService/marketindex/majors/rpc', '/api/securityService/marketindex/majors/bond',
                    '/api/securityService/marketindex/energy', '/api/securityFe/api/index/KOSPI/integration'):
            return not q
        if path == '/api/domestic/market/theme/list':
            return q == {'startIdx': '0', 'pageSize': '100', 'sortType': 'changeRate'}
        if re.fullmatch(r'/api/domestic/market/theme/[0-9]{1,6}/stocklist', path):
            return q == {'marketType': 'ALL', 'orderType': 'priceTop', 'startIdx': '0', 'pageSize': '100'}
    if host == 'm.stock.naver.com':
        if re.fullmatch(r'/api/(?:stock/[0-9]{6}|index/(?:KOSPI|KOSDAQ))/price', path):
            return set(q) == {'pageSize', 'page'} and q['pageSize'] == '60' and q['page'] in {str(n) for n in range(1, 13)}
        if re.fullmatch(r'/api/stocks/theme/[0-9]{1,6}', path):return q == {'page': '1', 'pageSize': '100'}
    if host == 'query1.finance.yahoo.com':
        return (bool(re.fullmatch(r'/v8/finance/chart/[A-Za-z0-9^=.-]{1,32}', path)) and
                set(q) == {'interval', 'range'} and q['interval'] in ('1d', '1wk', '1mo') and
                q['range'] in ('1d', '1y', '2y', '10y', 'max'))
    if host == 'news.google.com' and path == '/rss/search':
        return set(q) == {'q', 'hl', 'gl', 'ceid'} and q['q'] in NEWS_QUERIES and q['hl'] == 'ko' and q['gl'] == 'KR' and q['ceid'] == 'KR:ko'
    if host == 'finance.daum.net' and path == '/api/home/sec':
        return set(q) == {'path'} and bool(re.fullmatch(r'/api/futures/KR[A-Z0-9]{10}', q['path']))
    return False


class MarketReadError(Exception):
    def __init__(self,code):self.code=code;super().__init__(code)


class NoMarketRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None


def read_market_text(url,opener=None):
    """Public GET after GAS session validation; no auth/session headers or fallback."""
    if not allowed_market_url(url):raise MarketReadError('RELAY_PUBLIC_URL_DENIED')
    host=urlsplit(url).hostname
    referer=('https://news.google.com/' if host=='news.google.com' else
             'https://finance.yahoo.com/' if host=='query1.finance.yahoo.com' else
             'https://finance.daum.net/' if host=='finance.daum.net' else 'https://stock.naver.com/')
    request=urllib.request.Request(url,method='GET',headers={'Accept':'*/*','Accept-Encoding':'identity',
        'User-Agent':'Mozilla/5.0','Referer':referer})
    try:
        client=opener or urllib.request.build_opener(NoMarketRedirect())
        with client.open(request,timeout=20) as response:
            if response.geturl()!=url:raise MarketReadError('RELAY_REDIRECT_DENIED')
            if response.status!=200:raise MarketReadError('RELAY_PUBLIC_FAILED')
            raw=response.read(2*1024*1024+1)
            if len(raw)>2*1024*1024:raise MarketReadError('RELAY_RESPONSE_TOO_LARGE')
            return raw.decode('utf-8')
    except MarketReadError:raise
    except urllib.error.HTTPError as error:
        code='RELAY_REDIRECT_DENIED' if 300<=error.code<400 else 'RELAY_PUBLIC_FAILED'
        error.close();raise MarketReadError(code) from None
    except UnicodeError:raise MarketReadError('RELAY_RESPONSE_INVALID') from None
    except Exception:raise MarketReadError('RELAY_UPSTREAM_NETWORK') from None
