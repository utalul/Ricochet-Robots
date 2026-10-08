import { MSG_TYPE } from './RoomManager.js';

function normalizeSnapshot(originalRoomId, data) {
  if (!data) return null;
  const snapshot = data.snapshot || data;
  const boardConfig = data.boardConfig || snapshot.boardConfig;
  if (!Array.isArray(boardConfig) || boardConfig.length !== 4) return null;

  return {
    roomId: String(data.roomId || snapshot.roomId || originalRoomId),
    hostId: data.hostId || snapshot.hostId || data.hostPlayerId || snapshot.hostPlayerId || null,
    hostPlayerId: data.hostPlayerId || data.hostId || snapshot.hostPlayerId || null,
    status: data.status || snapshot.status || 'WAITING',
    boardConfig,
    robotPositions: data.robotPositions || snapshot.robotPositions || snapshot.initialRobots,
    useSilver: data.useSilver ?? snapshot.useSilver ?? false,
    players: data.players || data.members || snapshot.players || [],
    started: Boolean(data.started ?? snapshot.started ?? (data.phase && data.phase !== 'LOBBY')),
    phase: data.phase || snapshot.phase || 'LOBBY',
    round: data.round || snapshot.round || 0,
    target: data.target || snapshot.target || null,
  };
}

/** Ask the room host or cloud database for a current snapshot when the room is not in local storage. */
export async function discoverRoomSnapshot(roomManager, roomId, userName, { timeoutMs = 5000 } = {}) {
  const cleanId = String(roomId).replace(/[^a-zA-Z0-9]/g, '');

  // 1. 優先直接自雲端（Firebase）或快取讀取
  try {
    const directSnap = await roomManager.fetchRoomSnapshot(roomId);
    const normalized = normalizeSnapshot(roomId, directSnap);
    if (normalized) {
      return normalized;
    }
  } catch (err) {
    // 忽略，繼續執行監聽發現
  }

  // 2. 設置廣播/即時事件監聽器 (相容 Mock 測試與即時房主回覆)
  let unsubscribe = [];
  let timeout;
  let requestTimer;
  let settle;

  const result = new Promise((resolve) => {
    settle = resolve;
    const receive = (message) => {
      const data = message?.payload || message || {};
      const normalized = normalizeSnapshot(roomId, data);
      if (normalized) {
        resolve(normalized);
      }
    };

    for (const event of [MSG_TYPE.ROOM_SYNC, MSG_TYPE.ROOM_SYNC_PAYLOAD, MSG_TYPE.SYNC_STATE]) {
      unsubscribe.push(roomManager.on(event, receive));
    }
  });

  try {
    await roomManager.connect(String(roomId), userName, false);

    const sendDiscoveryRequest = async () => {
      roomManager.send(MSG_TYPE.REQUEST_ROOM_SYNC, {
        sender: { id: roomManager.userId, name: userName },
      });
      // 同步重試遠端讀取（防短暫延遲）
      try {
        const snap = await roomManager.fetchRoomSnapshot(roomId);
        const norm = normalizeSnapshot(roomId, snap);
        if (norm && settle) {
          settle(norm);
        }
      } catch (e) {}
    };

    sendDiscoveryRequest();
    requestTimer = setInterval(sendDiscoveryRequest, 500);
    timeout = setTimeout(() => settle(null), timeoutMs);
    return await result;
  } finally {
    clearTimeout(timeout);
    clearInterval(requestTimer);
    unsubscribe.forEach((off) => off());
  }
}
