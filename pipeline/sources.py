"""晨鐘 Morningbell — 資料來源。全部是免費、不需金鑰的公開端點；任何一個失敗只回傳 None，由呼叫端記進 errors。
歷史資料存在 data/hist/*.csv（d,o,h,l,c,v），每天只抓最近一段合併進去，所以某天沒跑也會自動補齊。"""
import csv, json, os, subprocess, time, datetime as dt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HIST = os.path.join(ROOT, 'data', 'hist')
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'


def get(url, data=None, timeout=40, raw=False, enc='utf-8', ua=True, http1=False):
    # FRED 會擋偽裝成瀏覽器的請求（實測帶 Chrome UA 會逾時），所以 ua=False 用 curl 預設
    cmd = ['curl', '-sSL', '--max-time', str(timeout)] + (['-A', ua] if isinstance(ua, str) else []) + (['-A', UA, '-H', 'Accept: application/json, text/plain, */*', '-H', 'Accept-Language: zh-TW,zh;q=0.9,en;q=0.8'] if ua is True else [])
    if http1: cmd.append('--http1.1')   # Nasdaq 的 HTTP/2 偶爾中途斷線
    if data: cmd += ['-X', 'POST', '--data', data]
    r = subprocess.run(cmd + [url], capture_output=True)
    if r.returncode != 0: raise RuntimeError(f'curl {r.returncode}: {r.stderr.decode(errors="ignore")[:120]}')
    out = r.stdout.decode(enc, errors='replace')
    if raw: return out
    s = out.strip()
    if not s.startswith(('{', '[')): raise RuntimeError('非 JSON 回應：' + s[:80].replace('\n', ' '))
    return json.loads(s)


def num(x):
    if x is None: return None
    s = str(x).replace(',', '').replace('$', '').replace('+', '').strip()
    if s in ('', '--', '---', 'N/A', '.', 'X0.00'): return None
    try: return float(s)
    except ValueError: return None


def roc(s):   # 民國日期 115/09/01 → 2026-09-01
    y, m, d = s.strip().split('/'); return f'{int(y) + 1911:04d}-{int(m):02d}-{int(d):02d}'


# ---------- 歷史檔 ----------
def hist_path(key): return os.path.join(HIST, key + '.csv')


def read_hist(key, keyn=1):
    """keyn：前幾欄是鍵（日期；長格式如類股指數再加名稱），其餘轉成數字。"""
    p = hist_path(key)
    if not os.path.exists(p): return []
    with open(p) as f:
        rd = csv.reader(f); head = next(rd, None)
        return [r[:keyn] + [num(x) for x in r[keyn:]] for r in rd if r]


def merge_hist(key, rows, head=('d', 'o', 'h', 'l', 'c', 'v'), keyn=1):
    """rows：[[d, ...]]；同一天（同鍵）以新資料覆蓋。回傳合併後的筆數。"""
    os.makedirs(HIST, exist_ok=True)
    K = lambda r: tuple(r[:keyn])
    cur = {K(r): r for r in read_hist(key, keyn)}
    for r in rows:
        if r and r[0] and any(v is not None for v in r[keyn:]): cur[K(r)] = r
    out = [cur[k] for k in sorted(cur)]
    with open(hist_path(key), 'w', newline='') as f:
        w = csv.writer(f); w.writerow(head)
        for r in out: w.writerow(list(r[:keyn]) + ['' if v is None else (round(v, 4) if isinstance(v, float) else v) for v in r[keyn:]])
    return len(out)


# ---------- 美股：Nasdaq（股票、ETF、指數） ----------
def nasdaq(sym, src, frm, to=None):
    # 起日落在週末會回「Something went wrong」，所以往前挪到週五；最多只給最近 10 年
    f = dt.date.fromisoformat(frm)
    while f.weekday() > 4: f -= dt.timedelta(days=1)
    to = to or dt.date.today().isoformat()
    u = f'https://api.nasdaq.com/api/quote/{sym}/historical?assetclass={src}&fromdate={f}&todate={to}&limit=9999'
    for k in range(3):
        try:
            j = get(u, http1=True)
            if (j.get('data') or {}).get('tradesTable'): break
        except Exception:
            if k == 2: raise
        time.sleep(3)
    t = ((j or {}).get('data') or {}).get('tradesTable') or {}
    rows = []
    for r in t.get('rows') or []:
        m, d, y = r['date'].split('/')
        rows.append([f'{y}-{m}-{d}', num(r.get('open')), num(r.get('high')), num(r.get('low')), num(r.get('close')), num(r.get('volume'))])
    if not rows: raise RuntimeError(f'nasdaq {sym} 無資料')
    return sorted(rows)


# ---------- CBOE：VIX 期限結構 ----------
def cboe(sym):
    txt = get(f'https://cdn.cboe.com/api/global/us_indices/daily_prices/{sym}_History.csv', raw=True)
    rows = []
    for line in txt.strip().splitlines()[1:]:
        p = line.split(',')
        if len(p) < 5: continue
        m, d, y = p[0].split('/')
        rows.append([f'{y}-{int(m):02d}-{int(d):02d}', num(p[1]), num(p[2]), num(p[3]), num(p[4]), None])
    if not rows: raise RuntimeError(f'cboe {sym} 無資料')
    return rows


# ---------- 美國財政部：殖利率曲線 ----------
UST_COLS = ['1 Mo', '3 Mo', '6 Mo', '1 Yr', '2 Yr', '3 Yr', '5 Yr', '7 Yr', '10 Yr', '20 Yr', '30 Yr']


