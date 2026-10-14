#!/usr/bin/env python3
"""印出精簡摘要給 Claude 每日任務讀（不要讀整份 latest.json）。"""
import json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = json.load(open(os.path.join(ROOT, 'data', 'latest.json')))
Q = D['quotes']
K = ('d', 'c', 'chg_pct', 'r1w', 'r1m', 'ytd', 'dd_ath', 'ath_d', 'dev200', 'sma200', 'rsi', 'regime')
out = {'meta': D['meta'], 'errors': D['errors'], 'health': D['health'],
       'quotes': {k: {x: (q[x]['label'] if x == 'regime' else q.get(x)) for x in K} for k, q in Q.items() if q and (q.get('kind') in ('index',) or k in D.get('focus', {}).get('ids', []) or k in ('NVDA', 'TSM', 'SMH', 'SOX', 'TW_2330', 'TW_2454', 'TW_2317', 'TLT', 'GLD'))},
       'movers': sorted([[k, q['chg_pct'], q.get('name')] for k, q in Q.items() if q and q.get('chg_pct') is not None], key=lambda x: x[1])[:5] + sorted([[k, q['chg_pct'], q.get('name')] for k, q in Q.items() if q and q.get('chg_pct') is not None], key=lambda x: -x[1])[:5],
       'position': {'vix': D['position']['vix'], 'accel_on': D['position']['accel_on'],
                    'targets': [{k: h[k] for k in ('key', 'c', 'dd', 'ath_d', 'ep_low', 'hit', 'used', 'next', 'dev200', 'rsi')} | {'regime': h['regime']['label']} for h in D['position']['targets']],
                    'backtest': [{'name': b['name'], 'from': b['from'], 'cur': b['cur'], 'tiers': [{k: t[k] for k in ('dd', 'n', 'f1y_med', 'f1y_pos', 'more_med')} for t in b['tiers']]} for b in D['position']['backtest']]},
       'macro': {'last': D['macro'].get('last')} | {k: {x: v[x] for x in ('name', 'd', 'v', 'chg1m', 'pct10y')} for k, v in D['macro'].items() if isinstance(v, dict) and 'pct10y' in v},
       'sentiment': {k: D['sentiment'].get(k) for k in ('vix', 'breadth')} | {'fng': {k: (D['sentiment'].get('fng') or {}).get(k) for k in ('score', 'rating', 'd', 'prev_week', 'prev_month')}, 'rsp_spy': {k: (D['sentiment'].get('rsp_spy') or {}).get(k) for k in ('chg3m', 'chg1y')}, 'term': D['sentiment'].get('term')},
       'sectors': {'us': [[s['sym'], s['name'], s['chg_pct'], s['r1m'], s['r3m'], s['quad']] for s in D['sectors']['us']], 'tw_top': [[s['name'], s['chg_pct'], s['r1m'], s['quad']] for s in D['sectors']['tw'][:6]], 'tw_bottom': [[s['name'], s['chg_pct'], s['r1m'], s['quad']] for s in D['sectors']['tw'][-4:]]},
       'focus': {'items': [{'key': x['key'], 'name': x['name'], 'type': x['type'], 'risk': x['risk'], 'info': {k: (x.get('info') or {}).get(k) for k in ('fee', 'r1y')},
                            'top3': [(t['name'], t['w']) for t in ((x.get('hold') or {}).get('top') or [])[:3]], 'hold_d': (x.get('hold') or {}).get('d')} for x in D.get('focus', {}).get('items', [])],
                 'overlap': D.get('focus', {}).get('overlap', [])[:4]},
       'taiwan': {k: D['taiwan'].get(k) for k in ('inst_sum', 'margin_last', 'fut_last')} | {'adr': {k: (D['taiwan'].get('adr') or {}).get(k) for k in ('v', 'fx', 'fx_d')}, 'inst_last5': (D['taiwan'].get('inst') or [])[-5:]}}
print(json.dumps(out, ensure_ascii=False, separators=(',', ':')))
