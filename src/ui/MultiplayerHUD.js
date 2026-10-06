/**
 * MultiplayerHUD.js
 * 多人連線 2 分鐘同步競速 HUD 介面模組。
 *
 * 包含：
 * 1. 模式切換同步（單人自由模式 vs 多人即時競賽）
 * 2. 房間大廳（輸入暱稱、建立房間、加入房間、網址 #room=xxx 自動帶入、分享連結）
 * 3. 房間頂部狀態列（房號、連線模式、在線玩家與得分）
 * 4. 17 題總進度顯示（第 X / 17 題進度條）
 * 5. 120 秒同步競速沙漏計時器進度條
 * 6. 個人最佳步數 (PB) 狀態提示
 * 7. 即時競標排行榜（排名、玩家名稱、個人最佳步數、最低步數領先標記）
 * 8. 本地試走輔助操作（復原 Z、重回起點 R）
 * 9. 回合結算通知與 17 題終局頒獎台彈窗 (Podium Modal)
 */
import { ROOM_PHASE, BID_STATUS } from '../network/RoomState.js';

/**
 * 複製房間邀請連結 (支援現代 Clipboard API 與相容回退 execCommand)
 * @param {string} roomId 房間代碼
 * @param {object} [opts]
 * @param {(msg: string, type?: string) => void} [opts.showToast] 自訂 Toast 回呼
 */
