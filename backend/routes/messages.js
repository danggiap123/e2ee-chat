const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const prisma = new PrismaClient();

// ─── POST /messages ───────────────────────────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  try {
    const { conversationId, ciphertext, iv, aad, ekPub, opkId, ikPub } = req.body;

    if (!conversationId || !ciphertext || !iv || !aad) {
      return res.status(400).json({ error: 'Thiếu trường bắt buộc: conversationId, ciphertext, iv, aad' });
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
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

    // Server chỉ lưu bản mã — không đọc được nội dung (Blind Server model)
    const message = await prisma.message.create({
      data: {
        conversationId,
        senderId: req.user.userId,
        ciphertext,
        iv,
        aad,
        ekPub: ekPub ?? null,
        opkId: opkId ?? null,
        ikPub: ikPub ?? null,
      },
    });

    return res.status(201).json({
      messageId: message.id,
      createdAt: message.createdAt,
    });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Phát hiện tấn công phát lại' });
    }
    console.error('[POST /messages]', err);
    return res.status(500).json({ error: 'Lỗi server khi gửi tin nhắn' });
  }
});

// ─── GET /messages/:convId ────────────────────────────────────────────────────
router.get('/:convId', requireAuth, async (req, res) => {
  try {
    const { convId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);//dù client có gửi limit bao nhiêu thì server cũng chỉ trả tối đa 100 tin mỗi lần để tránh quá tải, mặc định là 20 nếu client không gửi limit nào cả.
    const cursor = req.query.cursor;

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

    const messages = await prisma.message.findMany({
      where: { conversationId: convId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        senderId: true,
        ciphertext: true,
        iv: true,
        aad: true,
        ekPub: true,
        opkId: true,
        ikPub: true,
        createdAt: true,
      },
    });

    const nextCursor = messages.length === limit
      ? messages[messages.length - 1].id
      : null;

    return res.json({ messages, nextCursor });
  } catch (err) {
    console.error('[GET /messages/:convId]', err);
    return res.status(500).json({ error: 'Lỗi server khi tải tin nhắn' });
  }
});

// ─── DELETE /messages/:messageId ─────────────────────────────────────────────
router.delete('/:messageId', requireAuth, async (req, res) => {
  try {
    const { messageId } = req.params;

    const message = await prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      return res.status(404).json({ error: 'Tin nhắn không tồn tại' });
    }

    // Chỉ người gửi mới được xóa — ngăn người nhận xóa tin của người khác
    if (message.senderId !== req.user.userId) {
      return res.status(403).json({ error: 'Bạn chỉ có thể xóa tin nhắn của chính mình' });
    }

    await prisma.message.delete({
      where: { id: messageId },
    });

    return res.json({ message: 'Đã xóa tin nhắn' });
  } catch (err) {
    console.error('[DELETE /messages/:messageId]', err);
    return res.status(500).json({ error: 'Lỗi server khi xóa tin nhắn' });
  }
});

module.exports = router;
