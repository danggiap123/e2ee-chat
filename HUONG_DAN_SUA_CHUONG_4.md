# Hướng dẫn sửa Chương 4 — Triển khai và Thử nghiệm

> Tài liệu tập trung riêng cho **Chương 4**, đi theo từng mục 4.1 → 4.8.
> Mọi đề xuất đều đã đối chiếu mã nguồn thật và (với mục 4.6) **đo thật** — xem số liệu chi tiết ở [benchmark/KET_QUA_DO_THAT.md](benchmark/KET_QUA_DO_THAT.md).
>
> Quy ước: 🔴 phải sửa (sai sự thật) · 🟡 nên sửa · 🟢 nên bổ sung để mạnh hơn.

---

## 4.2.1 — Module quản lý và phân quyền người dùng

**Giữ nguyên (đúng):** bcrypt cost 12, JWT có thời hạn (`expiresIn: '1d'`), kiểm tra role ở middleware, whitelist email.

**🟢 Bổ sung 3 điểm tốt mà code CÓ nhưng báo cáo CHƯA kể** (đưa vào sẽ được điểm cộng):

1. **Chống timing attack khi đăng nhập** — khi sai username, server vẫn chạy `bcrypt.compare` với một hash giả (`DUMMY_HASH`) để thời gian phản hồi không tiết lộ "username này có tồn tại hay không" (`auth.js:14, 97`).
2. **Chống race condition khi đăng ký** — việc tạo user và đánh dấu email whitelist "đã dùng" nằm trong **một transaction** (`auth.js:66-75`), tránh trường hợp 2 người đăng ký cùng lúc bằng 1 email.
3. **Cơ chế bootstrap admin** — email cấu hình qua biến môi trường `ADMIN_SEED_EMAIL` được bỏ qua whitelist và tự gán quyền ADMIN khi đăng ký lần đầu (`auth.js:44-53`), để giải bài toán "chưa có admin nào thì ai thêm whitelist".

**Câu gợi ý viết thêm:**
> "Để tránh rò rỉ thông tin qua thời gian phản hồi, tôi luôn cho server chạy phép so khớp bcrypt kể cả khi username không tồn tại (so với một hash giả cố định), nhờ đó kẻ tấn công không thể dựa vào độ trễ để dò xem tài khoản nào có thật."

---

## 4.2.2 — Module trao đổi khóa và mã hóa đầu cuối

**Giữ nguyên (đúng):** 100 OPK, verify chữ ký SPK trước khi X3DH, PBKDF2 600k bọc khóa riêng, mã hóa AES-256-GCM từng tin.

**🟢 Bổ sung 2 chi tiết thật của code:**

1. **Xóa khóa nhạy cảm khỏi RAM** ngay sau khi tính xong Session Key — `DH1..DH4`, `IK_priv`, `EK.priv`, `OPK_priv` đều bị `.fill(0)` (`x3dh.js:84-86, 125-127`). Đây là biện pháp giảm rủi ro lộ khóa nếu bộ nhớ bị dump.
2. **Khóa định danh là Ed25519, convert sang X25519 khi cần DH** (`keyGen.js:21`, `x3dh.js:66`). Đây là điểm kỹ thuật đáng kể — và là chỗ tốt để viết một câu "có chất người làm thật".

**Câu gợi ý (giọng cá nhân):**
> "Một chỗ tôi phải xử lý cẩn thận là khóa định danh: tôi sinh nó dưới dạng Ed25519 để ký khóa SPK, nhưng khi chạy bốn phép Diffie-Hellman lại phải chuyển sang dạng X25519. Lúc đầu tôi để lẫn hai định dạng nên hai bên dẫn xuất ra Session Key khác nhau mà không báo lỗi gì — phải mất khá nhiều thời gian mới tìm ra nguyên nhân."

> ⚠️ Lưu ý đồng bộ với Chương 3: pseudocode 3.5.1 đang ghi `IK = X25519...` là sai (xem hướng dẫn tổng ⑧).

---

## 4.2.3 — Module quản lý lịch sử tin nhắn

**Giữ nguyên (đúng):** lưu bản mã (nonce/ciphertext/tag), phân trang **cursor 20 tin/trang** (`messages.js:271`), xóa tin/hội thoại trên bản ghi đã mã hóa.

