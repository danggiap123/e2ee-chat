# Kết quả benchmark đo thật — E2EE Chat

> Tài liệu này ghi lại **số liệu đo thật** (không phải ước lượng) để thay cho Bảng 4.1 trong báo cáo.
> Mọi con số dưới đây đều chạy trực tiếp trên hệ thống đang deploy bằng Docker.

## 1. Phương pháp đo (methodology)

| Hạng mục | Giá trị |
|---|---|
| Máy đo | AMD Ryzen 7 8845HS (8 nhân/16 luồng), 31 GB RAM |
| Hệ điều hành | Windows 11 + Docker Desktop |
| Công cụ tải | k6 v2.0.0 |
| Runtime đo crypto | Node.js v24.14.0 (Web Crypto API — cùng API trình duyệt dùng) |
| Ngày đo | 2026-06-20 |
| Cách truy cập | qua Nginx cổng 80 (`/api`, `/ws`) — đúng đường người dùng thật đi |
| Số mẫu | PBKDF2/Fingerprint: 10 lần; AES: 1000 lần; X3DH: 100 lần; HTTP/WS: hàng nghìn request |

> **Lưu ý trung thực:** các phép crypto phía client (PBKDF2, AES, Fingerprint, X3DH) được đo bằng Web Crypto API **trong Node**, không phải trong trình duyệt thật. Trình duyệt có thể chậm hơn đôi chút (nhất là PBKDF2). Các số phía server (bcrypt, login, gửi tin, WebSocket) đo trực tiếp trên hệ thống deploy nên phản ánh đúng thực tế.

---

## 2. Bảng A — Chi phí từng phép mật mã (micro-benchmark)

| Thao tác | Thời gian đo thật | Tần suất | (Báo cáo cũ ghi) |
|---|---|---|---|
| PBKDF2 600.000 vòng → khóa bọc | **avg 73 ms**, p95 87 ms | Khi đăng nhập / mở khóa | ~0,5 giây ❗ cao gấp ~7× |
| X3DH (4 phép DH + HKDF) | **avg 0,66 ms**, p95 1,4 ms | Khi mở phiên mới | < 10 ms ✓ (thực tế nhanh hơn nhiều) |
| AES-256-GCM mã hóa/giải mã 1 tin | **avg 0,04 ms**, p95 0,07 ms | Mỗi tin nhắn | < 1 ms ✓ |
| Fingerprint (SHA-512 lặp 5200) | **avg 97 ms**, p95 121 ms | Khi xác minh danh tính | 200–500 ms ❗ cao hơn thực tế |
| bcrypt cost 12 (server) | **avg 190 ms** (5 lần: 189–191) | Khi đăng ký / đăng nhập | ~300 ms ❗ lệch |
| WebSocket gửi→ack (gồm ghi DB, 1 kết nối) | **avg 11,3 ms**, p50 9 ms, p95 26 ms | Mỗi tin nhắn | < 5 ms (chưa tính ghi DB) |

❗ = số trong báo cáo hiện tại **lệch** so với đo thật trên máy này → cần cập nhật.

---

## 3. Bảng B — Throughput / chịu tải (macro-benchmark, k6)

| Kịch bản | Throughput | Latency | Lỗi |
|---|---|---|---|
| **Login** (`POST /auth/login`, 20 VU) | ~40 req/s | avg 277 ms, p95 336 ms | 0% |
| **Gửi tin** (`POST /messages`, tới 30 VU) | **~194 tin/s** | avg 26 ms, p95 52 ms | 0% |
| WebSocket relay (gửi→ack, 1 kết nối) | ~ liên tục | avg 11 ms, p95 26 ms | 0% |

**Nhận định quan trọng (nên đưa vào báo cáo):**
- Throughput **login bị giới hạn bởi bcrypt** (CPU-bound ~190ms/lần), không phải bởi I/O. Đây là lý do login chỉ ~40 req/s trong khi gửi tin đạt ~194 tin/s.
- Gửi tin nhanh hơn ~5× vì chỉ gồm: verify JWT → 1 query DB → insert → relay; không có phép mật mã nặng nào ở server (mã hóa diễn ra ở client).
- WebSocket ack ~11ms đã bao gồm ghi DB trước rồi mới ack — đúng thiết kế "lưu trước, relay sau" (`handler.js:169`).

