# 碰撞機器人 (Ricochet Robots) - 多人獨立棋盤競速版

[![Deploy to GitHub Pages](https://github.com/your-username/ricochet-robots/actions/workflows/deploy.yml/badge.svg)](https://github.com/your-username/ricochet-robots/actions/workflows/deploy.yml)
[![Node.js CI](https://img.shields.io/badge/Node.js-v20%2B-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

經典益智桌遊《碰撞機器人》(Ricochet Robots / Rasende Roboter) 的多人線上網頁版遊戲。  
採用**純靜態前端架構**，可直接部署於 **GitHub Pages**。玩家透過房間代碼加入同一局，各自在自己的棋盤試走；房主維護玩家名單、回合與排行榜。

---

## 🎮 遊戲規則簡介

1. **無煞車滑動 (Slide & Collide)**：
   - 機器人一旦朝某個方向出發，會一路滑行直到**撞到牆壁**、**外圍邊界**、**中央卡榫 (7,7~8,8)** 或**其他機器人**才會停下。
2. **目標達陣與轉向規則**：
   - 翻開當前目標圓片（指定顏色與符號，或彩色漩渦）。
   - **個人至少轉向一次**：抵達目標的該台機器人本身移動次數必須 $\ge 2$（直達 1 步或開局已在目標格視為不合規）。
   - 若為彩色漩渦目標，任一顏色機器人皆可達陣。
3. **多人獨立棋盤競速**：所有玩家看到相同目標與回合倒數，但每位玩家在自己的棋盤操作。有效解答會回報步數並更新排行榜；回合結束時由房主以最低步數判定得分，平手共同得分。

---

## ⌨️ 操作鍵位與控制指南

| 操作項目 | 鍵盤快捷鍵 | 滑鼠 / 觸控操作 |
| :--- | :--- | :--- |
| **選取機器人** | <kbd>1</kbd> 紅、<kbd>2</kbd> 藍、<kbd>3</kbd> 黃、<kbd>4</kbd> 綠 | 點擊棋盤上的機器人實心球體，或點擊右側面板按鈕 |
| **滑動機器人** | 方向鍵 <kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd> 或 <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> | 點擊畫面 D-Pad 按鈕、在棋盤上滑動手勢，或點擊同欄同列格子 |
| **復原上一步** | <kbd>Z</kbd> | 點擊「↶ 復原」按鈕 |
| **重設本回合** | <kbd>R</kbd> | 點擊「⟲ 重設」按鈕 |
| **下一目標** | <kbd>N</kbd> / <kbd>Enter</kbd>（彈窗時） | 點擊「下一題」按鈕 |
| **新開隨機地圖** | <kbd>M</kbd> | 點擊「新地圖」按鈕 |

---

## 🌐 雙模式連線機制 (Dual-Mode Network)

遊戲自動使用專案內建的多人連線設定，玩家不需輸入任何服務憑證：

建立房間後分享代碼或邀請連結，其他玩家輸入暱稱即可加入。連線服務不可用時，遊戲會提示跨裝置多人暫時無法使用；BroadcastChannel 僅支援同瀏覽器分頁。

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