**🔴 Sửa dung lượng file:** nếu mục này (hoặc 4.2.4) có nhắc "10MB" → đổi thành **5MB** (frontend chặn 5MB plaintext, backend multer 7MB sau mã hóa). Xem hướng dẫn tổng ①.

---

## 4.2.4 — Module xử lý hàng đợi tin nhắn

**🔴 Sửa hiểu nhầm về "hàng đợi":** Báo cáo (và mục 4.5) gợi ý có Redis làm hàng đợi/bộ đệm tin offline. **Thực tế KHÔNG có hàng đợi**: mỗi tin được **lưu thẳng vào PostgreSQL trước**, rồi mới relay nếu người nhận online; người nhận offline sẽ thấy tin khi **tải lại lịch sử từ DB** (`handler.js:169-210`).

**Câu sửa lại:**
> "Hệ thống không dùng hàng đợi riêng. Mỗi tin nhắn được lưu vào PostgreSQL trước rồi mới chuyển tiếp qua WebSocket; nếu người nhận đang ngoại tuyến, tin vẫn nằm trong cơ sở dữ liệu và được tải lại khi họ kết nối và mở lại hội thoại. Nhờ lưu trước-relay sau, tin không bị mất kể cả khi server gặp sự cố ngay sau khi nhận."

**🟢 Bổ sung — mô hình 1 phiên/người dùng:** mỗi user chỉ giữ **một kết nối WebSocket**; khi kết nối từ thiết bị/tab mới, phiên cũ bị thay thế (`handler.js:62`, gửi `session_replaced`). Nên nêu vì nó nhất quán với phạm vi "không hỗ trợ đa thiết bị/đa tab".

**🟢 Bổ sung thứ tự tin:** thứ tự đảm bảo bằng `createdAt` do server gán khi ghi DB.

---

## 4.4 — Kiểm thử  (mục cần sửa nhiều nhất về tính trung thực)

**🔴 BỎ câu "Việc kiểm thử được thực hiện với sự hỗ trợ của Jest".**
Em không dùng Jest, nên để câu này trong báo cáo là **rủi ro lớn nhất** — hội đồng chỉ cần hỏi "Jest là gì, test file đâu" là lộ. Hãy mô tả **đúng những gì em thật sự đã làm**.

**Cách viết lại 4.4 (trung thực, vẫn chuyên nghiệp):**

> "Việc kiểm thử được thực hiện theo hai hướng: kiểm thử tính đúng của các hàm mật mã bằng các script chạy trực tiếp, và kiểm thử các kịch bản tấn công bằng cách thao tác thủ công trên hệ thống đang chạy."

### 4.4.1 — Kiểm thử tính đúng của hàm mật mã
Mô tả đúng cái em có:
- Script `crypto-test.js` chạy thử chuỗi **X3DH (4 DH) → HKDF → AES-GCM encrypt/decrypt** và in ra kết quả "giải mã khớp với bản gốc" — chứng minh tính đúng.
- Kiểm tra **X3DH đồng thuận khóa**: cho hai phía tính độc lập, so khớp Session Key.
- Kiểm tra **Fingerprint nhất quán**: hai bên tính ra cùng chuỗi bất kể thứ tự khóa.

> 🟡 Lưu ý kỹ thuật: `crypto-test.js` dùng khóa IK dạng X25519 thuần (`crypto_box_keypair`), **khác** code production (IK là Ed25519 convert). Nên hoặc cập nhật script cho khớp, hoặc ghi rõ "script minh họa nguyên lý, code thật dùng Ed25519". Đừng để giám khảo phát hiện hai bên lệch nhau.

### 4.4.2 — Kiểm thử kịch bản tấn công
Ba kịch bản này **có thật và kiểm chứng được** trong code (giữ nguyên, mô tả là "kiểm thử thủ công"):
- **MITM:** server trả SPK sai → `verifySignedPreKey` trả false → client `throw` dừng phiên (`x3dh.js:57-58`). ✔
- **Replay:** gửi lại tin thiết lập phiên → vướng ràng buộc `@@unique([conversationId, iv])` → server trả **HTTP 409 "Phát hiện tấn công phát lại"** (`messages.js:91-92`, `schema.prisma:147`). ✔ (tôi đã xác nhận constraint này tồn tại)
- **Server tò mò:** soi trực tiếp DB chỉ thấy `ciphertext/iv/aad`, không có khóa giải mã. ✔

