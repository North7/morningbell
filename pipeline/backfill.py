#!/usr/bin/env python3
"""一次性回補歷史資料到 data/hist/。可中斷重跑：已經有的月份會跳過。
用法：python3 pipeline/backfill.py [--only SYM ...] [--skip-tw] [--skip-us]
證交所有流量限制，台股全部回補約 40 分鐘。"""
import argparse, datetime as dt, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sources as S

ap = argparse.ArgumentParser()
ap.add_argument('--only', nargs='*'); ap.add_argument('--skip-tw', action='store_true'); ap.add_argument('--skip-us', action='store_true')
a = ap.parse_args()
U = json.load(open(os.path.join(S.ROOT, 'pipeline', 'universe.json')))
today = dt.date.today()
want = lambda s: not a.only or s in a.only
log = lambda *x: print(*x, flush=True)

# Nasdaq 只給最近 10 年。長歷史（歷次回撤、加碼回測）另外抓：
#   那斯達克 100：FRED NASDAQ100（1986 起，只有收盤）；S&P 500：Yahoo ^GSPC（本機常被擋，在 Actions 跑 backfill.yml）
def long_hist():
    if want('NDX_LONG'):
        try: log('NDX_LONG', S.merge_hist('NDX_LONG', [[d, None, None, None, v, None] for d, v in S.fred('NASDAQ100')]))
        except Exception as e: log('FAIL NDX_LONG', e)
    if want('SPX_LONG'):
        try: log('SPX_LONG', S.merge_hist('SPX_LONG', S.yahoo('^GSPC')))
        except Exception as e: log('FAIL SPX_LONG（之後在 GitHub Actions 回補）', e)


if not a.skip_us:
    for u in U['us']:
        s = u['sym']
        if not want(s): continue
        try:
            log('us', s, S.merge_hist(s, S.nasdaq(s, u['src'], (today - dt.timedelta(days=3650)).isoformat())))
        except Exception as e: log('FAIL us', s, e)
    for s in U['vix']:
        if not want(s): continue
        try: log('cboe', s, S.merge_hist('CBOE_' + s, S.cboe(s)))
        except Exception as e: log('FAIL cboe', s, e)
    long_hist()
    if want('UST'):
        for y in range(today.year - 10, today.year + 1):
            try: S.merge_hist('UST', S.treasury(y), head=['d'] + S.UST_COLS); log('ust', y)
            except Exception as e: log('FAIL ust', y, e)

if a.skip_tw: sys.exit(0)


def months(since):
    y, m = int(since[:4]), int(since[5:7]); out = []
    while (y, m) <= (today.year, today.month):
        out.append(f'{y}{m:02d}01'); m += 1
        if m == 13: y, m = y + 1, 1
    return out


def have_months(key):
    return {r[0][:7].replace('-', '') + '01' for r in S.read_hist(key)}


def split_adj(rows, splits):
    for d, k in splits or []:
        for r in rows:
            if r[0] < d: r[1:5] = [None if v is None else v / k for v in r[1:5]]
    return rows


cur_m = f'{today.year}{today.month:02d}01'
short = (today - dt.timedelta(days=470)).isoformat()
for u in U['tw']:
    s = u['sym']
    if not want(s): continue
    key = 'TW_' + s
    since = '2000-01-01' if s == 'TAIEX' else '2019-01-01' if s in ('0050', '006208') else short
    have = have_months(key); n = 0
    for ym in months(since):
        if ym in have and ym != cur_m: continue
        try:
            rows = S.taiex_month(ym) if s == 'TAIEX' else S.tpex_month(s, ym) if u.get('otc') else split_adj(S.tw_stock_month(s, ym), u.get('split'))
            if rows: n = S.merge_hist(key, rows)
        except Exception as e: log('FAIL tw', s, ym, e)
    log('tw', s, n)

# 三大法人、融資、類股指數：最近約 6 個月的交易日
days = [today - dt.timedelta(days=i) for i in range(0, 190)]
days = [d.strftime('%Y%m%d') for d in sorted(days) if d.weekday() < 5]
for key, fn, head in (('TW_INST', S.tw_inst, ['d', 'foreign', 'trust', 'dealer', 'total']),
                      ('TW_MARGIN', S.tw_margin, ['d', 'margin', 'short'])):
    if not want(key): continue
    have = {r[0] for r in S.read_hist(key)}; rows = []
    for d in days[-130:]:
        if f'{d[:4]}-{d[4:6]}-{d[6:]}' in have: continue
        try:
            r = fn(d)
            if r: rows.append(r)
        except Exception as e: log('FAIL', key, d, e)
    log(key, S.merge_hist(key, rows, head=head))

if want('TW_SECT'):
    have = {r[0] for r in S.read_hist('TW_SECT', 2)}; rows = []
    for d in days:
        if f'{d[:4]}-{d[4:6]}-{d[6:]}' in have: continue
        try: rows += S.tw_sectors(d) or []
        except Exception as e: log('FAIL sect', d, e)
    log('TW_SECT', S.merge_hist('TW_SECT', rows, head=['d', 'name', 'c'], keyn=2))

if want('TW_FUT'):
    rows = []
    for k in range(6, -1, -1):
        e = today - dt.timedelta(days=30 * k); s0 = e - dt.timedelta(days=29)
        try: rows += S.taifex_fut(s0.strftime('%Y/%m/%d'), e.strftime('%Y/%m/%d'))
        except Exception as ex: log('FAIL fut', e, ex)
    log('TW_FUT', S.merge_hist('TW_FUT', rows, head=['d', 'net_oi', 'net_amt']))
