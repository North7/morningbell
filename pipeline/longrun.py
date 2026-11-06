#!/usr/bin/env python3
"""長線視角（2026-11-06）：data/hist/ → data/longrun.json（網站打開「長線視角」版時才載入）。
不打任何 API。圖的構想參考自老錢日日談 Big Picture 看板，資料與程式都是本站自己的。
- 每個指數：週線、±20% 牛熊週期、年度報酬與年內最大回撤、年末收盤（跨年矩陣）、月報酬、20／60 日波動率、滾動報酬、牛市路徑
- 共用：VIX ≥ 30 的恐慌期間、席勒本益比、每股盈餘、改良版巴菲特指標、痛苦指數、七巨頭等權指數"""
import datetime as dt, json, math, os, statistics as st, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sources as S

ROOT = S.ROOT
dn = lambda d: (dt.date.fromisoformat(d) - dt.date(1970, 1, 1)).days
r2 = lambda x, k=2: None if x is None else round(x, k)


def closes(key): return [(r[0], r[4]) for r in S.read_hist(key) if r[4]]
def series(key): return [(r[0], r[1]) for r in S.read_hist(key) if len(r) > 1 and r[1] is not None]


def weekly(cl):
    o = {}
    for d, c in cl:
        y, w, _ = dt.date.fromisoformat(d).isocalendar(); o[(y, w)] = (d, c)
    return [o[k] for k in sorted(o)]


def cycles(cl, th=20):
    """±20% 牛熊：多頭中從高點跌 20% → 高點那天是牛市終點、熊市起點；空頭中從低點漲 20% → 低點那天是熊市終點、牛市起點。"""
    out, mode, ext_i, start_i = [], 'bull', 0, 0
    for i in range(1, len(cl)):
        c = cl[i][1]
        if mode == 'bull':
            if c > cl[ext_i][1]: ext_i = i
            elif c <= cl[ext_i][1] * (1 - th / 100):
                out.append(seg('bull', cl, start_i, ext_i)); mode, start_i, ext_i = 'bear', ext_i, i
        else:
            if c < cl[ext_i][1]: ext_i = i
            elif c >= cl[ext_i][1] * (1 + th / 100):
                out.append(seg('bear', cl, start_i, ext_i)); mode, start_i, ext_i = 'bull', ext_i, i
    cur = seg(mode, cl, start_i, len(cl) - 1); cur['ongoing'] = True
    cur['ext'] = cl[ext_i][0]; cur['ext_px'] = r2(cl[ext_i][1]); out.append(cur)
    return out


def seg(kind, cl, a, b):
    return {'k': kind, 's': cl[a][0], 'e': cl[b][0], 'chg': r2((cl[b][1] / cl[a][1] - 1) * 100, 1), 'days': b - a,
            'cal': (dt.date.fromisoformat(cl[b][0]) - dt.date.fromisoformat(cl[a][0])).days}


def annual(cl):
    by = {}
    for d, c in cl: by.setdefault(int(d[:4]), []).append(c)
    ys = sorted(by); out, ye = [], []
    for i, y in enumerate(ys):
        v = by[y]; ye.append([y, r2(v[-1])])
        if i == 0: continue
        prev = by[ys[i - 1]][-1]; pk = prev; mdd = 0
        for c in v: pk = max(pk, c); mdd = min(mdd, c / pk - 1)
        out.append({'y': y, 'ret': r2((v[-1] / prev - 1) * 100, 1), 'dd': r2(mdd * 100, 1), 'part': y == ys[-1]})
    return out, ye


def monthly(cl):
    by = {}
    for d, c in cl: by[(int(d[:4]), int(d[5:7]))] = c
    ks = sorted(by); return [[k[0], k[1], r2((by[k] / by[ks[i - 1]] - 1) * 100, 2)] for i, k in enumerate(ks) if i]


def vol(cl, step=5):
    lr = [0.0] + [math.log(cl[i][1] / cl[i - 1][1]) for i in range(1, len(cl))]
    out = []
    for i in range(60, len(cl), step):
        v20 = st.stdev(lr[i - 19:i + 1]) * math.sqrt(252) * 100; v60 = st.stdev(lr[i - 59:i + 1]) * math.sqrt(252) * 100
        out.append([dn(cl[i][0]), r2(v20, 1), r2(v60, 1)])
    if out and out[-1][0] != dn(cl[-1][0]):
        i = len(cl) - 1; out.append([dn(cl[i][0]), r2(st.stdev(lr[i - 19:i + 1]) * math.sqrt(252) * 100, 1), r2(st.stdev(lr[i - 59:i + 1]) * math.sqrt(252) * 100, 1)])
    return out


def rolling(cl):
    """月底取樣，往回看 1／5／10／20 年的年化報酬（只算價格）。"""
    me = {}
    for d, c in cl: me[d[:7]] = (d, c)
    m = [me[k] for k in sorted(me)]; out = []
    for i in range(12, len(m)):
        row = [dn(m[i][0])]
        for yrs in (1, 5, 10, 20):
            j = i - yrs * 12
            row.append(r2(((m[i][1] / m[j][1]) ** (1 / yrs) - 1) * 100, 1) if j >= 0 else None)
        out.append(row)
    return out


def bull_paths(cl, cyc, since, step=5):
    idx = {d: i for i, (d, _) in enumerate(cl)}; out = []
    for c in cyc:
        if c['k'] != 'bull' or c['s'] < since: continue
        a, b = idx[c['s']], idx[c['e']]; base = cl[a][1]
        out.append({'s': c['s'], 'e': c['e'], 'chg': c['chg'], 'days': c['days'], 'ongoing': c.get('ongoing', False),
                    'pts': [r2((cl[k][1] / base - 1) * 100, 1) for k in range(a, b + 1, step)] + ([r2((cl[b][1] / base - 1) * 100, 1)] if (b - a) % step else [])})
    return out


