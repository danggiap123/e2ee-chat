const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const prisma = new PrismaClient();// khởi tạo kết nối DB — dùng chung 1 instance

// ─── POST /messages ───────────────────────────────────────────────────────────
// Sender gọi endpoint này để gửi 1 tin nhắn đã mã hóa lên server
router.post('/', requireAuth, async (req, res) => {

  const { conversationId, ciphertext, iv, aad, ekPub, opkId } = req.body;

  // Validate: 4 trường bắt buộc phải có
  if (!conversationId || !ciphertext || !iv || !aad) {
    return res.status(400).json({ error: 'Thiếu trường bắt buộc: conversationId, ciphertext, iv, aad' });
  }

  // Tìm conversation trong DB theo conversationId từ body
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
  });

  // Nếu conversation không tồn tại → từ chối
  if (!conversation) {
    return res.status(404).json({ error: 'Conversation không tồn tại' });
  }

  // Kiểm tra người gửi có phải thành viên của conversation không
  // participantA và participantB là 2 userId trong conversation
  const isMember =
    conversation.participantA === req.user.userId ||
    conversation.participantB === req.user.userId;

  if (!isMember) {
    return res.status(403).json({ error: 'Bạn không phải thành viên của conversation này' });
  }

  // Lưu tin nhắn vào DB — server chỉ lưu bản mã, không đọc được nội dung
  const message = await prisma.message.create({
    data: {
      conversationId,
      senderId: req.user.userId,
      ciphertext,
      iv,
      aad,
      ekPub: ekPub ?? null,
      opkId: opkId ?? null,
    },
  });

  return res.status(201).json({
    messageId: message.id,
    createdAt: message.createdAt,
  });
});

// ─── GET /messages/:convId ────────────────────────────────────────────────────
// Receiver gọi endpoint này để tải lịch sử tin nhắn
// Query params: ?cursor=<messageId>&limit=<số>
router.get('/:convId', requireAuth, async (req, res) => {

  const { convId } = req.params;

  // parseInt chuyển string "20" → số 20
  // || 20 nghĩa là nếu client không gửi limit thì mặc định lấy 20 tin
  const limit = parseInt(req.query.limit) || 20;
  const cursor = req.query.cursor;          // messageId của tin cuối cùng đã load

  // Tìm conversation và kiểm tra quyền truy cập
  const conversation = await prisma.conversation.findUnique({
    where: { id: convId },
  });

  if (!conversation) {
    return res.status(404).json({ error: 'Conversation không tồn tại' });
  }

  const isMember =
    conversation.participantA === req.user.userId ||
    conversation.participantB === req.user.userId;

  if (!isMember) {
    return res.status(403).json({ error: 'Bạn không phải thành viên của conversation này' });
  }

  // Xây dựng query cursor pagination
  // Nếu có cursor → bắt đầu từ sau tin đó (skip: 1 để không lặp lại tin cursor)
  // Nếu không có cursor → lấy từ đầu (tin mới nhất trước)
  const messages = await prisma.message.findMany({
    where: { conversationId: convId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    ...(cursor
      ? { cursor: { id: cursor }, skip: 1 }
      : {}
    ),
    select: {
      id: true,
      senderId: true,
      ciphertext: true,
      iv: true,
      aad: true,
      ekPub: true,
      opkId: true,
      createdAt: true,
    },
  });

  // nextCursor: ID của tin cuối cùng trong batch này
  // Client gửi nextCursor lên lần sau để tải thêm
  // Nếu trả về ít hơn limit → đã hết tin → nextCursor = null
  const nextCursor = messages.length === limit
    ? messages[messages.length - 1].id
    : null;

  return res.json({ messages, nextCursor });
});

// ─── DELETE /messages/:messageId ─────────────────────────────────────────────
// Chỉ người GỬI mới được xóa tin của mình — người nhận không xóa được
router.delete('/:messageId', requireAuth, async (req, res) => {

  const { messageId } = req.params;

  // Tìm tin nhắn theo messageId
  const message = await prisma.message.findUnique({
    where: { id: messageId },
  });

  if (!message) {
    return res.status(404).json({ error: 'Tin nhắn không tồn tại' });
  }

  // Chỉ người gửi mới được xóa — nếu người khác gọi → 403
  if (message.senderId !== req.user.userId) {
    return res.status(403).json({ error: 'Bạn chỉ có thể xóa tin nhắn của chính mình' });
  }

  await prisma.message.delete({
    where: { id: messageId },
  });

  return res.json({ message: 'Đã xóa tin nhắn' });
});

module.exports = router;
