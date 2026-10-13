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
    """Yahoo 會擋完整的瀏覽器 UA（429），用簡短的 Mozilla/5.0 才行；range=max 會自動變成季線，所以改用起訖時間。"""
    import urllib.parse
    p1 = -1325635200 if days is None else int(time.time()) - days * 86400   # 1928-01-01 起
    j = get(f'https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}?period1={p1}&period2={int(time.time()) + 86400}&interval=1d', ua='Mozilla/5.0', timeout=60)
    r = j['chart']['result'][0]; q = r['indicators']['quote'][0]
    ymd = lambda ts: dt.datetime.fromtimestamp(ts, dt.timezone.utc).strftime('%Y-%m-%d')
    return [[ymd(t), q['open'][i], q['high'][i], q['low'][i], q['close'][i], q['volume'][i]] for i, t in enumerate(r['timestamp']) if q['close'][i] is not None]


# ---------- 證交所（有流量限制：每 5 秒最多約 3 次，所以每次請求間隔 2.2 秒） ----------
_last = [0.0]


def twse(path, **q):
    wait = 2.2 - (time.time() - _last[0])
    if wait > 0: time.sleep(wait)
    qs = '&'.join(f'{k}={v}' for k, v in q.items())
    for k in range(3):
        _last[0] = time.time()
        try:
            j = get(f'https://www.twse.com.tw/rwd/zh/{path}?{qs}&response=json')
            return j
        except Exception:
            if k == 2: raise
            time.sleep(20 * (k + 1))


def tw_stock_month(code, ym):   # ym = '20260901'
    j = twse('afterTrading/STOCK_DAY', date=ym, stockNo=code)
    if j.get('stat') != 'OK': return []
    return [[roc(r[0]), num(r[3]), num(r[4]), num(r[5]), num(r[6]), num(r[1])] for r in j.get('data') or []]


def tpex_month(code, ym):   # 櫃買中心上櫃（債券 ETF 如 00679B）；成交量單位為張
    j = get(f'https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?code={code}&date={ym[:4]}/{ym[4:6]}/01&response=json')
    tb = (j.get('tables') or [{}])[0]
    return [[roc(r[0]), num(r[3]), num(r[4]), num(r[5]), num(r[6]), None if num(r[1]) is None else num(r[1]) * 1000] for r in tb.get('data') or []]


def taiex_month(ym):
    j = twse('TAIEX/MI_5MINS_HIST', date=ym)
    if j.get('stat') != 'OK': return []
    return [[roc(r[0]), num(r[1]), num(r[2]), num(r[3]), num(r[4]), None] for r in j.get('data') or []]


def tw_inst(day):   # 三大法人買賣金額（億元）
    j = twse('fund/BFI82U', type='day', dayDate=day)
    if j.get('stat') != 'OK': return None
    m = {r[0]: num(r[3]) for r in j['data']}
    e = lambda v: None if v is None else round(v / 1e8, 2)
    dealer = (m.get('自營商(自行買賣)') or 0) + (m.get('自營商(避險)') or 0)
    foreign = (m.get('外資及陸資(不含外資自營商)') or 0) + (m.get('外資自營商') or 0)
    return [f'{day[:4]}-{day[4:6]}-{day[6:]}', e(foreign), e(m.get('投信')), e(dealer), e(m.get('合計'))]


def tw_margin(day):   # 融資餘額（億元）、融券餘額（張）
    j = twse('marginTrading/MI_MARGN', date=day, selectType='MS')
    tb = (j.get('tables') or [{}])[0]
    if j.get('stat') != 'OK' or not tb.get('data'): return None
    m = {r[0]: r for r in tb['data']}
    amt = num(m.get('融資金額(仟元)', [None] * 6)[5]); short = num(m.get('融券(交易單位)', [None] * 6)[5])
    return [f'{day[:4]}-{day[4:6]}-{day[6:]}', None if amt is None else round(amt / 1e5, 2), short]


def tw_sectors(day):   # 類股指數收盤
    j = twse('afterTrading/MI_INDEX', date=day, type='IND')
    if j.get('stat') != 'OK': return None
    tb = (j.get('tables') or [{}])[0]
    d = f'{day[:4]}-{day[4:6]}-{day[6:]}'
    return [[d, r[0], num(r[1])] for r in tb.get('data') or [] if r[0].endswith('類指數') and num(r[1])]


# ---------- Yahoo：S&P 500 長歷史（1927 起） ----------
def yahoo(sym, days=None):
    """Yahoo 會擋完整的瀏覽器 UA（429），用簡短的 Mozilla/5.0 才行；range=max 會自動變成季線，所以改用起訖時間。"""
    import urllib.parse
    p1 = -1325635200 if days is None else int(time.time()) - days * 86400   # 1928-01-01 起
    j = get(f'https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}?period1={p1}&period2={int(time.time()) + 86400}&interval=1d', ua='Mozilla/5.0', timeout=60)
    r = j['chart']['result'][0]; q = r['indicators']['quote'][0]
    ymd = lambda ts: dt.datetime.fromtimestamp(ts, dt.timezone.utc).strftime('%Y-%m-%d')
    return [[ymd(t), q['open'][i], q['high'][i], q['low'][i], q['close'][i], q['volume'][i]] for i, t in enumerate(r['timestamp']) if q['close'][i] is not None]


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
