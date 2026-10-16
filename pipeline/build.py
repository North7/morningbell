#!/usr/bin/env python3
"""data/hist/*.csv + pipeline/snap.json + data/model.json → data/latest.json（網站讀的唯一資料檔）。
不打任何 API。數字算不出來就是 null，並寫進 errors；不推估、不沿用舊值。"""
import datetime as dt, json, math, os, statistics as st, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sources as S

ROOT = S.ROOT
U = json.load(open(os.path.join(ROOT, 'pipeline', 'universe.json')))
M = json.load(open(os.path.join(ROOT, 'data', 'model.json')))
SNAP = os.path.join(ROOT, 'pipeline', 'snap.json')
snap = json.load(open(SNAP)) if os.path.exists(SNAP) else {}
errors = list(snap.get('errors') or [])
now = dt.datetime.now(dt.timezone.utc)
dn = lambda d: (dt.date.fromisoformat(d) - dt.date(1970, 1, 1)).days
r2 = lambda x, k=2: None if x is None or (isinstance(x, float) and math.isnan(x)) else round(x, k)
pct = lambda a, b: None if a is None or not b else (a / b - 1) * 100


def closes(key):
    return [(r[0], r[4]) for r in S.read_hist(key) if r[4] is not None]


def series(key, col=1):
    return [(r[0], r[col]) for r in S.read_hist(key) if len(r) > col and r[col] is not None]


def sma(v, n): return sum(v[-n:]) / n if len(v) >= n else None


def rsi(v, n=14):
    if len(v) < n * 3: return None
    g = [max(0, v[i] - v[i - 1]) for i in range(1, len(v))]; l = [max(0, v[i - 1] - v[i]) for i in range(1, len(v))]
    ag, al = sum(g[:n]) / n, sum(l[:n]) / n
    for i in range(n, len(g)): ag = (ag * (n - 1) + g[i]) / n; al = (al * (n - 1) + l[i]) / n
    return 100 if al == 0 else 100 - 100 / (1 + ag / al)


def ago(cl, n): return cl[-1 - n][1] if len(cl) > n else None


def stats(key, meta=None):
    rows = S.read_hist(key); cl = [(r[0], r[4]) for r in rows if r[4] is not None]
    if len(cl) < 2: errors.append(f'{key}: 沒有歷史資料'); return None
    v = [c for _, c in cl]; d, c = cl[-1]
    py = [x for x in cl if x[0] < d[:4] + '-01-01']
    y1 = [x for x in v[-252:]]
    s50, s200 = sma(v, 50), sma(v, 200)
    s200_20 = sum(v[-220:-20]) / 200 if len(v) >= 220 else None
    ath_i = max(range(len(v)), key=lambda i: v[i])
    rets = [math.log(v[i] / v[i - 1]) for i in range(max(1, len(v) - 20), len(v))]
    vols = [r[5] for r in rows[-21:-1] if r[5]]
    o = {
        'd': d, 'c': r2(c, 4 if c < 10 else 2), 'chg_pct': r2(pct(c, v[-2])), 'r1w': r2(pct(c, ago(cl, 5))), 'r1m': r2(pct(c, ago(cl, 21))),
        'r3m': r2(pct(c, ago(cl, 63))), 'r1y': r2(pct(c, ago(cl, 252))), 'ytd': r2(pct(c, py[-1][1])) if py else None,
        'hi52': r2(max(y1)), 'lo52': r2(min(y1)), 'ath': r2(v[ath_i]), 'ath_d': cl[ath_i][0], 'dd_ath': r2(pct(c, v[ath_i])),
        'hist_from': cl[0][0], 'pos52': r2((c - min(y1)) / (max(y1) - min(y1)) * 100 if max(y1) > min(y1) else None, 0),
        'sma50': r2(s50), 'sma200': r2(s200), 'dev200': r2(pct(c, s200)), 'sma200_up': None if s200_20 is None else s200 > s200_20,
        'rsi': r2(rsi(v[-300:]), 0), 'vol20': r2(st.stdev(rets) * math.sqrt(252) * 100 if len(rets) > 5 else None, 1),
        'vratio': r2(rows[-1][5] / (sum(vols) / len(vols)) if rows[-1][5] and vols else None),
        'spark': [r2(x, 4 if x < 10 else 2) for x in v[-60:]],
    }
    if meta: o.update({k: meta[k] for k in ('name', 'kind', 'group', 'hold') if k in meta})
    return o


