/**
 * main.js
 * 碰撞機器人 (Ricochet Robots) 主程式。
 * 整合：
 * 1. 【🕹️ 單人自由模式】：無時限、自由試走、復原 (Z)、重設起點 (R)、下一題 (N)、洗牌開大地圖 (M)。
 * 2. 【🌐 多人即時競賽】：全員 2 分鐘 (120s) 同步試走競賽、回報個人最佳解 (PB)、自動結算最低步數、17 題完賽頒獎台 (Podium)。
 */
import { assembleBigBoard, collectTargets } from './core/BoardAssembler.js';
import { GameState, GOAL_REASON, isVortexTarget } from './core/GameState.js';
import {
  pickQuadrantBoards,
  randomRobotPositions,
  createTargetDeck,
  drawTarget,
} from './core/RoundFactory.js';
import { ROBOT_COLORS } from './core/constants.js';
import { BoardRenderer, createTargetIcon } from './ui/BoardRenderer.js';
import { InputController } from './ui/InputController.js';
import { RoomManager, MSG_TYPE } from './network/RoomManager.js';
import { RoomState, ROOM_PHASE, BID_STATUS } from './network/RoomState.js';
import { MultiplayerHUD } from './ui/MultiplayerHUD.js';

const DATA_URL = new URL('./data/boards.json', import.meta.url);
const FALLBACK_DATA_URL = new URL('./data/sample_boards.json', import.meta.url);

const COLOR_NAMES = Object.freeze({
  red: '紅色',
  blue: '藍色',
  yellow: '黃色',
  green: '綠色',
  silver: '白色',
  white: '白色',
  multi: '彩色',
  vortex: '彩色',
});

const ROBOT_NAMES = Object.freeze({
  red: '紅',
  blue: '藍',
  yellow: '黃',
  green: '綠',
  silver: '白',
  white: '白',
});

const SHAPE_NAMES = Object.freeze({
  star: '星星',
  moon: '月亮',
  planet: '行星',
  gear: '齒輪',
  vortex: '漩渦',
});

const DIR_NAMES = Object.freeze({
  up: '▲ 上',
  down: '▼ 下',
  left: '◀ 左',
  right: '▶ 右',
});

// ---------- DOM 參照 ----------
const elBoard = document.getElementById('board');
const elAppSubtitle = document.getElementById('app-subtitle');
const elTabSolo = document.getElementById('tab-solo');
const elTabMulti = document.getElementById('tab-multi');
const elTargetIcon = document.getElementById('target-icon');
const elTargetText = document.getElementById('target-text');
const elTargetCardLabel = document.getElementById('target-card-label');
const elMoveCount = document.getElementById('move-count');
const elSolvedCount = document.getElementById('solved-count');
const elSoloStats = document.getElementById('solo-stats');
const elHistory = document.getElementById('history');
const elHistoryCard = document.getElementById('history-card');
const elBtnUndo = document.getElementById('btn-undo');
const elBtnReset = document.getElementById('btn-reset');
const elBtnNext = document.getElementById('btn-next');
const elBtnNewGame = document.getElementById('btn-newgame');
const elToast = document.getElementById('toast');

// 白色機器人變體元件
const elToggleSilver = document.getElementById('toggle-silver-robot');
const elBtnRobotSilver = document.getElementById('btn-robot-silver');
const elRobotSelectContainer = document.getElementById('robot-select-container');
const elRobotSelectLabel = document.getElementById('robot-select-label');

// 單人通關彈窗
const elModal = document.getElementById('modal');
const elModalTitle = document.getElementById('modal-title');
const elModalDetail = document.getElementById('modal-detail');
const elModalNext = document.getElementById('modal-next');

// 多人回合結算彈窗
const elRoundModal = document.getElementById('round-modal');
const elRoundModalEmoji = document.getElementById('round-modal-emoji');
const elRoundModalTitle = document.getElementById('round-modal-title');
const elRoundModalDetail = document.getElementById('round-modal-detail');
const elBtnRoundModalNext = document.getElementById('btn-round-modal-next');
const elBtnRoundModalClose = document.getElementById('btn-round-modal-close');

// 17 題終局頒獎台彈窗
const elGameOverModal = document.getElementById('gameover-modal');
const elGameOverSummary = document.getElementById('gameover-summary');
const elGameOverPodium = document.getElementById('gameover-podium');
const elBtnRestartGame = document.getElementById('btn-restart-game');
const elBtnCloseGameOver = document.getElementById('btn-close-gameover');

const elMpContainer = document.getElementById('mp-container');
let robotButtons = Array.from(document.querySelectorAll('.robot-btn'));

// ---------- 全域狀態 ----------
let currentMode = 'solo'; // 'solo' | 'multi'
let useSilverRobot = false; // 是否啟用白色機器人變體

// 地圖與牌庫
let allBoards = [];
let currentGrid = null;
let currentQuadBoards = [];
let targetDeck = [];
let currentTarget = null;
let selectedRobot = 'red';
let toastTimer = null;

// 單機狀態
const soloGameState = new GameState();
let soloSolvedCount = 0;
let isSoloModalOpen = false;

// 多人連線狀態
const roomManager = new RoomManager();
const roomState = new RoomState({ countdownDuration: 120 });
const localMultiGameState = new GameState(); // 玩家自己在多人模式中的本地獨立試走棋盤
let mpHUD = null;
let localPbMoves = null; // 本回合個人最佳步數

// UI 模組
let renderer = null;
let inputController = null;

// ---------- UI 提示與彈窗輔助函式 ----------

function showToast(message, type = 'info', durationMs = 2600) {
  if (!elToast) return;
  clearTimeout(toastTimer);
  elToast.textContent = message;
  elToast.className = `toast show ${type}`;
  toastTimer = setTimeout(() => {
    elToast.classList.remove('show');
  }, durationMs);
}

function showSoloModal(title, detailHtml) {
  if (!elModal) return;
  elModalTitle.textContent = title;
  elModalDetail.innerHTML = detailHtml;
  elModal.removeAttribute('hidden');
  isSoloModalOpen = true;
  elModalNext?.focus();
}

function hideSoloModal() {
  if (!elModal) return;
  elModal.setAttribute('hidden', '');
  isSoloModalOpen = false;
}

function showRoundModal(title, detailHtml, isDraw = false) {
  if (!elRoundModal) return;
  elRoundModalEmoji.textContent = isDraw ? '⌛' : '🏁';
  elRoundModalTitle.textContent = title;
  elRoundModalDetail.innerHTML = detailHtml;
  elRoundModal.removeAttribute('hidden');
  if (elBtnRoundModalNext) {
    elBtnRoundModalNext.style.display = roomManager.isHost ? 'inline-block' : 'none';
  }
}

