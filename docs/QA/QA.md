# QA — Câu hỏi & Giải thích kỹ thuật

Ghi lại các khái niệm đã thảo luận để ôn lại sau.

---

## 1. AAD (Additional Authenticated Data)

**AAD là gì?**
Dữ liệu đi kèm ciphertext dưới dạng bản rõ — ai cũng đọc được nhưng không ai sửa được vì auth tag bảo vệ.

**AAD trong project gồm gì?**
```
aad = conversationId + ":" + senderId
```

**Tại sao không có timestamp?**
Timestamp do server sinh sau khi nhận — client chưa biết lúc mã hóa, đồng hồ client/server lệch nhau.

**Tại sao không có recipientId?**
ConversationId đã bao hàm cả 2 người — biết senderId thì người còn lại chính là recipient.

**AAD khác auth tag như thế nào?**
- Auth tag: bảo vệ nội dung ciphertext khỏi bị sửa
- AAD: buộc ciphertext vào đúng ngữ cảnh (conversation + người gửi), chống chuyển sang conversation khác

---

## 2. IV (Initialization Vector)

**IV có phải bí mật không?**
Không — IV sinh ngẫu nhiên 12 bytes mỗi tin, lưu bản rõ cùng ciphertext. Mục đích là đảm bảo cùng plaintext ra ciphertext khác nhau mỗi lần.

**Nếu IV bị lộ thì sao?**
Không giải mã được — kẻ tấn công vẫn cần session key.

---

## 3. Session Key

**Tạo ra như thế nào?**
X3DH tính 4 phép Diffie-Hellman ra master secret, đưa qua HKDF-SHA256 ra session key đủ ngẫu nhiên.

**Lưu ở đâu?**
- RAM: tạm thời khi đang dùng
- IndexedDB: dài hạn, wrap bằng PBKDF2 + AES-GCM

**Tại sao server không biết session key?**
X3DH tính hoàn toàn ở browser — private key không bao giờ rời khỏi máy client.

---

## 4. OPK (One-Time PreKey)

**Tại sao phải xóa ngay sau khi dùng?**
Forward Secrecy — dù hacker lấy được IK_priv và SPK_priv của Alice sau này, OPK_priv đã bị xóa → thiếu DH4 → không tính lại được session key → tin nhắn cũ vẫn an toàn.

---

## 5. fingerprintVerified

**Dùng để làm gì?**
Chống MITM attack — xác thực danh tính qua kênh thứ 3 (gặp mặt/gọi điện), so sánh chuỗi 60 chữ số được hash từ 2 IK public nhiều lần.

**Hiện tại code có kiểm tra không?**
Chưa — sẽ thêm vào POST /messages khi làm frontend:
```js
if (!conversation.fingerprintVerified) {
  return res.status(403).json({ error: 'Chưa xác thực fingerprint' });
}
```

---

## 6. JWT

**Gồm mấy phần?**
3 phần: header (thuật toán) + payload (userId, exp) + chữ ký (header+payload+secret).

**Điểm yếu và cách xử lý?**
JWT không có cơ chế thu hồi — dùng Redis blocklist: logout/đổi mật khẩu → JWT vào blocklist → bị từ chối dù chữ ký hợp lệ.

**401 vs 403?**
- 401: server không biết bạn là ai (chưa xác thực)
- 403: server biết bạn là ai nhưng không có quyền

---

## 7. BCrypt

**Tham số cost factor là gì?**
Số vòng lặp = 2^cost. Cost 12 → 4096 lần → hash mất ~300ms.

**Tại sao chọn 12?**
Cân bằng bảo mật và hiệu năng. OWASP khuyến nghị tối thiểu 10, hiện tại 12 là chuẩn phổ biến.

**Cost có thể lớn hơn 12 không?**
Được — BCrypt hỗ trợ 4-31. Tăng 1 = chậm gấp đôi. Khi CPU mạnh hơn thì tăng cost lên.

