# Prompt cho session tiếp theo

Paste toàn bộ đoạn này vào đầu session mới:

---

Đây là dự án đồ án tốt nghiệp E2EE Chat tại Đại học Bách Khoa Hà Nội.
Hãy đọc CLAUDE.md và PROGRESS.md trước khi làm bất cứ điều gì.

=== ĐÃ HOÀN THÀNH TRONG SESSION TRƯỚC ===

1. Ôn tập backend hoàn chỉnh (câu 15–27)
   - Cursor pagination vs OFFSET, IDOR, Singleton Redis
   - dotenv phải đặt đầu tiên, express.json(), prefix mount
   - Foreign Key Constraint khi xóa

2. Thêm 3 endpoint còn thiếu:
   - GET  /users?search=     — tìm user (contains insensitive, max 20, loại bỏ bản thân)
   - GET  /conversations     — danh sách conv kèm peer + lastMessageAt, sort mới nhất trước
   - PATCH /conversations/:convId/fingerprint — verify fingerprint (idempotent, không unverify)

3. Quyết định kiến trúc đã chốt:
   - Redis-first (publish trước, lưu DB sau) — theo docs ARCHITECTURE.md Luồng 5
   - Online Status sẽ làm cùng WebSocket — không vi phạm Blind Server model
   - Fingerprint: 1 boolean chung, đơn giản hóa có chủ ý — ghi vào hạn chế báo cáo
   - Sidebar: chỉ hiển thị username + lastMessageAt, không có read receipt / badge chưa đọc

4. Cập nhật QA (câu 28–35), ARCHITECTURE.md, PROGRESS.md

=== VIỆC CẦN LÀM TIẾP THEO (THEO THỨ TỰ ƯU TIÊN) ===

VIỆC A — Task 6: WebSocket + Redis Pub/Sub + Online Status (QUAN TRỌNG NHẤT)

Tạo file: backend/ws/handler.js
Sửa file: backend/server.js (tích hợp WS vào HTTP server)

Luồng đã thống nhất:
  Client kết nối: ws://localhost:3000/ws?token=<JWT>
  1. Verify JWT từ query param
  2. Lưu mapping userId → ws socket
  3. Subscribe Redis channel "user:{userId}"
  4. Lưu userId vào Redis SET "online_users" → broadcast online status

  Client gửi tin nhắn qua WS: { type: "message", conversationId, ciphertext, iv, aad, ekPub?, opkId? }
  1. Parse JSON
  2. Kiểm tra membership (participantA hoặc participantB)
  3. Redis.publish("user:{receiverId}", payload) ← NGAY LẬP TỨC
  4. Lưu vào PostgreSQL ← sau đó

  Khi Redis deliver:
  1. Tìm ws socket của receiverId
  2. ws.send(message)

  Khi client ngắt kết nối:
  1. Xóa userId khỏi Redis SET "online_users"
  2. Broadcast offline status

  Loại tin nhắn WS cần xử lý:
  - { type: "message" }   ← tin nhắn chat
  - { type: "ping" }      ← keepalive
  - { type: "presence" }  ← online/offline status (server tự broadcast, client không gửi)

VIỆC B — Frontend (sau khi WebSocket xong)
  3 trang: Register (/register), Login (/login), Chat (/chat)
  Thư viện cần cài: react, tailwindcss, dexie, libsodium-wrappers

VIỆC C — Docker Compose hoàn thiện (sau Frontend)

=== NGUYÊN TẮC QUAN TRỌNG ===
- Đóng vai chuyên gia bảo mật + lập trình viên top đầu hướng dẫn sinh viên đồ án
- Giải thích TỪNG DÒNG code — sinh viên cần hiểu để báo cáo GV
- Code phải đúng 100% vì sẽ được ChatGPT kiểm tra độc lập
- Mỗi đoạn code kèm phân tích: tại sao viết vậy, rủi ro nếu viết khác
- Hỏi sinh viên đã hiểu chưa trước khi chuyển bước tiếp theo
- Sinh viên hay phát hiện lỗi sai của Claude → xác nhận thẳng thắn khi bị bắt lỗi
- Dạy lý thuyết trước, sinh viên confirm hiểu rồi mới code
