# 晨鐘 Morningbell

**給長期投資人的美股、台股日報。** 兩市收盤、要聞解讀、回撤與加碼位置、宏觀、情緒、板塊輪動與台股籌碼。破曉 [Daybreak](https://north7.github.io/daybreak/)（比特幣日報）的姊妹刊。

網站：<https://north7.github.io/morningbell/>

## 每天兩刊

| 刊別 | 台北時間 | 頭版 | 內容重點 |
|---|---|---|---|
| 晨刊 | 約 07:00 | S&P 500 | 美股收盤、隔夜消息、今天台股要注意什麼 |
| 午後刊 | 約 16:00 | 加權指數 | 台股收盤、三大法人、外資期貨 |

漲跌顏色採台灣慣例：**紅漲、綠跌**。品牌色是藍色（不和漲跌混淆）。

## 版面

| # | 版面 | 看什麼 |
|---|---|---|
| 01 | 頭版 | 號外標題、巨型收盤（滑過可回看 20 天）、數據帶、兩市收盤看板、今日要聞、今天該做什麼、持倉位置卡、今日數據與自動解讀、近一年走勢、接下來的日期 |
| 02 | 消息 | 過去 24 小時要聞，每則附「對美股／台股的意義」並對照本站數據 |
| 03 | 加碼框架 | 每個持倉距歷史高點、加碼階梯跑道圖、近三年回撤水位圖、加碼模擬器、**歷史回測**（跌到每一階之後一年、三年的報酬與「之後還會再跌多少」）、這次回撤 vs 歷次回撤路徑、歷次 10% 以上回撤表 |
| 04 | 宏觀 | 殖利率曲線（今天／一個月前／一年前）、10 年／2 年／3 個月、利差與倒掛、高收益債利差、實質利率、美元指數、美元兌台幣 |
| 05 | 情緒 | VIX 與期限結構（9 天 → 6 個月）、CNN 恐懼貪婪、類股寬度、等權重 ÷ 市值權重 |
| 06 | 板塊 | 美股 11 類股＋半導體＋軟體、台股類股指數的輪動象限（RRG）與 1 日～今年報酬熱度表 |
| 07 | 台股籌碼 | 外資與投信買賣超、外資台指期淨未平倉、融資餘額、台股 ETF 折溢價、權值與 AI 供應鏈個股的本益比／殖利率／月營收年增、台積電 ADR 溢價 |
| 08 | 觀察清單 | 美股指數 ETF、七巨頭、AI 半導體、台股各族群：距高點、200 日線、RSI、52 週位置、60 日走勢 |
| 09 | 方法 | 原則、資料來源、限制 |

觀察清單在 `pipeline/universe.json`，加減代號後執行 `python3 pipeline/backfill.py --only <代號>` 回補歷史。

## 加碼框架

以「100% ＝ 預留的加碼資金」計（和定期定額分開），參數在 `data/model.json`：

| 距歷史高點 | −5% | −10% | −15% | −20% | −30% |
|---|---|---|---|---|---|
| 加碼 | 10% | 15% | 20% | 25% | 30% |

每階在同一段回撤裡只執行一次，創新高後重置；VIX 收盤 ≥ 30 時下一階可提前。這是範例參數，不是投資建議。

## 資料來源（全部免費、不需金鑰）

| 來源 | 用在哪裡 |
|---|---|
| Nasdaq | 美股、ETF、那斯達克與費半指數日線（近 10 年） |
| FRED | S&P 500 指數、那斯達克 100 長歷史（1986 起）、高收益債利差、實質利率、美元指數、美元兌台幣 |
| 美國財政部 | 殖利率曲線 |
| CBOE | VIX、VIX9D、VIX3M、VIX6M |
| CNN | 恐懼貪婪指數 |
| Yahoo | S&P 500 長歷史（一次性回補，用 Actions 的 backfill.yml） |
| 證交所 | 加權指數（2000 起）、個股與 ETF、三大法人、融資融券、類股指數、本益比、月營收、ETF 預估淨值 |
| 期交所 | 三大法人台指期未平倉 |

## 系統架構

```
cron-job.org ──(repository_dispatch)──▶ GitHub Actions  daily.yml
   UTC 21:40（台北 05:40）晨刊   ─┐
   UTC 07:40（台北 15:40）午後刊 ─┼─▶ update.py：抓最近一段資料合併進 data/hist/*.csv、當日快照進 pipeline/snap.json
   UTC 13:40（台北 21:40）融資   ─┘   build.py：算出 data/latest.json → 提交 → GitHub Pages
Claude 排程任務（台北 07:15、16:15）→ brief.py 摘要 + 查新聞 → data/notes.json → 提交
瀏覽器 → index.html + assets/app.js 讀 latest.json 與 notes.json
```

歷史資料存在倉庫裡（`data/hist/`），每天只抓最近幾週合併，所以某天沒跑會自動補齊；任何來源失敗只影響該項，頁面顯示「本日未取得」。

## 部署（一次性）

1. 建立公開倉庫 `morningbell`，推到 `main`。
2. Settings → Pages：Deploy from a branch，`main`、`/ (root)`。
3. Settings → Actions → General → Workflow permissions：Read and write。
4. Actions → **Backfill history** 手動執行一次（預設 `SPX_LONG`，補 S&P 500 從 1927 年起的長歷史）。
5. 依 [docs/CRON_JOB.md](docs/CRON_JOB.md) 設 cron-job.org。
6. 在 Claude Code 建每日排程任務，指示見 [docs/CLAUDE_DAILY.md](docs/CLAUDE_DAILY.md)。

## 本機開發

```bash
python3 pipeline/update.py      # 抓資料（證交所有流量限制，約 2 分鐘）
python3 pipeline/build.py       # 算 data/latest.json
python3 -m http.server 8791     # http://localhost:8791/
```

網站純靜態、無外部套件、無建置步驟；圖表是手寫 SVG（沿用破曉）。Python 只用標準庫。

## 資料原則

- 數字取不到就是 null 並寫進 errors，不推估、不沿用舊值。
- 報酬只算價格，不含股息。0050 於 2025-06-18 一拆四，之前價格已除以 4。
- 文字判讀只解釋數字，不改數字；不寫目標價、不喊單。
- 僅供研究參考，非投資建議。
