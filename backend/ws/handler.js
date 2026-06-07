'use strict';

const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const redis = require('../redis');

const prisma = new PrismaClient();

// Map<userId, WebSocket> — sống trong RAM, mất khi server restart
// Key: UUID string của user. Value: đối tượng WebSocket đang kết nối.
const clients = new Map();

// ─── Khởi động WebSocket server ───────────────────────────────────────────────
function initWebSocket(server) {
  const wss = new WebSocket.Server({ server, path: '/ws' });
  // Mỗi khi có client kết nối, chạy hàm onConnect để xử lý xác thực và đăng ký events cho socket đó
  wss.on('connection', (ws, req) => {
    //chạy hàm onConnect để xử lý lỗi async bên trong onConnect
    onConnect(ws, req).catch((err) => {
      console.error('[WS] onConnect unhandled error:', err.message);
      ws.close(4500, 'Internal server error');
    });
  });

}

// ─── Xử lý khi client kết nối ─────────────────────────────────────────────────
async function onConnect(ws, req) {
  // Bước 1: Lấy JWT từ query string của HTTP Upgrade request
  // req.url = '/ws?token=eyJ...' — split theo '?token=' lấy phần sau
  const token = req.url.split('?token=')[1];

  if (!token) {
    ws.close(4001, 'Missing token');
    return;
  }

  // Bước 2: Xác thực chữ ký JWT — nếu sai secret hoặc hết hạn thì throw
  let userId;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    userId = payload.userId;
  } catch {
    // Không log chi tiết lỗi JWT ra ngoài để tránh lộ thông tin
    ws.close(4001, 'Invalid or expired token');
    return;
  }

  // Bước 3: Kiểm tra JWT có bị thu hồi không (logout / đổi mật khẩu)
  // redis.get trả null nếu key không tồn tại, trả "1" nếu đã bị blocklist
  const blocked = await redis.get(`blocklist:${token}`).catch(() => null);
  if (blocked) {
    ws.close(4001, 'Token has been revoked');
    return;
  }

  // Bước 4: Nếu user đã có socket cũ (mở tab mới), thông báo rồi đóng socket cũ
  // Gửi session_replaced trước để FE hiện overlay, rồi mới close
  const existing = clients.get(userId);
  if (existing && existing.readyState === WebSocket.OPEN) {
    safeSend(existing, { type: 'session_replaced' });
    existing.close(4009, 'Replaced by new connection');
  }
  clients.set(userId, ws);

  // Bước 5: Gửi danh sách user đang online cho client mới vừa kết nối
  // Client dùng list này để hiển thị trạng thái ngay khi mở app
  const onlineUsers = [...clients.keys()];// mảng userId đang online bằng cách lấy keys từ Map clients
  safeSend(ws, { type: 'connected', userId, onlineUsers });

  // Bước 6: Thông báo cho tất cả người khác rằng userId này vừa online
  // excludeUserId = userId để không gửi lại cho chính mình
  broadcast({ type: 'presence', userId, status: 'online' }, userId);

  // Bước 7: Đăng ký handler nhận tin nhắn từ client
  ws.on('message', (raw) => {
    onMessage(ws, userId, raw).catch((err) => {
      console.error(`[WS] onMessage error userId=${userId}:`, err.message);
      safeSend(ws, { type: 'error', error: 'Lỗi xử lý tin nhắn' });
    });
  });

  // Bước 8: Xử lý khi client ngắt kết nối (đóng tab, mất mạng)
  ws.on('close', () => {
    // So sánh tham chiếu: chỉ xóa nếu đây vẫn là socket hiện tại của userId.
    // Nếu user đã mở tab mới (socket mới đã ghi đè), không xóa nhầm socket mới.
    if (clients.get(userId) === ws) {
      clients.delete(userId);
      broadcast({ type: 'presence', userId, status: 'offline' });
    }
  });

  // Bước 9: Xử lý lỗi tầng TCP (mạng bị ngắt đột ngột, không có close event)
  ws.on('error', (err) => {
    console.error(`[WS] socket error userId=${userId}:`, err.message);
    if (clients.get(userId) === ws) {
      clients.delete(userId);
      broadcast({ type: 'presence', userId, status: 'offline' });
    }
  });
}