def pack(key, name, since_bull):
    cl = closes(key)
    if len(cl) < 600: return None
    cyc = cycles(cl); ann, ye = annual(cl)
    return {'key': key, 'name': name, 'from': cl[0][0], 'to': cl[-1][0], 'last': r2(cl[-1][1]),
            'weekly': [[dn(d), r2(c)] for d, c in weekly(cl)], 'cycles': cyc, 'annual': ann, 'year_end': ye,
            'monthly': monthly(cl), 'vol': vol(cl), 'rolling': rolling(cl), 'bulls': bull_paths(cl, cyc, since_bull)}


L = {'generated_utc': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'), 'idx': []}
spx = 'SPX_LONG' if len(closes('SPX_LONG')) > 2000 else 'SPX'
for key, name, since in ((spx, 'S&P 500', '1949-01-01'), ('NDX_LONG', '那斯達克 100', '1986-01-01'), ('TW_TAIEX', '台股加權指數', '2000-01-01')):
    p = pack(key, name, since)
    if p: L['idx'].append(p)

# VIX ≥ 30 連續 5 個交易日以上的恐慌期間
vx = closes('CBOE_VIX'); per, i = [], 0
while i < len(vx):
    if vx[i][1] >= 30:
        j = i
        while j + 1 < len(vx) and vx[j + 1][1] >= 30: j += 1
        if j - i + 1 >= 5: per.append([dn(vx[i][0]), dn(vx[j][0]), r2(max(c for _, c in vx[i:j + 1]), 1)])
        i = j + 1
    else: i += 1
L['vix30'] = per
L['vix_weekly'] = [[dn(d), r2(c, 1)] for d, c in weekly(vx)]

# 席勒本益比與每股盈餘（multpl 月資料）
cape = series('MULTPL_CAPE')
if cape:
    v = [x for _, x in cape]; now = v[-1]
    L['cape'] = {'hist': [[dn(d), x] for d, x in cape], 'now': now, 'd': cape[-1][0], 'mean': r2(st.mean(v), 1), 'median': r2(st.median(v), 1),
                 'pct': r2(sum(x <= now for x in v) / len(v) * 100, 0), 'mean_1990': r2(st.mean([x for d, x in cape if d >= '1990']), 1)}
eps = series('MULTPL_EPS')
if eps: L['eps'] = {'hist': [[dn(d), x] for d, x in eps if d >= '1950'], 'd': eps[-1][0], 'now': eps[-1][1]}

# 改良版巴菲特指標：企業股權市值 ÷（GDP ＋ Fed 總資產）。分子是 FRED 的非金融企業股權市值（季），GDP 季（十億），Fed 資產週（百萬）取季平均
eq, gdp, wal = dict(series('FRED_NCBEILQ027S')), dict(series('FRED_GDP')), series('FRED_WALCL')
if eq and gdp:
    qa = {}
    for d, x in wal: q = f"{d[:4]}-{(int(d[5:7]) - 1) // 3 * 3 + 1:02d}-01"; qa.setdefault(q, []).append(x)
    rows = []
    for d in sorted(eq):
        if d not in gdp: continue
        fed = st.mean(qa[d]) if d in qa else 0
        rows.append([dn(d), r2(eq[d] / (gdp[d] * 1000 + fed) * 100, 1), r2(eq[d] / (gdp[d] * 1000) * 100, 1)])
    if rows:
        v = [r[1] for r in rows]
        L['buffett'] = {'hist': rows, 'now': v[-1], 'd': sorted(set(eq) & set(gdp))[-1], 'mean': r2(st.mean(v), 1), 'pct': r2(sum(x <= v[-1] for x in v) / len(v) * 100, 0)}

# 痛苦指數：CPI 年增率 ＋ 失業率
cpi, un = series('FRED_CPIAUCSL'), dict(series('FRED_UNRATE'))
if cpi and un:
    cd = dict(cpi); rows = []
    for d, x in cpi:
        y0 = f"{int(d[:4]) - 1}{d[4:]}"
        if y0 in cd and d in un:
            inf = (x / cd[y0] - 1) * 100; rows.append([dn(d), r2(inf + un[d], 1), r2(inf, 1), un[d]])
    if rows: L['misery'] = {'hist': rows, 'now': rows[-1][1], 'd': cpi[-1][0], 'mean': r2(st.mean(r[1] for r in rows), 1)}

# 七巨頭等權指數 vs S&P 500（週線，起點＝100）
M7 = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA']
ws = {k: dict(weekly(closes(k))) for k in M7 + ['SPY']}
common = sorted(set.intersection(*[set(v) for v in ws.values()]))
if common:
    idx, spy, out = 100.0, 100.0, []
    for i, d in enumerate(common):
        if i:
            p = common[i - 1]
            idx *= 1 + st.mean(ws[k][d] / ws[k][p] - 1 for k in M7); spy *= ws['SPY'][d] / ws['SPY'][p]
        out.append([dn(d), r2(idx, 1), r2(spy, 1)])
    L['m7'] = {'hist': out, 'from': common[0]}

json.dump(L, open(os.path.join(ROOT, 'data', 'longrun.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
print('longrun.json', os.path.getsize(os.path.join(ROOT, 'data', 'longrun.json')) // 1024, 'KB；指數', [x['name'] for x in L['idx']])
