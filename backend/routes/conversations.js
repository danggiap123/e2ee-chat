const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const prisma = new PrismaClient();

// ─── POST /conversations ──────────────────────────────────────────────────────
// Alice gọi endpoint này để tạo cuộc trò chuyện với Bob
// Nếu 2 người đã có conversation rồi → trả về cái cũ, không tạo trùng
router.post('/', requireAuth, async (req, res) => {

  const { recipientId } = req.body;

  // Validate: phải có recipientId
  if (!recipientId) {
    return res.status(400).json({ error: 'Thiếu recipientId' });
  }

  // Không thể tạo conversation với chính mình
  if (recipientId === req.user.userId) {
    return res.status(400).json({ error: 'Không thể tạo conversation với chính mình' });
  }

  // Kiểm tra recipient có tồn tại trong DB không
  const recipient = await prisma.user.findUnique({
    where: { id: recipientId },
  });

  if (!recipient) {
    return res.status(404).json({ error: 'Người dùng không tồn tại' });
  }

  // Kiểm tra conversation đã tồn tại chưa — thử cả 2 chiều
  // Vì Alice tạo conv với Bob: participantA=Alice, participantB=Bob
  // Bob tạo conv với Alice: participantA=Bob, participantB=Alice
  // → cần tìm cả 2 trường hợp để tránh tạo trùng
  const existing = await prisma.conversation.findFirst({
    where: {
      OR: [
        { participantA: req.user.userId, participantB: recipientId },
        { participantA: recipientId,     participantB: req.user.userId },
      ],
    },
  });

  // Nếu đã tồn tại → trả về conversation cũ kèm status 200
  if (existing) {
    return res.status(200).json({
      conversationId: existing.id,
      message: 'Conversation đã tồn tại',
    });
  }

  // Chưa có → tạo mới: người gọi là participantA, recipient là participantB
  const conversation = await prisma.conversation.create({
    data: {
      participantA: req.user.userId,
      participantB: recipientId,
    },
  });

  return res.status(201).json({
    conversationId: conversation.id,
    message: 'Tạo conversation thành công',
  });
});

// ─── DELETE /conversations/:convId ───────────────────────────────────────────
// Xóa toàn bộ conversation + tất cả tin nhắn bên trong
// Chỉ thành viên của conversation mới được xóa
router.delete('/:convId', requireAuth, async (req, res) => {

  const { convId } = req.params;

  const conversation = await prisma.conversation.findUnique({
    where: { id: convId },
  });

  if (!conversation) {
    return res.status(404).json({ error: 'Conversation không tồn tại' });
  }

  // Chỉ 2 thành viên mới được xóa conversation
  const isMember =
    conversation.participantA === req.user.userId ||
    conversation.participantB === req.user.userId;

  if (!isMember) {
    return res.status(403).json({ error: 'Bạn không phải thành viên của conversation này' });
  }

  // Xóa tin nhắn trước, sau đó mới xóa conversation
  // Vì Message có foreign key trỏ vào Conversation — xóa ngược sẽ lỗi
  const deleted = await prisma.message.deleteMany({
    where: { conversationId: convId },
  });

  await prisma.conversation.delete({
    where: { id: convId },
  });

  return res.json({
    message: 'Đã xóa conversation',
    messagesDeleted: deleted.count,
  });
});

module.exports = router;
