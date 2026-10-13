# 用 cron-job.org 準時觸發資料管線

GitHub Actions 自己的定時排程常晚好幾小時（破曉 Daybreak 2026-10 實測晚 5–7 小時）。晨鐘一天有兩刊，對時間更敏感，所以建議和破曉一樣，用 cron-job.org 準時呼叫 GitHub 的 `repository_dispatch` API。`daily.yml` 原本的 `schedule` 與 Claude 推送觸發都保留當備援。

## 一、建立 GitHub token（只需要一次）

1. 打開 <https://github.com/settings/personal-access-tokens/new>（Fine-grained token）。
2. Token name：`morningbell-cron`；Expiration：1 年。
3. Repository access：Only select repositories → 勾 `North7/morningbell`（也可以和破曉共用一把 token，兩個倉庫都勾）。
4. Repository permissions → **Contents** 設為 **Read and write**。
5. 產生後複製 `github_pat_` 開頭的字串。不要貼到任何公開的地方。

## 二、在 cron-job.org 建三個工作

設定都一樣，只有標題與時間不同：

| 欄位 | 填什麼 |
|---|---|
| URL | `https://api.github.com/repos/North7/morningbell/dispatches` |
| Request method | POST |
| Request headers | `Authorization` ＝ `Bearer github_pat_…`、`Accept` ＝ `application/vnd.github+json`、`Content-Type` ＝ `application/json`、`User-Agent` ＝ `morningbell-cron` |
| Request body | `{"event_type":"daily-data"}` |

| 工作 | 時間（UTC，週一到週五） | 台北 | 用途 |
|---|---|---|---|
| `morningbell us` | 21:40 | 05:40 | 晨刊：美股收盤 |
| `morningbell tw` | 07:40 | 15:40 | 午後刊：台股收盤與三大法人 |
| `morningbell margin` | 13:40 | 21:40 | 補抓融資融券（晚上才公布） |

## 三、測試

在 cron-job.org 對任一工作按 **Run now**，到 GitHub → Actions 確認「Daily data」有一筆 `repository_dispatch` 觸發的執行，跑完 `data/latest.json` 會有新的提交。
