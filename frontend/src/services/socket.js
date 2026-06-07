// Quản lý WebSocket connection dưới dạng singleton.
// Tách khỏi api.js vì WS là stateful (tồn tại suốt session), api.js thì stateless.

const WS_PATH = import.meta.env.VITE_WS_URL || '/ws';

let ws = null;
const listeners = new Map(); // Map<eventType, callback>

let reconnectTimer = null;
let pingTimer = null;
let currentToken = null;
let intentionalClose = false;

// ─── Kết nối ─────────────────────────────────────────────────────────────────

export function connectSocket(token) {
  // Đóng socket cũ nếu đang tồn tại (ví dụ: token mới sau khi re-login)
  if (ws) {
    intentionalClose = true;
    ws.close();
    ws = null;
  }

  currentToken = token;
  intentionalClose = false;
  _connect(token);
}

function _connect(token) {
  // Build URL đầy đủ từ window.location vì WebSocket API không chấp nhận path tương đối.
  // Dùng wss:// khi trang chạy HTTPS để tránh mixed-content block của browser.
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}${WS_PATH}?token=${token}`;

  ws = new WebSocket(url);

  ws.onopen = () => {
    // Bắt đầu ping keepalive 30s — giữ kết nối không bị Nginx/firewall timeout
    clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      sendSocketMessage({ type: 'ping' });
    }, 30_000);
  };

  ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return; // JSON lỗi → bỏ qua, không crash
    }
    // session_replaced: server đóng tab này vì tab mới của cùng tài khoản đã kết nối
    // Bật intentionalClose trước khi onclose fire → ngăn reconnect vô tận
    if (msg.type === 'session_replaced') {
      intentionalClose = true;
      clearInterval(pingTimer);
      pingTimer = null;
    }
    const cb = listeners.get(msg.type);
    if (cb) cb(msg);
  };

  ws.onclose = (event) => {
    clearInterval(pingTimer);
    pingTimer = null;

    // code 4009 = bị thay thế bởi tab mới — không reconnect, listener đã được gọi qua onmessage
    if (event.code === 4009) return;

    // Chỉ reconnect khi mất mạng đột ngột — không reconnect khi logout
    if (!intentionalClose && currentToken) {
      reconnectTimer = setTimeout(() => _connect(currentToken), 3000);
    }
  };

  ws.onerror = () => {
    // onerror luôn đi kèm onclose → không cần xử lý thêm ở đây
  };
}

// ─── Ngắt kết nối ────────────────────────────────────────────────────────────

export function disconnectSocket() {
  intentionalClose = true;
  clearInterval(pingTimer);
  clearTimeout(reconnectTimer);
  pingTimer = null;
  reconnectTimer = null;
  currentToken = null;
  ws?.close();
  ws = null;
}

// ─── Gửi tin ─────────────────────────────────────────────────────────────────

export function sendSocketMessage(payload) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
  // Nếu socket chưa OPEN (đang reconnect): bỏ qua — caller tự retry nếu cần
}

// ─── Đăng ký / hủy listener ──────────────────────────────────────────────────

// Mỗi loại event chỉ có 1 listener — Map.set ghi đè nếu đăng ký lại.
// Thiết kế này đủ cho 1-1 chat: useWebSocket.js là nơi duy nhất lắng nghe.
export function onSocketEvent(type, callback) {
  listeners.set(type, callback);
}

export function offSocketEvent(type) {
  listeners.delete(type);
}