function hideRoundModal() {
  if (!elRoundModal) return;
  elRoundModal.setAttribute('hidden', '');
}

function showGameOverModal() {
  if (!elGameOverModal) return;
  hideRoundModal();
  hideSoloModal();

  const podium = currentMode === 'multi' ? roomState.getPodium() : null;

  if (currentMode === 'multi' && podium) {
    if (podium.isTie) {
      const names = podium.champions.map((c) => `【${c.name}】`).join(' 與 ');
      elGameOverSummary.innerHTML = `🤝 <strong>平手共享榮譽！</strong> ${names} 各得 <strong>${podium.topScore}★</strong> 共同獲勝！`;
    } else if (podium.champions.length > 0) {
      const champ = podium.champions[0];
      elGameOverSummary.innerHTML = `👑 <strong>榮譽冠軍：【${champ.name}】</strong> 以 <strong>${podium.topScore}★</strong> 奪得最高分！`;
    } else {
      elGameOverSummary.textContent = '17 題已全數結束！';
    }

    // 渲染頒獎排行榜
    elGameOverPodium.innerHTML = '';
    const medals = ['🥇', '🥈', '🥉'];
    podium.rankings.forEach((p, idx) => {
      const row = document.createElement('div');
      row.className = 'podium-rank-item';
      if (idx === 0) row.classList.add('champion');

      const medal = medals[idx] || `#${idx + 1}`;
      const isMe = p.id === roomManager.userId ? ' (你)' : '';
      row.innerHTML = `
        <span class="podium-medal">${medal}</span>
        <span class="podium-name">${p.name}${isMe}</span>
        <span class="podium-score">${p.score || 0}★</span>
      `;
      elGameOverPodium.appendChild(row);
    });
  } else {
    // 單人模式完賽
    elGameOverSummary.innerHTML = '🎉 <strong>太厲害了！</strong> 您已獨立解開全部 17 道官方難題！';
    elGameOverPodium.innerHTML = `
      <div class="podium-rank-item champion" style="text-align: center; justify-content: center; padding: 14px;">
        <span>🏆 恭喜通關碰撞機器人單人挑戰！</span>
      </div>
    `;
  }

  elGameOverModal.removeAttribute('hidden');
}

function hideGameOverModal() {
  if (!elGameOverModal) return;
  elGameOverModal.setAttribute('hidden', '');
}

function getTargetDescription(target) {
  if (!target) return '無目標';
  if (isVortexTarget(target)) {
    return '請將 <strong class="hl" style="color:#ba68c8">【任意機器人】</strong> 移動至 <strong class="hl" style="color:#ba68c8">【彩色漩渦】</strong>';
  }
  const colorName = COLOR_NAMES[target.color] ?? target.color;
  const shapeName = SHAPE_NAMES[target.shape] ?? target.shape;
  return `請將 <strong class="hl">${colorName}機器人</strong> 移動至 <strong class="hl">${colorName}${shapeName}</strong>`;
}

/** 取得當前模式活躍中的 GameState */
function getActiveGameState() {
  if (currentMode === 'multi' && mpHUD?.inRoom) {
    return localMultiGameState;
  }
  return soloGameState;
}

/** 刷新面板資訊 */
function updateHUD() {
  const activeGame = getActiveGameState();
  if (!activeGame || !activeGame.grid) return;

  if (currentMode === 'solo') {
    if (elMoveCount) elMoveCount.textContent = String(activeGame.moveCount);
    if (elSolvedCount) elSolvedCount.textContent = `${soloSolvedCount} / 17`;

    const canUndo = activeGame.history.length > 0;
    const canReset = activeGame.history.length > 0;
    if (elBtnUndo) elBtnUndo.disabled = !canUndo;
    if (elBtnReset) elBtnReset.disabled = !canReset;
    if (elBtnNext) elBtnNext.disabled = false;
    if (elBtnNewGame) elBtnNewGame.disabled = false;
  } else {
    // 多人模式
    if (mpHUD) {
      mpHUD.updateTargetProgress(
        roomState.round,
        roomState.completedTargets.length,
        roomState.totalTargetsCount
      );
    }
  }

  // 機器人選取按鈕外觀與步數計數
  robotButtons.forEach((btn) => {
    const c = btn.dataset.select;
    const isSel = c === selectedRobot;
    btn.setAttribute('aria-pressed', String(isSel));
    const countEl = btn.querySelector('.count');
    if (countEl) countEl.textContent = String(activeGame.countMovesOf(c));
  });

  // 移動歷史列表（單人模式顯示）
  if (elHistory && currentMode === 'solo') {
    if (activeGame.history.length === 0) {
      elHistory.innerHTML = '<li class="empty">尚未移動</li>';
    } else {
      elHistory.innerHTML = '';
      activeGame.history.forEach((h) => {
        const li = document.createElement('li');
        const robotName = ROBOT_NAMES[h.color] ?? h.color;
        const dirName = DIR_NAMES[h.direction] ?? h.direction;
        li.innerHTML = `<span class="dot sm ${h.color}"></span> ${robotName} ${dirName}`;
        elHistory.appendChild(li);
      });
      elHistory.scrollTop = elHistory.scrollHeight;
    }
  }
}

function updateRobotVariantUI(useSilver) {
  useSilverRobot = Boolean(useSilver);
  if (elToggleSilver) elToggleSilver.checked = useSilverRobot;
  if (elBtnRobotSilver) elBtnRobotSilver.style.display = useSilverRobot ? 'flex' : 'none';
  if (elRobotSelectContainer) elRobotSelectContainer.classList.toggle('has-silver', useSilverRobot);
  if (elRobotSelectLabel) {
    elRobotSelectLabel.innerHTML = useSilverRobot
      ? '選擇機器人 <span class="hint">（點棋盤或按 1–5）</span>'
      : '選擇機器人 <span class="hint">（點棋盤或按 1–4）</span>';
  }
  robotButtons = Array.from(document.querySelectorAll('.robot-btn'));
  if (!useSilverRobot && selectedRobot === 'silver') {
    selectedRobot = 'red';
  }
}