**Blowfish là gì?**
Thuật toán mã hóa đối xứng 1993. BCrypt mượn lõi Blowfish làm hàm tính toán tốn kém, lặp 2^cost lần để làm chậm quá trình hash.

**Dummy hash để làm gì?**
Chống timing attack — username sai vẫn chạy bcrypt.compare() mất ~300ms, không để hacker đo thời gian response phân biệt username tồn tại hay không.
Nếu ko có dummy hash thì tham số thứ 2 trong hàm verify sẽ là undefined nên hàm verify sẽ ko chạy và thời gian trả về gân như bằng 0
const hashToVerify = user ? user.passwordHash : undefined;
await bcrypt.compare(password, undefined); // throw error hoặc return ngay
**Tại sao dùng BCrypt thay Argon2id?**
Thầy đề xuất vì BCrypt đơn giản hơn, dễ giải thích hơn, vẫn đủ bảo mật cho hệ thống nội bộ.

---

## 8. Index trong DB

**Index là gì?**
Cấu trúc cây tạo thêm bên cạnh bảng, giống mục lục sách. Nhảy thẳng đến vị trí cần tìm thay vì đọc từng dòng.

**Bảng Message index trên gì?**
```prisma
@@index([conversationId, createdAt(sort: Desc)])
```
Tối ưu cho cursor pagination — lấy tin mới nhất của 1 conversation.

---

## 9. Cursor Pagination

**Khác offset pagination như thế nào?**
Offset phải đếm từ đầu → càng về sau càng chậm. Cursor dùng index nhảy thẳng đến vị trí → luôn nhanh.

**nextCursor = null nghĩa là gì?**
Server trả về ít hơn limit → đã hết tin → client không gọi thêm.

---

## 10. Worker Thread Pool

**Là gì?**
Nhóm luồng phụ chạy ngầm xử lý tác vụ tốn CPU như bcrypt hash để không block luồng chính Node.js.

**Mặc định mấy luồng?**
4 luồng. Tối ưu nhất là bằng số core CPU thật của máy.

**Project này đặt bao nhiêu?**
8 luồng vì máy có 8 core — đặt qua cross-env trong package.json:
```json
"dev": "cross-env UV_THREADPOOL_SIZE=8 nodemon server.js"
```

**Nếu đặt nhiều hơn số core thì sao?**
OS phải liên tục chuyển đổi giữa các luồng (context switching) → overhead tăng → thực ra chậm hơn.

---

## 11. Scale ngang (Horizontal Scaling)

**2 server instance là gì?**
2 process giống hệt nhau, Load Balancer đứng trước phân chia request. Người dùng chỉ thấy 1 địa chỉ duy nhất.

**Tại sao cần Redis Pub/Sub khi scale?**
Mỗi server giữ kết nối WS của người dùng khác nhau. Redis là trung gian để các instance giao tiếp được với nhau.

**2 server trên cùng máy có mạnh gấp đôi không?**
Không — 2 process tranh nhau số core thật. Scale thật sự có ý nghĩa khi chạy trên nhiều máy vật lý.

**Cách deploy 2 instance bằng Docker?**
```yaml
services:
  server:
    deploy:
      replicas: 2
```

---

## 12. Peak Hour Problem

**Vấn đề là gì?**
200 người login lúc 9h sáng — bcrypt hash mỗi cái 300ms → tắc nghẽn.

**Giải pháp?**
- Thực tế người login trải dài vài phút, không đồng thời đúng 1 giây
- Giảm cost xuống 10 nếu cần (~100ms/hash)
- Tăng UV_THREADPOOL_SIZE bằng số core CPU

---

## 13. Foreign Key và thứ tự xóa

**Tại sao xóa Message trước rồi mới xóa Conversation?**
Message có foreign key `conversationId` trỏ vào Conversation. DB không cho xóa Conversation khi còn Message đang tham chiếu — giống như không thể phá phòng khi còn người bên trong.