def treasury(year):
    u = (f'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/{year}/all'
         f'?type=daily_treasury_yield_curve&field_tdr_date_value={year}&page&_format=csv')
    txt = get(u, raw=True)
    lines = list(csv.reader(txt.strip().splitlines()))
    head = lines[0]; ix = [head.index(c) if c in head else None for c in UST_COLS]
    rows = []
    for r in lines[1:]:
        m, d, y = r[0].split('/')
        rows.append([f'{y}-{m}-{d}'] + [num(r[i]) if i is not None else None for i in ix])
    return rows


# ---------- FRED ----------
def fred(sid):
    txt = get(f'https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}', raw=True, ua=False)
    rows = []
    for line in txt.strip().splitlines()[1:]:
        p = line.split(',')
        if len(p) == 2 and num(p[1]) is not None: rows.append([p[0], num(p[1])])
    if not rows: raise RuntimeError(f'fred {sid} 無資料')
    return rows


# ---------- Yahoo：S&P 500 長歷史（1927 起） ----------
def yahoo(sym, days=None):
    """Yahoo 日線。Yahoo 會擋完整的瀏覽器 UA（429），用簡短的 Mozilla/5.0 才行。
    days=None：1928 年起全部（range=max 會變季線，所以用起訖時間）；days=N：最近 N 天，用來在收盤後立刻補上當天收盤——
    Nasdaq 與 CBOE 的歷史檔都要到隔天才有當天那根（2026-10-13 實測）。個股與 ETF 當天那根的收盤常是空的，改用 meta 的正規盤收盤價；
    還在盤中（現在早於正規盤結束）就不收當天那根，避免把盤中價格寫進歷史。"""
    import urllib.parse
    q = (f'range={days}d' if days else f'period1=-1325635200&period2={int(time.time()) + 86400}')
    j = get(f'https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}?{q}&interval=1d', ua='Mozilla/5.0', timeout=60)
    r = j['chart']['result'][0]; m = r.get('meta') or {}; qt = r['indicators']['quote'][0]
    ymd = lambda ts: dt.datetime.fromtimestamp(ts, dt.timezone.utc).strftime('%Y-%m-%d')
    rows = [[ymd(t), qt['open'][i], qt['high'][i], qt['low'][i], qt['close'][i], qt['volume'][i]] for i, t in enumerate(r.get('timestamp') or [])]
    reg = (m.get('currentTradingPeriod') or {}).get('regular') or {}
    if rows and reg.get('start') and rows[-1][0] == ymd(reg['start']):
        if time.time() < reg.get('end', 0): rows.pop()   # 盤中
        elif rows[-1][4] is None and m.get('regularMarketPrice') is not None:
            rows[-1] = [rows[-1][0], rows[-1][1], m.get('regularMarketDayHigh') or rows[-1][2], m.get('regularMarketDayLow') or rows[-1][3], m['regularMarketPrice'], m.get('regularMarketVolume') or rows[-1][5]]
    rows = [r_ for r_ in rows if r_[4] is not None]
    if not rows: raise RuntimeError(f'yahoo {sym} 無資料')
    return rows


# ---------- 證交所 OpenAPI（一次拿全市場） ----------
def tw_valuation():   # 本益比、殖利率、股價淨值比（個股，不含 ETF）
    j = get('https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL')
    return {r['Code']: {'pe': num(r.get('PEratio')), 'yield': num(r.get('DividendYield')), 'pb': num(r.get('PBratio')), 'd': r.get('Date')} for r in j}


def tw_revenue():   # 上市公司最新月營收
    j = get('https://openapi.twse.com.tw/v1/opendata/t187ap05_L')
    out = {}
    for r in j:
        ym = r.get('資料年月', '')
        out[r['公司代號']] = {'ym': f'{int(ym[:-2]) + 1911}-{ym[-2:]}' if len(ym) >= 4 else None,
                          'rev': num(r.get('營業收入-當月營收')), 'mom': num(r.get('營業收入-上月比較增減(%)')),
                          'yoy': num(r.get('營業收入-去年同月增減(%)')), 'ytd_yoy': num(r.get('累計營業收入-前期比較增減(%)'))}
    return out


def tw_etf_nav():   # ETF 市價、預估淨值、折溢價（盤後為收盤值）
    j = get('https://mis.twse.com.tw/stock/data/all_etf.txt')
    out = {}
    for blk in j.get('a1') or []:
        for r in blk.get('msgArray') or []:
            out[r['a']] = {'px': num(r.get('e')), 'nav': num(r.get('f')), 'prem': num(r.get('g')), 'd': r.get('i')}
    return out


# ---------- 期交所：三大法人台指期未平倉 ----------
def taifex_fut(start, end):   # 'YYYY/MM/DD'
    txt = get('https://www.taifex.com.tw/cht/3/futContractsDateDown', data=f'queryStartDate={start}&queryEndDate={end}&commodityId=TXF', raw=True, enc='big5')
    rows = []
    for line in txt.strip().splitlines()[1:]:
        p = line.split(',')
        if len(p) >= 15 and p[2].strip() == '外資及陸資':
            rows.append([p[0].replace('/', '-'), num(p[13]), round((num(p[14]) or 0) / 1e5, 2)])   # 淨未平倉口數、金額（億元）
    return rows