def regime(dd):
    for r in M['regime']:
        if dd is not None and dd > r['max_dd']: return {'label': r['label'], 'tone': r['tone']}
    return {'label': M['regime'][-1]['label'], 'tone': M['regime'][-1]['tone']}


def hist_pts(key, days=750, col=4):
    cl = [(r[0], r[col]) for r in S.read_hist(key) if r[col] is not None]
    if not cl: return []
    cut = dn(cl[-1][0]) - days
    return [[dn(d), r2(c, 4 if c < 10 else 2)] for d, c in cl if dn(d) >= cut]


def underwater(cl, days=1100):
    out, pk = [], 0
    for d, c in cl:
        pk = max(pk, c); out.append([dn(d), r2(pct(c, pk), 2)])
    return out[-days:] if out else []


# ---------- 回撤與加碼回測 ----------
def episodes(cl, depth=-10):
    eps, pk_i, tr_i = [], 0, 0
    v = [c for _, c in cl]
    for i in range(1, len(v)):
        if v[i] >= v[pk_i]:
            dd = pct(v[tr_i], v[pk_i])
            if tr_i > pk_i and dd <= depth: eps.append({'peak': cl[pk_i][0], 'trough': cl[tr_i][0], 'depth': r2(dd, 1), 'down_days': tr_i - pk_i, 'up_days': i - tr_i, 'rec': cl[i][0], 'pk_i': pk_i, 'tr_i': tr_i})
            pk_i = tr_i = i
        elif v[i] < v[tr_i] or tr_i < pk_i: tr_i = i
    dd = pct(v[tr_i], v[pk_i])
    cur = {'peak': cl[pk_i][0], 'trough': cl[tr_i][0], 'depth': r2(dd, 1), 'now': r2(pct(v[-1], v[pk_i]), 1), 'down_days': tr_i - pk_i, 'days': len(v) - 1 - pk_i, 'pk_i': pk_i, 'tr_i': tr_i, 'ongoing': True}
    if dd <= depth: eps.append(dict(cur))
    return eps, cur


def tier_test(cl, tiers):
    v = [c for _, c in cl]; n = len(v); out = []
    for t in tiers:
        ev, pk, hit = [], v[0], False
        for i in range(1, n):
            if v[i] >= pk: pk, hit = v[i], False; continue
            if not hit and pct(v[i], pk) <= t:
                hit = True
                j = i; low = v[i]
                while j < n and v[j] < pk: low = min(low, v[j]); j += 1
                ev.append({'d': cl[i][0], 'f6m': r2(pct(v[i + 126], v[i]), 1) if i + 126 < n else None, 'f1y': r2(pct(v[i + 252], v[i]), 1) if i + 252 < n else None,
                           'f3y': r2(pct(v[i + 756], v[i]), 1) if i + 756 < n else None, 'more': r2(pct(low, v[i]), 1), 'rec_days': (j - i) if j < n else None})
        f1 = [e['f1y'] for e in ev if e['f1y'] is not None]; f3 = [e['f3y'] for e in ev if e['f3y'] is not None]; mo = [e['more'] for e in ev]
        out.append({'dd': t, 'n': len(ev), 'f1y_med': r2(st.median(f1), 1) if f1 else None, 'f1y_pos': r2(sum(x > 0 for x in f1) / len(f1) * 100, 0) if f1 else None,
                    'f1y_min': r2(min(f1), 1) if f1 else None, 'f3y_med': r2(st.median(f3), 1) if f3 else None, 'more_med': r2(st.median(mo), 1) if mo else None,
                    'more_min': r2(min(mo), 1) if mo else None, 'events': ev[-12:]})
    return out


def paths(cl, eps, cur, cap=400):
    span = min(cap, max(160, int(cur['days'] * 1.6)))
    v = [c for _, c in cl]
    mk = lambda i0: [r2(pct(v[i], v[i0]), 1) for i in range(i0, min(len(v), i0 + span + 1), 2)]
    past = [{'label': e['peak'][:4], 'peak': e['peak'], 'depth': e['depth'], 'pts': mk(e['pk_i'])} for e in eps if not e.get('ongoing')]
    return {'step': 2, 'span': span, 'cur': mk(cur['pk_i']), 'cur_days': cur['days'], 'past': past[-14:]}


# ---------- RRG：相對強度（週線） ----------
def weekly(cl):
    out = {}
    for d, c in cl:
        y, w, _ = dt.date.fromisoformat(d).isocalendar(); out[(y, w)] = (d, c)
    return [out[k] for k in sorted(out)]


