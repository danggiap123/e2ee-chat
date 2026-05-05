const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const prisma = new PrismaClient();

// ─── POST /conversations ──────────────────────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  try {
    const { recipientId } = req.body;

    if (!recipientId) {
      return res.status(400).json({ error: 'Thiếu recipientId' });
    }

    if (recipientId === req.user.userId) {
      return res.status(400).json({ error: 'Không thể tạo conversation với chính mình' });
    }

    const recipient = await prisma.user.findUnique({
      where: { id: recipientId },
    });

    if (!recipient) {
      return res.status(404).json({ error: 'Người dùng không tồn tại' });
    }

    // Tìm cả 2 chiều A↔B để tránh tạo trùng
    const existing = await prisma.conversation.findFirst({
      where: {
        OR: [
          { participantA: req.user.userId, participantB: recipientId },
          { participantA: recipientId,     participantB: req.user.userId },
        ],
      },
    });

    if (existing) {
      return res.status(200).json({
        conversationId: existing.id,
        message: 'Conversation đã tồn tại',
      });
    }

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
  } catch (err) {
    console.error('[POST /conversations]', err);
    return res.status(500).json({ error: 'Lỗi server khi tạo conversation' });
  }
});

// ─── DELETE /conversations/:convId ───────────────────────────────────────────
router.delete('/:convId', requireAuth, async (req, res) => {
  try {
    const { convId } = req.params;

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

    // Xóa tin nhắn trước vì Message có foreign key trỏ vào Conversation
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
  } catch (err) {
    console.error('[DELETE /conversations/:convId]', err);
    return res.status(500).json({ error: 'Lỗi server khi xóa conversation' });
  }
});

module.exports = router;