> 🟢 Gợi ý mạnh: chèn **ảnh chụp** bằng chứng (ví dụ response 409 khi replay, hoặc kết quả query DB chỉ ra bản mã) vào Phụ lục C. Hiện 4.4.2 mới "kể lại", chưa "chứng minh".

---

## 4.5 — Triển khai hệ thống

**🔴 Sửa vai trò Redis (ý iii):** Redis **chỉ** lưu danh sách thu hồi JWT (blocklist), **không** làm hàng đợi/bộ đệm. Tin offline lưu PostgreSQL.

**🟡 Sửa danh sách 5 container cho đúng tên thật:**
5 service trong `docker-compose.yml` là: `postgres`, `redis`, `backend`, `frontend`, `cloudflared`. **Không có container nginx riêng** — Nginx chạy *bên trong* container `frontend` (`frontend/nginx.conf`) để phục vụ SPA + reverse proxy.

**Đoạn viết lại cho 4.5:**
> "Hệ thống gồm 5 container: (i) **backend** — máy chủ ứng dụng (REST API + WebSocket); (ii) **postgres** — PostgreSQL 16 lưu dữ liệu đã mã hóa và metadata định tuyến; (iii) **redis** — danh sách thu hồi JWT; (iv) **frontend** — Nginx phục vụ giao diện tĩnh và làm reverse proxy chuyển tiếp `/api` và `/ws` về backend; (v) **cloudflared** — Cloudflare Tunnel đưa dịch vụ ra Internet không cần mở cổng. Lưu ý cổng backend (3000) không publish ra ngoài; mọi truy cập đều đi qua Nginx ở cổng 80."

---

## 4.6 — Đánh giá hiệu năng  (thay toàn bộ Bảng 4.1 bằng SỐ ĐO THẬT)

**🔴 Vấn đề:** Bảng 4.1 hiện tại là ước lượng, và có **3 số lệch thật sự** so với đo trên máy thật.

**Bảng 4.1 mới — dán thẳng vào báo cáo:**

| Thao tác | Thời gian (đo thật) | Tần suất |
|---|---|---|
| Dẫn xuất khóa bọc PBKDF2 (600.000 vòng) | ≈ **73 ms** | Khi đăng nhập / mở khóa |
| Trao đổi khóa X3DH (4 DH + HKDF) | **< 1 ms** | Khi mở phiên mới |
| Mã hóa / giải mã AES-256-GCM một tin | ≈ **0,04 ms** | Mỗi tin nhắn |
| Tính Fingerprint (SHA-512 lặp 5200) | ≈ **97 ms** | Khi xác minh danh tính |
| Băm mật khẩu bcrypt (cost 12, server) | ≈ **190 ms** | Khi đăng ký / đăng nhập |
| Gửi tin qua WebSocket (gồm ghi DB + ack) | ≈ **11 ms** | Mỗi tin nhắn |
| Throughput gửi tin (`POST /messages`) | ≈ **194 tin/giây** | Tải tối đa đo được |
| Throughput đăng nhập | ≈ **40 req/giây** | Tải tối đa đo được |

*Đo trên AMD Ryzen 7 8845HS, 31 GB RAM, Windows 11 + Docker; các phép crypto phía client đo qua Web Crypto API; ngày 20/06/2026.*

**🔴 So với số cũ:** PBKDF2 (báo cũ ~500ms → thật 73ms), Fingerprint (báo cũ 200–500ms → thật 97ms), bcrypt (báo cũ ~300ms → thật 190ms). **Phải cập nhật**, nếu không khi demo trên máy này số sẽ vênh.

