#!/usr/bin/env python3
"""每日更新：抓最近一段資料合併進 data/hist/，再抓當日快照（本益比、月營收、ETF 折溢價、恐懼貪婪）到 pipeline/snap.json。
任何來源失敗只記進 errors，不影響其他來源；之後由 build.py 算出 data/latest.json。
用法：python3 pipeline/update.py [--skip-tw] [--skip-us]"""
import argparse, datetime as dt, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sources as S

ap = argparse.ArgumentParser()
ap.add_argument('--skip-tw', action='store_true'); ap.add_argument('--skip-us', action='store_true')
a = ap.parse_args()
U = json.load(open(os.path.join(S.ROOT, 'pipeline', 'universe.json')))
SNAP = os.path.join(S.ROOT, 'pipeline', 'snap.json')
snap = json.load(open(SNAP)) if os.path.exists(SNAP) else {}
errors, ok = [], {}
today = dt.date.today()
log = lambda *x: print(*x, flush=True)


def run(name, fn):
    try:
        r = fn(); ok[name] = dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'); return r
    except Exception as e:
        errors.append(f'{name}: {e}'); log('FAIL', name, e); return None


if not a.skip_us:
    frm = (today - dt.timedelta(days=21)).isoformat()
    # 美東今天還沒收盤（16:20 前）就不收當天那根：Nasdaq 的指數在盤中會回傳當天的半成品 K 線（2026-10-13 實測）
    from zoneinfo import ZoneInfo
    ny = dt.datetime.now(ZoneInfo('America/New_York'))
    open_day = ny.date().isoformat() if ny.weekday() < 5 and (ny.hour, ny.minute) < (16, 20) else None
    done = lambda rows: [r for r in rows if r[0] != open_day]
    for u in U['us']:
        run('nasdaq ' + u['sym'], lambda u=u: S.merge_hist(u['sym'], done(S.nasdaq(u['sym'], u['src'], frm))))
    for s in U['vix']:
        run('cboe ' + s, lambda s=s: S.merge_hist('CBOE_' + s, done(S.cboe(s))))
    # Nasdaq 與 CBOE 要隔天才有當天收盤，收盤後用 Yahoo 補上最近幾天（同一天以 Yahoo 為準）
    YF = {'NDX': '^NDX', 'COMP': '^IXIC', 'SOX': '^SOX'}
    for key, yf in [(u['sym'], YF.get(u['sym'], u['sym'].replace('.', '-'))) for u in U['us']] + [('SPX', '^GSPC')] + [('CBOE_' + s, '^' + s) for s in U['vix']]:
        run('yahoo ' + yf, lambda key=key, yf=yf: S.merge_hist(key, done(S.yahoo(yf, 10))))
    run('treasury', lambda: S.merge_hist('UST', S.treasury(today.year), head=['d'] + S.UST_COLS))
    for sid in list(U['fred']) + ['SP500', 'NASDAQ100']:
        key = {'SP500': 'SPX', 'NASDAQ100': 'NDX_LONG'}.get(sid, 'FRED_' + sid)
        def f(sid=sid, key=key):
            rows = S.fred(sid)
            if key in ('SPX', 'NDX_LONG'): rows = [[d, None, None, None, v, None] for d, v in rows]
            return S.merge_hist(key, rows, head=('d', 'o', 'h', 'l', 'c', 'v') if len(rows[0]) == 6 else ('d', 'v'))
        run('fred ' + sid, f)
    # S&P 500 長歷史：和 SPX 同一份 Yahoo 資料
    run('yahoo ^GSPC long', lambda: S.merge_hist('SPX_LONG', done(S.yahoo('^GSPC', 40))))
    # CNN 恐懼貪婪（常擋機器人；失敗就顯示本日未取得）
    def fng():
        j = S.get('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', timeout=20)
        fg = j['fear_and_greed']; hist = [[dt.datetime.fromtimestamp(p['x'] / 1000, dt.timezone.utc).strftime('%Y-%m-%d'), round(p['y'], 1)] for p in j['fear_and_greed_historical']['data']]
        snap['fng'] = {'score': round(fg['score'], 1), 'rating': fg['rating'], 'd': fg['timestamp'][:10], 'prev_week': fg.get('previous_1_week'), 'prev_month': fg.get('previous_1_month'), 'hist': hist[-260:]}
    run('cnn fear&greed', fng)

if not a.skip_tw:
    yms = [f'{today.year}{today.month:02d}01']
    if today.day <= 7:
        p = today.replace(day=1) - dt.timedelta(days=1); yms.insert(0, f'{p.year}{p.month:02d}01')
    for u in U['tw']:
        s = u['sym']
        def f(s=s, u=u):
            n = 0
            for ym in yms:
                rows = S.taiex_month(ym) if s == 'TAIEX' else S.tpex_month(s, ym) if u.get('otc') else S.tw_stock_month(s, ym)
                for d, k in u.get('split') or []:
                    for r in rows:
                        if r[0] < d: r[1:5] = [None if v is None else v / k for v in r[1:5]]
                n = S.merge_hist('TW_' + s, rows)
            return n
        run('twse ' + s, f)
    days = [today - dt.timedelta(days=i) for i in range(0, 12)]
    days = [d.strftime('%Y%m%d') for d in sorted(days) if d.weekday() < 5]
    for key, fn, head in (('TW_INST', S.tw_inst, ['d', 'foreign', 'trust', 'dealer', 'total']), ('TW_MARGIN', S.tw_margin, ['d', 'margin', 'short'])):
        def f(key=key, fn=fn, head=head):
            have = {r[0] for r in S.read_hist(key)}
            rows = [r for r in (fn(d) for d in days if f'{d[:4]}-{d[4:6]}-{d[6:]}' not in have or d == days[-1]) if r]
            return S.merge_hist(key, rows, head=head)
        run('twse ' + key, f)
    def sect():
        have = {r[0] for r in S.read_hist('TW_SECT', 2)}; rows = []
        for d in days:
            if f'{d[:4]}-{d[4:6]}-{d[6:]}' not in have or d == days[-1]: rows += S.tw_sectors(d) or []
        return S.merge_hist('TW_SECT', rows, head=['d', 'name', 'c'], keyn=2)
    run('twse TW_SECT', sect)
    run('taifex TW_FUT', lambda: S.merge_hist('TW_FUT', S.taifex_fut((today - dt.timedelta(days=20)).strftime('%Y/%m/%d'), today.strftime('%Y/%m/%d')), head=['d', 'net_oi', 'net_amt']))
    codes = {u['sym'] for u in U['tw']}
    def val():
        v = S.tw_valuation(); snap['tw_val'] = {k: v[k] for k in codes if k in v}
    run('twse 本益比', val)
    def rev():
        v = S.tw_revenue(); snap['tw_rev'] = {k: v[k] for k in codes if k in v}
    run('twse 月營收', rev)
    def nav():
        v = S.tw_etf_nav(); snap['tw_nav'] = {k: v[k] for k in codes if k in v}
    run('twse ETF 淨值', nav)

snap['errors'] = errors
snap['ok'] = {**snap.get('ok', {}), **ok}
snap['updated_utc'] = dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
json.dump(snap, open(SNAP, 'w'), ensure_ascii=False, indent=1)
log(f'完成：{len(ok)} 個來源成功、{len(errors)} 個失敗')