/** 切換選取的機器人 */
function selectRobot(color) {
  if (color === 'white') color = 'silver';
  const activeGame = getActiveGameState();
  const available = activeGame?.grid ? Object.keys(activeGame.getRobots()) : ROBOT_COLORS;
  if (!available.includes(color)) return;
  selectedRobot = color;
  if (activeGame?.grid) {
    renderer?.renderRobots(activeGame.getRobots(), selectedRobot, { animate: false });
  }
  updateHUD();
}

// ---------- 模式切換邏輯 ----------

function switchGameMode(mode) {
  currentMode = mode;
  const isMulti = mode === 'multi';

  elTabSolo.classList.toggle('active', !isMulti);
  elTabMulti.classList.toggle('active', isMulti);

  if (elSoloStats) elSoloStats.hidden = isMulti;
  if (elHistoryCard) elHistoryCard.hidden = isMulti;

  if (mpHUD) mpHUD.switchMode(mode);

  hideSoloModal();
  hideRoundModal();

  if (isMulti) {
    if (elAppSubtitle) {
      elAppSubtitle.textContent =
        '🌐 多人即時競賽 · 全員 120 秒同步試走競速，自動結算最佳有效解';
    }
    if (elTargetCardLabel) elTargetCardLabel.textContent = '多人本回合目標';

    // 若已在房間中，呈現多人遊戲棋盤
    if (mpHUD?.inRoom && roomState.grid) {
      updateRobotVariantUI(Boolean(roomState.useSilver));
      renderer.setBoard(roomState.grid);
      if (roomState.phase === ROOM_PHASE.LOBBY) {
        renderer.setTarget(null);
        if (roomState.initialRobots) {
          renderer.renderRobots(roomState.initialRobots, selectedRobot, { animate: false });
        }
        if (elTargetIcon) {
          elTargetIcon.innerHTML = '<span style="font-size: 1.8rem;">⏳</span>';
        }
        if (elTargetText) {
          elTargetText.innerHTML = '<span style="color: var(--muted);">等待房主點擊「開始遊戲」</span>';
        }
      } else {
        renderer.setTarget(roomState.target);
        renderer.renderRobots(localMultiGameState.getRobots(), selectedRobot, { animate: false });
        if (elTargetIcon) {
          elTargetIcon.innerHTML = '';
          elTargetIcon.appendChild(createTargetIcon(roomState.target, 40));
        }
        if (elTargetText) {
          elTargetText.innerHTML = getTargetDescription(roomState.target);
        }
      }
    }
  } else {
    // 切換回單人自由模式
    updateRobotVariantUI(Boolean(elToggleSilver?.checked));
    if (elAppSubtitle) {
      elAppSubtitle.textContent =
        '🕹️ 單人自由模式 · 無時間限制、自由試走、復原與洗牌';
    }
    if (elTargetCardLabel) elTargetCardLabel.textContent = '本回合目標';

    renderer.setBoard(currentGrid);
    renderer.setTarget(currentTarget);
    renderer.renderRobots(soloGameState.getRobots(), selectedRobot, { animate: false });
    if (elTargetIcon) {
      elTargetIcon.innerHTML = '';
      elTargetIcon.appendChild(createTargetIcon(currentTarget, 40));
    }
    if (elTargetText) {
      elTargetText.innerHTML = getTargetDescription(currentTarget);
    }
  }

  updateHUD();
}

// ---------- 核心移動處理 (單人自由模式 vs 多人同步競賽) ----------

function handleMove(direction) {
  if (isSoloModalOpen) return;
  if (!selectedRobot) selectedRobot = 'red';

  // ========== 多人連線 2 分鐘同步競速模式 ==========
  if (currentMode === 'multi' && mpHUD?.inRoom) {
    if (roomState.phase !== ROOM_PHASE.RACING) {
      if (roomState.phase === ROOM_PHASE.LOBBY) {
        showToast('⏳ 等待大廳中，請等待房主開始遊戲！', 'info', 2000);
      } else {
        showToast('🏁 本回合已結束結算中，棋盤已鎖定！請等待房主開始下一輪', 'info', 2200);
      }
      renderer.bump(selectedRobot, direction);
      return;
    }

    // 玩家在本地獨立 GameState 中自由試走
    const slide = localMultiGameState.applyMove(selectedRobot, direction);
    if (slide.moved) {
      renderer.drawTrail(selectedRobot, slide.path);
      renderer.renderRobots(localMultiGameState.getRobots(), selectedRobot, { animate: true });
      updateHUD();

      // 檢查是否達成目標
      const goal = localMultiGameState.checkGoalReached();
      if (goal.success) {
        const moves = localMultiGameState.moveCount;
        renderer.celebrate(roomState.target.x, roomState.target.y);

        // 檢查是否為玩家本回合個人最佳 (PB)
        if (localPbMoves === null || moves < localPbMoves) {
          localPbMoves = moves;
          roomState.reportSolution(roomManager.userId, moves, {
            path: slide.path,
            finalRobots: localMultiGameState.getRobots(),
          });
          roomManager.sendSolution(moves);
          mpHUD.setPersonalBest(moves);
          mpHUD.updateLeaderboard(roomState.getLeaderboard());

          showToast(`🎉 成功達陣！本回合個人最佳：${moves} 步（已回報至排行榜）`, 'success', 3000);
        } else {
          showToast(`達陣完成！已走 ${moves} 步（目前個人最佳仍為 ${localPbMoves} 步）`, 'info', 2000);
        }
      } else if (goal.reason === GOAL_REASON.NO_RICOCHET) {
        showToast('⚠️ 未轉向：抵達目標的機器人本身必須至少移動 2 次！', 'warn', 2500);
      }
    } else {
      renderer.bump(selectedRobot, direction);
    }
    return;
  }

  // ========== 單人自由模式 ==========
  const slide = soloGameState.applyMove(selectedRobot, direction);
  if (slide.moved) {
    renderer.drawTrail(selectedRobot, slide.path);
    renderer.renderRobots(soloGameState.getRobots(), selectedRobot, { animate: true });
    updateHUD();

    const check = soloGameState.checkGoalReached();
    if (check.success) {
      soloSolvedCount++;
      updateHUD();
      renderer.celebrate(currentTarget.x, currentTarget.y);
      const robotName = COLOR_NAMES[check.robot] ?? check.robot;

      if (soloSolvedCount >= 17) {
        showGameOverModal();
      } else {
        const detail = `花費 <strong>${soloGameState.moveCount}</strong> 步完成目標！<br>（${robotName}機器人移動 ${check.robotMoves} 次符合轉向規範）`;
        showSoloModal('🎉 恭喜通關！', detail);
      }
    } else if (check.reason === GOAL_REASON.NO_RICOCHET) {
      showToast('⚠️ 未轉向：抵達目標的機器人本身必須至少移動 2 次！', 'warn', 2800);
    } else if (check.reason === GOAL_REASON.WRONG_COLOR) {
      const curRobot = COLOR_NAMES[check.robot] ?? check.robot;
      const targetColor = COLOR_NAMES[currentTarget.color] ?? currentTarget.color;
      showToast(`⚠️ 目標要求【${targetColor}】，目前格上是【${curRobot}】機器人`, 'warn', 2200);
    }
  } else {
    renderer.bump(selectedRobot, direction);
  }
}

