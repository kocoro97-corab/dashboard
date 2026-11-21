"""Offline synthetic PC/Fold6 comparison preview; no app login, network, GAS or NH."""
import asyncio
import json
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
URL = (ROOT / 'preview' / 'strategy-scenario-compare-v1.html').resolve().as_uri()

async def run():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        try:
            for width in (1440, 690, 344):
                context = await browser.new_context(viewport={'width': width, 'height': 900},
                                                    timezone_id='Asia/Seoul',
                                                    service_workers='block')
                page = await context.new_page()
                errors, network = [], []
                page.on('pageerror', lambda err: errors.append(str(err)))
                page.on('request', lambda req: network.append(req.url) if not req.url.startswith('file:') else None)
                await page.goto(URL, wait_until='load')
                await page.locator('[data-scenario="day"]').wait_for()
                await page.locator('[data-scenario="swing"]').wait_for()
                day = page.locator('[data-result="day"]')
                swing = page.locator('[data-result="swing"]')
                difference = page.locator('[data-result="comparison"]')
                assert '가상 수량' in await day.inner_text()
                assert '가상 수량' in await swing.inner_text()
                assert '수량 차이' in await difference.inner_text()
                assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), width
                assert await page.evaluate('window.MYInvestStrategyScenarioCompareV1 != null')
                assert await page.evaluate('window.MYInvestScenarioComparePanelV1 != null')
                # Bad day stop invalidates day only; swing remains available.
                await page.get_by_label('day · 손절가').fill('50000')
                await page.get_by_role('button', name='가상 수량·손익 비교').click()
                assert '입력 확인' in await day.inner_text()
                assert '가상 수량' in await swing.inner_text()
                assert '두 가상 계획 모두 유효' in await difference.inner_text()
                # Clearing a compulsory numeric input is invalid, not silently zero.
                await page.get_by_label('공통 · 가상 총자본').fill('')
                await page.get_by_role('button', name='가상 수량·손익 비교').click()
                assert '공통 입력값을 확인' in await difference.inner_text()
                # Restore synthesis, change market and ensure same scalar currency only.
                await page.get_by_role('button', name='합성 예시 초기화').click()
                assert '수량 차이' in await difference.inner_text()
                await page.get_by_label('시장 · 통화').select_option('US')
                assert '달러' in await day.inner_text()
                assert '달러' in await swing.inner_text()
                assert '원' not in (await page.locator('.stat strong').all_inner_texts())[1]
                assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), width
                # Reset and page re-entry must restore the disclosed synthetic defaults.
                await page.reload(wait_until='load')
                assert await page.get_by_label('시장 · 통화').input_value() == 'KR'
                assert await page.get_by_label('공통 · 가상 총자본').input_value() == '10000000'
                assert await page.get_by_label('swing · 급락').count() == 0  # exact accessible label is longer
                assert not errors, errors
                assert not network, network
                print(json.dumps({'width':width,'scope':'OFFLINE_SYNTHETIC_PREVIEW',
                    'dayVsSwing':'PASS','invalidInputs':'PASS','reset':'PASS',
                    'responsive':'PASS','externalNetworkCalls':0,'NHCalls':0,
                    'orderCalls':0}),flush=True)
                await context.close()
        finally:
            await browser.close()

if __name__ == '__main__':
    asyncio.run(run())
