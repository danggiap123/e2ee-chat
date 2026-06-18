const express = require('express');
const router = express.Router();
const WebSocket = require('ws');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');
const { clients } = require('../ws/handler');

const prisma = new PrismaClient();

// ─── POST /messages ───────────────────────────────────────────────────────────
// Dùng chung cho cả 1-1 và group.
// 1-1:   body = { conversationId, ciphertext, iv, aad, ekPub?, opkId?, ikPub? }
// Group: body = { groupId, recipients: [{ userId, ciphertext, iv, aad, ekPub?, opkId?, ikPub? }] }
router.post('/', requireAuth, async (req, res) => {
  const { groupId } = req.body;
  if (groupId) return handleGroupMessage(req, res);
  return handleDirectMessage(req, res);
});

// ─── Gửi tin nhắn 1-1 ────────────────────────────────────────────────────────
async function handleDirectMessage(req, res) {
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

    // Kiểm tra người nhận có còn active không
    const receiverId = conversation.participantA === req.user.userId
      ? conversation.participantB
      : conversation.participantA;

    const recipient = await prisma.user.findUnique({
      where: { id: receiverId },
      select: { isActive: true },
    });

    if (!recipient?.isActive) {
      return res.status(403).json({ error: 'Người dùng này đã không còn trong tổ chức' });
    }

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

    const receiverSocket = clients.get(receiverId);
    if (receiverSocket && receiverSocket.readyState === WebSocket.OPEN) {
      receiverSocket.send(JSON.stringify({
        type: 'message',
        msgId: message.id,
        conversationId,
        senderId: req.user.userId,
        ciphertext,
        iv,
        aad,
        ...(ekPub  != null && { ekPub }),
        ...(opkId  != null && { opkId }),
        ...(ikPub  != null && { ikPub }),
        createdAt: message.createdAt,
      }));
    }

    return res.status(201).json({ messageId: message.id, createdAt: message.createdAt });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Phát hiện tấn công phát lại' });
    }
    console.error('[POST /messages 1-1]', err);
    return res.status(500).json({ error: 'Lỗi server khi gửi tin nhắn' });
  }
}

// ─── Gửi tin nhắn group ───────────────────────────────────────────────────────
// Mỗi recipient nhận 1 bản ciphertext riêng — server không đọc được nội dung
async function handleGroupMessage(req, res) {
  try {
    const { groupId, recipients } = req.body;

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: 'Thiếu danh sách recipients' });
    }

    // Validate từng recipient có đủ trường
    for (const r of recipients) {
      if (!r.userId || !r.ciphertext || !r.iv || !r.aad) {
        return res.status(400).json({ error: 'Mỗi recipient cần có: userId, ciphertext, iv, aad' });
      }
    }

    // Kiểm tra group tồn tại và sender là thành viên
    const senderMembership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: req.user.userId } },
    });

    if (!senderMembership) {
      return res.status(403).json({ error: 'Bạn không phải thành viên của nhóm này' });
    }

    // Lấy danh sách thành viên để validate recipients
    const members = await prisma.groupMember.findMany({
      where: { groupId },
      select: { userId: true },
    });
    const memberIds = new Set(members.map(m => m.userId));

    for (const r of recipients) {
      if (!memberIds.has(r.userId)) {
        return res.status(403).json({ error: `User ${r.userId} không phải thành viên của nhóm` });
      }
    }

    // Lưu tất cả bản mã trong 1 transaction
    const messages = await prisma.$transaction(
      recipients.map(r =>
        prisma.message.create({
          data: {
            groupId,
            recipientId: r.userId,
            senderId: req.user.userId,
            ciphertext: r.ciphertext,
            iv: r.iv,
            aad: r.aad,
            ekPub: r.ekPub ?? null,
            opkId: r.opkId ?? null,
            ikPub: r.ikPub ?? null,
          },
        })
      )
    );

    // Relay real-time cho từng recipient đang online
    for (let i = 0; i < recipients.length; i++) {
      const r = recipients[i];
      const socket = clients.get(r.userId);
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'group_message',
          msgId: messages[i].id,
          groupId,
          senderId: req.user.userId,
          ciphertext: r.ciphertext,
          iv: r.iv,
          aad: r.aad,
          ...(r.ekPub  != null && { ekPub: r.ekPub }),
          ...(r.opkId  != null && { opkId: r.opkId }),
          ...(r.ikPub  != null && { ikPub: r.ikPub }),
          createdAt: messages[i].createdAt,
        }));
      }
    }

    return res.status(201).json({
      count: messages.length,
      messageId: messages[0].id,
      createdAt: messages[0].createdAt,
    });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Phát hiện tấn công phát lại' });
    }
    console.error('[POST /messages group]', err);
    return res.status(500).json({ error: 'Lỗi server khi gửi tin nhắn nhóm' });
  }
}

