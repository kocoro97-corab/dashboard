"""Public data adapter tests; all provider values are synthetic."""
import copy
from datetime import datetime
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('collector', ROOT / 'tools/collect_public_briefing_v1.py')
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)
NOW = int(datetime.fromisoformat('2026-11-21T07:00:00+09:00').timestamp() * 1000)
OBS = '2026-11-20T16:15:00-05:00'


def fixtures():
    us = []
    feeds = {}
    for i, (key, (code, symbol, exchange)) in enumerate(c.CORE.items()):
        us.append({'reutersCode': code, 'closePriceRaw': str(100 + i), 'fluctuationsRatioRaw': '1.2', 'marketStatus': 'CLOSE', 'localTradedAt': OBS})
        t=int(datetime.fromisoformat('2026-11-20T09:30:00-05:00').timestamp())
        feeds[key] = {'http': 200, 'text': json.dumps({'chart': {'result': [{'meta': {'symbol': symbol, 'currency': 'USD', 'instrumentType': 'INDEX', 'exchangeName': exchange}, 'timestamp': [t-86400,t], 'indicators': {'quote': [{'close': [(100+i)/1.012,100+i]}]}}]}})}
    feeds['us'] = {'http': 200, 'text': json.dumps({'datas': us})}
    feeds['rates'] = {'http': 200, 'text': 'observation_date,DGS2,DGS10\n2026-11-19,3.2,4.1\n2026-11-20,,\n'}
    return feeds


class CollectorTests(unittest.TestCase):
    def test_core_crosscheck_and_daily_date_without_invented_clock(self):
        snap, _ = c.normalize(fixtures(), NOW)
        self.assertEqual(len([q for q in snap['quotes'] if q['key'] in c.CORE]), 4)
        for q in snap['quotes']:
            if q['key'].startswith('ust'):
                self.assertIsNone(q['observedAt'])
                self.assertEqual(q['observationDate'], '2026-11-19')
        self.assertEqual(snap['calendar']['kr'], 'WEEKEND')
        self.assertEqual(snap['calendar']['us'], 'UNKNOWN')

    def test_open_us_market_never_mislabeled_regular_close(self):
        feeds = fixtures();doc = json.loads(feeds['us']['text']);doc['datas'][0]['marketStatus'] = 'OPEN';feeds['us']['text'] = json.dumps(doc)
        with self.assertRaises(c.Invalid):
            c.normalize(feeds, NOW)

    def test_mismatched_identity_currency_close_or_observation_rejected(self):
        for patch in ['symbol', 'currency', 'close', 'future','change']:
            feeds = fixtures();doc = json.loads(feeds['sp500']['text']);data = doc['chart']['result'][0]
            if patch == 'symbol':data['meta']['symbol'] = '^WRONG'
            if patch == 'currency':data['meta']['currency'] = 'KRW'
            if patch == 'close':data['indicators']['quote'][0]['close'][0] = 999
            if patch == 'future':data['timestamp'][0] = NOW//1000 + 600
            if patch == 'change':data['indicators']['quote'][0]['close'][0]=50
            feeds['sp500']['text'] = json.dumps(doc)
            with self.assertRaises(c.Invalid):c.normalize(feeds, NOW)

    def test_missing_core_fails_closed_without_partial_report(self):
        feeds = fixtures();del feeds['dow']
        with self.assertRaises(c.Invalid):c.normalize(feeds, NOW)

    def test_missing_optional_is_absent_instead_of_zero(self):
        snap, missing = c.normalize(fixtures(), NOW)
        self.assertIn('esf', missing)
        self.assertFalse(any(q['key']=='esf' for q in snap['quotes']))

    def test_long_weekend_old_close_is_preserved_but_holiday_not_fabricated(self):
        now = int(datetime.fromisoformat('2026-11-23T07:00:00+09:00').timestamp()*1000)
        snap, _ = c.normalize(fixtures(), now)
        self.assertEqual(snap['calendar']['us'], 'WEEKEND')
        self.assertEqual(snap['calendar']['kr'], 'UNKNOWN')
        self.assertEqual(snap['quotes'][0]['observedAt'], c.stamp(OBS))

    def test_stale_core_and_naive_observation_rejected(self):
        with self.assertRaises(c.Invalid):c.normalize(fixtures(), NOW+5*86400000)
        self.assertIsNone(c.stamp('2026-11-20T16:00:00'))

    def test_industry_breadth_requires_consistent_counts_and_has_no_fake_time(self):
        rows = c.industry_sample({'groups': [{'name':'Synthetic A','changeRate':'2','totalCount':10,'riseCount':8,'fallCount':1,'steadyCount':1}, {'name':'Synthetic B','changeRate':'1','totalCount':10,'riseCount':20,'fallCount':0,'steadyCount':0}]})
        self.assertEqual(rows[0]['up'], 8)
        self.assertIsNone(rows[0]['observedAt'])
        self.assertIsNone(rows[1]['up'])

    def test_only_fixed_public_routes_exist_and_no_auth_or_nh(self):
        for url in c.TARGETS.values():
            self.assertTrue(url.startswith('https://'))
            self.assertNotIn('script.google', url)
            self.assertNotIn('nh', url.split('/')[2].lower())
            self.assertNotIn('token=', url)


if __name__ == '__main__':unittest.main()
