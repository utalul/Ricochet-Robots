/**
 * MultiplayerHUD.js
 * 多人連線 HUD 介面模組。
 *
 * 包含：
 * 1. 模式切換（單機練習 vs 多人連線）
 * 2. 房間大廳（輸入暱稱、建立房間、加入房間、網址 #room=xxx 自動帶入、分享連結）
 * 3. 房間頂部狀態列（房號、連線模式、在線玩家與得分）
 * 4. 60 秒沙漏倒數計時進度條
 * 5. 步數下注面板（輸入框 + 下注按鈕 / Enter 快捷）
 * 6. 即時排行榜（排名、玩家名稱、宣告步數、狀態）
 * 7. 展示者控制列與觀戰提示（獨占操作者提示、放棄按鈕）
 */
import { ROOM_PHASE, BID_STATUS } from '../network/RoomState.js';

export class MultiplayerHUD {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.container 裝載多人控制面板的容器
   * @param {object} opts.handlers 回呼函式
   */
  constructor({ container, handlers }) {
    this.container = container;
    this.h = handlers || {};

    this.currentMode = 'solo'; // 'solo' | 'multi'
    this.inRoom = false;
    this.roomInfo = null;
    this.currentUserId = null;

    this._timerInterval = null;
    this._countdownEnd = null;
    this._totalSeconds = 60;

    this._buildDOM();
    this._bindEvents();
    this._checkUrlHash();
  }