def rrg(cl, bench, tail=5):
    """簡化版 JdK：RS＝價格÷大盤；相對強度＝RS ÷ 其 12 週均值；動能＝相對強度 ÷ 其 6 週均值。兩者都以 100 為中線，再取 3 週平滑。"""
    b = dict(weekly(bench)); w = [(d, c) for d, c in weekly(cl) if d in b]
    rs = [100 * c / b[d] for d, c in w]
    if len(rs) < 26: return None
    sm = lambda a, i, n: sum(a[i - n + 1:i + 1]) / n
    ratio = [None] * len(rs)
    for i in range(11, len(rs)): ratio[i] = 100 * rs[i] / sm(rs, i, 12)
    r3 = [None] * len(rs)
    for i in range(13, len(rs)): r3[i] = sm(ratio, i, 3)
    mom = [None] * len(rs)
    for i in range(18, len(rs)): mom[i] = 100 * r3[i] / sm(r3, i, 6)
    pts = [[w[i][0], r2(r3[i], 2), r2(mom[i], 2)] for i in range(len(rs)) if mom[i] is not None]
    return pts[-tail:]


def quadrant(p):
    if not p: return None
    x, y = p[-1][1], p[-1][2]
    return '領漲' if x >= 100 and y >= 100 else '轉弱' if x >= 100 else '落後' if y < 100 else '改善'


# =============== 組裝 ===============
D = {'meta': {}, 'quotes': {}, 'errors': [], 'model': {k: M[k] for k in ('ladder', 'ladder_note', 'accel', 'trend')}}
Q = D['quotes']
for u in U['us']: Q[u['sym']] = stats(u['sym'], dict(u, mkt='us'))
for u in U['tw']: Q['TW_' + u['sym']] = stats('TW_' + u['sym'], u)
FUNDS = {f['key']: f for f in U.get('funds', [])}
for k, f in FUNDS.items(): Q[k] = stats(k, {'name': f['name'], 'kind': 'fund'})
for k, q in Q.items():
    if q: q['mkt'] = 'tw' if k.startswith('TW_') else 'fund' if k.startswith('FUND_') else 'us'; q['regime'] = regime(q['dd_ath'])
Q['SPX'] = stats('SPX', {'name': 'S&P 500 指數', 'kind': 'index'})
if Q['SPX']: Q['SPX']['mkt'] = 'us'; Q['SPX']['regime'] = regime(Q['SPX']['dd_ath'] if Q['SPX']['hist_from'] < '2017' else None)

us_d = (Q.get('SPY') or {}).get('d'); tw_d = (Q.get('TW_TAIEX') or {}).get('d')
# 哪個市場比較晚收盤：台股收盤台北 13:30（UTC 05:30），美股收盤紐約 16:00（UTC 20:00／21:00）
us_ts = dt.datetime.fromisoformat(us_d + 'T20:30:00+00:00') if us_d else None
tw_ts = dt.datetime.fromisoformat(tw_d + 'T05:30:00+00:00') if tw_d else None
edition = 'tw' if tw_ts and (not us_ts or tw_ts > us_ts) else 'us'
D['meta'] = {'generated_utc': now.isoformat(timespec='seconds'), 'us_date': us_d, 'tw_date': tw_d, 'edition': edition,
             'bar_date': tw_d if edition == 'tw' else us_d, 'slot': edition}

# 前台主圖
D['charts'] = {k: hist_pts(k) for k in ('SPX', 'SPY', 'QQQ', 'GOOGL', 'TW_TAIEX', 'TW_0050', 'SOX')}
D['charts']['rows20'] = {k: [[r[0][5:].replace('-', '/'), r[1], r[2], r[3], r[4]] for r in S.read_hist(k)[-20:]] for k in ('SPY', 'TW_TAIEX')}

