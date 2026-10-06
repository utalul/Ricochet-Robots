# 碰撞機器人 (Ricochet Robots) - 線上多人即時競標版

[![Deploy to GitHub Pages](https://github.com/your-username/ricochet-robots/actions/workflows/deploy.yml/badge.svg)](https://github.com/your-username/ricochet-robots/actions/workflows/deploy.yml)
[![Node.js CI](https://img.shields.io/badge/Node.js-v20%2B-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

經典益智桌遊《碰撞機器人》(Ricochet Robots / Rasende Roboter) 的多人線上網頁版遊戲。  
採用**純靜態前端架構**，可直接部署於 **GitHub Pages**，具備「零付費、零後端伺服器」特性，並支援**至多 100 人同房即時競標與同步展示**！

---

## 🎮 遊戲規則簡介

1. **無煞車滑動 (Slide & Collide)**：
   - 機器人一旦朝某個方向出發，會一路滑行直到**撞到牆壁**、**外圍邊界**、**中央卡榫 (7,7~8,8)** 或**其他機器人**才會停下。
2. **目標達陣與轉向規則**：
   - 翻開當前目標圓片（指定顏色與符號，或彩色漩渦）。
   - **個人至少轉向一次**：抵達目標的該台機器人本身移動次數必須 $\ge 2$（直達 1 步或開局已在目標格視為不合規）。
   - 若為彩色漩渦目標，任一顏色機器人皆可達陣。
3. **多人競標流程 (4 階段狀態機)**：
   - **THINKING（自由思考期）**：翻開新目標，棋盤全體鎖定，所有玩家只能用心算思考路線並喊出預計步數。
   - **COUNTDOWN（60 秒沙漏期）**：首位玩家喊出步數後啟動 60 秒倒數。全體玩家可繼續挑戰更少步數（個人新下注必須小於自己前一次）。
   - **DEMONSTRATING（路徑展示期）**：倒數結束，由宣告步數最少者（相同步數則先喊者優先）取得**獨占操作鎖 (Mutex Lock)**，其餘玩家即時觀戰。若步數剛好等於宣告值且達陣成功，獲得該圓片；若步數超過、放棄或失敗，機器人一鍵彈回起點，操作權移交次順位玩家。
   - **ROUND_END（結算期）**：顯示本回合得主，機器人固定於當前位置，準備開啟下一輪。

---

## ⌨️ 操作鍵位與控制指南

| 操作項目 | 鍵盤快捷鍵 | 滑鼠 / 觸控操作 |
| :--- | :--- | :--- |
| **選取機器人** | <kbd>1</kbd> 紅、<kbd>2</kbd> 藍、<kbd>3</kbd> 黃、<kbd>4</kbd> 綠 | 點擊棋盤上的機器人實心球體，或點擊右側面板按鈕 |
| **滑動機器人** | 方向鍵 <kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd> 或 <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> | 點擊畫面 D-Pad 按鈕、在棋盤上滑動手勢，或點擊同欄同列格子 |
| **復原上一步** | <kbd>Z</kbd> | 點擊「↶ 復原」按鈕 |
| **重設本回合** | <kbd>R</kbd> | 點擊「⟲ 重設」按鈕（展示者可重回起點重試） |
| **下一目標** | <kbd>N</kbd> / <kbd>Enter</kbd>（彈窗時） | 點擊「下一題」按鈕 |
| **新開隨機地圖** | <kbd>M</kbd> | 點擊「新地圖」按鈕 |

---

## 🌐 雙模式連線機制 (Dual-Mode Network)

本遊戲提供雙模式自動切換機制：

1. **本地分頁模擬 (預設零設定，BroadcastChannel)**：
   - 無需任何金鑰或設定，只需在同一台電腦開啟 2~4 個瀏覽器分頁，輸入相同房號（例如 `101`），即可進行多人即時競標與滑動同步展示！
2. **雲端跨裝置百人連線 (Supabase Realtime)**：
   - 在多人連線面板點擊「**⚙️ 雲端連線設定**」，填入 Supabase 免費專案憑證，即可開啟跨手機、平板與異地電腦的 100 人即時同房連線！

---

## 🚀 3 步驟免費申請 Supabase Realtime 金鑰

1. **註冊並建立專案**：
   - 前往 [Supabase 官網 (supabase.com)](https://supabase.com/) 免費註冊並點擊 **"New Project"**。
2. **取得 Project API 憑證**：
   - 進入專案後點擊左側齒輪 **Project Settings** $\rightarrow$ **API**。
   - 複製 **Project URL**（格式如 `https://xxxx.supabase.co`）。
   - 複製 **Project API keys** 中的 `anon` `public` 金鑰。
3. **在遊戲中儲存設定**：
   - 開啟遊戲網頁，切換至 **【🌐 多人即時連線】** $\rightarrow$ 點擊 **【⚙️ 雲端連線設定】**。
   - 貼上 Project URL 與 Anon Key 並點擊「**儲存並套用**」。
   - 設定儲存於瀏覽器 `localStorage`，無需重新打包部署！

---

## 📦 免費部署至 GitHub Pages 步驟

1. **Fork 或上傳本專案至 GitHub**：
   ```bash
   git init
   git add .
   git commit -m "feat: initial commit for Ricochet Robots"
   git branch -M main
   git remote add origin https://github.com/<your-username>/ricochet-robots.git
   git push -u origin main
   ```
2. **啟用 GitHub Pages**：
   - 進入 GitHub 倉庫的 **Settings** $\rightarrow$ **Pages**。
   - 在 **Build and deployment** 下方的 **Source** 選擇 **GitHub Actions**。
3. **自動部署完成**：
   - 當程式碼推送至 `main` 分支時，`.github/workflows/deploy.yml` 會自動執行單元測試並部署完成。
   - 前往 `https://<your-username>.github.io/ricochet-robots/` 即可立即開始遊玩！

---

## 🛠 本地開發與自動化測試

本專案使用原生 ES Modules，零繁瑣建置流程，支援 Node.js 20+：

```powershell
# 執行所有單元測試（包含版圖 81 種全拼裝、移動引擎、個人轉向次數、狀態機與通訊測試）
npm.cmd test

# 啟動本機 HTTP 伺服器
npm.cmd start
```

開啟瀏覽器前往 `http://localhost:8080` 即可體驗！

---

## 🧩 12 張子版圖題庫資料結構 (`src/data/boards.json`)

依據官方規則收錄完整的 12 張 8×8 子版圖（A、B、C、D 各組 3 張）：
- **拉丁方陣目標分佈**：A, B, C 組各含 4 個不同顏色符號目標，D 組含 4 個目標 + 1 個彩色漩渦。
- **全拼裝保證**：從 4 組中各挑 1 張拼合，$3 \times 3 \times 3 \times 3 = 81$ 種組合全部保證生成精確的 16×16 地圖與無重複的 17 個目標。
