require('dotenv').config(); // load .env trước tất cả — JWT_SECRET, DATABASE_URL, REDIS_URL phải có sẵn
const http    = require('http');    // module HTTP core của Node.js — cần để chia sẻ cổng với WebSocket
const express = require('express');

const { initWebSocket }      = require('./ws/handler');
const authRoutes             = require('./routes/auth');
const keyRoutes              = require('./routes/keys');
const messageRoutes          = require('./routes/messages');
const conversationRoutes     = require('./routes/conversations');
const userRoutes             = require('./routes/users');

const app = express();
app.use(express.json()); // parse body JSON cho tất cả REST endpoint

app.use('/auth',          authRoutes);
app.use('/keys',          keyRoutes);
app.use('/messages',      messageRoutes);
app.use('/conversations',  conversationRoutes);
app.use('/users',         userRoutes);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Tạo HTTP server bọc ngoài Express app.
// Lý do: thư viện ws cần gắn vào http.Server — không thể gắn thẳng vào Express app.
// Cả REST và WebSocket đều dùng chung cổng 3000, Node.js tự phân biệt qua header Upgrade.
const server = http.createServer(app);

// Khởi động WebSocket server — path /ws, xác thực JWT bên trong handler
initWebSocket(server);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`REST  → http://localhost:${PORT}`);
  console.log(`WS    → ws://localhost:${PORT}/ws?token=<JWT>`);
});