# ---------- 加碼框架：追蹤標的的位置 ----------
tiers = [t['dd'] for t in M['ladder']]
vix_now = (closes('CBOE_VIX') or [(None, None)])[-1][1]
hold = []
for k in M['targets']:
    q = Q.get(k)
    if not q: continue
    cl = closes(k); eps, cur = episodes(cl)
    hit = [t for t in M['ladder'] if cur['depth'] is not None and cur['depth'] <= t['dd']]
    nxt = next((t for t in M['ladder'] if t not in hit), None)   # 同一段回撤裡每階只執行一次：下一階＝還沒觸發的第一階
    hold.append({'key': k, 'name': q.get('name'), 'c': q['c'], 'd': q['d'], 'ath': q['ath'], 'ath_d': q['ath_d'], 'dd': q['dd_ath'], 'ep_low': cur['depth'],
                 'ep_days': cur['days'], 'hit': [t['dd'] for t in hit], 'used': sum(t['add'] for t in hit),
                 'next': None if not nxt else {'dd': nxt['dd'], 'add': nxt['add'], 'px': r2(q['ath'] * (1 + nxt['dd'] / 100)), 'dist': r2(pct(q['ath'] * (1 + nxt['dd'] / 100), q['c']), 1)},
                 'levels': [{'dd': t['dd'], 'add': t['add'], 'px': r2(q['ath'] * (1 + t['dd'] / 100))} for t in M['ladder']],
                 'sma200': q['sma200'], 'dev200': q['dev200'], 'rsi': q['rsi'], 'regime': q['regime'], 'hist_from': q['hist_from'],
                 'uw': underwater(cl)[-760:]})
D['position'] = {'targets': hold, 'vix': r2(vix_now), 'accel_on': bool(vix_now and vix_now >= M['accel']['vix'])}

bt = []
for b in M['backtest']:
    key = b['key']; cl = closes(key)
    if len(cl) < 2000 and b.get('fallback'): key = b['fallback']; cl = closes(key)
    if len(cl) < 500: errors.append(f'回測 {b["name"]}: 歷史不足'); continue
    eps, cur = episodes(cl)
    bt.append({'key': key, 'name': b['name'], 'from': cl[0][0], 'to': cl[-1][0], 'tiers': tier_test(cl, tiers),
               'episodes': [{k: e[k] for k in ('peak', 'trough', 'depth', 'down_days', 'up_days', 'rec') if k in e} | ({'ongoing': True, 'now': e['now']} if e.get('ongoing') else {}) for e in eps][-16:],
               'cur': {k: cur[k] for k in ('peak', 'trough', 'depth', 'now', 'down_days', 'days')}, 'paths': paths(cl, eps, cur)})
D['position']['backtest'] = bt

# ---------- 宏觀 ----------
ust = S.read_hist('UST'); mac = {}
if ust:
    T = S.UST_COLS; col = lambda name: T.index(name) + 1
    last = ust[-1]
    def row_ago(days):
        tgt = dn(last[0]) - days; return min(ust, key=lambda r: abs(dn(r[0]) - tgt))
    mac['curve'] = {'tenors': T, 'now': [last[0]] + last[1:], 'm1': (lambda r: [r[0]] + r[1:])(row_ago(30)), 'y1': (lambda r: [r[0]] + r[1:])(row_ago(365))}
    cut = dn(last[0]) - 3 * 365
    sel = [r for r in ust if dn(r[0]) >= cut]
    mac['y10'] = [[dn(r[0]), r[col('10 Yr')]] for r in sel if r[col('10 Yr')] is not None]
    mac['y2'] = [[dn(r[0]), r[col('2 Yr')]] for r in sel if r[col('2 Yr')] is not None]
    mac['y3m'] = [[dn(r[0]), r[col('3 Mo')]] for r in sel if r[col('3 Mo')] is not None]
    mac['s10_2'] = [[dn(r[0]), r2(r[col('10 Yr')] - r[col('2 Yr')])] for r in sel if r[col('10 Yr')] is not None and r[col('2 Yr')] is not None]
    mac['s10_3m'] = [[dn(r[0]), r2(r[col('10 Yr')] - r[col('3 Mo')])] for r in sel if r[col('10 Yr')] is not None and r[col('3 Mo')] is not None]
    g = lambda name, r=last: r[col(name)]
    mac['last'] = {'d': last[0], 'y3m': g('3 Mo'), 'y2': g('2 Yr'), 'y10': g('10 Yr'), 'y30': g('30 Yr'), 'y10_1m': r2(g('10 Yr') - g('10 Yr', row_ago(30))) if g('10 Yr', row_ago(30)) is not None else None,
                   's10_2': r2(g('10 Yr') - g('2 Yr')), 's10_3m': r2(g('10 Yr') - g('3 Mo'))}
