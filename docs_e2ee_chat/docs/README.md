# Tài Liệu Đồ Án Tốt Nghiệp — E2EE Chat

## Giới thiệu hệ thống

**E2EE Chat** là ứng dụng nhắn tin mã hóa đầu cuối (End-to-End Encryption) cho doanh nghiệp nội bộ. Server đóng vai trò "Blind Server" — chỉ lưu và chuyển tiếp ciphertext, không thể đọc nội dung tin nhắn.

**Stack công nghệ:**
- Backend: Node.js + Express + PostgreSQL + Redis (Docker)
- Frontend: React + Vite + Tailwind CSS
- Crypto: libsodium (Ed25519/X25519) + Web Crypto API (AES-256-GCM, HKDF, PBKDF2)
- Storage: Dexie.js (IndexedDB) — private key lưu trên thiết bị, không gửi lên server

---

## Cấu trúc tài liệu

```
docs/
├── README.md                    ← File này
│
├── 1_phan_tich_nghiep_vu/
│   └── use_case_va_nghiep_vu_chi_tiet.md
│       ├── Use Case Diagram (mức cơ bản)
│       └── 12 ca nghiệp vụ chi tiết:
│           UC-01 Đăng ký, UC-02 Đăng nhập, UC-03 Đăng xuất
│           UC-07 Tạo conversation, UC-08 Gửi tin X3DH
│           UC-09 Gửi tin AES-GCM, UC-10 Xác minh Fingerprint
│           UC-11 Tải lịch sử, UC-15 Gửi tin nhóm
│           UC-18/19 Export/Import backup key
│
├── 2_kien_truc_thiet_ke/
│   └── component_sequence_database.md
│       ├── Component Diagram (Frontend + Backend + DB)
│       ├── Sequence Diagrams:
│       │   SD-01 Đăng ký + Upload Key
│       │   SD-02 Đăng nhập
│       │   SD-03 Gửi tin X3DH đầu tiên
│       │   SD-04 Xác minh Fingerprint
│       │   SD-05 Tải lịch sử (Cursor Pagination)
│       └── Database Schema chi tiết (8 bảng)
│
├── 3_kien_truc_chi_tiet/
│   └── class_diagram_mo_ta_chi_tiet.md
│       ├── Class Diagram (tất cả module)
│       └── Mô tả chi tiết từng module:
│           keyGen.js, x3dh.js, aesGcm.js, fingerprint.js
│           storage.js, api.js, socket.js
│           AuthContext, useWebSocket, useMessages
│           handler.js (BE), auth.js middleware
│
├── 4_cai_dat_chi_tiet/
│   └── framework_va_giai_thich_code.md
│       ├── Bảng so sánh framework (tại sao chọn)
│       ├── Giải thích từng API endpoint:
│       │   POST /auth/register — Transaction + BCrypt
│       │   POST /auth/login — Timing Attack Protection
│       │   POST /auth/logout — Redis Blocklist TTL
│       │   GET /keys/:userId — Pop OPK + low_opk notify
│       │   POST /messages — DB trước, relay sau
│       │   GET /messages/:convId — Cursor Pagination
│       ├── useWebSocket — Stale Closure & giải pháp Ref
│       ├── Chat.jsx — getOrCreateSK, Optimistic UI
│       └── Docker Compose — tại sao Redis appendonly
│
└── 5_thuat_toan_ma_hoa/
    └── e2ee_ly_thuyet_pseudocode_thuc_thi.md
        ├── Tổng quan kiến trúc 3 tầng mã hóa
        ├── X3DH Protocol:
        │   - Lý thuyết + tại sao 4 phép DH
        │   - Pseudo code (sender + receiver)
        │   - Mã nguồn thực thi (x3dh.js) + giải thích từng dòng
        ├── AES-256-GCM:
        │   - Lý thuyết + tại sao IV random + vai trò AAD
        │   - Pseudo code
        │   - Mã nguồn thực thi (aesGcm.js)
        ├── PBKDF2 (600k vòng):
        │   - Lý thuyết + tại sao cần salt
        │   - Pseudo code
        │   - Mã nguồn thực thi (keyGen.js)
        ├── Fingerprint (SHA-512 × 5200):
        │   - Lý thuyết MITM
        │   - Pseudo code
        │   - Mã nguồn thực thi (fingerprint.js)
        └── Bảng tổng hợp câu hỏi GV thường hỏi
```

---

## Luồng dữ liệu chính (tóm tắt)

```
1. Đăng ký:   sinh key → PBKDF2 wrap → lưu IndexedDB + upload public key server
2. Đăng nhập: PBKDF2 unwrap → load private key vào RAM → mở WebSocket
3. Tin đầu:   X3DH 4×DH → SK → AES-GCM encrypt → gửi WS → server relay
4. Tin tiếp:  lấy SK từ cache → AES-GCM encrypt → gửi WS
5. Nhận:      AES-GCM decrypt (+ X3DH nếu cần) → hiển thị
```

---

## Câu hỏi GV hay hỏi nhất

1. **"Server có đọc được tin nhắn không?"** → Không. Server chỉ thấy ciphertext. SK không bao giờ rời khỏi browser. Đây là mô hình Blind Server.

2. **"Private key lưu ở đâu, an toàn không?"** → IndexedDB, đã wrap bằng PBKDF2(600k) + AES-256-GCM. Cần password đúng mới giải mã được.

3. **"Tại sao 4 phép DH trong X3DH?"** → DH1+DH2: mutual authentication. DH3+DH4: forward secrecy. Thiếu bất kỳ phép nào → mất 1 tính chất bảo mật.

4. **"Forward secrecy hoạt động thế nào?"** → EK_priv xóa ngay sau X3DH (.fill(0)). Dump RAM sau này không tính lại được SK. Session-level, không phải message-level (không có Double Ratchet).

5. **"Fingerprint là gì?"** → 60 chữ số từ SHA-512×5200 của 2 Identity Key. Dùng để verify ngoài băng tần — nếu server MITM thì fingerprint 2 bên khác nhau.