/** 復原上一步 (Z) */
function handleUndo() {
  if (currentMode === 'multi' && mpHUD?.inRoom) {
    if (roomState.phase !== ROOM_PHASE.RACING) return;
    if (localMultiGameState.history.length === 0) {
      showToast('已在起點，無法復原', 'info');
      return;
    }
    const undone = localMultiGameState.undo();
    if (undone) {
      renderer.renderRobots(localMultiGameState.getRobots(), selectedRobot, { animate: true });
      updateHUD();
    }
    return;
  }

  // 單機模式
  if (soloGameState.history.length === 0) {
    showToast('已在起點，無法復原', 'info');
    return;
  }
  const undone = soloGameState.undo();
  if (undone) {
    hideSoloModal();
    renderer.renderRobots(soloGameState.getRobots(), selectedRobot, { animate: true });
    updateHUD();
  }
}

/** 重設回合起點 (R) */
function handleReset() {
  if (currentMode === 'multi' && mpHUD?.inRoom) {
    if (roomState.phase !== ROOM_PHASE.RACING) return;
    localMultiGameState.resetToInitial();
    renderer.renderRobots(localMultiGameState.getRobots(), selectedRobot, { animate: true });
    updateHUD();
    showToast('棋盤已重回本題起點，可重新嘗試路線', 'info');
    return;
  }

  // 單機模式
  if (soloGameState.history.length === 0 && !isSoloModalOpen) {
    showToast('目前已在初始位置', 'info');
    return;
  }
  hideSoloModal();
  soloGameState.resetToInitial();
  renderer.renderRobots(soloGameState.getRobots(), selectedRobot, { animate: true });
  updateHUD();
  showToast('本回合已重設至起點', 'info');
}

/** 下一題 (N) */
function handleNextRound() {
  hideSoloModal();
  hideRoundModal();

  if (currentMode === 'multi') {
    if (!roomManager.isHost) {
      showToast('只有房主可以開啟下一輪', 'info');
      return;
    }
    startMultiplayerRound();
    return;
  }

  // 單人自由模式：機器人保留在當前位置做為新回合起點
  if (targetDeck.length === 0) {
    const targets = collectTargets(currentGrid);
    targetDeck = createTargetDeck(targets);
    showToast('17 張目標已全數輪替，牌堆已重新洗牌！', 'info');
  }

  const nextTarget = drawTarget(targetDeck, soloGameState.getRobots());
  if (!nextTarget) {
    showToast('無可用目標', 'warn');
    return;
  }
  currentTarget = nextTarget;
  soloGameState.initRound(currentGrid, soloGameState.getRobots(), currentTarget);

  if (elTargetIcon) {
    elTargetIcon.innerHTML = '';
    elTargetIcon.appendChild(createTargetIcon(currentTarget, 40));
  }
  if (elTargetText) {
    elTargetText.innerHTML = getTargetDescription(currentTarget);
  }

  renderer.setTarget(currentTarget);
  renderer.renderRobots(soloGameState.getRobots(), selectedRobot, { animate: false });
  updateHUD();
  showToast(`第 ${soloSolvedCount + 1} 題已開始！`, 'info');
}

/** 重新隨機洗牌組地圖 (M) */
function handleNewGame() {
  hideSoloModal();
  hideGameOverModal();

  try {
    currentQuadBoards = pickQuadrantBoards(allBoards);
    currentGrid = assembleBigBoard(...currentQuadBoards);
    const targets = collectTargets(currentGrid);
    targetDeck = createTargetDeck(targets);
    const initialRobots = randomRobotPositions(currentGrid, Math.random, {
      useSilver: useSilverRobot,
    });
    currentTarget = drawTarget(targetDeck, initialRobots);
    soloSolvedCount = 0;

    soloGameState.initRound(currentGrid, initialRobots, currentTarget);

    renderer.setBoard(currentGrid);
    renderer.setTarget(currentTarget);
    renderer.renderRobots(soloGameState.getRobots(), selectedRobot, { animate: false });

    if (elTargetIcon) {
      elTargetIcon.innerHTML = '';
      elTargetIcon.appendChild(createTargetIcon(currentTarget, 40));
    }
    if (elTargetText) {
      elTargetText.innerHTML = getTargetDescription(currentTarget);
    }

    updateHUD();
    showToast('全新 16×16 地圖與 17 題牌堆已建立！', 'success');
  } catch (err) {
    console.error('新開局失敗:', err);
    showToast('開局失敗：' + err.message, 'warn');
  }
}

// ---------- 多人連線網路事件處理 ----------