for sid, name in U['fred'].items():
    s = series('FRED_' + sid)
    if not s: errors.append(f'FRED {sid}: 沒有資料'); continue
    v10 = [x for d, x in s if d >= (dt.date.fromisoformat(s[-1][0]) - dt.timedelta(days=3650)).isoformat()]
    cut = dn(s[-1][0]) - 3 * 365
    x1m = min(s, key=lambda r: abs(dn(r[0]) - (dn(s[-1][0]) - 30)))[1]
    mac[sid] = {'name': name, 'd': s[-1][0], 'v': s[-1][1], 'chg1m': r2(s[-1][1] - x1m, 3), 'pct10y': r2(sum(x <= s[-1][1] for x in v10) / len(v10) * 100, 0),
                'hist': [[dn(d), x] for d, x in s if dn(d) >= cut]}
D['macro'] = mac

# ---------- 情緒 ----------
sen = {}
vx = {s: closes('CBOE_' + s) for s in U['vix']}
if vx.get('VIX'):
    term = {s: (vx[s][-1] if vx[s] else None) for s in U['vix']}
    sen['term'] = [{'k': s, 'd': term[s][0] if term[s] else None, 'v': term[s][1] if term[s] else None} for s in U['vix']]
    m1 = {s: (min(vx[s], key=lambda r: abs(dn(r[0]) - (dn(vx[s][-1][0]) - 30))) if vx[s] else None) for s in U['vix']}
    sen['term_m1'] = [{'k': s, 'v': m1[s][1] if m1[s] else None} for s in U['vix']]
    v = [c for _, c in vx['VIX']]; v1 = v[-252:]; vlast = v[-1]
    sen['vix'] = {'d': vx['VIX'][-1][0], 'v': vlast, 'chg': r2(vlast - v[-2]), 'pct1y': r2(sum(x <= vlast for x in v1) / len(v1) * 100, 0),
                  'pct_all': r2(sum(x <= vlast for x in v) / len(v) * 100, 0), 'median_all': r2(st.median(v), 1), 'since': vx['VIX'][0][0],
                  'ratio_3m': r2(vlast / term['VIX3M'][1], 3) if term.get('VIX3M') else None}
    b3 = dict(vx.get('VIX3M') or []); cut = dn(vx['VIX'][-1][0]) - 760
    sen['vix_hist'] = [[dn(d), c] for d, c in vx['VIX'] if dn(d) >= cut]
    sen['ratio_hist'] = [[dn(d), r2(c / b3[d], 3)] for d, c in vx['VIX'] if dn(d) >= cut and b3.get(d)]
if snap.get('fng'): sen['fng'] = dict(snap['fng'], hist=[[dn(d), x] for d, x in snap['fng'].get('hist', [])])
rsp, spy = dict(closes('RSP')), closes('SPY')
cut = dn(spy[-1][0]) - 3 * 365 if spy else 0
rs = [[dn(d), r2(rsp[d] / c * 100, 3)] for d, c in spy if d in rsp and dn(d) >= cut]
if rs: sen['rsp_spy'] = {'hist': rs, 'chg3m': r2(pct(rs[-1][1], rs[-64][1] if len(rs) > 64 else None), 1), 'chg1y': r2(pct(rs[-1][1], rs[-253][1] if len(rs) > 253 else None), 1)}
secs = [u['sym'] for u in U['us'] if u['kind'] == 'sector' and u['sym'] not in ('SMH', 'IGV')]
above = [s for s in secs if Q.get(s) and Q[s]['dev200'] is not None and Q[s]['dev200'] > 0]
stk = [k for k, q in Q.items() if q and q.get('kind') == 'stock']
sen['breadth'] = {'sectors_above200': len(above), 'sectors_n': len(secs), 'stocks_above200': sum(1 for k in stk if (Q[k]['dev200'] or -1) > 0), 'stocks_n': len(stk)}
D['sentiment'] = sen

# ---------- 板塊 ----------
spy_cl = closes('SPY'); sec_out = []
for u in U['us']:
    if u['kind'] != 'sector' or not Q.get(u['sym']): continue
    q = Q[u['sym']]; p = rrg(closes(u['sym']), spy_cl)
    sec_out.append({'sym': u['sym'], 'name': u['name'], **{k: q[k] for k in ('c', 'chg_pct', 'r1w', 'r1m', 'r3m', 'ytd', 'r1y', 'dev200', 'rsi')}, 'rrg': p, 'quad': quadrant(p)})
tw_sect = {}
for d, name, c in S.read_hist('TW_SECT', 2):
    if c is not None: tw_sect.setdefault(name, []).append((d, c))