---

## 4. Lỗi phát hiện trong bộ script benchmark (đã sửa)

Khi chạy thật, bộ `benchmark/` cũ **không chạy được** với backend hiện tại. Các lỗi:

| File | Lỗi | Đã sửa |
|---|---|---|
| `00_setup.js`, `01_http_login.js` | Login gửi field `email`, nhưng `/auth/login` yêu cầu `username` → HTTP 400 | ✅ đổi sang `username` |
| `00_setup.js` | Đọc `convRes.json('id')`, nhưng API trả `conversationId` | ✅ đổi sang `conversationId` |
| Tất cả | Mặc định `http://localhost:3000` / `ws://localhost:3000` — nhưng port 3000 **không publish ra host** | ✅ đổi sang `http://localhost/api`, `ws://localhost/ws` |

> Đây là bằng chứng kỹ thuật cho thấy bộ số trong Bảng 4.1 cũ **không lấy ra từ chính các script này** — vì script chạy là fail.

### Hạn chế của benchmark 03/04 (WebSocket) — cần ghi rõ
`03_ws_concurrent.js` và `04_ws_throughput.js` dùng **cùng 1 token cho mọi VU**. Nhưng backend **chỉ cho 1 phiên/user**: khi user kết nối lần 2, phiên cũ bị kick (`handler.js:62`, `session_replaced`). Hậu quả: 200 VU dùng token `alice` thì 199 kết nối bị đá ra ngay → không đo được số kết nối đồng thời.
→ **Để đo đúng "N kết nối đồng thời" cần N token của N user khác nhau** (sinh sẵn N user, mỗi VU một token). Đây là việc cần làm nếu muốn đưa số "chịu được bao nhiêu connection" vào báo cáo. (Backend đã được xác nhận xử lý ping/pong + ack đúng bằng client Node thật.)

---

## 5. Bảng đề xuất thay cho Bảng 4.1 (dán vào báo cáo)

| Thao tác | Thời gian | Tần suất |
|---|---|---|
| Dẫn xuất khóa bọc PBKDF2 (600.000 vòng) | ≈ 73 ms | Khi đăng nhập / mở khóa |
| Trao đổi khóa X3DH (4 DH + HKDF) | < 1 ms | Khi mở phiên mới |
| Mã hóa / giải mã AES-256-GCM một tin | ≈ 0,04 ms | Mỗi tin nhắn |
| Tính Fingerprint (SHA-512 lặp 5200) | ≈ 97 ms | Khi xác minh danh tính |
| Băm mật khẩu bcrypt (cost 12, server) | ≈ 190 ms | Khi đăng ký / đăng nhập |
| Gửi tin qua WebSocket (gồm ghi DB, ack) | ≈ 11 ms | Mỗi tin nhắn |
| **Throughput gửi tin** (`POST /messages`) | **≈ 194 tin/giây** | Tải tối đa đo được |
| **Throughput đăng nhập** | **≈ 40 req/giây** (giới hạn bởi bcrypt) | Tải tối đa đo được |

*Đo trên AMD Ryzen 7 8845HS / 31GB RAM / Windows 11 + Docker, ngày 20/06/2026; crypto client đo qua Web Crypto API (Node). Mỗi giá trị là trung bình nhiều lần chạy.*

---

## 6. Việc nên làm tiếp (tùy chọn)
- [ ] Đo lại PBKDF2 + Fingerprint **trong trình duyệt thật** (Chrome/Firefox) để có số client chính xác tuyệt đối.
- [ ] Sửa 03/04 để cấp **N token riêng** rồi đo số kết nối WebSocket đồng thời tối đa.
- [ ] Chụp màn hình bảng summary k6 làm minh chứng đính kèm Phụ lục.