function setupMultiplayerNetwork() {
  // 1. 玩家加入
  roomManager.on(MSG_TYPE.PLAYER_JOIN, ({ payload }) => {
    roomState.addPlayer(payload.player);
    mpHUD.updatePlayers(roomState.getPlayerList(), roomManager.isHost);
    showToast(`👋 玩家【${payload.player.name}】加入了房間！`, 'info', 2000);

    // 房主發送全狀態同步
    if (roomManager.isHost) {
      const quadIds = currentQuadBoards.map((b) => b.board_id);
      roomManager.sendSyncResponse(payload.player.id, {
        snapshot: roomState.serialize(),
        quadBoardIds: quadIds,
      });
    }
  });

  // 2. 玩家離開
  roomManager.on(MSG_TYPE.PLAYER_LEAVE, ({ payload }) => {
    const p = roomState.getPlayer(payload.playerId);
    const pName = p ? p.name : '玩家';
    roomState.removePlayer(payload.playerId);
    mpHUD.updatePlayers(roomState.getPlayerList(), roomManager.isHost);
    showToast(`🚪 玩家【${pName}】離開了房間`, 'info', 2000);
  });

  // 3. 狀態請求與同步
  roomManager.on(MSG_TYPE.SYNC_REQUEST, ({ payload }) => {
    if (roomManager.isHost) {
      const quadIds = currentQuadBoards.map((b) => b.board_id);
      roomManager.sendSyncResponse(payload.requesterId, {
        snapshot: roomState.serialize(),
        quadBoardIds: quadIds,
      });
    }
  });

  roomManager.on(MSG_TYPE.SYNC_RESPONSE, ({ payload }) => {
    if (payload.targetPlayerId && payload.targetPlayerId !== roomManager.userId) return;

    if (payload.snapshot) {
      if (payload.quadBoardIds && payload.quadBoardIds.length === 4) {
        currentQuadBoards = payload.quadBoardIds.map(
          (id) => allBoards.find((b) => b.board_id === id) || allBoards[0]
        );
        currentGrid = assembleBigBoard(...currentQuadBoards);
        renderer.setBoard(currentGrid);
      }

      roomState.deserialize(payload.snapshot, currentGrid);
      if (payload.snapshot?.roomId) {
        roomState.roomId = payload.snapshot.roomId;
        if (mpHUD.roomInfo) mpHUD.roomInfo.roomId = payload.snapshot.roomId;
        mpHUD.setRoomCode?.(payload.snapshot.roomId);
      }
      const target = roomState.target;
      const useSilver = Boolean(
        payload.snapshot?.useSilver ||
          (payload.snapshot?.initialRobots && payload.snapshot.initialRobots.silver)
      );
      updateRobotVariantUI(useSilver);
      if (mpHUD) mpHUD.setVariant(useSilver);

      if (roomState.phase === ROOM_PHASE.LOBBY) {
        renderer.setTarget(null);
        if (roomState.initialRobots) {
          renderer.renderRobots(roomState.initialRobots, selectedRobot, { animate: false });
        }
        if (elTargetIcon) {
          elTargetIcon.innerHTML = '<span style="font-size: 1.8rem;">⏳</span>';
        }
        if (elTargetText) {
          elTargetText.innerHTML = '<span style="color: var(--muted);">等待房主開始遊戲...</span>';
        }
        mpHUD.updatePhase(ROOM_PHASE.LOBBY);
      } else {
        if (target) {
          renderer.setTarget(target);
          if (elTargetIcon) {
            elTargetIcon.innerHTML = '';
            elTargetIcon.appendChild(createTargetIcon(target, 40));
          }
          if (elTargetText) {
            elTargetText.innerHTML = getTargetDescription(target);
          }
        }

        if (roomState.initialRobots && target) {
          localMultiGameState.initRound(currentGrid, roomState.initialRobots, target);
          renderer.renderRobots(localMultiGameState.getRobots(), selectedRobot, { animate: false });
        }

        mpHUD.updateLeaderboard(roomState.getLeaderboard());
        mpHUD.updateTargetProgress(
          roomState.round,
          roomState.completedTargets.length,
          roomState.totalTargetsCount
        );
        mpHUD.updatePhase(roomState.phase, {
          countdownEnd: roomState.countdownEnd,
          countdownDuration: roomState.countdownDuration,
        });
      }

      mpHUD.updatePlayers(roomState.getPlayerList(), roomManager.isHost);
      updateHUD();
      showToast('已同步房間最新狀態！', 'success', 2000);
    }
  });

  // 4. 房主啟動遊戲廣播 (START_GAME)
  roomManager.on(MSG_TYPE.START_GAME, ({ payload }) => {
    if (payload.quadBoardIds && payload.quadBoardIds.length === 4) {
      currentQuadBoards = payload.quadBoardIds.map(
        (id) => allBoards.find((b) => b.board_id === id) || allBoards[0]
      );
      currentGrid = assembleBigBoard(...currentQuadBoards);
      renderer.setBoard(currentGrid);
    }

    const useSilver = Boolean(
      payload.useSilver || (payload.initialRobots && payload.initialRobots.silver)
    );
    updateRobotVariantUI(useSilver);
    if (mpHUD) mpHUD.setVariant(useSilver);

    roomState.startRound({
      grid: currentGrid,
      initialRobots: payload.initialRobots,
      target: payload.target,
      round: payload.round || 1,
      duration: payload.duration || 120,
      useSilver,
      phase: ROOM_PHASE.RACING,
    });

    localMultiGameState.initRound(currentGrid, payload.initialRobots, payload.target);
    localPbMoves = null;

    renderer.setTarget(payload.target);
    renderer.renderRobots(localMultiGameState.getRobots(), selectedRobot, { animate: false });

    if (elTargetIcon) {
      elTargetIcon.innerHTML = '';
      elTargetIcon.appendChild(createTargetIcon(payload.target, 40));
    }
    if (elTargetText) {
      elTargetText.innerHTML = getTargetDescription(payload.target);
    }

    hideSoloModal();
    hideRoundModal();

    mpHUD.setPersonalBest(null);
    mpHUD.updateLeaderboard([]);
    mpHUD.updateTargetProgress(payload.round || 1, roomState.completedTargets.length, 17);
    mpHUD.updatePhase(ROOM_PHASE.RACING, {
      countdownEnd: roomState.countdownEnd,
      countdownDuration: roomState.countdownDuration || 120,
    });

    updateHUD();
    showToast(`🔔 房主已啟動遊戲！第 1 題 2 分鐘同步競速倒數啟動！`, 'info', 3200);
  });

  // 5. 大廳設定同步（如白色機器人開關）
  roomManager.on(MSG_TYPE.LOBBY_UPDATE, ({ payload }) => {
    if (payload.useSilver !== undefined) {
      roomState.useSilver = Boolean(payload.useSilver);
      updateRobotVariantUI(roomState.useSilver);
      if (mpHUD) mpHUD.setVariant(roomState.useSilver);
    }
    if (payload.initialRobots && currentGrid) {
      roomState.initialRobots = payload.initialRobots;
      renderer.renderRobots(roomState.initialRobots, selectedRobot, { animate: false });
    }
  });

  // 6. 新回合開局廣播
  roomManager.on(MSG_TYPE.NEW_ROUND, ({ payload }) => {
    if (payload.quadBoardIds && payload.quadBoardIds.length === 4) {
      currentQuadBoards = payload.quadBoardIds.map(
        (id) => allBoards.find((b) => b.board_id === id) || allBoards[0]
      );
      currentGrid = assembleBigBoard(...currentQuadBoards);
      renderer.setBoard(currentGrid);
    }

    const useSilver = Boolean(
      payload.useSilver || (payload.initialRobots && payload.initialRobots.silver)
    );
    updateRobotVariantUI(useSilver);
    if (mpHUD) mpHUD.setVariant(useSilver);

    roomState.startRound({
      grid: currentGrid,
      initialRobots: payload.initialRobots,
      target: payload.target,
      round: payload.round,
      duration: payload.duration || 120,
      useSilver,
    });

    localMultiGameState.initRound(currentGrid, payload.initialRobots, payload.target);
    localPbMoves = null;

    renderer.setTarget(payload.target);
    renderer.renderRobots(localMultiGameState.getRobots(), selectedRobot, { animate: false });

    if (elTargetIcon) {
      elTargetIcon.innerHTML = '';
      elTargetIcon.appendChild(createTargetIcon(payload.target, 40));
    }
    if (elTargetText) {
      elTargetText.innerHTML = getTargetDescription(payload.target);
    }

    hideSoloModal();
    hideRoundModal();

    mpHUD.setPersonalBest(null);
    mpHUD.updateLeaderboard([]);
    mpHUD.updateTargetProgress(payload.round, roomState.completedTargets.length, 17);
    mpHUD.updatePhase(ROOM_PHASE.RACING, {
      countdownEnd: roomState.countdownEnd,
      countdownDuration: roomState.countdownDuration,
    });

    updateHUD();
    showToast(`🔔 第 ${payload.round} 題開始！2 分鐘同步競速倒數啟動！`, 'info', 3200);
  });

  // 5. 收到其他玩家回報個人最佳步數 (PB)
  const handleSolutionMsg = ({ payload }) => {
    const res = roomState.reportSolution(payload.playerId, payload.moves, {
      timestamp: payload.timestamp,
    });
    if (res.accepted) {
      mpHUD.updateLeaderboard(roomState.getLeaderboard());
      showToast(`📢【${payload.playerName}】找到了 ${payload.moves} 步解法！`, 'info', 2200);
    }
  };
  roomManager.on(MSG_TYPE.REPORT_PB, handleSolutionMsg);
  roomManager.on(MSG_TYPE.BID, handleSolutionMsg); // 相容舊版 BID

  // 6. 回合結算同步廣播 (由房主發送)
  roomManager.on(MSG_TYPE.ROUND_END_SYNC, ({ payload }) => {
    if (payload.snapshot) {
      roomState.deserialize(payload.snapshot, currentGrid);
    }

    mpHUD.stopTimer();
    mpHUD.updatePhase(roomState.phase);
    mpHUD.updatePlayers(roomState.getPlayerList(), roomManager.isHost);
    mpHUD.updateLeaderboard(roomState.getLeaderboard());
    mpHUD.updateTargetProgress(
      roomState.round,
      roomState.completedTargets.length,
      roomState.totalTargetsCount
    );

    handleDisplayRoundOutcome(payload.endResult || {});
  });

  // 7. 重新開局同步廣播
  roomManager.on(MSG_TYPE.GAME_RESTART, ({ payload }) => {
    hideGameOverModal();
    hideRoundModal();
    if (payload.snapshot) {
      roomState.deserialize(payload.snapshot, currentGrid);
      const useSilver = Boolean(roomState.useSilver);
      updateRobotVariantUI(useSilver);
      if (mpHUD) mpHUD.setVariant(useSilver);
    }
    mpHUD.updatePlayers(roomState.getPlayerList(), roomManager.isHost);
    showToast('房主已重啟新的一局！17 題重新開跑！', 'success', 3000);
  });
}

