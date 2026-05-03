require('dotenv').config(); // import thư viện dotenv để load biến môi trường từ file .env
const express = require('express'); //import thư viện express để tạo server
const authRoutes     = require('./routes/auth');     // import routes auth
const keyRoutes      = require('./routes/keys');     // import routes key bundle
const messageRoutes       = require('./routes/messages');      // import routes messages
const conversationRoutes  = require('./routes/conversations'); // import routes conversations

const app = express(); //tạo ứng dụng express
app.use(express.json()); //middleware để parse JSON body của request, giúp server có thể đọc được dữ liệu gửi lên từ client dưới dạng JSON

app.use('/auth', authRoutes); // mount auth routes: /auth/register, /auth/login, /auth/logout
app.use('/keys',     keyRoutes);     // mount key routes:    /keys/upload, /keys/:userId
app.use('/messages',      messageRoutes);      // mount message routes:      /messages, /messages/:convId
app.use('/conversations', conversationRoutes); // mount conversation routes: /conversations

//kiểm tra server có chạy được không bằng endpoint /health
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// lắng nghe request,in ra log khi server đã sẵn sàng
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

