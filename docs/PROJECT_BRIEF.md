# Project Brief — Tóm tắt báo cáo định hướng

## Mục tiêu hệ thống
Server (kể cả admin) không được phép đọc nội dung tin nhắn.
Khi server bị tấn công và dump toàn bộ database, kẻ tấn công chỉ lấy được:
- Ciphertext (không giải mã được nếu không có private key)
- Public key (vô dụng để giải mã)
- Metadata: ai chat với ai, lúc nào, bao nhiêu tin (đây là giới hạn — xem mục Hạn chế)

---

## Mô hình Blind Server

| Thành phần | Server LƯU | Server KHÔNG CÓ |
|---|---|---|
| Tin nhắn 1-1 | Ciphertext + IV + AAD | Plaintext |
| Tin nhắn group | N bản ciphertext (mỗi người 1 bản) + IV + AAD | Plaintext |
| File / ảnh | Encrypted bytes (UUID filename) | Nội dung file, loại file |
| Khóa | Public key (IK, SPK, OPK) | Private key, Session Key, fileKey |
| Xác thực | JWT (HS256), bcrypt hash (cost 12) | Mật khẩu gốc |
| User | username, email, role, isActive | Private key |
| Metadata | sender/receiver id, timestamp, group membership | — |
| Whitelist | AllowedEmail (email, usedAt) | — |
| Verify | PeerVerification (ai verify ai) | Nội dung fingerprint |

---

## Các thuật toán crypto và lý do chọn

| Thuật toán | Mục đích | Tiêu chuẩn | Lý do chọn |
|---|---|---|---|
| X3DH | Thiết lập Session Key bất đồng bộ | Signal Whitepaper 2016 | Alice chat được với Bob khi Bob offline |
| X25519 (ECDH) | 4 phép DH trong X3DH | RFC 7748 | Constant-time tự nhiên, nhanh hơn P-256 2-4x |
| Ed25519 (EdDSA) | Ký + verify SPK; là keypair vĩnh viễn IK | RFC 8032 | Chống server giả mạo SPK; convert sang X25519 khi cần DH |
| AES-256-GCM | Mã hóa tin nhắn + file (AEAD) | FIPS 197 + NIST SP 800-38D | Vừa mã hóa vừa xác thực, hardware-accelerated |
| HKDF-SHA256 | Derive Session Key từ X3DH output | RFC 5869 | Làm sạch entropy của ECDH output |
| PBKDF2-SHA256 | Bảo vệ private key bằng password (wrap) | RFC 8018, OWASP 2023 | Web Crypto API native, 600k iterations |
| bcrypt (cost 12) | Hash password phía server | — | 2^12 = 4096 vòng, ~300ms/hash, cân bằng bảo mật và UX |
| SHA-512 (5200 vòng) | Tạo Fingerprint | FIPS 180-4 | Theo Signal Safety Numbers spec |
| Random 256-bit key | Mã hóa file trong group chat | — | fileKey sinh 1 lần, chia sẻ qua SK 1-1 riêng → tiết kiệm băng thông |

---

## Phân tích các loại tấn công

| Tấn công | Cơ chế chống | Hiệu quả |
|---|---|---|
| Passive eavesdropping (nghe lén đường truyền) | AES-256-GCM + HTTPS/WSS | Hoàn toàn |
| Server bị hack, dump database | Blind Server: chỉ có ciphertext | Hoàn toàn (về nội dung) |
| Replay attack 1-1 (gửi lại tin cũ) | OPK dùng 1 lần + IV unique per conversation (@@unique DB constraint) | Hoàn toàn |
| Replay attack group (copy ciphertext sang recipient khác) | @@unique([groupId, recipientId, iv]) — IV phải duy nhất per recipient | Hoàn toàn |
| Man-in-the-Middle (thay public key) | Ed25519 ký SPK + Fingerprint verify (bắt buộc với 1-1, tự nguyện với group) | Hoàn toàn nếu user verify |
| Tamper ciphertext (sửa nội dung / AAD) | AES-GCM auth tag 16 bytes; AAD = `${convId/groupId}:${senderId}` | Hoàn toàn |
| Brute force password | PBKDF2 600k iterations (client-side key derivation) + bcrypt cost 12 (server) | Tốt |
| Unauthorized user truy cập hệ thống | Email whitelist (AllowedEmail) + JWT | Tốt |
| Privilege escalation (user thường thành admin) | Role field trong JWT + adminMiddleware check server-side | Tốt |
| Admin thu hồi quyền đồng thời (race condition) | PostgreSQL FOR UPDATE row lock trong transaction | Hoàn toàn |
| XSS đọc private key | CSP; private key chỉ trong RAM (không serialize ra DOM); wrappingKey không xuất được | Trung bình |