/** 呈現回合結算結果視窗 */
function handleDisplayRoundOutcome(result) {
  if (roomState.phase === ROOM_PHASE.GAME_OVER || result.gameOver) {
    showGameOverModal();
    return;
  }

  if (result.isDraw) {
    showRoundModal(
      '⌛ 本題流標！',
      '120 秒內無玩家達成有效目標。<br>該目標圓片已<strong>洗回剩餘牌堆</strong>，將於後續回合重新抽出！',
      true
    );
  } else if (result.winners && result.winners.length > 0) {
    const minMoves = result.minMoves;
    if (result.winners.length > 1) {
      const names = result.winners.map((w) => `【${w.playerName}】`).join('、');
      showRoundModal(
        '🎉 共同獲勝！',
        `${names} 同以 <strong>${minMoves}</strong> 步並列最佳解！<br>官方規則平手共享榮譽，<strong>各獲得 1★ 積分</strong>！`
      );
    } else {
      const w = result.winners[0];
      showRoundModal(
        '🏆 回合獲勝！',
        `【${w.playerName}】以 <strong>${minMoves}</strong> 步榮獲本回合最少步數！<br>成功贏得該目標圓片，<strong>獲得 1★ 積分</strong>！`
      );
    }
  } else {
    showRoundModal('🏁 回合結束', '本回合競賽結束，準備進入下一題。');
  }
}

/** 房主手動啟動遊戲（由等待大廳進入第 1 題） */
function startMultiplayerGame() {
  if (!roomManager.isHost) return;

  hideRoundModal();
  hideGameOverModal();

  if (!currentGrid) {
    currentQuadBoards = pickQuadrantBoards(allBoards);
    currentGrid = assembleBigBoard(...currentQuadBoards);
    renderer.setBoard(currentGrid);
  }

  const allTargets = collectTargets(currentGrid);
  roomState.setTargetDeck(createTargetDeck(allTargets));

  const useSilver = Boolean(roomState.useSilver);
  updateRobotVariantUI(useSilver);
  if (mpHUD) mpHUD.setVariant(useSilver);

  const initialRobots =
    roomState.initialRobots ||
    randomRobotPositions(currentGrid, Math.random, { useSilver });
  roomState.initialRobots = initialRobots;

  const target = drawTarget(roomState.targetDeck, initialRobots);
  if (!target) {
    showToast('無可用目標', 'warn');
    return;
  }

  roomState.startRound({
    grid: currentGrid,
    initialRobots,
    target,
    round: 1,
    duration: 120,
    useSilver,
    phase: ROOM_PHASE.RACING,
  });

  localMultiGameState.initRound(currentGrid, initialRobots, target);
  localPbMoves = null;

  renderer.setTarget(target);
  renderer.renderRobots(localMultiGameState.getRobots(), selectedRobot, { animate: false });

  if (elTargetIcon) {
    elTargetIcon.innerHTML = '';
    elTargetIcon.appendChild(createTargetIcon(target, 40));
  }
  if (elTargetText) {
    elTargetText.innerHTML = getTargetDescription(target);
  }

  mpHUD.setPersonalBest(null);
  mpHUD.updateLeaderboard([]);
  mpHUD.updateTargetProgress(1, 0, 17);
  mpHUD.updatePhase(ROOM_PHASE.RACING, {
    countdownEnd: roomState.countdownEnd,
    countdownDuration: 120,
  });

  updateHUD();

  // 廣播給房間內所有玩家：開始遊戲
  roomManager.sendStartGame({
    round: 1,
    quadBoardIds: currentQuadBoards.map((b) => b.board_id),
    initialRobots,
    target,
    duration: 120,
    useSilver,
  });

  showToast('🔔 遊戲正式開始！第 1 題 2 分鐘同步競速倒數！', 'info', 3200);
}