  _buildDOM() {
    this.container.innerHTML = `
      <!-- 模式切換標籤 -->
      <div class="card mode-switcher">
        <button type="button" class="tab-btn active" data-mode="solo">🎮 單機練習</button>
        <button type="button" class="tab-btn" data-mode="multi">🌐 多人即時連線</button>
      </div>

      <!-- 多人連線外層容器 -->
      <div id="mp-section" class="mp-section" hidden>

        <!-- 1. 大廳面板 (未進房時顯示) -->
        <div id="mp-lobby-card" class="card mp-card">
          <div class="card-title">🌐 多人房間大廳</div>
          <p class="desc">支援本地多開（開啟多個分頁）或 Supabase Realtime 至多 100 人同步競標展示。</p>
          <div class="form-row">
            <label for="mp-username">玩家暱稱：</label>
            <input type="text" id="mp-username" placeholder="輸入暱稱" maxlength="12" />
          </div>
          <div class="form-row">
            <label for="mp-roomid">房間代碼：</label>
            <input type="text" id="mp-roomid" placeholder="例如：101" maxlength="16" />
          </div>
          <div class="lobby-actions">
            <button type="button" id="btn-create-room" class="primary">建立新房間</button>
            <button type="button" id="btn-join-room">加入房間</button>
          </div>
          <div style="margin-top: 10px; text-align: center;">
            <button type="button" id="btn-cloud-settings" class="btn-sm" style="width: 100%;">⚙️ 雲端連線設定 (Supabase)</button>
          </div>
        </div>

        <!-- 2. 房間面板 (進房後顯示) -->
        <div id="mp-room-card" class="card mp-card" hidden>
          <div class="room-header">
            <div>
              <span class="room-title">房間：<strong id="mp-room-title">---</strong></span>
              <span id="mp-net-badge" class="badge">廣播頻道</span>
            </div>
            <div class="room-header-btns">
              <button type="button" id="btn-room-cloud-settings" class="btn-sm" title="雲端連線設定">⚙️ 設定</button>
              <button type="button" id="btn-copy-link" class="btn-sm" title="複製房間邀請網址">📋 複製邀請</button>
              <button type="button" id="btn-leave-room" class="btn-sm btn-danger">離開</button>
            </div>
          </div>

          <!-- 在線玩家清單與得分 -->
          <div class="players-bar">
            <div class="label">在線玩家 (<span id="mp-player-count">0</span>)：</div>
            <div id="mp-player-chips" class="player-chips"></div>
          </div>

          <!-- 沙漏倒數計時器 -->
          <div id="mp-timer-wrap" class="timer-wrap" hidden>
            <div class="timer-info">
              <span class="timer-label">⏳ 沙漏競標倒數：</span>
              <span id="mp-timer-text" class="timer-seconds">60s</span>
            </div>
            <div class="progress-bar">
              <div id="mp-timer-bar" class="progress-fill" style="width: 100%;"></div>
            </div>
          </div>

          <!-- 階段指示橫幅 -->
          <div id="mp-phase-banner" class="phase-banner phase-thinking">
            自由思考中：尚未有人下注
          </div>

          <!-- 展示者專屬控制條 (DEMONSTRATING 階段) -->
          <div id="mp-demo-banner" class="demo-banner" hidden>
            <div id="mp-demo-status" class="demo-status">現由【玩家】展示中</div>
            <div id="mp-demo-controls" class="demo-controls" hidden>
              <button type="button" id="btn-mp-forfeit" class="btn-danger btn-sm">放棄展示 (Forfeit)</button>
              <button type="button" id="btn-mp-reset" class="btn-sm">重回起點</button>
            </div>
          </div>

          <!-- 下注操作區 -->
          <div id="mp-bid-card" class="bid-panel">
            <div class="label">宣告步數競標：</div>
            <div class="bid-inputs">
              <input type="number" id="mp-bid-input" min="2" max="60" placeholder="步數 (≥ 2)" />
              <button type="button" id="btn-submit-bid" class="primary">下注</button>
            </div>
            <div class="hint">若已下注，新步數必須比前一次更少。少者優先，同步先喊優先。</div>
          </div>

          <!-- 即時排行榜 -->
          <div class="leaderboard-wrap">
            <div class="label">競標排行榜：</div>
            <div id="mp-leaderboard" class="leaderboard-list">
              <div class="empty-lb">尚未有玩家喊步數</div>
            </div>
          </div>

          <!-- 房主專屬操作列 -->
          <div id="mp-host-controls" class="host-controls" hidden>
            <button type="button" id="btn-host-next" class="primary btn-sm">房主：開始下一輪</button>
          </div>
        </div>

        <!-- 3. 雲端連線設定彈窗 -->
        <div id="mp-settings-modal" class="modal" hidden>
          <div class="modal-box" style="text-align: left; max-width: 440px;">
            <h2 style="margin-top: 0; font-size: 1.25rem; color: var(--accent);">⚙️ 雲端連線設定</h2>
            <p style="font-size: 0.85rem; color: var(--muted); margin-bottom: 12px; line-height: 1.5;">
              預設使用瀏覽器原生 <strong>BroadcastChannel</strong> 進行本機多開雙分頁連線。<br/>
              若要進行跨裝置、手機或遠端百人連線，可免費至 <strong>Supabase</strong> 註冊專案並填寫以下憑證：
            </p>
            <div class="form-row" style="margin-bottom: 8px;">
              <label for="cfg-supabase-url" style="width: 90px; font-size: 0.82rem;">Project URL:</label>
              <input type="url" id="cfg-supabase-url" placeholder="https://xyz.supabase.co" />
            </div>
            <div class="form-row" style="margin-bottom: 12px;">
              <label for="cfg-supabase-key" style="width: 90px; font-size: 0.82rem;">Anon Key:</label>
              <input type="text" id="cfg-supabase-key" placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6..." />
            </div>
            <div id="cfg-mode-status" style="font-size: 0.82rem; margin-bottom: 14px;"></div>
            <div class="modal-actions" style="justify-content: flex-end;">
              <button type="button" id="btn-save-settings" class="primary btn-sm">儲存並套用</button>
              <button type="button" id="btn-clear-settings" class="btn-sm">清除 (還原本地)</button>
              <button type="button" id="btn-close-settings" class="btn-sm">關閉</button>
            </div>
          </div>
        </div>

      </div>
    `;

    // 取得常用元素
    this.tabSolo = this.container.querySelector('[data-mode="solo"]');
    this.tabMulti = this.container.querySelector('[data-mode="multi"]');
    this.mpSection = this.container.querySelector('#mp-section');
    this.lobbyCard = this.container.querySelector('#mp-lobby-card');
    this.roomCard = this.container.querySelector('#mp-room-card');

    this.inputName = this.container.querySelector('#mp-username');
    this.inputRoom = this.container.querySelector('#mp-roomid');
    this.inputBid = this.container.querySelector('#mp-bid-input');

    this.roomTitle = this.container.querySelector('#mp-room-title');
    this.netBadge = this.container.querySelector('#mp-net-badge');
    this.playerCount = this.container.querySelector('#mp-player-count');
    this.playerChips = this.container.querySelector('#mp-player-chips');

    this.timerWrap = this.container.querySelector('#mp-timer-wrap');
    this.timerText = this.container.querySelector('#mp-timer-text');
    this.timerBar = this.container.querySelector('#mp-timer-bar');

    this.phaseBanner = this.container.querySelector('#mp-phase-banner');
    this.demoBanner = this.container.querySelector('#mp-demo-banner');
    this.demoStatus = this.container.querySelector('#mp-demo-status');
    this.demoControls = this.container.querySelector('#mp-demo-controls');
    this.bidPanel = this.container.querySelector('#mp-bid-card');
    this.leaderboardEl = this.container.querySelector('#mp-leaderboard');
    this.hostControls = this.container.querySelector('#mp-host-controls');

    this.settingsModal = this.container.querySelector('#mp-settings-modal');
    this.inputCfgUrl = this.container.querySelector('#cfg-supabase-url');
    this.inputCfgKey = this.container.querySelector('#cfg-supabase-key');
    this.cfgStatus = this.container.querySelector('#cfg-mode-status');

    // 載入預設暱稱
    const savedName = localStorage.getItem('ricochet_player_name');
    if (savedName) this.inputName.value = savedName;
    else this.inputName.value = '玩家_' + Math.floor(100 + Math.random() * 900);
  }