---

## Giới hạn đã biết (nêu trong báo cáo)

**1. Không có Double Ratchet:**
Forward Secrecy chỉ ở cấp phiên (session-level), không phải cấp tin nhắn.
Nếu Session Key bị lộ → toàn bộ tin nhắn trong phiên bị đọc được.
Signal giải quyết bằng Double Ratchet (spec 40 trang) — nằm ngoài phạm vi đồ án.

**2. Metadata lộ:**
Server biết ai chat với ai, lúc nào, bao nhiêu tin, ai trong nhóm nào.
Signal giải quyết bằng Sealed Sender — ngoài phạm vi.

**3. Endpoint security:**
Nếu máy user nhiễm malware → kẻ tấn công lấy được password → giải mã private key.
E2EE không bảo vệ được trường hợp này — đây là giới hạn cố hữu của mọi hệ thống E2EE.

**4. Chưa Post-Quantum:**
X25519/Ed25519 sẽ bị máy tính lượng tử phá.
Signal đã chuyển sang PQXDH (Kyber-1024 + X25519) từ 2023.
Hướng phát triển tương lai.

**5. Group chat đơn giản hóa:**
Dùng "N tin 1-1 song song" thay vì Sender Keys / MLS.
N người → N bản ciphertext → không scale tốt cho group > 20 người.
Phù hợp với công ty nhỏ nội bộ (scope đồ án).

**6. Single-device:**
Private key chỉ tồn tại trong IndexedDB của thiết bị đăng ký.
Chuyển thiết bị: export/import thủ công file `.e2ee`.
Giải pháp đầy đủ: Signal Sesame Protocol (ngoài phạm vi).

---

## Khi giáo viên hỏi những câu này, trả lời như sau

**"Tại sao không dùng Double Ratchet?"**
> Double Ratchet spec dài 40 trang, yêu cầu quản lý message key riêng cho từng tin nhắn, cần thêm bảng DB và logic phức tạp. Trong phạm vi 6 tuần, ưu tiên implement đúng X3DH trước. Double Ratchet đưa vào hướng phát triển tương lai.

**"Forward Secrecy của bạn ở mức nào?"**
> Session-level forward secrecy: Ephemeral Key và các DH output bị xóa khỏi RAM ngay sau khi tính xong Session Key. OPK dùng 1 lần, không thể replay. Tuy nhiên, nếu Session Key bị lộ thì toàn bộ tin nhắn trong phiên bị đọc được — đây là khác biệt so với Double Ratchet vốn có message-level forward secrecy.

**"Tại sao dùng X25519 không dùng P-256?"**
> X25519 constant-time tự nhiên (chống side-channel), performance cao hơn P-256 khoảng 2-4 lần, là chuẩn của toàn bộ secure messaging ecosystem (Signal, WhatsApp, ProtonMail). NIST P-256 có lịch sử tranh cãi về backdoor trong random number generation.

**"Tại sao IK là Ed25519 mà không phải X25519?"**
> IK phải ký SPK bằng chữ ký số Ed25519 để chứng minh SPK là thật — X25519 không có khả năng ký. Khi cần IK tham gia DH, chuyển đổi sang X25519 bằng hàm `crypto_sign_ed25519_sk_to_curve25519` của libsodium. Đây đúng với Signal Protocol spec.

