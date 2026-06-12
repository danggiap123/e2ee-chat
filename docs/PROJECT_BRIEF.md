# Project Brief — Tóm tắt báo cáo định hướng

## Mục tiêu hệ thống
Server (kể cả admin) không được phép đọc nội dung tin nhắn.
Khi server bị tấn công và dump toàn bộ database, kẻ tấn công chỉ lấy được:
- Ciphertext (không giải mã được nếu không có private key)
- Public key (vô dụng để giải mã)
- Metadata: ai chat với ai, lúc nào, bao nhiêu tin (đây là giới hạn — xem mục Hạn chế)

## Mô hình Blind Server

| Thành phần | Server LƯU | Server KHÔNG CÓ |
|---|---|---|
| Tin nhắn | Ciphertext | Plaintext |
| Khóa | Public key | Private key, Session Key |
| Xác thực | JWT, bcrypt hash (cost 12) | Mật khẩu gốc |
| Metadata | sender/receiver id, timestamp | — |

## Các thuật toán crypto và lý do chọn

| Thuật toán | Mục đích | Tiêu chuẩn | Lý do chọn |
|---|---|---|---|
| X3DH | Thiết lập Session Key bất đồng bộ | Signal Whitepaper 2016 | Alice chat được với Bob khi Bob offline |
| X25519 (ECDH) | 4 phép DH trong X3DH | RFC 7748 | Constant-time, nhanh hơn P-256 2-4x |
| Ed25519 (EdDSA) | Ký + verify SPK | RFC 8032 | Chống server giả mạo SPK |
| AES-256-GCM | Mã hóa tin nhắn (AEAD) | FIPS 197 + NIST SP 800-38D | Vừa mã hóa vừa xác thực, hardware-accelerated |
| HKDF-SHA256 | Derive Session Key từ X3DH | RFC 5869 | Làm sạch entropy của ECDH output |
| PBKDF2-SHA256 | Bảo vệ private key bằng password | RFC 8018, OWASP 2023 | Web Crypto API native, 600k iterations |
| bcrypt (cost 12) | Hash password phía server | — | 2^12 = 4096 vòng lặp, ~300ms/hash, cân bằng bảo mật và UX. Argon2id mạnh hơn nhưng phức tạp hơn — đưa vào hướng phát triển tương lai |
| SHA-512 (5200 vòng) | Tạo Fingerprint | FIPS 180-4 | Theo Signal Safety Numbers spec |

## Phân tích các loại tấn công

| Tấn công | Cơ chế chống | Hiệu quả |
|---|---|---|
| Passive eavesdropping (nghe lén đường truyền) | AES-256-GCM + HTTPS | Hoàn toàn |
| Server bị hack, dump database | Blind Server: chỉ có ciphertext | Hoàn toàn (về nội dung) |
| Replay attack (gửi lại tin cũ) | OPK dùng 1 lần + IV unique per conversation (@@unique DB constraint) | Hoàn toàn |
| Man-in-the-Middle | Ed25519 ký SPK + Fingerprint bắt buộc verify | Hoàn toàn (nếu user chịu verify) |
| Tamper ciphertext (sửa nội dung) | AES-GCM auth tag 16 bytes | Hoàn toàn |
| Brute force password | PBKDF2 600k iterations (client) + bcrypt cost 12 (server) | Tốt |
| XSS đọc IndexedDB | CSP + SRI (bonus tuần 5) | Trung bình |

## Giới hạn đã biết (nêu trong báo cáo)

**1. Không có Double Ratchet:**
Forward Secrecy chỉ ở cấp phiên (session-level), không phải cấp tin nhắn.
Nếu Session Key bị lộ → toàn bộ tin nhắn trong phiên bị đọc được.
Signal giải quyết bằng Double Ratchet (spec 40 trang) — nằm ngoài phạm vi đồ án.

**2. Metadata lộ:**
Server biết ai chat với ai, lúc nào, bao nhiêu tin.
Signal giải quyết bằng Sealed Sender — ngoài phạm vi.

**3. Endpoint security:**
Nếu máy user nhiễm malware → kẻ tấn công lấy được password → giải mã private key.
E2EE không bảo vệ được trường hợp này — đây là giới hạn cố hữu của mọi hệ thống E2EE.

**4. Chưa Post-Quantum:**
X25519/Ed25519 sẽ bị máy tính lượng tử phá.
Signal đã chuyển sang PQXDH (Kyber-1024) từ 2023.
Hướng phát triển tương lai.

**5. Group chat đơn giản hóa:**
Dùng "N tin 1-1 song song" thay vì Sender Keys/MLS.
Không scale tốt cho group > 20 người — phù hợp với công ty nhỏ.

## Khi giáo viên hỏi những câu này, trả lời như sau

**"Tại sao không dùng Double Ratchet?"**
> Double Ratchet spec dài 40 trang, yêu cầu quản lý message key riêng cho từng tin nhắn, cần thêm bảng DB và logic phức tạp. Trong phạm vi 6 tuần, ưu tiên implement đúng X3DH trước. Double Ratchet đưa vào hướng phát triển tương lai.

**"Forward Secrecy của bạn ở mức nào?"**
> Session-level forward secrecy: Ephemeral Key và các DH output bị xóa khỏi RAM ngay sau khi tính xong Session Key. OPK dùng 1 lần. Tuy nhiên, nếu Session Key bị lộ thì toàn bộ tin nhắn trong phiên bị đọc được — đây là khác biệt so với Double Ratchet vốn có message-level forward secrecy.

**"Tại sao dùng X25519 không dùng P-256?"**
> X25519 constant-time tự nhiên (chống side-channel), performance cao hơn P-256 khoảng 2-4 lần, là chuẩn của toàn bộ secure messaging ecosystem (Signal, WhatsApp, ProtonMail). NIST P-256 có lịch sử tranh cãi về backdoor trong random number generation.

**"Sao chỉ có 4 bảng?"**
> Mô hình Blind Server yêu cầu server lưu tối thiểu dữ liệu. Bảng đặc trưng nhất là KeyBundle — không có trong hệ thống chat thông thường — đây là nơi lưu public key để thực hiện X3DH bất đồng bộ.

## Hướng phát triển tương lai (cho chương kết luận báo cáo)
1. Double Ratchet — Forward Secrecy cấp tin nhắn
2. PQXDH — kết hợp X25519 với Kyber-1024 (ML-KEM, FIPS 203)
3. MLS (RFC 9420) — group chat scale lớn
4. Multi-device sync — Sesame protocol
5. Sealed Sender — ẩn metadata người gửi
6. Argon2id phía client — thay PBKDF2 khi WASM support tốt hơn