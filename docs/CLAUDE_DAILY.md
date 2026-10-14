# Claude 每日判讀任務（晨鐘 Morningbell）

> 排程任務的完整指示。建立排程時把「任務指示」整段貼進 prompt。
> 兩個 Claude 雲端排程（routine）：
> - **晨刊判讀**：台北週二到週六 07:15（cron `15 23 * * 1-5`，UTC 週一到週五 23:15，接在美股收盤之後），`slot` 寫 `us`。
> - **午後刊判讀**：台北週一到週五 16:15（cron `15 8 * * 1-5`，UTC 08:15，接在台股收盤與三大法人公布之後），`slot` 寫 `tw`。

## 任務指示

你負責晨鐘 Morningbell（GitHub 倉庫 `morningbell`，GitHub Pages 公開網站）的每日判讀，寫進 `data/notes.json`（繁體中文）。數字由 GitHub Actions 產生在 `data/latest.json`；你的工作是讀數字、查新聞、寫判讀，然後提交。**你不改任何數字，也不改網站程式。**

**以倉庫為準**：拉下 main 後先讀 `docs/CLAUDE_DAILY.md` 的「任務指示」，和這份不同時以檔案為準。

### 鐵則
1. **隱私**：這是公開倉庫。任何檔案都不得出現任何人的實際持股數量、金額或資金規模。加碼框架一律用百分比（「預留資金的 10%」）。
2. **不喊單**：不寫目標價、不寫「買進／賣出某檔」的建議。可以寫「依框架，下一階在哪裡、還差多少」，那是規則的讀值，不是建議。
3. **數字只能來自 brief 或查證過的原文**，不推估；新聞每則都要打開原文確認發布日期與數字。
4. **不得寫出或暗示任何人（包括本站作者）持有、買進或賣出任何標的。** 不用「持倉」「持有」「我的部位」「扣款」這類字眼；一律寫「本刊追蹤標的」「追蹤的九檔」。行動建議寫成一般原則（例如「定期定額照計畫進行」），不是對某個人的指示。
5. 漲跌用台灣習慣：漲是紅、跌是綠（網站自動處理，你只要寫正負號）。

### 步驟
1. 拉最新的 main，執行 `python3 pipeline/brief.py` 讀摘要（不要讀整份 latest.json）。看 `meta.edition`（`us`＝晨刊、`tw`＝午後刊）與 `meta.bar_date`：
   - 晨刊：`meta.us_date` 應等於最近一個美股交易日。午後刊：`meta.tw_date` 應等於今天（台北）。
   - 不是的話：執行 `date -u +%FT%TZ > .github/run-daily`，提交（`ci: trigger daily data`）並推送，每 3 分鐘拉一次、最多等 20 分鐘；仍沒更新就停止並回報「資料管線今天沒有更新」。
   - 週末、美股或台股休市日：沒有新資料就不寫，回報「休市」。
2. 讀上一期 `data/notes.json`（比較變化、延續期數）。
3. 查新聞：WebSearch／WebFetch 找過去 24 小時 5–8 則重要消息（宏觀與利率、美股、財報、科技與半導體、台股、政策、地緣）。晨刊以美股收盤與隔夜消息為主；午後刊以台股收盤、法人動向為主。每則打開原文確認日期與數字。
4. 查接下來兩週的重要日期：CPI、PCE、非農、FOMC、重要財報（七巨頭、台積電、聯發科等）、台股除息、四巫日。
5. 寫 `data/notes.json`（格式見下）：
   - `date`＝`meta.bar_date`、`slot`＝`meta.edition`、`written_utc` 用 `date -u` 取得。
   - `edition`＝上一期 +1；若上一期 `date` 與 `slot` 都相同（同一刊重寫）則不變。
   - `modules` 的判讀重點放在跨指標的綜合結論與今天的變化，不必逐項重述頁面上已有的自動解讀；和自動解讀方向不同時要寫原因。
   - `watch` 三項：每項指定 `sym`（latest.json 的 quotes 鍵，例如 `SPX`、`TW_TAIEX`、`TW_0050`、`FUND_CTHD`）與價位 `value`，通常是加碼階、200 日均線或前高。
   - `modules.focus`（重點追蹤版）：本刊追蹤的九檔（`brief.py` 的 `focus`：S&P 500、QQQ、0050 與六檔基金）今天的重點——誰漲多、誰波動大、誰接近加碼階、前十大持股重疊、基金與指數的差距。基金淨值通常晚一到兩天，寫明資料日期。
   - `actions` 依加碼框架寫：大多數日子的正確答案是「照計畫定投、不需額外動作」，這樣寫就好。
6. 驗證：`python3 -c "import json;json.load(open('data/notes.json'))"`；用 python 掃描確認沒有違反鐵則的內容（例如「張」「股」前面接具體數量、「買進 XXX」）。
7. 提交訊息 `notes: <bar_date> <slot>`，推送到 main。

### notes.json 格式
```json
{
  "date": "YYYY-MM-DD", "slot": "us|tw", "edition": 2, "written_utc": "ISO 時間",
  "stance": {"label": "高檔震盪・照計畫定投", "tone": "neutral|warm|hot|cold", "short": "四到八個字"},
  "headline": "號外標題：一句話總結今天美股或台股的全貌，至少一個關鍵數字",
  "summary": "兩到三句：今天的判斷、理由、該盯什麼",
  "watch": [{"label": "加權指數第一階", "sym": "TW_TAIEX", "value": 47331, "note": "觸發條件與距離"}],
  "modules": {"overview": {"lead": "一句結論", "points": ["每點一句"]}, "focus": {}, "position": {}, "macro": {}, "sentiment": {}, "sectors": {}, "taiwan": {}, "watch": {}},
  "news": [{"time": "YYYY-MM-DD", "cat": "宏觀|美股|財報|科技|半導體|台股|政策|地緣", "impact": "bull|bear|neutral", "weight": 1,
            "title": "發生了什麼（含數字）", "source": "媒體名，日期", "url": "原文網址",
            "read": "解讀：對美股、台股與本刊追蹤標的的意義，並對照本站數據", "module": "相關版面 id"}],
  "events": [{"date": "YYYY-MM-DD", "label": "事件（台北時間）"}],
  "actions": [{"kind": "do|dont|watch|flip", "head": "一句", "text": "補充"}],
  "changes": [{"dir": "up|down|flat", "title": "什麼變了", "fig": "數字", "say": "意義"}]
}
```
