require('dotenv').config(); // load .env trước tất cả — JWT_SECRET, DATABASE_URL, REDIS_URL phải có sẵn
const http = require('http');    // module HTTP core của Node.js — cần để chia sẻ cổng với WebSocket
const express = require('express');
const cors = require('cors');

const { initWebSocket } = require('./ws/handler');
const authRoutes = require('./routes/auth');
const keyRoutes = require('./routes/keys');
const messageRoutes = require('./routes/messages');
const conversationRoutes = require('./routes/conversations');
const userRoutes = require('./routes/users');
const groupRoutes = require('./routes/groups');
const fileRoutes = require('./routes/files');

const app = express(); // Tạo Express app — sẽ gắn vào http.Server để phục vụ REST API

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',');
app.use(cors({
  origin: (origin, cb) => {
    // origin = undefined khi gọi từ Postman / curl (không có browser) → cho qua
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} không được phép`));
  },
  credentials: true, // cho phép FE gửi cookie / Authorization header
}));

app.use(express.json()); // parse body JSON cho tất cả REST endpoint

app.use('/auth', authRoutes);
app.use('/keys', keyRoutes);
app.use('/messages', messageRoutes);
app.use('/conversations', conversationRoutes);
app.use('/users', userRoutes);
app.use('/groups', groupRoutes);
app.use('/files', fileRoutes);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Tạo HTTP server bọc ngoài Express app để khi có request thường đến thì Express sẽ xử lý, còn nếu có request WebSocket thì sẽ được WebSocket server xử lý.
// Cả REST và WebSocket đều dùng chung cổng 3000, Node.js tự phân biệt qua header Upgrade.
const server = http.createServer(app);

// Khởi động WebSocket server, gắn websocket server vào httpserver 
initWebSocket(server);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`REST  → http://localhost:${PORT}`);
  console.log(`WS    → ws://localhost:${PORT}/ws?token=<JWT>`);
});
