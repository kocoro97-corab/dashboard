"""Known optional reference frame only; tests never fetch vendor market data."""
from urllib.parse import urlsplit

def fulfill_reference_widget(route):
    url=urlsplit(route.request.url)
    if (url.scheme=='https' and url.hostname=='s.tradingview.com'
            and url.path=='/embed-widget/single-quote/'
            and route.request.is_navigation_request()
            and route.request.frame.parent_frame is not None):
        route.fulfill(content_type='text/html',body='<!doctype html><html><body>Reference widget fixture; no market data</body></html>')
        return True
    return False