taiex = closes('TW_TAIEX'); tws = []
for name, cl in tw_sect.items():
    cl.sort()
    if len(cl) < 5: continue
    v = [c for _, c in cl]; p = rrg(cl, taiex)
    tws.append({'name': name.replace('類指數', ''), 'd': cl[-1][0], 'c': cl[-1][1], 'chg_pct': r2(pct(v[-1], v[-2])), 'r1w': r2(pct(v[-1], ago(cl, 5))), 'r1m': r2(pct(v[-1], ago(cl, 21))),
                'r3m': r2(pct(v[-1], ago(cl, 63))), 'rrg': p, 'quad': quadrant(p)})
D['sectors'] = {'us': sec_out, 'tw': sorted(tws, key=lambda x: -(x['r1m'] or -999))}

# ---------- 台股 ----------
tw = {}
inst = S.read_hist('TW_INST')
if inst:
    tw['inst'] = [[r[0], r[1], r[2], r[3], r[4]] for r in inst[-60:]]
    f = [r[1] or 0 for r in inst]
    tw['inst_sum'] = {'d': inst[-1][0], 'f1': inst[-1][1], 'f5': r2(sum(f[-5:])), 'f20': r2(sum(f[-20:])), 't5': r2(sum((r[2] or 0) for r in inst[-5:])), 'streak': 0}
    k = 0
    for x in reversed(f):
        if x == 0 or (k and (x > 0) != (k > 0)): break
        k += 1 if x > 0 else -1
    tw['inst_sum']['streak'] = k
mg = S.read_hist('TW_MARGIN')
if mg:
    tw['margin'] = [[dn(r[0]), r[1]] for r in mg[-130:] if r[1] is not None]
    v = [r[1] for r in mg if r[1] is not None]
    tw['margin_last'] = {'d': mg[-1][0], 'v': v[-1], 'chg1d': r2(v[-1] - v[-2]) if len(v) > 1 else None, 'chg20': r2(pct(v[-1], v[-21]) if len(v) > 21 else None, 1)}
fut = S.read_hist('TW_FUT')
if fut:
    tw['fut'] = [[dn(r[0]), r[1]] for r in fut[-130:]]
    tw['fut_last'] = {'d': fut[-1][0], 'oi': fut[-1][1], 'amt': fut[-1][2], 'chg5': r2(fut[-1][1] - fut[-6][1], 0) if len(fut) > 5 else None}
val, rev, nav = snap.get('tw_val') or {}, snap.get('tw_rev') or {}, snap.get('tw_nav') or {}
for u in U['tw']:
    q = Q.get('TW_' + u['sym'])
    if not q: continue
    if u['sym'] in val: q.update({k: val[u['sym']][k] for k in ('pe', 'yield', 'pb')})
    if u['sym'] in rev: q['rev'] = rev[u['sym']]
    if u['sym'] in nav: q['nav'] = nav[u['sym']]
# 台積電 ADR 溢價：TSM（1 ADR = 5 股）× 匯率 ÷ 2330
fx = dict(series('FRED_DEXTAUS')); tsm = dict(closes('TSM')); t2330 = closes('TW_2330')
if fx and tsm and t2330:
    fxd = sorted(fx); prem = []; j = 0; last_fx = None
    for d, c in t2330:
        while j < len(fxd) and fxd[j] <= d: last_fx = fx[fxd[j]]; j += 1
        if d in tsm and last_fx: prem.append([dn(d), r2((tsm[d] / 5 * last_fx / c - 1) * 100, 1)])
    if prem: tw['adr'] = {'hist': prem[-260:], 'v': prem[-1][1], 'fx': last_fx, 'fx_d': fxd[-1] if fxd else None}
D['taiwan'] = tw

# ---------- 重點追蹤：本刊追蹤標的（指數 ETF 與基金），不代表任何人持有 ----------
def wk_ret(key, weeks=53):
    o = {}
    for d, c in closes(key):
        y, w, _ = dt.date.fromisoformat(d).isocalendar(); o[(y, w)] = c
    ks = sorted(o)[-(weeks + 1):]
    return {ks[i]: math.log(o[ks[i]] / o[ks[i - 1]]) for i in range(1, len(ks))}


