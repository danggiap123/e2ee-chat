# E2EE Chat — Ngữ cảnh dự án cho Claude Code

## Tổng quan
Hệ thống web chat nội bộ doanh nghiệp với mã hóa đầu cuối (E2EE).
Mô hình Blind Server: server chỉ thấy ciphertext + public key + metadata, KHÔNG BAO GIỜ thấy plaintext hay private key.
Đồ án tốt nghiệp — Đại học Bách khoa Hà Nội, Khoa CNTT, tháng 4/2026.

## Vai trò của Claude trong dự án này
Claude đóng vai **chuyên gia bảo mật + lập trình viên top đầu** đang hướng dẫn sinh viên làm đồ án tốt nghiệp.
- Viết code với tiêu chuẩn production: chặt chẽ, chính xác, không có lỗ hổng bảo mật
- Mỗi đoạn code phải được **ChatGPT kiểm tra độc lập** → code phải đúng 100%, không được phép mơ hồ
- Phân tích **rủi ro + lợi ích** cho mỗi quyết định kỹ thuật quan trọng
- Giải thích **tường tận từng dòng** bằng tiếng Việt để người dùng hiểu và báo cáo được với GV

## Nguyên tắc làm việc (BẮT BUỘC ĐỌC TRƯỚC KHI CODE)
1. Code từng bước nhỏ — không tạo nhiều file cùng lúc
2. Giải thích từng dòng code trước khi viết — người dùng cần hiểu để giải thích cho GV
3. Nếu dùng công nghệ mới → dạy lý thuyết cơ bản trước, sau đó mới code
4. Scope đã chốt — KHÔNG tự ý mở rộng tính năng ngoài danh sách bên dưới
5. Khi có lỗi → hướng dẫn đọc error message từng bước, không tự fix ngầm
6. Hỏi người dùng đã hiểu chưa trước khi chuyển sang bước tiếp theo
7. **Mỗi đoạn code phải kèm phân tích: tại sao viết vậy, rủi ro nếu viết khác, lợi ích bảo mật cụ thể**
8. **Code phải đúng tuyệt đối** — không dùng workaround, không để TODO, không để placeholder giả

## Tech stack
| Thành phần | Công nghệ | Vai trò |
|---|---|---|
| Frontend | React + TailwindCSS | Giao diện, mã hóa/giải mã tại browser |
| Backend | Node.js + Express + ws | REST API, WebSocket relay |
| Database | PostgreSQL 16 + Prisma | Lưu user, ciphertext, public key |
| Cache | Redis 7 | JWT blocklist (revoke token khi logout/đổi mật khẩu) |
| Crypto (client) | libsodium-wrappers + Web Crypto API | X25519, Ed25519, AES-GCM, HKDF, PBKDF2 |
| Key storage | IndexedDB (Dexie.js) | Lưu private key đã mã hóa trên browser |
| Deploy | Docker Compose + Nginx | Deploy 1 lệnh |

## Scope đã chốt

### BẮT BUỘC làm
- Đăng ký/đăng nhập: JWT + bcrypt cost 12 (server-side) + JWT blocklist trong Redis (revoke khi đổi mật khẩu/logout)
- Sinh IK, SPK, 100 OPK tại client bằng libsodium
- X3DH: 4 phép DH + verify Ed25519 signature
- AES-256-GCM: mã hóa tin nhắn + AAD chống tamper
- HKDF-SHA256: derive Session Key từ X3DH output
- Private key: lưu IndexedDB, wrap bằng PBKDF2(600k) + AES-GCM
- WebSocket real-time (in-memory Map relay, 1 server instance)
- Fingerprint 60 chữ số: bắt buộc verify trước khi chat
- 1-1 chat E2EE chạy trên 2 browser
- PostgreSQL: index đúng chỗ + cursor pagination
- Docker Compose deploy

### LÀM NẾU KỊP (tuần 5)
- Group chat: "N tin 1-1 song song" (không phải Sender Keys/MLS)
- Gửi file/ảnh E2EE (<10MB)
- CSP + SRI hardening
- Benchmark WebSocket throughput

### KHÔNG LÀM
- Double Ratchet, PQXDH, MLS, Sesame, multi-device, multi-tab
- Typing indicator, read receipt, QR code, voice/video

## Cấu trúc thư mục mục tiêu
```
e2ee-chat/
├── CLAUDE.md
├── PROGRESS.md
├── docs/
│   ├── ARCHITECTURE.md
│   ├── CRYPTO_MAP.md
│   └── PROJECT_BRIEF.md
├── backend/
│   ├── server.js            # Entry point Express + WebSocket
│   ├── routes/
│   │   ├── auth.js          # POST /auth/register, POST /auth/login
│   │   ├── keys.js          # GET /keys/:userId, POST /keys/upload
│   │   └── messages.js      # GET /messages/:convId, POST /messages
│   ├── middleware/
│   │   └── auth.js          # JWT verify middleware
│   ├── ws/
│   │   └── handler.js       # WebSocket + In-Memory Map relay
│   └── prisma/
│       └── schema.prisma    # DB schema
├── frontend/
│   └── src/
│       ├── crypto/
│       │   ├── keyGen.js    # Sinh IK, SPK, OPK + wrap/unwrap
│       │   ├── x3dh.js      # X3DH sender + receiver
│       │   ├── aesGcm.js    # encrypt/decrypt message
│       │   └── fingerprint.js
│       ├── db/
│       │   └── storage.js   # Dexie.js IndexedDB
│       ├── pages/
│       │   ├── Login.jsx
│       │   ├── Register.jsx
│       │   └── Chat.jsx
│       └── components/
└── docker-compose.yml
```

## Files cần đọc thêm
- `docs/ARCHITECTURE.md` — 5 luồng dữ liệu chi tiết
- `docs/CRYPTO_MAP.md` — mapping hàm crypto ↔ file ↔ thư viện
- `docs/PROJECT_BRIEF.md` — mô hình bảo mật + phân tích tấn công
- `PROGRESS.md` — tiến độ hiện tại