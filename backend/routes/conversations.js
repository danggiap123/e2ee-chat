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
          { participantA: recipientId, participantB: req.user.userId },
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

// ─── GET /conversations ───────────────────────────────────────────────────────
// Lấy danh sách conversation của user đang đăng nhập
// fingerprintVerified được tính từ PeerVerification — nguồn sự thật duy nhất
router.get('/', requireAuth, async (req, res) => {
  try {
    const conversations = await prisma.conversation.findMany({
      where: {
        OR: [
          { participantA: req.user.userId },
          { participantB: req.user.userId },
        ],
      },
      select: {
        id: true,
        createdAt: true,
        userA: {
          select: {
            id: true, username: true, isActive: true,
            keyBundle: { select: { ikPub: true } },
          },
        },
        userB: {
          select: {
            id: true, username: true, isActive: true,
            keyBundle: { select: { ikPub: true } },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
      },
    });

    // PeerVerification là nguồn sự thật duy nhất cho trạng thái xác minh
    const peerIds = conversations.map(conv =>
      conv.userA.id === req.user.userId ? conv.userB.id : conv.userA.id
    );
    const verifications = await prisma.peerVerification.findMany({
      where: { verifierId: req.user.userId, peerId: { in: peerIds } },
      select: { peerId: true },
    });
    const verifiedSet = new Set(verifications.map(v => v.peerId));

    const result = conversations.map((conv) => {
      const isA = conv.userA.id === req.user.userId;
      const peer = isA ? conv.userB : conv.userA;
      return {
        conversationId: conv.id,
        peer: {
          id: peer.id,
          username: peer.username,
          isActive: peer.isActive,
          ikPub: peer.keyBundle?.ikPub ?? null,
        },
        fingerprintVerified: verifiedSet.has(peer.id),
        lastMessageAt: conv.messages[0]?.createdAt ?? conv.createdAt,
      };
    });

    result.sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
    return res.json({ conversations: result });
  } catch (err) {
    console.error('[GET /conversations]', err);
    return res.status(500).json({ error: 'Lỗi server khi lấy danh sách conversation' });
  }
});

// ─── PATCH /conversations/:convId/fingerprint ─────────────────────────────────
// Redirect: tìm peerId từ convId rồi ghi vào PeerVerification (nguồn sự thật duy nhất)
// Giữ endpoint này để tương thích với client cũ — frontend mới nên gọi PATCH /peers/:peerId/verify
router.patch('/:convId/fingerprint', requireAuth, async (req, res) => {
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

    const peerId = conversation.participantA === req.user.userId
      ? conversation.participantB
      : conversation.participantA;

    await prisma.peerVerification.upsert({
      where: { verifierId_peerId: { verifierId: req.user.userId, peerId } },
      create: { verifierId: req.user.userId, peerId },
      update: {},
    });

    return res.json({ message: 'Xác nhận fingerprint thành công' });
  } catch (err) {
    console.error('[PATCH /conversations/:convId/fingerprint]', err);
    return res.status(500).json({ error: 'Lỗi server khi xác nhận fingerprint' });
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