/** 房主在大廳切換白色機器人變體 */
function handleHostLobbyVariant(useSilver) {
  if (!roomManager.isHost) return;
  roomState.useSilver = Boolean(useSilver);
  updateRobotVariantUI(useSilver);
  if (mpHUD) mpHUD.setVariant(useSilver);

  if (currentGrid) {
    const initRobots = randomRobotPositions(currentGrid, Math.random, {
      useSilver: roomState.useSilver,
    });
    roomState.initialRobots = initRobots;
    renderer.renderRobots(initRobots, selectedRobot, { animate: false });
  }

  roomManager.sendLobbyUpdate({
    useSilver: roomState.useSilver,
    initialRobots: roomState.initialRobots,
  });
}

/** 房主開新回合（2 分鐘同步競速） */
function startMultiplayerRound() {
  if (!roomManager.isHost) return;

  hideRoundModal();
  hideGameOverModal();

  // 若牌堆尚未初始化，從地圖中蒐集 17 題
  if (!roomState.targetDeck || roomState.targetDeck.length === 0) {
    if (roomState.completedTargets.length >= 17) {
      showGameOverModal();
      return;
    }
    const allTargets = collectTargets(currentGrid || assembleBigBoard(...currentQuadBoards));
    roomState.setTargetDeck(createTargetDeck(allTargets));
  }

  const useSilver = Boolean(roomState.useSilver);
  updateRobotVariantUI(useSilver);
  if (mpHUD) mpHUD.setVariant(useSilver);

  // 機器人保留在當前位置做為新回合起點 (桌遊官方規則)
  const nextInitialRobots = localMultiGameState.grid
    ? localMultiGameState.getRobots()
    : roomState.initialRobots ||
      randomRobotPositions(currentGrid, Math.random, { useSilver });

  const nextTarget = drawTarget(roomState.targetDeck, nextInitialRobots);
  if (!nextTarget) {
    // 牌堆抽完，進入終局
    roomState.phase = ROOM_PHASE.GAME_OVER;
    mpHUD.updatePhase(ROOM_PHASE.GAME_OVER);
    showGameOverModal();
    return;
  }

  const roundNum = (roomState.round || 0) + 1;
  roomState.startRound({
    grid: currentGrid,
    initialRobots: nextInitialRobots,
    target: nextTarget,
    round: roundNum,
    duration: 120,
    useSilver,
  });

  localMultiGameState.initRound(currentGrid, nextInitialRobots, nextTarget);
  localPbMoves = null;

  renderer.setTarget(nextTarget);
  renderer.renderRobots(localMultiGameState.getRobots(), selectedRobot, { animate: false });

  if (elTargetIcon) {
    elTargetIcon.innerHTML = '';
    elTargetIcon.appendChild(createTargetIcon(nextTarget, 40));
  }
  if (elTargetText) {
    elTargetText.innerHTML = getTargetDescription(nextTarget);
  }

  mpHUD.setPersonalBest(null);
  mpHUD.updateLeaderboard([]);
  mpHUD.updateTargetProgress(roundNum, roomState.completedTargets.length, 17);
  mpHUD.updatePhase(ROOM_PHASE.RACING, {
    countdownEnd: roomState.countdownEnd,
    countdownDuration: 120,
  });

  updateHUD();

  // 廣播給房間內所有玩家
  roomManager.sendNewRound({
    round: roundNum,
    quadBoardIds: currentQuadBoards.map((b) => b.board_id),
    initialRobots: nextInitialRobots,
    target: nextTarget,
    duration: 120,
    useSilver,
  });

  showToast(`🔔 第 ${roundNum} 題開始！2 分鐘同步競速倒數！`, 'info', 3200);
}

/** 120 秒計時結束處理（由房主自動觸發結算） */
function handleCountdownExpired() {
  if (!roomManager.isHost) return;

  const endResult = roomState.endRound();
  mpHUD.stopTimer();
  mpHUD.updatePhase(roomState.phase);
  mpHUD.updatePlayers(roomState.getPlayerList(), true);
  mpHUD.updateLeaderboard(roomState.getLeaderboard());
  mpHUD.updateTargetProgress(
    roomState.round,
    roomState.completedTargets.length,
    roomState.totalTargetsCount
  );

  // 廣播結算狀態
  roomManager.sendRoundEndSync({
    snapshot: roomState.serialize(),
    endResult,
  });

  handleDisplayRoundOutcome(endResult);
}

/** 重新開始新的一局 */
function handleRestartGame() {
  hideGameOverModal();
  if (currentMode === 'multi') {
    if (!roomManager.isHost) {
      showToast('只有房主可以重啟新的一局', 'info');
      return;
    }
    const allTargets = collectTargets(currentGrid);
    roomState.restartGame(allTargets);
    roomManager.sendGameRestart({
      snapshot: roomState.serialize(),
    });
    startMultiplayerRound();
  } else {
    handleNewGame();
  }
}

// ---------- 初始化主程序 ----------