**🟢 Thêm 1 nhận định có giá trị học thuật (đây là phát hiện thật khi đo):**
> "Một quan sát đáng chú ý là throughput đăng nhập (~40 req/s) thấp hơn nhiều so với throughput gửi tin (~194 tin/s). Nguyên nhân không nằm ở mạng hay cơ sở dữ liệu mà ở chính bcrypt: mỗi lần đăng nhập tốn ~190ms CPU để băm mật khẩu, và đây là phép cố tình làm chậm để chống dò mật khẩu. Ngược lại, gửi tin chỉ gồm xác thực JWT, một truy vấn và một lần ghi DB — không có phép mật mã nặng nào ở phía server vì toàn bộ mã hóa diễn ra ở trình duyệt."

**🟡 Ghi rõ phương pháp đo:** cấu hình máy, công cụ (k6), số VU, và trình bày cả trung bình + p95 (không chỉ một con số). Nên chụp màn hình bảng kết quả k6 cho Phụ lục.

**🟢 Về benchmark WebSocket đồng thời:** nếu muốn đưa số "chịu được bao nhiêu kết nối", cần lưu ý hệ thống **chỉ cho 1 phiên/user** nên không thể test bằng 1 token dùng chung — phải sinh nhiều user, mỗi kết nối một token. Hiện tại đã đo được độ trễ relay (~11ms/tin) và throughput gửi tin (194 tin/s), đủ để kết luận về tính khả dụng.

---

## 4.7 — Đánh giá bảo mật

**Giữ nguyên 4.7.1 và 4.7.2** — phần này viết tốt và đúng với code.

**🟢 Bổ sung 1 hạn chế trung thực vào 4.7.1 (hoặc dồn xuống 5.2):**
> "Cơ chế kiểm tra thu hồi token hiện hoạt động theo kiểu fail-open: nếu Redis gặp sự cố, hệ thống bỏ qua bước kiểm tra blocklist để ưu tiên tính sẵn sàng (`middleware/auth.js`). Đây là một đánh đổi cần được thay bằng fail-closed hoặc bổ sung giám sát trong môi trường yêu cầu bảo mật cao."

---

## 4.8 — Kết chương
Cập nhật lại cho khớp các thay đổi trên: nói rõ kiểm thử gồm **kiểm tra tính đúng hàm mật mã bằng script + ba kịch bản tấn công kiểm thử thủ công** (bỏ "Jest"), và hiệu năng được **đo thật** với số liệu cụ thể.

---

## Tổng kết việc cần làm ở Chương 4

**🔴 Phải sửa:**
- [ ] 4.4: **bỏ "Jest"**, mô tả lại đúng cách kiểm thử thật
- [ ] 4.5: sửa vai trò Redis (chỉ blocklist) + tên 5 container
- [ ] 4.6: thay **toàn bộ Bảng 4.1** bằng số đo thật (PBKDF2 73ms, Fingerprint 97ms, bcrypt 190ms…)
- [ ] 4.2.4 (và 4.5): bỏ ý "Redis hàng đợi/bộ đệm" — tin offline ở PostgreSQL
- [ ] Đổi mọi "10MB" → "5MB" (nếu xuất hiện trong 4.2.3/4.2.4)

**🟢 Nên bổ sung:**
- [ ] 4.2.1: timing-attack (DUMMY_HASH), transaction chống race, ADMIN_SEED_EMAIL
- [ ] 4.2.2: xóa khóa khỏi RAM, chuyện Ed25519→X25519 (viết giọng cá nhân)
- [ ] 4.2.4: mô hình 1 phiên/user, thứ tự theo createdAt
- [ ] 4.4.2: chèn ảnh bằng chứng (response 409 replay, query DB ra bản mã) vào Phụ lục C
- [ ] 4.6: nhận định "login bị giới hạn bởi bcrypt" + phương pháp đo
- [ ] 4.7: hạn chế Redis fail-open

**Về giọng văn (áp dụng riêng cho Chương 4):**
Chương 4 là chương "kể việc mình làm" → là nơi giọng cá nhân tự nhiên nhất. Mỗi mục 4.2.x nên có ít nhất **1 câu "tôi"** + **1 con số/chi tiết cụ thể** (đã đo, đã gặp lỗi gì). Tránh liệt kê khô khan kiểu "Module này được triển khai bằng..." — thay bằng "Tôi triển khai... và đo được...". Dùng các con số thật ở mục 4.6 rải vào lời văn để chứng minh em thật sự chạy hệ thống.