  _bindEvents() {
    // 模式切換
    this.tabSolo.addEventListener('click', () => this.switchMode('solo'));
    this.tabMulti.addEventListener('click', () => this.switchMode('multi'));

    // 建立房間
    this.container.querySelector('#btn-create-room').addEventListener('click', () => {
      const name = this._saveAndGetName();
      const roomId = this.inputRoom.value.trim() || String(Math.floor(1000 + Math.random() * 9000));
      this._call('createRoom', { roomId, userName: name });
    });

    // 加入房間
    this.container.querySelector('#btn-join-room').addEventListener('click', () => {
      const name = this._saveAndGetName();
      const roomId = this.inputRoom.value.trim();
      if (!roomId) {
        alert('請輸入房間代碼');
        return;
      }
      this._call('joinRoom', { roomId, userName: name });
    });

    // 複製邀請連結
    this.container.querySelector('#btn-copy-link').addEventListener('click', () => {
      if (!this.roomInfo) return;
      const url = `${window.location.origin}${window.location.pathname}#room=${this.roomInfo.roomId}`;
      navigator.clipboard?.writeText(url).then(() => {
        alert('已複製房間邀請連結：' + url);
      }).catch(() => {
        prompt('請複製房間網址：', url);
      });
    });

    // 離開房間
    this.container.querySelector('#btn-leave-room').addEventListener('click', () => {
      if (confirm('確定要離開房間嗎？')) {
        this._call('leaveRoom');
      }
    });

    // 下注送出
    const submitBid = () => {
      const val = parseInt(this.inputBid.value, 10);
      if (isNaN(val) || val < 2) {
        alert('下注步數必須為大於等於 2 之整數');
        return;
      }
      this._call('submitBid', val);
      this.inputBid.value = '';
    };

    this.container.querySelector('#btn-submit-bid').addEventListener('click', submitBid);
    this.inputBid.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitBid();
      }
    });

    // 放棄與重試
    this.container.querySelector('#btn-mp-forfeit').addEventListener('click', () => {
      if (confirm('確定要放棄展示，將操作權移交給次順位玩家嗎？')) {
        this._call('forfeit');
      }
    });
    this.container.querySelector('#btn-mp-reset').addEventListener('click', () => {
      this._call('resetDemo');
    });

    // 房主下一輪
    this.container.querySelector('#btn-host-next').addEventListener('click', () => {
      this._call('nextRound');
    });

    // 雲端連線設定
    const openSettings = () => {
      this.inputCfgUrl.value = localStorage.getItem('SUPABASE_URL') || '';
      this.inputCfgKey.value = localStorage.getItem('SUPABASE_ANON_KEY') || '';
      this._updateSettingsStatus();
      this.settingsModal.removeAttribute('hidden');
    };
    this.container.querySelector('#btn-cloud-settings')?.addEventListener('click', openSettings);
    this.container.querySelector('#btn-room-cloud-settings')?.addEventListener('click', openSettings);

    this.container.querySelector('#btn-close-settings')?.addEventListener('click', () => {
      this.settingsModal.setAttribute('hidden', '');
    });

    this.container.querySelector('#btn-save-settings')?.addEventListener('click', () => {
      const url = this.inputCfgUrl.value.trim();
      const key = this.inputCfgKey.value.trim();
      if (url && key) {
        localStorage.setItem('SUPABASE_URL', url);
        localStorage.setItem('SUPABASE_ANON_KEY', key);
        this.settingsModal.setAttribute('hidden', '');
        this._call('settingsChanged', { url, key });
      } else {
        alert('請填寫完整的 Project URL 與 Anon Key，或點擊「清除 (還原本地)」');
      }
    });

    this.container.querySelector('#btn-clear-settings')?.addEventListener('click', () => {
      localStorage.removeItem('SUPABASE_URL');
      localStorage.removeItem('SUPABASE_ANON_KEY');
      this.inputCfgUrl.value = '';
      this.inputCfgKey.value = '';
      this.settingsModal.setAttribute('hidden', '');
      this._call('settingsChanged', { url: '', key: '' });
    });
  }

  _updateSettingsStatus() {
    const url = localStorage.getItem('SUPABASE_URL');
    const key = localStorage.getItem('SUPABASE_ANON_KEY');
    if (url && key) {
      this.cfgStatus.textContent = '✅ 目前狀態：已設定 Supabase 憑證（跨裝置百人連線）';
      this.cfgStatus.style.color = '#81c784';
    } else {
      this.cfgStatus.textContent = '⚡ 目前狀態：使用 BroadcastChannel（本地雙分頁模擬）';
      this.cfgStatus.style.color = '#64b5f6';
    }
  }

  _call(name, ...args) {
    const fn = this.h?.[name];
    if (typeof fn === 'function') fn(...args);
  }

  _saveAndGetName() {
    const name = this.inputName.value.trim() || '玩家';
    localStorage.setItem('ricochet_player_name', name);
    return name;
  }

  _checkUrlHash() {
    if (typeof window === 'undefined') return;
    const match = window.location.hash.match(/room=([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      this.inputRoom.value = match[1];
      // 自動切換至多人分頁
      this.switchMode('multi');
    }
  }

  // ---------- 對外控制方法 ----------

  switchMode(mode) {
    this.currentMode = mode;
    const isMulti = mode === 'multi';
    this.tabSolo.classList.toggle('active', !isMulti);
    this.tabMulti.classList.toggle('active', isMulti);
    this.mpSection.hidden = !isMulti;
    this._call('modeChanged', mode);
  }

  setInRoom(inRoom, info = null) {
    this.inRoom = inRoom;
    this.roomInfo = info;
    if (info?.userId) this.currentUserId = info.userId;

    this.lobbyCard.hidden = inRoom;
    this.roomCard.hidden = !inRoom;

    if (inRoom && info) {
      this.roomTitle.textContent = info.roomId;
      this.netBadge.textContent = info.mode.includes('Supabase') ? '☁ Supabase' : '⚡ 本地分頁廣播';
      if (history.replaceState) {
        history.replaceState(null, '', `#room=${info.roomId}`);
      }
    } else {
      this.stopTimer();
      if (history.replaceState) {
        history.replaceState(null, '', window.location.pathname);
      }
    }
  }

  updatePlayers(players = [], isHost = false) {
    this.playerCount.textContent = String(players.length);
    this.playerChips.innerHTML = '';
    players.forEach((p) => {
      const chip = document.createElement('span');
      chip.className = 'player-chip';
      const isMe = p.id === this.currentUserId ? ' (你)' : '';
      const hostIcon = p.isHost ? ' 👑' : '';
      chip.innerHTML = `${p.name}${hostIcon}${isMe} <span class="score">${p.score || 0}★</span>`;
      this.playerChips.appendChild(chip);
    });
    this.hostControls.hidden = !isHost;
  }

  updatePhase(phase, phaseData = {}) {
    this.phaseBanner.className = 'phase-banner';

    switch (phase) {
      case ROOM_PHASE.THINKING:
        this.phaseBanner.classList.add('phase-thinking');
        this.phaseBanner.textContent = '💡 自由思考中：觀察路線並喊出預計步數';
        this.bidPanel.hidden = false;
        this.demoBanner.hidden = true;
        this.stopTimer();
        break;

      case ROOM_PHASE.COUNTDOWN:
        this.phaseBanner.classList.add('phase-countdown');
        this.phaseBanner.textContent = '⏳ 沙漏競標中！全員可繼續挑戰更少步數';
        this.bidPanel.hidden = false;
        this.demoBanner.hidden = true;
        if (phaseData.countdownEnd) {
          this.startTimer(phaseData.countdownEnd, phaseData.countdownDuration || 60);
        }
        break;

      case ROOM_PHASE.DEMONSTRATING:
        this.phaseBanner.classList.add('phase-demo');
        this.phaseBanner.textContent = '🎯 展示階段：下注已鎖定，由領先者獨占操作棋盤';
        this.bidPanel.hidden = true;
        this.demoBanner.hidden = false;
        this.stopTimer();
        break;

      case ROOM_PHASE.ROUND_END:
        this.phaseBanner.classList.add('phase-end');
        this.phaseBanner.textContent = '🏁 回合結算：等待下一輪開始';
        this.bidPanel.hidden = true;
        this.demoBanner.hidden = true;
        this.stopTimer();
        break;
      default:
        break;
    }
  }

  startTimer(countdownEnd, durationSec = 60) {
    this._countdownEnd = countdownEnd;
    this._totalSeconds = durationSec;
    this.timerWrap.hidden = false;

    this.stopTimer();
    const tick = () => {
      const remainingMs = Math.max(0, this._countdownEnd - Date.now());
      const remainingSec = Math.ceil(remainingMs / 1000);
      const pct = Math.min(100, Math.max(0, (remainingMs / (this._totalSeconds * 1000)) * 100));

      this.timerText.textContent = `${remainingSec}s`;
      this.timerBar.style.width = `${pct}%`;

      if (remainingMs <= 0) {
        this.stopTimer();
        this._call('countdownExpired');
      }
    };

    tick();
    this._timerInterval = setInterval(tick, 200);
  }

  stopTimer() {
    if (this._timerInterval) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
    }
    this.timerWrap.hidden = true;
  }

  updateLeaderboard(bids = [], activeDemonstratorId = null) {
    if (!bids || bids.length === 0) {
      this.leaderboardEl.innerHTML = '<div class="empty-lb">尚未有玩家喊步數</div>';
      return;
    }

    this.leaderboardEl.innerHTML = '';
    bids.forEach((bid, idx) => {
      const item = document.createElement('div');
      item.className = 'lb-item';
      if (bid.playerId === this.currentUserId) item.classList.add('is-me');
      if (bid.playerId === activeDemonstratorId) item.classList.add('is-active-demo');

      let badgeHtml = '';
      if (bid.status === BID_STATUS.ACTIVE) {
        badgeHtml = '<span class="status-tag active">展示中</span>';
      } else if (bid.status === BID_STATUS.FAILED) {
        badgeHtml = '<span class="status-tag failed">已失敗</span>';
      } else if (bid.status === BID_STATUS.SUCCESS) {
        badgeHtml = '<span class="status-tag success">成功達陣</span>';
      }

      item.innerHTML = `
        <span class="lb-rank">#${idx + 1}</span>
        <span class="lb-name">${bid.playerName}</span>
        <span class="lb-moves">${bid.moves} 步</span>
        ${badgeHtml}
      `;
      this.leaderboardEl.appendChild(item);
    });
  }

  updateDemonstratorBanner({ isDemonstrator, demonstratorName, targetMoves, currentMoves }) {
    if (isDemonstrator) {
      this.demoStatus.innerHTML = `🎮 <strong>輪到您展示！</strong> 目標步數：<strong>${targetMoves}</strong> 步（目前已走：${currentMoves} 步）`;
      this.demoControls.hidden = false;
    } else {
      this.demoStatus.innerHTML = `👀 <strong>觀戰中：</strong> 現由【${demonstratorName}】展示（目標：${targetMoves} 步，目前：${currentMoves} 步）`;
      this.demoControls.hidden = true;
    }
  }
}