async function init() {
  try {
    renderer = new BoardRenderer(elBoard);

    // 載入版圖題庫
    let res = await fetch(DATA_URL).catch(() => null);
    if (!res || !res.ok) {
      res = await fetch(FALLBACK_DATA_URL);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    allBoards = data.boards;

    // 實例化多人 HUD
    mpHUD = new MultiplayerHUD({
      container: elMpContainer,
      handlers: {
        showToast: (msg, type) => showToast(msg, type),
        switchToMulti: () => switchGameMode('multi'),
        undo: () => handleUndo(),
        reset: () => handleReset(),
        nextRound: () => startMultiplayerRound(),
        startGame: () => startMultiplayerGame(),
        lobbyVariantChanged: ({ useSilver }) => handleHostLobbyVariant(useSilver),
        countdownExpired: () => handleCountdownExpired(),
        createRoom: async ({ roomId, userName, useSilver }) => {
          try {
            const info = await roomManager.createRoom(roomId, userName);
            const actualRoomId = info.roomId || roomId;
            info.roomId = actualRoomId;
            roomState.roomId = actualRoomId;
            roomState.phase = ROOM_PHASE.LOBBY;
            roomState.useSilver = Boolean(useSilver);
            updateRobotVariantUI(useSilver);
            info.useSilver = Boolean(useSilver);
            info.isHost = true;
            roomState.addPlayer({ id: info.userId, name: info.userName, isHost: true });

            // 初始化房間版圖（大地圖與機器人初始落點），目標蓋牌
            currentQuadBoards = pickQuadrantBoards(allBoards);
            currentGrid = assembleBigBoard(...currentQuadBoards);
            renderer.setBoard(currentGrid);

            const allTargets = collectTargets(currentGrid);
            roomState.setTargetDeck(createTargetDeck(allTargets));

            const initRobots = randomRobotPositions(currentGrid, Math.random, {
              useSilver: roomState.useSilver,
            });
            roomState.initialRobots = initRobots;
            renderer.setTarget(null);
            renderer.renderRobots(initRobots, selectedRobot, { animate: false });

            if (elTargetIcon) {
              elTargetIcon.innerHTML = '<span style="font-size: 1.8rem;">⏳</span>';
            }
            if (elTargetText) {
              elTargetText.innerHTML = '<span style="color: var(--muted);">等待房主點擊「開始遊戲」</span>';
            }

            mpHUD.setInRoom(true, info);
            mpHUD.setVariant(Boolean(useSilver));
            mpHUD.updatePhase(ROOM_PHASE.LOBBY);
            mpHUD.updatePlayers(roomState.getPlayerList(), true);
            showToast(`房間【${actualRoomId}】建立成功！等待玩家加入大廳 👑`, 'success');
          } catch (err) {
            console.error('建立房間失敗:', err);
            showToast('建立房間失敗：' + err.message, 'warn');
          }
        },
        joinRoom: async ({ roomId, userName }) => {
          try {
            const info = await roomManager.joinRoom(roomId, userName);
            const actualRoomId = info.roomId || roomId;
            info.roomId = actualRoomId;
            roomState.roomId = actualRoomId;
            roomState.phase = ROOM_PHASE.LOBBY;
            info.isHost = false;
            roomState.addPlayer({ id: info.userId, name: info.userName, isHost: false });
            mpHUD.setInRoom(true, info);
            mpHUD.updatePhase(ROOM_PHASE.LOBBY);
            mpHUD.updatePlayers(roomState.getPlayerList(), false);

            if (elTargetIcon) {
              elTargetIcon.innerHTML = '<span style="font-size: 1.8rem;">⏳</span>';
            }
            if (elTargetText) {
              elTargetText.innerHTML = '<span style="color: var(--muted);">等待房主開始遊戲...</span>';
            }

            showToast(`成功加入房間【${actualRoomId}】！正在同步遊戲大廳…`, 'success');
          } catch (err) {
            console.error('加入房間失敗:', err);
            showToast('加入房間失敗：' + err.message, 'warn');
          }
        },
        leaveRoom: async () => {
          await roomManager.leaveRoom();
          roomState.roomId = null;
          roomState.phase = ROOM_PHASE.LOBBY;
          roomState.players.clear();
          mpHUD.setInRoom(false);
          updateRobotVariantUI(Boolean(elToggleSilver?.checked));
          showToast('已離開房間', 'info');
        },
        settingsChanged: async ({ url, key }) => {
          try {
            await roomManager.reconfigure();
            const modeName = roomManager.mode;
            if (url && key) {
              showToast(`已成功套用 Supabase 設定！模式：${modeName}`, 'success', 3500);
            } else {
              showToast(`已還原為本地雙分頁模擬：${modeName}`, 'info', 3000);
            }
            if (mpHUD.inRoom && mpHUD.roomInfo) {
              mpHUD.roomInfo.mode = modeName;
              mpHUD.setInRoom(true, mpHUD.roomInfo);
            }
          } catch (err) {
            console.error('連線設定失敗:', err);
            showToast('連線設定失敗：' + err.message, 'warn');
          }
        },
      },
    });

    setupMultiplayerNetwork();

    // 頂部模式切換按鈕事件
    elTabSolo.addEventListener('click', () => switchGameMode('solo'));
    elTabMulti.addEventListener('click', () => switchGameMode('multi'));

    // 白色機器人變體選用開關 (單人模式)
    elToggleSilver?.addEventListener('change', (e) => {
      const checked = e.target.checked;
      updateRobotVariantUI(checked);
      if (currentMode === 'solo') {
        handleNewGame();
        showToast(
          checked
            ? '已啟用白色機器人變體（已重新開始新局）'
            : '已關閉白色機器人變體（已重新開始新局）',
          'info'
        );
      }
    });

    // 彈窗按鈕事件綁定
    elBtnRoundModalNext?.addEventListener('click', () => {
      handleNextRound();
    });
    elBtnRoundModalClose?.addEventListener('click', () => {
      hideRoundModal();
    });
    elBtnRestartGame?.addEventListener('click', () => {
      handleRestartGame();
    });
    elBtnCloseGameOver?.addEventListener('click', () => {
      hideGameOverModal();
    });

    // 綁定輸入控制器
    inputController = new InputController({
      boardElement: elBoard,
      controlsRoot: document.body,
      cellFromClient: (cx, cy) => renderer.cellFromClient(cx, cy),
      getRobots: () => {
        const active = getActiveGameState();
        return active?.grid ? active.getRobots() : {};
      },
      getSelected: () => selectedRobot,
      handlers: {
        select: (c) => selectRobot(c),
        move: (dir) => handleMove(dir),
        undo: () => handleUndo(),
        reset: () => handleReset(),
        next: () => handleNextRound(),
        newGame: () => handleNewGame(),
        confirm: () => {
          if (isSoloModalOpen) handleNextRound();
        },
        cancel: () => {
          if (isSoloModalOpen) hideSoloModal();
          hideRoundModal();
          hideGameOverModal();
        },
      },
    });
    inputController.attach();

    // 啟動單人自由模式第一局
    handleNewGame();
  } catch (err) {
    console.error('遊戲載入失敗:', err);
    if (elTargetText) {
      elTargetText.textContent = `載入失敗：${err.message}（請使用 HTTP 伺服器開啟，如 npm.cmd start）`;
    }
    showToast('遊戲載入失敗：' + err.message, 'warn', 5000);
  }
}

init();
