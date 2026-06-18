const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Middleware bảo vệ /admin/*: chỉ cho qua nếu JWT hợp lệ và role = ADMIN
function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Không có token xác thực' });
  }

  try {
    const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
    if (decoded.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Không có quyền admin' });
    }
    req.admin = decoded; // gắn payload vào request
    next();
  } catch {
    return res.status(401).json({ error: 'Token không hợp lệ hoặc đã hết hạn' });
  }
}

router.use(requireAdmin);

// ─── GET /admin/users ─────────────────────────────────────────────────────────
// Lấy danh sách tất cả user kèm role và trạng thái
router.get('/users', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ users });
  } catch (err) {
    console.error('[GET /admin/users]', err);
    return res.status(500).json({ error: 'Lỗi server' });
  }
});

// ─── PATCH /admin/users/:id/disable ──────────────────────────────────────────
// Vô hiệu hóa user — admin không thể tự vô hiệu hóa chính mình
router.patch('/users/:id/disable', async (req, res) => {
  try {
    const { id } = req.params;

    if (id === req.admin.userId) {
      return res.status(400).json({ error: 'Không thể vô hiệu hóa chính mình' });
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ error: 'User không tồn tại' });
    if (!user.isActive) return res.json({ message: 'User đã bị vô hiệu hóa trước đó' });

    await prisma.user.update({ where: { id }, data: { isActive: false } });

    return res.json({ message: `Đã vô hiệu hóa ${user.username}` });
  } catch (err) {
    console.error('[PATCH /admin/users/:id/disable]', err);
    return res.status(500).json({ error: 'Lỗi server' });
  }
});

// ─── PATCH /admin/users/:id/enable ───────────────────────────────────────────
// Kích hoạt lại user đã bị vô hiệu hóa
router.patch('/users/:id/enable', async (req, res) => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ error: 'User không tồn tại' });
    if (user.isActive) return res.json({ message: 'User đang hoạt động bình thường' });

    await prisma.user.update({ where: { id }, data: { isActive: true } });

    return res.json({ message: `Đã kích hoạt lại ${user.username}` });
  } catch (err) {
    console.error('[PATCH /admin/users/:id/enable]', err);
    return res.status(500).json({ error: 'Lỗi server' });
  }
});

// ─── PATCH /admin/users/:id/grant-admin ──────────────────────────────────────
// Cấp quyền ADMIN cho user
router.patch('/users/:id/grant-admin', async (req, res) => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ error: 'User không tồn tại' });
    if (user.role === 'ADMIN') return res.json({ message: `${user.username} đã là admin` });

    await prisma.user.update({ where: { id }, data: { role: 'ADMIN' } });

    return res.json({ message: `Đã cấp quyền admin cho ${user.username}` });
  } catch (err) {
    console.error('[PATCH /admin/users/:id/grant-admin]', err);
    return res.status(500).json({ error: 'Lỗi server' });
  }
});

// ─── PATCH /admin/users/:id/revoke-admin ─────────────────────────────────────
// Thu hồi quyền ADMIN — dùng FOR UPDATE để tránh race condition 2 admin xóa nhau
router.patch('/users/:id/revoke-admin', async (req, res) => {
  try {
    const { id } = req.params;

    if (id === req.admin.userId) {
      return res.status(400).json({ error: 'Không thể tự thu hồi quyền admin của chính mình' });
    }

    await prisma.$transaction(async (tx) => {
      const adminCount = await tx.user.count({ where: { role: 'ADMIN' } });

      if (adminCount <= 1) {
        throw new Error('LAST_ADMIN');
      }

      await tx.user.update({ where: { id }, data: { role: 'USER' } });
    });

    return res.json({ message: 'Đã thu hồi quyền admin' });
  } catch (err) {
    if (err.message === 'LAST_ADMIN') {
      return res.status(400).json({ error: 'Phải có ít nhất 1 admin trong hệ thống' });
    }
    console.error('[PATCH /admin/users/:id/revoke-admin]', err);
    return res.status(500).json({ error: 'Lỗi server' });
  }
});

// ─── GET /admin/whitelist ─────────────────────────────────────────────────────
router.get('/whitelist', async (req, res) => {
  try {
    const emails = await prisma.allowedEmail.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ emails });
  } catch (err) {
    console.error('[GET /admin/whitelist]', err);
    return res.status(500).json({ error: 'Lỗi server' });
  }
});

// ─── POST /admin/whitelist ────────────────────────────────────────────────────
router.post('/whitelist', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Email không hợp lệ' });
    }

    const entry = await prisma.allowedEmail.create({
      data: { email: email.toLowerCase().trim() },
    });

    return res.status(201).json({ message: `Đã thêm ${entry.email}`, entry });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Email đã có trong whitelist' });
    }
    console.error('[POST /admin/whitelist]', err);
    return res.status(500).json({ error: 'Lỗi server' });
  }
});

// ─── DELETE /admin/whitelist/:id ──────────────────────────────────────────────
router.delete('/whitelist/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const entry = await prisma.allowedEmail.findUnique({ where: { id } });
    if (!entry) return res.status(404).json({ error: 'Email không tồn tại trong whitelist' });

    await prisma.allowedEmail.delete({ where: { id } });

    return res.json({ message: `Đã xóa ${entry.email} khỏi whitelist` });
  } catch (err) {
    console.error('[DELETE /admin/whitelist/:id]', err);
    return res.status(500).json({ error: 'Lỗi server' });
  }
});

module.exports = router;
