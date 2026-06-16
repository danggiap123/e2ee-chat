const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const prisma = new PrismaClient();

// ─── GET /users?search=keyword ───────────────────────────────────────────────
// Tìm kiếm user theo username — partial match, không phân biệt hoa thường
// Kết quả loại bỏ chính người đang gọi, giới hạn 20 user
router.get('/', requireAuth, async (req, res) => {
  try {
    const { search } = req.query;

    if (!search || search.trim() === '') {
      return res.status(400).json({ error: 'Thiếu tham số search' });
    }

    if (search.trim().length < 2) {
      return res.status(400).json({ error: 'Từ khóa tìm kiếm phải có ít nhất 2 ký tự' });
    }

    const users = await prisma.user.findMany({
      where: {
        username: {
          contains: search.trim(), // partial match: "ali" khớp "alice"
          mode: 'insensitive',     // không phân biệt hoa thường
        },
        NOT: { id: req.user.userId }, // loại bỏ chính mình
        isActive: true,               // ẩn user đã bị vô hiệu hóa
      },
      select: {
        id: true,
        username: true,
        // KHÔNG select passwordHash — không bao giờ trả ra ngoài
      },
      take: 20, // tối đa 20 kết quả
    });

    return res.json({ users });
  } catch (err) {
    console.error('[GET /users]', err);
    return res.status(500).json({ error: 'Lỗi server khi tìm kiếm user' });
  }
});

module.exports = router;