def corr(a, b):
    c = [k for k in a if k in b]
    if len(c) < 20: return None
    x = [a[k] for k in c]; y = [b[k] for k in c]; mx, my = st.mean(x), st.mean(y)
    den = math.sqrt(sum((p - mx) ** 2 for p in x) * sum((q - my) ** 2 for q in y))
    return r2(sum((p - mx) * (q - my) for p, q in zip(x, y)) / den) if den else None


def risk(key, days=756):
    cl = closes(key)[-days:]
    if len(cl) < 60: return {}
    v = [c for _, c in cl]; pk = v[0]; mdd = 0
    for c in v: pk = max(pk, c); mdd = min(mdd, c / pk - 1)
    rets = [math.log(v[i] / v[i - 1]) for i in range(max(1, len(v) - 252), len(v))]
    yrs = (dt.date.fromisoformat(cl[-1][0]) - dt.date.fromisoformat(cl[0][0])).days / 365.25
    return {'vol1y': r2(st.stdev(rets) * math.sqrt(252) * 100, 1), 'mdd3y': r2(mdd * 100, 1), 'cagr3y': r2(((v[-1] / v[0]) ** (1 / yrs) - 1) * 100, 1) if yrs >= 2.9 else None}


import re
def norm(n):   # 前十大持股名稱正規化，用來比對重疊（英文去掉公司字尾）
    n = (n or '').upper().replace('*', '')
    n = re.sub(r'[.,]|\b(INC|CORP|CORPORATION|CO|LTD|LIMITED|ORD|PLC|HOLDINGS?|GROUP|THE)\b|-?\s*CL(ASS)?\s*[AB]\b|-\s*CLASS A', ' ', n)
    return ' '.join(n.split())


FDESC = U.get('focus_desc', {})
sf = snap.get('funds') or {}
focus = []
for k in U.get('focus', []):
    q = Q.get(k)
    if not q: continue
    f = FUNDS.get(k, {}); meta = (sf.get(k) or {})
    focus.append({'key': k, 'code': f.get('isin') or k.replace('TW_', ''), 'name': f.get('name') or q.get('name'), 'full': f.get('full') or q.get('name'), 'region': f.get('region'), 'style': f.get('style'),
                  'desc': f.get('desc') or FDESC.get(k), 'type': 'fund' if f else 'etf', 'ccy': f.get('ccy') or ('TWD' if k.startswith('TW_') else 'USD'),
                  'info': meta.get('info'), 'hold': meta.get('hold'), 'risk': risk(k), 'hist': hist_pts(k, 400)})
W = {x['key']: wk_ret(x['key']) for x in focus}
cm = [[corr(W[a['key']], W[b['key']]) for b in focus] for a in focus]
ov = []
for i, a in enumerate(focus):
    for b in focus[i + 1:]:
        ha = {norm(h['en'] or h['name']): h for h in ((a.get('hold') or {}).get('top') or [])}
        hb = {norm(h['en'] or h['name']): h for h in ((b.get('hold') or {}).get('top') or [])}
        hb.update({norm(h['name']): h for h in ((b.get('hold') or {}).get('top') or [])})
        common = [(ha[n]['name'], min(ha[n]['w'], hb[n]['w'])) for n in ha if n in hb]
        if common: ov.append({'a': a['key'], 'b': b['key'], 'n': len(common), 'w': r2(sum(w for _, w in common), 1), 'names': [c[0] for c in sorted(common, key=lambda x: -x[1])]})