**"Hệ thống có bao nhiêu bảng? Tại sao nhiều vậy?"**
> 8 bảng: User, AllowedEmail, KeyBundle, Conversation, Group, GroupMember, Message, UploadedFile, PeerVerification. Mỗi bảng phục vụ đúng 1 mục đích rõ ràng. Bảng đặc trưng nhất là KeyBundle — lưu public key để X3DH bất đồng bộ, không có trong hệ thống chat thông thường. AllowedEmail kiểm soát đăng ký, PeerVerification lưu trạng thái xác minh fingerprint toàn cục.

**"Sao chỉ cần 1 salt (wrapSalt) cho tất cả private key?"**
> wrapSalt dùng để derive wrappingKey (CryptoKey) duy nhất qua PBKDF2. wrappingKey này sau đó AES-GCM encrypt từng private key với IV riêng (random mỗi lần). Salt đảm bảo PBKDF2 output không bị rainbow table, IV đảm bảo mỗi ciphertext khác nhau. Không cần nhiều salt vì PBKDF2 chỉ chạy 1 lần — thêm salt per-key sẽ buộc PBKDF2 chạy lại 102 lần (51 giây).

**"Tại sao file group dùng random fileKey thay vì SK?"**
> Dùng SK: phải encrypt file N lần (1 lần/người) → upload N bản → băng thông O(N). Random fileKey: encrypt file 1 lần → upload 1 bản → nhúng fileKey vào message payload của từng người (bảo vệ bằng SK 1-1 riêng) → băng thông O(1) cho file. Server chỉ thấy 1 blob encrypted — vẫn đúng Blind Server model.

**"Admin có đọc được tin nhắn của user không?"**
> Không. Admin là user thực trong hệ thống — tài khoản admin cũng không có private key của người khác. Admin chỉ quản lý được whitelist email và trạng thái tài khoản (enable/disable). Nội dung tin nhắn vẫn được bảo vệ bởi E2EE, kể cả với admin.

**"Tại sao fingerprint group không bắt buộc như 1-1?"**
> Giống với Signal: fingerprint bảo vệ MITM chủ động (server thay public key giả) — rủi ro thấp với hệ thống nội bộ tự vận hành. E2EE đã bảo vệ 99% mối đe dọa (nghe lén, rò rỉ DB) kể cả không verify. Với 1-1, bắt verify để đảm bảo user ý thức được. Với group, tự nguyện để không cản trở UX — người dùng có thể verify từng thành viên qua GroupInfoPanel.

**"PeerVerification hoạt động thế nào?"**
> Fingerprint = hàm của (IK_pub_A, IK_pub_B) — giá trị không đổi dù context là 1-1 hay group. Verify Bob 1 lần (qua conversation 1-1 hoặc qua nhóm) → bản ghi PeerVerification(verifierId=Alice, peerId=Bob) được ghi vào DB → ở mọi nhóm có Bob, shield icon của Bob tự động xanh. Đây là "global verification" — không phải per-conversation.

**"Race condition giữa 2 admin thu hồi quyền nhau là gì?"**
> Nếu admin A và admin B đồng thời revoke quyền của nhau: không có lock, cả 2 đều thấy count=2 → cả 2 đều revoke thành công → hệ thống không còn admin. Giải pháp: `prisma.$transaction` với raw SQL `SELECT COUNT(*) ... FOR UPDATE` → PostgreSQL lock row của bảng User → request thứ 2 phải chờ, đọc lại count sau khi request thứ 1 commit → thấy count=1 → bị từ chối.

---

## Hướng phát triển tương lai (cho chương kết luận báo cáo)

1. **Double Ratchet** — Forward Secrecy cấp tin nhắn (per-message key rotation)
2. **PQXDH** — kết hợp X25519 với Kyber-1024 (ML-KEM, FIPS 203) chống máy tính lượng tử
3. **MLS (RFC 9420)** — group chat scale lớn (Sender Keys, thay thế "N tin 1-1 song song")
4. **Multi-device sync** — Sesame Protocol, thay thế export/import thủ công
5. **Sealed Sender** — ẩn metadata người gửi với server
6. **Argon2id phía client** — thay PBKDF2 khi WASM support tốt hơn trên browser
7. **Audit log** — ghi lại hành động admin (disable/enable/grant/revoke) vào bảng riêng
