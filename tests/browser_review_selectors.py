"""Keep response identity assertions exact while allowing verified display names."""
import re

def stock_heading(page,symbol):
    return page.locator('.sva').get_by_role('heading',name=re.compile(r'(?:^|\()'+re.escape(symbol)+r'\)?(?: · 종목명 미확인)? · 기술적 분석$'))

def watch_code_cell(page,code):
    # Holdings/watch assertions must exclude the new independent leader table.
    return page.locator('.stv2 > div:last-child').get_by_role('cell',name=re.compile(r'^(?:.* \()?'+re.escape(code)+r'(?:\)| · 종목명 미확인)?$'))