# 規則讀值：同一套公開規則套在每一檔上（加碼框架＋200 日線乖離＋RSI），不是個別的買賣建議
HT = M.get('heat', {}); TG = {h['key']: h for h in D['position']['targets']}
for x in focus:
    q = Q[x['key']]; h = TG.get(x['key']) or {}; dev, rsi_, dd = q.get('dev200'), q.get('rsi'), q.get('dd_ath')
    sig = []
    hit = h.get('hit') or []
    if hit and dd is not None and dd <= max(hit): sig.append({'k': 'zone', 'tone': 'pos', 'label': '加碼區', 'say': f"距高點 {dd:.1f}%，位於第 1 階（{M['ladder'][0]['dd']}%）之下；這段回撤（{h.get('ath_d')} 高點起）已觸發 {len(hit)} 階、最深 {h.get('ep_low')}%"})
    elif h.get('next') and h['next']['dist'] is not None and h['next']['dist'] > -HT.get('near_tier', 2):
        sig.append({'k': 'near', 'tone': 'warn', 'label': '接近加碼階', 'say': f"再跌 {abs(h['next']['dist']):.1f}% 到 {h['next']['dd']}% 階（{h['next']['px']}）"})
    if dev is not None and dev >= HT.get('hot_dev200', 30): sig.append({'k': 'hot', 'tone': 'neg', 'label': '過熱', 'say': f"高於 200 日線 {dev:.1f}%（≥ {HT.get('hot_dev200')}%）"})
    elif dev is not None and dev >= HT.get('warm_dev200', 20): sig.append({'k': 'warm', 'tone': 'warn', 'label': '偏熱', 'say': f"高於 200 日線 {dev:.1f}%（≥ {HT.get('warm_dev200')}%）"})
    if rsi_ is not None and rsi_ >= HT.get('rsi_hot', 70): sig.append({'k': 'rsi', 'tone': 'warn', 'label': '短線超買', 'say': f"RSI {rsi_:.0f}（≥ {HT.get('rsi_hot')}）"})
    if dev is not None and dev < 0: sig.append({'k': 'below', 'tone': 'warn', 'label': '跌破長期均線', 'say': f"低於 200 日線 {abs(dev):.1f}%" + ('，均線仍上升' if q.get('sma200_up') else '，均線已走平或下降')})
    if not sig: sig.append({'k': 'neutral', 'tone': 'neu', 'label': '中性', 'say': f"距高點 {dd:.1f}%、高於 200 日線 {dev:.1f}%，沒有觸發任何規則" if dd is not None and dev is not None else '沒有觸發任何規則'})
    sma = q.get('sma200')
    lv = [{'k': 'tier', 'label': f"加碼 {t['dd']}% 階", 'px': t['px'], 'hit': t['dd'] in hit} for t in (h.get('levels') or [])]
    if sma: lv += [{'k': 'sma', 'label': '200 日線', 'px': r2(sma)}, {'k': 'warm', 'label': f"偏熱線（200 日線 +{HT.get('warm_dev200')}%）", 'px': r2(sma * (1 + HT.get('warm_dev200', 20) / 100))}, {'k': 'hot', 'label': f"過熱線（200 日線 +{HT.get('hot_dev200')}%）", 'px': r2(sma * (1 + HT.get('hot_dev200', 30) / 100))}]
    lv += [{'k': 'hi', 'label': '52 週高點', 'px': q.get('hi52')}, {'k': 'lo', 'label': '52 週低點', 'px': q.get('lo52')}, {'k': 'ath', 'label': f"歷史高點（{q.get('ath_d')}）", 'px': q.get('ath')}]
    x['rule'] = {'state': sig[0], 'signals': sig, 'levels': sorted([l for l in lv if l['px']], key=lambda l: -l['px']), 'next': h.get('next'), 'hit': hit, 'ep_low': h.get('ep_low'), 'rsi': rsi_, 'dev200': dev, 'c': q.get('c')}
D['heat_note'] = HT.get('note')

D['focus'] = {'ids': [x['key'] for x in focus], 'items': focus, 'corr': cm, 'overlap': sorted(ov, key=lambda x: -x['w'])}

# ---------- 資料狀態 ----------
def last_d(key, keyn=1):
    r = S.read_hist(key, keyn); return r[-1][0] if r else None
health = [['美股（Nasdaq）', last_d('SPY')], ['S&P 500 指數（FRED）', last_d('SPX')], ['VIX（CBOE）', last_d('CBOE_VIX')], ['美債殖利率（財政部）', last_d('UST')],
          ['高收益債利差（FRED）', last_d('FRED_BAMLH0A0HYM2')], ['美元兌台幣（FRED）', last_d('FRED_DEXTAUS')], ['台股（證交所）', last_d('TW_TAIEX')],
          ['三大法人', last_d('TW_INST')], ['融資餘額', last_d('TW_MARGIN')], ['外資台指期（期交所）', last_d('TW_FUT')], ['類股指數', last_d('TW_SECT', 2)],
          ['恐懼貪婪（CNN）', (snap.get('fng') or {}).get('d')], ['基金淨值（鉅亨網）', min([last_d(k) for k in FUNDS] or [None])]]
D['health'] = [{'name': n, 'd': d} for n, d in health]
D['errors'] = errors
json.dump(D, open(os.path.join(ROOT, 'data', 'latest.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
print('latest.json', os.path.getsize(os.path.join(ROOT, 'data', 'latest.json')) // 1024, 'KB；edition', edition, '；errors', len(errors))
for e in errors: print(' -', e)
