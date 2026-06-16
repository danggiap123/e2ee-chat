const jwt = require('jsonwebtoken');
const redis = require('../redis');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Không có token xác thực' });
  }

  const token = authHeader.split(' ')[1];

  // Xác minh token và lấy payload
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Token không hợp lệ hoặc đã hết hạn' });
  }

  // Kiểm tra token có trong Redis blocklist không (đã logout trước đó)
  try {
    const blocked = await redis.get(`blocklist:${token}`);
    if (blocked) return res.status(401).json({ error: 'Token đã bị thu hồi' });
  } catch {
    // Redis down → bỏ qua check blocklist, vẫn cho qua
    console.error('Redis down, skipping blocklist check');
  }

  // Kiểm tra tài khoản có bị vô hiệu hóa không
  const user = await prisma.user.findUnique({
    where: { id: decoded.userId },
    select: { isActive: true },
  });
  if (!user || !user.isActive) {
    return res.status(401).json({ error: 'Tài khoản đã bị vô hiệu hóa' });
  }

  req.user = decoded; // gắn payload vào request để các route sau dùng
  next();
}

module.exports = { requireAuth };