export async function copyRoomInviteLink(roomId, { showToast = null } = {}) {
  if (typeof window === 'undefined') return '';
  const url = new URL(window.location.href);
  url.search = ''; // 清除 query
  url.hash = `room=${roomId}`;
  const textToCopy = url.toString();

  let success = false;
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(textToCopy);
      success = true;
    } catch (err) {
      console.warn('Clipboard API failed, fallback to execCommand', err);
    }
  }

  // Fallback 機制
  if (!success && typeof document !== 'undefined') {
    const textArea = document.createElement('textarea');
    textArea.value = textToCopy;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      success = document.execCommand('copy');
    } catch (err) {
      console.error('Fallback copy failed', err);
    }
    textArea.remove();
  }

  // 視覺回饋提示 (Toast)
  const toastFn =
    typeof showToast === 'function'
      ? showToast
      : (msg) => {
          if (typeof document === 'undefined') return;
          const el = document.getElementById('toast');
          if (el) {
            el.textContent = msg;
            el.className = 'toast show success';
            setTimeout(() => el.classList.remove('show'), 2600);
          }
        };

  if (success) {
    toastFn(`已複製邀請連結：${textToCopy}`);
  } else {
    if (typeof prompt === 'function') {
      prompt('請手動複製連結：', textToCopy);
    }
  }

  return textToCopy;
}

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
    this._totalSeconds = 120;
    this._toastTimer = null;

    this.myPersonalBest = null;

    this._buildDOM();
    this._bindEvents();
    this._checkUrlHash();
  }

  _buildDOM() {
    this.container.innerHTML = `
      <!-- 多人連線外層容器 -->
      <div id="mp-section" class="mp-section" hidden>

        <!-- 1. 大廳面板 (未進房時顯示) -->
        <div id="mp-lobby-card" class="card mp-card">
          <div class="card-title">🌐 多人房間大廳</div>
          <p class="desc">全員 2 分鐘同步試走競速！支援本地雙分頁多開或 Supabase Realtime 至多 100 人同房競賽。</p>
          <div class="form-row">
            <label for="mp-username">玩家暱稱：</label>
            <input type="text" id="mp-username" placeholder="輸入暱稱" maxlength="12" />
          </div>
          <div class="form-row">
            <label for="mp-roomid">房間代碼：</label>
            <input type="text" id="mp-roomid" placeholder="例如：101" maxlength="16" />
          </div>
          <div class="form-row" style="margin-top: 4px; margin-bottom: 6px;">
            <label for="mp-use-silver" style="width: auto; cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 0.88rem;">
              <input type="checkbox" id="mp-use-silver" />
              <span>☑ 啟用白色機器人變體 (Silver Robot)</span>
            </label>
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
              <span class="room-title">房間：<strong id="mp-room-title" class="room-title-code">---</strong></span>
              <span id="mp-net-badge" class="badge">廣播頻道</span>
              <span id="mp-variant-badge" class="badge" style="background: #455a64; color: #eceff1; display: none;">⚪ 白機器人</span>
            </div>
            <div class="room-header-btns">
              <button type="button" id="btn-room-cloud-settings" class="btn-sm" title="雲端連線設定">⚙️ 設定</button>
              <button type="button" id="btn-copy-link" class="btn-sm" title="複製房間邀請網址">📋 複製邀請</button>
              <button type="button" id="btn-leave-room" class="btn-sm btn-danger">離開</button>
            </div>
          </div>

          <!-- 在線玩家清單與得分 -->
          <div class="players-bar">
            <div class="label" id="mp-players-label">在線玩家 (<span id="mp-player-count">0</span> / 100)：</div>
            <div id="mp-player-chips" class="player-chips"></div>
          </div>

          <!-- 2A. 房間等待室面板 (LOBBY 階段顯示) -->
          <div id="mp-waiting-room" class="waiting-room-wrap">
            <div class="lobby-code-card">
              <div class="lobby-code-sub">房間代碼</div>
              <div class="lobby-code-huge room-code-display" id="lobby-room-code" data-id="mp-waiting-room-code">----</div>
              <div class="lobby-code-actions">
                <button type="button" id="btn-lobby-copy-link" class="btn-sm primary">📋 複製邀請連結</button>
              </div>
            </div>

            <!-- 房主變體設定開關 -->
            <div id="mp-lobby-host-variant" class="lobby-variant-row" style="display: none;">
              <label for="mp-lobby-use-silver" style="cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 0.88rem;">
                <input type="checkbox" id="mp-lobby-use-silver" />
                <span>☑ 啟用白色機器人變體 (Silver Robot)</span>
              </label>
            </div>

            <!-- 非房主變體狀態提示 -->
            <div id="mp-lobby-guest-variant" class="lobby-variant-info" style="display: none;">
              變體模式：<strong id="mp-lobby-variant-text" style="color: var(--accent);">標準 4 色模式</strong>
            </div>

            <!-- 大廳控制按鈕 -->
            <div class="lobby-controls">
              <button type="button" id="btn-lobby-start-game" class="btn-large-start" style="display: none;">
                🚀 開始遊戲
              </button>
              <button type="button" id="btn-lobby-waiting" class="btn-waiting" disabled style="display: none;">
                ⏳ 等待房主開始遊戲...
              </button>
            </div>
          </div>

          <!-- 2B. 競賽進行中面板 (RACING / ROUND_END / GAME_OVER 階段顯示) -->
          <div id="mp-racing-panel" class="racing-panel-wrap" style="display: none;">
            <!-- 17 題目標完成進度 -->
            <div class="target-progress-wrap card" style="padding: 8px 10px; background: rgba(0,0,0,0.2); margin-bottom: 8px;">
              <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 4px;">
                <span>🎯 目標牌堆進度：</span>
                <span id="mp-target-progress-text" style="font-weight: 700; color: var(--accent);">第 1 題 (已完成 0 / 17 題)</span>
              </div>
              <div class="progress-bar" style="height: 6px;">
                <div id="mp-target-progress-bar" class="progress-fill" style="width: 0%; background: #4fc3f7;"></div>
              </div>
            </div>

            <!-- 120 秒競速倒數計時器 -->
            <div id="mp-timer-wrap" class="timer-wrap">
              <div class="timer-info">
                <span class="timer-label">⏳ 2 分鐘同步競速倒數：</span>
                <span id="mp-timer-text" class="timer-seconds">120s</span>
              </div>
              <div class="progress-bar">
                <div id="mp-timer-bar" class="progress-fill" style="width: 100%;"></div>
              </div>
            </div>

            <!-- 階段指示橫幅 -->
            <div id="mp-phase-banner" class="phase-banner phase-countdown">
              🏃 同步競速中！請在本地棋盤自由試走，找出最短路徑
            </div>

            <!-- 個人最佳成績狀態卡 -->
            <div class="card my-pb-card" style="padding: 8px 12px; margin-bottom: 10px; background: #222938; border: 1px solid rgba(255,183,77,0.3);">
              <div style="font-size: 0.82rem; color: var(--muted);">你的本回合最佳 (PB)：</div>
              <div id="mp-my-pb" style="font-size: 1.15rem; font-weight: 700; color: var(--accent); margin-top: 2px;">
                尚未達陣（請嘗試滑動機器人）
              </div>
            </div>

            <!-- 本地試走輔助操作按鈕 -->
            <div class="sandbox-actions" style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 12px;">
              <button type="button" id="btn-mp-undo" class="btn-sm">↶ 復原 <kbd>Z</kbd></button>
              <button type="button" id="btn-mp-reset" class="btn-sm">⟲ 重回起點 <kbd>R</kbd></button>
            </div>

            <!-- 即時排行榜 -->
            <div class="leaderboard-wrap">
              <div class="label">🏆 即時步數排行榜（少者領先）：</div>
              <div id="mp-leaderboard" class="leaderboard-list">
                <div class="empty-lb">尚未有玩家達陣，全員試走中…</div>
              </div>
            </div>

            <!-- 房主專屬操作列 -->
            <div id="mp-host-controls" class="host-controls" hidden style="display: flex; gap: 6px; justify-content: flex-end; margin-top: 8px;">
              <button type="button" id="btn-host-settle" class="btn-sm">房主：提前結算</button>
              <button type="button" id="btn-host-next" class="primary btn-sm">房主：開始下一題 <kbd>N</kbd></button>
            </div>
          </div>
        </div>

        <!-- 3. 雲端連線設定彈窗 -->
        <div id="mp-settings-modal" class="modal" hidden>
          <div class="modal-box" style="text-align: left; max-width: 440px;">
            <h2 style="margin-top: 0; font-size: 1.25rem; color: var(--accent);">⚙️ 雲端連線設定</h2>
            <p style="font-size: 0.85rem; color: var(--muted); margin-bottom: 12px; line-height: 1.5;">
              預設使用瀏覽器原生 <strong>BroadcastChannel</strong> 進行本機多開雙分頁連線。<br/>
              若要進行跨裝置、手機或遠端百人連線，可免費至 <strong>Supabase</strong> 註冊專案並填寫憑證：
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
    this.mpSection = this.container.querySelector('#mp-section');
    this.lobbyCard = this.container.querySelector('#mp-lobby-card');
    this.roomCard = this.container.querySelector('#mp-room-card');

    this.inputName = this.container.querySelector('#mp-username');
    this.inputRoom = this.container.querySelector('#mp-roomid');
    this.inputUseSilver = this.container.querySelector('#mp-use-silver');

    this.roomTitle = this.container.querySelector('#mp-room-title');
    this.netBadge = this.container.querySelector('#mp-net-badge');
    this.variantBadge = this.container.querySelector('#mp-variant-badge');
    this.playerCount = this.container.querySelector('#mp-player-count');
    this.playerChips = this.container.querySelector('#mp-player-chips');

    // 等待室元件
    this.waitingRoom = this.container.querySelector('#mp-waiting-room');
    this.waitingRoomCode =
      this.container.querySelector('#lobby-room-code') ||
      this.container.querySelector('#mp-waiting-room-code') ||
      this.container.querySelector('.room-code-display');
    this.lobbyHostVariant = this.container.querySelector('#mp-lobby-host-variant');
    this.lobbyUseSilver = this.container.querySelector('#mp-lobby-use-silver');
    this.lobbyGuestVariant = this.container.querySelector('#mp-lobby-guest-variant');
    this.lobbyVariantText = this.container.querySelector('#mp-lobby-variant-text');
    this.btnLobbyStartGame = this.container.querySelector('#btn-lobby-start-game');
    this.btnLobbyWaiting = this.container.querySelector('#btn-lobby-waiting');

    // 競賽進行中元件
    this.racingPanel = this.container.querySelector('#mp-racing-panel');
    this.targetProgressText = this.container.querySelector('#mp-target-progress-text');
    this.targetProgressBar = this.container.querySelector('#mp-target-progress-bar');

    this.timerWrap = this.container.querySelector('#mp-timer-wrap');
    this.timerText = this.container.querySelector('#mp-timer-text');
    this.timerBar = this.container.querySelector('#mp-timer-bar');

    this.phaseBanner = this.container.querySelector('#mp-phase-banner');
    this.myPbText = this.container.querySelector('#mp-my-pb');
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
    // 建立房間（若無輸入代碼則自動隨機生成 4 碼數字代碼）
    this.container.querySelector('#btn-create-room').addEventListener('click', () => {
      const name = this._saveAndGetName();
      let roomId = this.inputRoom.value.trim();
      if (!roomId) {
        roomId = String(Math.floor(1000 + Math.random() * 9000));
        this.inputRoom.value = roomId;
      }
      const useSilver = Boolean(this.inputUseSilver?.checked);
      this._call('createRoom', { roomId, userName: name, useSilver });
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

    // 複製邀請連結 (頂部按鈕與大廳卡片按鈕)
    const copyLinkHandler = (e) => {
      e?.preventDefault?.();
      this.copyRoomInviteLink();
    };
    this.container.querySelector('#btn-copy-link')?.addEventListener('click', copyLinkHandler);
    this.container.querySelector('#btn-lobby-copy-link')?.addEventListener('click', copyLinkHandler);

    // 房主在大廳點擊開始遊戲
    this.btnLobbyStartGame?.addEventListener('click', () => {
      this._call('startGame');
    });

    // 房主在大廳切換白色機器人變體
    this.lobbyUseSilver?.addEventListener('change', (e) => {
      const checked = e.target.checked;
      this.setVariant(checked);
      this._call('lobbyVariantChanged', { useSilver: checked });
    });

    // 離開房間
    this.container.querySelector('#btn-leave-room').addEventListener('click', () => {
      if (confirm('確定要離開房間嗎？')) {
        this._call('leaveRoom');
      }
    });

    // 試走輔助操作按鈕 (Undo / Reset)
    this.container.querySelector('#btn-mp-undo').addEventListener('click', () => {
      this._call('undo');
    });
    this.container.querySelector('#btn-mp-reset').addEventListener('click', () => {
      this._call('reset');
    });

    // 房主下一題
    this.container.querySelector('#btn-host-next').addEventListener('click', () => {
      this._call('nextRound');
    });

    // 房主提前結算
    this.container.querySelector('#btn-host-settle')?.addEventListener('click', () => {
      if (confirm('確定要提前結算本回合嗎？')) {
        this._call('countdownExpired');
      }
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
      this._call('switchToMulti');
    }
  }

  _showToast(msg, type = 'info') {
    if (typeof this.h?.showToast === 'function') {
      this.h.showToast(msg, type);
      return;
    }
    if (typeof document !== 'undefined') {
      const el = document.getElementById('toast');
      if (el) {
        clearTimeout(this._toastTimer);
        el.textContent = msg;
        el.className = `toast show ${type}`;
        this._toastTimer = setTimeout(() => {
          el.classList.remove('show');
        }, 2600);
      }
    }
  }

  _getEffectiveRoomId() {
    const fromLobby = this.container.querySelector('#lobby-room-code')?.textContent?.trim();
    const fromMp = this.container.querySelector('#mp-waiting-room-code')?.textContent?.trim();
    const fromDisplay = this.container.querySelector('.room-code-display')?.textContent?.trim();
    const fromTitle = this.roomTitle?.textContent?.trim();
    const fromInput = this.inputRoom?.value?.trim();
    const code =
      this.roomInfo?.roomId ||
      fromLobby ||
      fromMp ||
      fromDisplay ||
      fromTitle ||
      fromInput ||
      '';
    if (code === '----' || code === '---') return '';
    return code;
  }

  async copyRoomInviteLink(roomId = null) {
    const code = roomId || this._getEffectiveRoomId();
    if (!code) {
      this._showToast('請先建立或加入房間', 'warn');
      return '';
    }
    return copyRoomInviteLink(code, {
      showToast: (msg) => this._showToast(msg, 'success'),
    });
  }

  _copyInviteLink() {
    return this.copyRoomInviteLink();
  }

  // ---------- 對外控制方法 ----------

  switchMode(mode) {
    this.currentMode = mode;
    const isMulti = mode === 'multi';
    this.mpSection.hidden = !isMulti;
  }

  setRoomCode(code) {
    const val = code ? String(code) : '';
    if (this.roomTitle) this.roomTitle.textContent = val || '---';
    const elements = this.container.querySelectorAll(
      '#lobby-room-code, #mp-waiting-room-code, .room-code-display'
    );
    elements.forEach((el) => {
      el.textContent = val || '----';
    });
  }

  updateLobbyInfo(info) {
    if (!info) return;
    if (info.roomId) {
      if (!this.roomInfo) this.roomInfo = {};
      this.roomInfo.roomId = String(info.roomId);
      this.setRoomCode(info.roomId);
    }
    if (info.useSilver !== undefined) {
      this.setVariant(Boolean(info.useSilver));
    }
  }

  setInRoom(inRoom, info = null) {
    this.inRoom = inRoom;
    this.roomInfo = info;
    if (info?.userId) this.currentUserId = info.userId;

    this.lobbyCard.hidden = inRoom;
    this.roomCard.hidden = !inRoom;

    if (inRoom && info) {
      const code = info.roomId ? String(info.roomId) : '';
      this.setRoomCode(code);
      this.netBadge.textContent =
        info.mode && info.mode.includes('Supabase') ? '☁ Supabase' : '⚡ 本地分頁廣播';
      this.setVariant(Boolean(info.useSilver));
      if (history.replaceState && code) {
        history.replaceState(null, '', `#room=${code}`);
      }
    } else {
      this.setRoomCode('');
      this.setVariant(false);
      this.stopTimer();
      if (history.replaceState) {
        history.replaceState(null, '', window.location.pathname);
      }
    }
  }

  setVariant(useSilver) {
    const silver = Boolean(useSilver);
    if (this.variantBadge) {
      this.variantBadge.style.display = silver ? 'inline-block' : 'none';
    }
    if (this.lobbyUseSilver) {
      this.lobbyUseSilver.checked = silver;
    }
    if (this.lobbyVariantText) {
      this.lobbyVariantText.textContent = silver ? '⚪ 白色機器人變體 (已啟用)' : '標準 4 色模式';
    }
  }

  updatePlayers(players = [], isHost = false) {
    if (this.roomInfo) this.roomInfo.isHost = isHost;
    if (this.roomInfo?.roomId) this.setRoomCode(this.roomInfo.roomId);
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

    if (this.currentPhase === ROOM_PHASE.LOBBY) {
      if (this.btnLobbyStartGame) this.btnLobbyStartGame.style.display = isHost ? 'block' : 'none';
      if (this.btnLobbyWaiting) this.btnLobbyWaiting.style.display = isHost ? 'none' : 'block';
      if (this.lobbyHostVariant) this.lobbyHostVariant.style.display = isHost ? 'block' : 'none';
      if (this.lobbyGuestVariant) this.lobbyGuestVariant.style.display = isHost ? 'none' : 'block';
    }
  }

  updateTargetProgress(round = 1, completedCount = 0, totalCount = 17) {
    if (this.targetProgressText) {
      this.targetProgressText.textContent = `第 ${round} 題 (已完成 ${completedCount} / ${totalCount} 題)`;
    }
    if (this.targetProgressBar) {
      const pct = Math.min(100, Math.max(0, (completedCount / totalCount) * 100));
      this.targetProgressBar.style.width = `${pct}%`;
    }
  }

  setPersonalBest(moves) {
    this.myPersonalBest = moves;
    if (this.myPbText) {
      if (moves) {
        this.myPbText.textContent = `🎯 ${moves} 步 (已送出至排行榜)`;
        this.myPbText.style.color = '#81c784';
      } else {
        this.myPbText.textContent = '尚未達陣（請嘗試滑動機器人）';
        this.myPbText.style.color = 'var(--accent)';
      }
    }
  }

  updatePhase(phase, phaseData = {}) {
    this.currentPhase = phase;
    this.phaseBanner.className = 'phase-banner';
    if (this.roomInfo?.roomId) this.setRoomCode(this.roomInfo.roomId);

    if (phase === ROOM_PHASE.LOBBY) {
      if (this.waitingRoom) this.waitingRoom.style.display = 'block';
      if (this.racingPanel) this.racingPanel.style.display = 'none';
      this.stopTimer();
      const isHost = Boolean(this.roomInfo?.isHost);
      if (this.btnLobbyStartGame) this.btnLobbyStartGame.style.display = isHost ? 'block' : 'none';
      if (this.btnLobbyWaiting) this.btnLobbyWaiting.style.display = isHost ? 'none' : 'block';
      if (this.lobbyHostVariant) this.lobbyHostVariant.style.display = isHost ? 'block' : 'none';
      if (this.lobbyGuestVariant) this.lobbyGuestVariant.style.display = isHost ? 'none' : 'block';
      return;
    }

    if (this.waitingRoom) this.waitingRoom.style.display = 'none';
    if (this.racingPanel) this.racingPanel.style.display = 'block';

    switch (phase) {
      case ROOM_PHASE.RACING:
      case ROOM_PHASE.COUNTDOWN:
        this.phaseBanner.classList.add('phase-countdown');
        this.phaseBanner.textContent = '🏃 同步競速中！請在本地棋盤自由試走，找出最短路徑';
        if (phaseData.countdownEnd) {
          this.startTimer(phaseData.countdownEnd, phaseData.countdownDuration || 120);
        }
        break;

      case ROOM_PHASE.ROUND_END:
        this.phaseBanner.classList.add('phase-end');
        this.phaseBanner.textContent = '🏁 回合結算：棋盤已鎖定，等待房主開啟下一輪';
        this.stopTimer();
        break;

      case ROOM_PHASE.GAME_OVER:
        this.phaseBanner.classList.add('phase-end');
        this.phaseBanner.textContent = '🏆 17 題目標全部達成！遊戲圓滿結束！';
        this.stopTimer();
        break;

      default:
        break;
    }
  }

  startTimer(countdownEnd, durationSec = 120) {
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
  }

  updateLeaderboard(bids = []) {
    if (!bids || bids.length === 0) {
      this.leaderboardEl.innerHTML = '<div class="empty-lb">尚未有玩家達陣，全員試走中…</div>';
      return;
    }

    this.leaderboardEl.innerHTML = '';
    const minMoves = bids[0]?.moves;

    bids.forEach((bid, idx) => {
      const item = document.createElement('div');
      item.className = 'lb-item';
      if (bid.playerId === this.currentUserId) item.classList.add('is-me');

      let badgeHtml = '';
      if (bid.moves === minMoves) {
        badgeHtml = '<span class="status-tag active">領先 👑</span>';
      }

      item.innerHTML = `
        <span class="lb-rank">#${idx + 1}</span>
        <span class="lb-name">${bid.playerName}${bid.playerId === this.currentUserId ? ' (你)' : ''}</span>
        <span class="lb-moves">${bid.moves} 步</span>
        ${badgeHtml}
      `;
      this.leaderboardEl.appendChild(item);
    });
  }
}