// ─── GET /messages/group/:groupId ─────────────────────────────────────────────
// Load lịch sử tin nhắn nhóm — mỗi người chỉ thấy bản mã của mình
// Phải đặt TRƯỚC /:convId để Express không nhầm "group" là convId
router.get('/group/:groupId', requireAuth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const cursor = req.query.cursor;
    const userId = req.user.userId;

    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });

    if (!membership) {
      return res.status(403).json({ error: 'Bạn không phải thành viên của nhóm này' });
    }

    // Đếm số thành viên để biết mỗi tin nhắn của sender tạo bao nhiêu rows.
    // Với N thành viên, sender tạo N-1 rows/tin → cần fetch limit*(N-1) rows để có đủ limit tin logic.
    const memberCount = await prisma.groupMember.count({ where: { groupId } });
    const rowMultiplier = Math.max(memberCount - 1, 1);
    const fetchLimit = limit * rowMultiplier + rowMultiplier; // +rowMultiplier để buffer tránh thiếu

    const rawRows = await prisma.message.findMany({
      where: {
        groupId,
        OR: [
          { recipientId: userId },
          { senderId: userId },
          { isSystem: true },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: fetchLimit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        senderId: true,
        recipientId: true,
        ciphertext: true,
        iv: true,
        aad: true,
        ekPub: true,
        opkId: true,
        ikPub: true,
        isSystem: true,
        systemText: true,
        createdAt: true,
      },
    });

    // Dedup server-side: với tin của sender, chỉ giữ 1 row/tin (theo createdAt).
    // Tin của người khác gửi cho mình: đã là 1 row/tin, giữ nguyên.
    const seen = new Set();
    const messages = [];
    for (const row of rawRows) {
      if (row.isSystem || row.senderId !== userId) {
        messages.push(row);
      } else {
        const key = row.createdAt.toISOString();
        if (!seen.has(key)) { seen.add(key); messages.push(row); }
      }
      if (messages.length >= limit) break;
    }

    const nextCursor = messages.length >= limit ? messages[messages.length - 1].id : null;

    return res.json({ messages, nextCursor });
  } catch (err) {
    console.error('[GET /messages/group/:groupId]', err);
    return res.status(500).json({ error: 'Lỗi server khi tải tin nhắn nhóm' });
  }
});

// ─── GET /messages/:convId ────────────────────────────────────────────────────
router.get('/:convId', requireAuth, async (req, res) => {
  try {
    const { convId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
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

    if (message.senderId !== req.user.userId) {
      return res.status(403).json({ error: 'Bạn chỉ có thể xóa tin nhắn của chính mình' });
    }

    if (message.groupId) {
      // Xóa toàn bộ N rows được tạo cùng 1 transaction (mỗi recipient 1 row)
      await prisma.message.deleteMany({
        where: { groupId: message.groupId, senderId: message.senderId, createdAt: message.createdAt },
      });
    } else {
      await prisma.message.delete({ where: { id: messageId } });
    }

    // Notify receiver nếu là tin 1-1
    if (message.conversationId) {
      const conv = await prisma.conversation.findUnique({
        where: { id: message.conversationId },
      });
      if (conv) {
        const receiverId = conv.participantA === req.user.userId
          ? conv.participantB
          : conv.participantA;
        const receiverSocket = clients.get(receiverId);
        if (receiverSocket && receiverSocket.readyState === WebSocket.OPEN) {
          receiverSocket.send(JSON.stringify({
            type: 'message_deleted',
            messageId,
            conversationId: message.conversationId,
          }));
        }
      }
    }

    // Notify tất cả thành viên đang online nếu là tin nhóm
    if (message.groupId) {
      const members = await prisma.groupMember.findMany({
        where: { groupId: message.groupId },
        select: { userId: true },
      });
      for (const member of members) {
        if (member.userId === req.user.userId) continue; // người xóa tự biết rồi
        const memberSocket = clients.get(member.userId);
        if (memberSocket && memberSocket.readyState === WebSocket.OPEN) {
          memberSocket.send(JSON.stringify({
            type: 'message_deleted',
            messageId,
            groupId: message.groupId,
          }));
        }
      }
    }

    return res.json({ message: 'Đã xóa tin nhắn' });
  } catch (err) {
    console.error('[DELETE /messages/:messageId]', err);
    return res.status(500).json({ error: 'Lỗi server khi xóa tin nhắn' });
  }
});

module.exports = router;
