require('dotenv').config(); // import thư viện dotenv để load biến môi trường từ file .env
const express = require('express'); //import thư viện express để tạo server

const app = express(); //tạo ứng dụng express
app.use(express.json()); //middleware để parse JSON body của request, giúp server có thể đọc được dữ liệu gửi lên từ client dưới dạng JSON

//kiểm tra server có chạy được không bằng endpoint /health
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// lắng nghe request,in ra log khi server đã sẵn sàng
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