// ─── Xử lý tin nhắn đến từ client ────────────────────────────────────────────
async function onMessage(ws, userId, raw) {
  // Parse JSON — raw là Buffer từ thư viện ws
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    safeSend(ws, { type: 'error', error: 'JSON không hợp lệ' });
    return;
  }

  // Phân loại theo msg.type
  switch (msg.type) {
    case 'ping':
      // Keepalive: client gửi ping mỗi 30s để giữ kết nối không bị timeout
      safeSend(ws, { type: 'pong' });
      break;

    case 'message':
      await handleChatMessage(ws, userId, msg);
      break;

    default:
      safeSend(ws, { type: 'error', error: `Loại tin không hỗ trợ: ${msg.type}` });
  }
}

// ─── Xử lý tin nhắn chat ──────────────────────────────────────────────────────
async function handleChatMessage(ws, senderId, msg) {
  const { conversationId, ciphertext, iv, aad, ekPub, opkId, ikPub } = msg;

  // Validate: 4 trường bắt buộc phải có để giải mã được
  if (!conversationId || !ciphertext || !iv || !aad) {
    safeSend(ws, { type: 'ack', success: false, error: 'Thiếu trường bắt buộc' });
    return;
  }

  // Membership check — chống IDOR:
  // Không để bất kỳ ai gửi tin vào conversation của người khác
  let conv;
  try {
    conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
  } catch (err) {
    console.error('[WS handleChatMessage] DB findUnique error:', err.message);
    safeSend(ws, { type: 'ack', success: false, error: 'Lỗi server khi kiểm tra conversation' });
    return;
  }

  if (!conv) {
    safeSend(ws, { type: 'ack', success: false, error: 'Conversation không tồn tại' });
    return;
  }

  // participantA và participantB là String (UUID) trong schema Prisma
  const isMember = conv.participantA === senderId || conv.participantB === senderId;
  if (!isMember) {
    safeSend(ws, { type: 'ack', success: false, error: 'Bạn không phải thành viên của conversation này' });
    return;
  }

  // Xác định receiverId: người kia trong conversation
  const receiverId = conv.participantA === senderId
    ? conv.participantB
    : conv.participantA;

  // Lưu DB TRƯỚC — đảm bảo tin không bị mất nếu server sập sau bước này
  // Nếu lưu sau khi relay, có nguy cơ B nhận tin nhưng DB không có → lịch sử mất
  let saved;
  try {
    saved = await prisma.message.create({
      data: {
        conversationId,
        senderId,
        ciphertext,
        iv,
        aad,
        // ekPub, opkId, ikPub chỉ có ở tin X3DH đầu tiên — undefined thì không ghi
        ...(ekPub != null && { ekPub }),
        ...(opkId != null && { opkId }),
        ...(ikPub != null && { ikPub }),
      },
    });
  } catch (err) {
    console.error('[WS handleChatMessage] DB create error:', err.message);
    safeSend(ws, { type: 'ack', success: false, error: 'Lỗi lưu tin nhắn' });
    return;
  }

  // Relay cho receiver nếu đang online (có trong clients Map)
  // readyState === OPEN để chắc chắn socket chưa đóng giữa chừng
  const receiverSocket = clients.get(receiverId);
  if (receiverSocket && receiverSocket.readyState === WebSocket.OPEN) {
    safeSend(receiverSocket, {
      type: 'message',
      msgId: saved.id,
      conversationId,
      senderId,
      ciphertext,
      iv,
      aad,
      ...(ekPub != null && { ekPub }),
      ...(opkId != null && { opkId }),
      ...(ikPub != null && { ikPub }),
      createdAt: saved.createdAt,
    });
  }
  // Nếu receiver offline: tin đã lưu DB, họ load lại lịch sử khi online là thấy

  // Trả ACK cho sender: thông báo tin đã lưu thành công
  safeSend(ws, {
    type: 'ack',
    success: true,
    msgId: saved.id,
    createdAt: saved.createdAt,
  });
}

// ─── Helper: gửi JSON an toàn ────────────────────────────────────────────────
// Kiểm tra readyState trước khi send — tránh throw khi socket đã đóng
function safeSend(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

// ─── Helper: broadcast đến tất cả client đang kết nối ───────────────────────
// excludeUserId: không gửi lại cho chính người gây ra event (tránh echo)
function broadcast(payload, excludeUserId) {
  const msg = JSON.stringify(payload);
  for (const [uid, socket] of clients) {
    if (uid === excludeUserId) continue;
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(msg);
    }
  }
}

module.exports = { initWebSocket, clients };
