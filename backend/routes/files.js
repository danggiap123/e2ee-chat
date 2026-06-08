const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const prisma = new PrismaClient();

// Thư mục lưu encrypted file bytes — tạo tự động nếu chưa có
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Multer: giữ file trong memory (Buffer), server sẽ ghi ra disk sau khi có UUID từ DB
// Giới hạn 10MB — đủ cho demo, ngăn DoS qua upload file khổng lồ
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ─── POST /files/upload ───────────────────────────────────────────────────────
// Body: multipart/form-data, field name = "file"
// Nội dung là encrypted bytes (client đã mã hóa trước khi upload)
// Server chỉ lưu ciphertext — không đọc được nội dung thực
// Return: { fileId }
router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Thiếu file trong request' });
    }

    // Tạo record DB để lấy UUID dùng làm tên file trên disk
    const record = await prisma.uploadedFile.create({
      data: { uploaderId: req.user.userId },
    });

    // Ghi encrypted bytes ra disk — tên file = UUID (không có extension vì đã encrypt)
    fs.writeFileSync(path.join(UPLOADS_DIR, record.id), req.file.buffer);

    return res.status(201).json({ fileId: record.id });
  } catch (err) {
    console.error('[POST /files/upload]', err);
    return res.status(500).json({ error: 'Lỗi server khi upload file' });
  }
});

// ─── GET /files/:fileId ───────────────────────────────────────────────────────
// Trả về raw encrypted bytes — caller (client) sẽ decrypt bằng session key
// Chỉ cần xác thực JWT, không cần check membership vì bytes đã mã hóa
// (người không có SK đúng download về cũng không đọc được gì)
router.get('/:fileId', requireAuth, async (req, res) => {
  try {
    const { fileId } = req.params;

    const record = await prisma.uploadedFile.findUnique({ where: { id: fileId } });
    if (!record) {
      return res.status(404).json({ error: 'File không tồn tại' });
    }

    const filePath = path.join(UPLOADS_DIR, fileId);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File không tìm thấy trên disk' });
    }

    // application/octet-stream = stream byte thô, không đoán content type
    res.setHeader('Content-Type', 'application/octet-stream');
    res.sendFile(filePath);
  } catch (err) {
    console.error('[GET /files/:fileId]', err);
    return res.status(500).json({ error: 'Lỗi server khi download file' });
  }
});

module.exports = router;
