# X3DH — Giao Thức Trao Đổi Khóa: Tại Sao & Như Thế Nào

> **Đối tượng:** Junior developer, sinh viên CNTT  
> **Mục tiêu:** Hiểu X3DH từ bài toán thực tế → so sánh giải pháp → phân tích code

---

## Phần 1 — Bài Toán Cần Giải

Hãy tưởng tượng Alice và Bob muốn nhắn tin bí mật cho nhau. Để mã hóa tin nhắn, hai người cần có **một khóa bí mật chung** (Session Key — SK). Vấn đề là:

> **Làm sao Alice và Bob có được cùng một khóa bí mật, mà không cần gặp nhau, không cần server biết khóa đó là gì?**

Đây là bài toán "**key agreement**" (thỏa thuận khóa) — bài toán trung tâm của mọi hệ thống mã hóa đầu cuối.

### Thêm một ràng buộc khó hơn: Bob đang offline

Trong ứng dụng chat thực tế, Alice có thể nhắn tin cho Bob lúc Bob đang ngủ, tắt máy, không có mặt online. Giao thức trao đổi khóa phải hoạt động được **dù Bob không online tại thời điểm Alice nhắn**.

> Đây gọi là **Asynchronous Key Agreement** — thỏa thuận khóa bất đồng bộ.

---

## Phần 2 — Các Giải Pháp Và Tại Sao Không Dùng

### Giải pháp 1: Gặp nhau trực tiếp để trao đổi khóa

Alice và Bob gặp nhau, Alice nói thầm: "Khóa của chúng ta là `abc123`."

**Vấn đề:** Hệ thống chat nội bộ doanh nghiệp có hàng trăm nhân viên. Không thể yêu cầu mọi người gặp nhau trước khi nhắn tin.

---

### Giải pháp 2: ECDH đơn giản (1 phép Diffie-Hellman)

**Diffie-Hellman là gì?** Đây là phép toán kỳ diệu cho phép hai người tính ra cùng một số bí mật mà không cần trao đổi trực tiếp số đó.

**Ví dụ bằng màu sơn (dễ hiểu hơn số học):**

```
Bước 1: Alice và Bob đồng ý dùng màu nền chung = Vàng (công khai, ai cũng biết)

Bước 2: Alice chọn màu bí mật riêng = Đỏ
        Bob   chọn màu bí mật riêng = Xanh

Bước 3: Alice trộn: Vàng + Đỏ = Cam        → Gửi màu Cam cho Bob (ai cũng thấy)
        Bob   trộn: Vàng + Xanh = Xanh lá  → Gửi màu Xanh lá cho Alice (ai cũng thấy)

Bước 4: Alice lấy màu Xanh lá (của Bob) + trộn thêm Đỏ (bí mật của mình) = Nâu
        Bob   lấy màu Cam (của Alice) + trộn thêm Xanh (bí mật của mình) = Nâu

Kết quả: Cả hai ra màu NÂU — đây là Session Key chung!
Kẻ nghe lén chỉ thấy: Vàng, Cam, Xanh lá → không tính ra được Nâu
```

**ECDH (Elliptic Curve DH)** là phiên bản hiệu quả hơn của DH, dùng đường cong elliptic thay vì số nguyên tố. **X25519** là ECDH trên đường cong Curve25519 — nhanh và an toàn.

**Vấn đề của ECDH đơn giản:**

```
Alice gửi: "Bob ơi, public key của tao là A_pub"
Bob phải online để trả lời: "Ok, public key của tao là B_pub"
→ Chỉ hoạt động khi CẢ HAI online cùng lúc
```

Nếu Bob offline, Alice không chat được. **Không phù hợp với ứng dụng chat thực tế.**

---

### Giải pháp 3: RSA — Mã hóa bằng public key của Bob

Alice lấy public key của Bob từ server, mã hóa tin nhắn bằng `RSA(B_pub, message)`. Chỉ Bob có private key mới giải mã được.

**Ưu điểm:** Bob không cần online.

**Nhược điểm nghiêm trọng — Không có Forward Secrecy:**

```
Tình huống: Kẻ tấn công ghi lại TẤT CẢ tin nhắn mã hóa trong 2 năm
Năm thứ 3: Kẻ tấn công lấy được private key của Bob (bị hack, bị ép buộc...)
Kết quả: Kẻ tấn công giải mã được TẤT CẢ 2 năm tin nhắn cũ!
```

**Forward Secrecy** = tính chất đảm bảo: dù private key bị lộ hôm nay, kẻ tấn công **không thể** giải mã tin nhắn của ngày hôm qua.

RSA không có Forward Secrecy → không dùng cho E2EE chat.

---

### Giải pháp 4: TLS (HTTPS)

TLS là giao thức mã hóa kênh truyền giữa browser và server. Nó **không phải** E2EE vì:

```
Không dùng TLS:  Alice → [plaintext] → Server → [plaintext] → Bob
Dùng TLS:        Alice → [encrypted] → Server → [encrypted] → Bob
                                          ↑
                               Server GIẢI MÃ ra plaintext ở đây
                               Server ĐỌC ĐƯỢC nội dung
```

TLS bảo vệ **kênh truyền** (wire encryption), không bảo vệ **nội dung** khỏi server. Với E2EE, yêu cầu là server không bao giờ thấy plaintext — TLS không đáp ứng được.

---

### Bảng so sánh tổng hợp

| Giao thức | Bob offline? | Forward Secrecy | Server không đọc được? | Mutual Auth |
|---|:---:|:---:|:---:|:---:|
| Gặp mặt trực tiếp | ✅ | ✅ | ✅ | ✅ |
| ECDH đơn giản | ❌ | ✅ | ✅ | ❌ |
| RSA | ✅ | ❌ | ✅ | ❌ |
| TLS | ✅ | ✅ | ❌ | một chiều |
| **X3DH** | **✅** | **✅** | **✅** | **✅** |

X3DH là giao thức duy nhất đáp ứng **tất cả 4 yêu cầu** cùng lúc.

---

## Phần 3 — X3DH Là Gì

**X3DH** = **Extended Triple Diffie-Hellman**

- **Extended** = mở rộng, có thêm tính năng so với DH gốc
- **Triple** = dùng 3 cặp khóa (Identity Key, Signed PreKey, One-Time PreKey)
- **Diffie-Hellman** = phép toán trao đổi khóa

X3DH được thiết kế bởi **Signal Protocol** (năm 2016) — giao thức mã hóa được dùng bởi Signal, WhatsApp, iMessage. Đây là tiêu chuẩn vàng của ngành E2EE messaging.

### Ý tưởng cốt lõi: Bob "gửi trước" public keys

Thay vì chờ Bob online để trao đổi khóa, Bob sẽ **upload sẵn một bộ public keys lên server** từ trước. Khi Alice muốn nhắn tin, Alice lấy bộ public keys đó xuống, tự tính ra Session Key — **mà không cần Bob có mặt.**

```
[Bob đăng nhập, upload keys] ──────────────────────────────────→ Server lưu
                                                                     ↓
[Alice online, muốn chat với Bob] ← lấy key bundle của Bob ← Server
         ↓
[Alice tự tính Session Key]
         ↓
[Alice gửi tin đã mã hóa + một số thông tin để Bob tính lại được SK]
         ↓
[Bob online sau đó] → [Bob tính ra cùng Session Key] → [Bob giải mã]
```

---

## Phần 4 — Bốn Loại Khóa Trong X3DH

Để hiểu X3DH, cần hiểu rõ Bob có 4 loại khóa:

### IK — Identity Key (Khóa danh tính)

```
Thuật toán: Ed25519 (dùng để ký) + X25519 (dùng để DH)
Thời gian sống: VĨNH VIỄN — tạo ra khi đăng ký, không bao giờ thay đổi
Vai trò: Chứng minh "tôi là Bob" — ai có IK_pub của Bob là xác minh được danh tính Bob
```

**Ví dụ thực tế:** Giống như chứng minh nhân dân — bất biến, gắn với một người duy nhất.

**Trong code:**
```javascript
// keyGen.js - generateIdentityKey()
const pair = sodium.crypto_sign_keypair();
// pair.publicKey  = IK_pub    (32 bytes, Ed25519)
// pair.privateKey = IK_secret (64 bytes, Ed25519)
```

---

### SPK — Signed PreKey (Khóa ký sẵn)

```
Thuật toán: X25519 (chỉ dùng để DH)
Thời gian sống: Trung hạn — nên rotate mỗi tuần/tháng (dự án này: cố định vì scope đồ án)
Vai trò: Khóa Bob gửi lên server để Alice dùng khi Bob offline
Đặc biệt: Được KÝ bởi IK_priv của Bob → ai cũng verify được SPK là thật của Bob
```

**Tại sao phải ký?** Server có thể bị hack, hoặc server giả mạo thay SPK bằng key của hacker. Chữ ký Ed25519 ngăn chặn điều này — nếu server thay SPK, chữ ký sẽ sai, Alice phát hiện ngay.

**Trong code:**
```javascript
// keyGen.js - generateSignedPreKey()
const pair = sodium.crypto_box_keypair();              // tạo cặp X25519
const SPK_sig = sodium.crypto_sign_detached(
  pair.publicKey,   // nội dung cần ký = SPK_pub
  IK_secret         // ký bằng Ed25519 private key
);
// SPK_sig là bằng chứng: "SPK_pub này đúng là của Bob, không phải giả mạo"
```

---

### OPK — One-Time PreKey (Khóa một lần)

```
Thuật toán: X25519
Thời gian sống: CHỈ DÙNG 1 LẦN — sau khi Alice dùng, server xóa, Bob xóa khỏi IndexedDB
Số lượng: 100 OPK được tạo và upload khi đăng nhập
Vai trò: Tăng cường Forward Secrecy — mỗi conversation đầu tiên dùng 1 OPK khác nhau
```

**Ví dụ thực tế:** Giống như tờ giấy OTP (mật khẩu dùng một lần) — dùng xong đốt đi, không dùng lại.

**Trong code:**
```javascript
// keyGen.js - generateOneTimePreKeys(100)
return Array.from({ length: 100 }, () => {
  const pair = sodium.crypto_box_keypair();
  return {
    id: crypto.randomUUID(), // ID để server + Bob tìm đúng OPK
    OPK_pub: pair.publicKey,
    OPK_priv: pair.privateKey,
  };
});
```

---

### EK — Ephemeral Key (Khóa tạm thời)

```
Thuật toán: X25519
Thời gian sống: CỰC NGẮN — tạo ra đúng lúc Alice gửi tin, xóa khỏi RAM ngay sau khi tính xong SK
Ai tạo: ALICE tạo, không phải Bob
Vai trò: Đảm bảo tính ngẫu nhiên — mỗi lần chat EK mới → SK mới → không đoán được
```

**Ví dụ thực tế:** Giống như số random trong OTP — chỉ tồn tại trong 30 giây, xong là biến mất.

---

### Tổng hợp 4 loại khóa

```
                    Ai tạo?  Sống bao lâu?  Upload server?  Vai trò chính
IK (Identity Key)   Bob      Vĩnh viễn     IK_pub ✅        Xác minh danh tính
SPK (Signed PreKey) Bob      Trung hạn     SPK_pub + sig ✅  Bob "online thay"
OPK (One-Time PK)   Bob      1 lần         OPK_pub ✅        Forward secrecy mạnh
EK (Ephemeral Key)  Alice    Vài ms        EK_pub ✅         Tính ngẫu nhiên, xóa sau
```

> **Lưu ý:** Private keys (IK_secret, SPK_priv, OPK_priv) **KHÔNG BAO GIỜ rời khỏi thiết bị** — server chỉ thấy public keys.

---

## Phần 5 — 4 Phép Diffie-Hellman: Trái Tim Của X3DH

Sau khi Alice lấy key bundle của Bob từ server (IK_pub_B, SPK_pub_B, SPK_sig, OPK_pub_B), Alice thực hiện 4 phép DH. Bob sau đó thực hiện 4 phép DH chiều ngược. Hai bên ra **cùng một kết quả**.

### Tính chất DH cần nhớ

```
Cho cặp khóa (a_priv, a_pub) và (b_priv, b_pub):
DH(a_priv, b_pub) == DH(b_priv, a_pub)

Ví dụ màu sơn:
Alice: DH(Đỏ, Xanh lá) = Nâu
Bob:   DH(Xanh, Cam)   = Nâu ← cùng kết quả!
```

### Phép DH1: Xác thực danh tính hai chiều

```
Alice tính: DH1 = DH(IK_priv_A, SPK_pub_B)
Bob   tính: DH1 = DH(SPK_priv_B, IK_pub_A_x)   ← cùng kết quả

Ý nghĩa: "IK của Alice" trao đổi với "SPK của Bob"
→ Chứng minh Alice BIẾT IK_priv_A (tức là Alice đúng là Alice)
→ Chứng minh Bob BIẾT SPK_priv_B (tức là Bob tạo ra SPK này, server không giả mạo)
→ Mutual Authentication: cả hai xác thực lẫn nhau
```

### Phép DH2: Xác thực danh tính Bob + Forward Secrecy

```
Alice tính: DH2 = DH(EK_priv_A, IK_pub_B_x)
Bob   tính: DH2 = DH(IK_priv_B, EK_pub_A)    ← cùng kết quả

Ý nghĩa: "EK tạm của Alice" trao đổi với "IK của Bob"
→ EK là ngẫu nhiên, mỗi phiên khác nhau → SK khác nhau → không đoán được
→ Bob phải BIẾT IK_priv_B → chứng minh Bob thật
→ Kết hợp DH1: cả hai bên đều xác thực (authenticated key exchange)
```

### Phép DH3: Forward Secrecy cơ bản

```
Alice tính: DH3 = DH(EK_priv_A, SPK_pub_B)
Bob   tính: DH3 = DH(SPK_priv_B, EK_pub_A)   ← cùng kết quả

Ý nghĩa: "EK tạm của Alice" trao đổi với "SPK của Bob"
→ EK ngẫu nhiên, xóa sau khi dùng → dù SPK_priv_B bị lộ sau này, SK không tính lại được
→ Forward Secrecy: quá khứ an toàn dù bị lộ tương lai
```

### Phép DH4: Forward Secrecy mạnh nhất (nhờ OPK)

```
Alice tính: DH4 = DH(EK_priv_A, OPK_pub_B)
Bob   tính: DH4 = DH(OPK_priv_B, EK_pub_A)   ← cùng kết quả

Ý nghĩa: "EK tạm của Alice" trao đổi với "OPK dùng 1 lần của Bob"
→ OPK bị xóa ngay sau khi dùng → SK của phiên này không bao giờ tính lại được
→ Ngay cả Bob cũng không thể tính lại SK của phiên này sau khi OPK bị xóa
→ "Perfect Forward Secrecy" — bảo vệ tuyệt đối cho mỗi phiên
```

### Tổng hợp: tại sao cần cả 4 phép?

```
Chỉ DH1+DH2:   Có mutual auth nhưng không có OPK → nếu SPK bị lộ, decrypt được
Chỉ DH3+DH4:   Forward secrecy tốt nhưng KHÔNG có auth → MITM tấn công được
DH1+DH2+DH3:   Auth + Forward secrecy nhưng OPK protection yếu hơn
Cả 4 phép:     Auth + Forward secrecy tối đa + OPK protection ✅
```

---

## Phần 6 — Ghép Thành Session Key

Sau 4 phép DH, Alice có 4 mảng byte: DH1, DH2, DH3, DH4 (mỗi cái 32 bytes).

```
Bước 1: Ghép IKM = F || DH1 || DH2 || DH3 || DH4
         F = 32 byte 0xFF (theo Signal spec, phân biệt X25519 vs X448)
         IKM = 160 bytes tổng

Bước 2: HKDF-SHA256(IKM) → SK (32 bytes AES-256-GCM key)
         HKDF = HMAC-based Key Derivation Function
         Mục đích: "rửa" entropy từ 4 phép DH thành 1 key chuẩn AES

Bước 3: XÓA DH1, DH2, DH3, DH4 khỏi RAM ngay lập tức
         Dù RAM bị dump, không tính lại được SK
```

**Trong code:**
```javascript
// x3dh.js
const F = new Uint8Array(32).fill(0xFF);
const IKM = concat(F, DH1, DH2, DH3, DH4);  // 160 bytes

const SK = await hkdf(IKM);  // HKDF-SHA256 → AES-256-GCM key

// Xóa ngay sau khi dùng:
DH1.fill(0); DH2.fill(0); DH3.fill(0); DH4.fill(0);
IK_priv.fill(0);
EK.privateKey.fill(0);
```

---

## Phần 7 — Luồng Đầy Đủ Từ Đầu Đến Cuối

```
                    TRƯỚC KHI ALICE NHẮN (Bob đã làm từ trước):
Bob ──────────────────────────────────────────────────────────────────────────
  1. Tạo IK (Ed25519), SPK (X25519), ký SPK bằng IK
  2. Tạo 100 OPK (X25519)
  3. Upload lên server: IK_pub, SPK_pub, SPK_sig, [OPK_pub × 100]
  4. Giữ lại private keys trong IndexedDB (đã wrap bằng PBKDF2+AES-GCM)
  5. Có thể đi ngủ, offline thoải mái ☕


                    KHI ALICE MUỐN NHẮN TIN LẦN ĐẦU:
Alice ────────────────────────────────────────────────────────────────────────
  1. GET /keys/bob_id → Server trả: IK_pub_B, SPK_pub_B, SPK_sig, OPK_pub_B, opk_id
                         Server POP 1 OPK (xóa khỏi danh sách)
  2. Verify: Ed25519.verify(SPK_sig, SPK_pub_B, IK_pub_B) → nếu false → dừng
  3. Tạo EK_A ngẫu nhiên
  4. Tính DH1, DH2, DH3, DH4
  5. HKDF → SK
  6. Xóa DH1-4, EK_priv, IK_priv khỏi RAM
  7. Mã hóa tin nhắn: AES-256-GCM(message, SK)
  8. Gửi qua WebSocket:
     { ciphertext, iv, EK_pub_A, OPK_id, IK_pub_A }
     ^ tin mã hóa  ^ thông tin để Bob tính lại SK


                    KHI BOB ONLINE VÀ NHẬN TIN:
Bob ──────────────────────────────────────────────────────────────────────────
  1. Thấy tin có EK_pub, OPK_id → biết đây là X3DH init message
  2. Lấy OPK_priv từ IndexedDB theo OPK_id
  3. Tính DH1, DH2, DH3, DH4 (chiều ngược)
  4. HKDF → SK  ← CùNG SK VỚI ALICE!
  5. Xóa DH1-4, OPK_priv khỏi IndexedDB (không dùng lại bao giờ)
  6. AES-256-GCM.decrypt(ciphertext, SK) → plaintext ✅


                    CÁC TIN TIẾP THEO:
Cả hai ──────────────────────────────────────────────────────────────────────
  SK đã được lưu vào IndexedDB (wrapped bằng wrappingKey)
  Các tin sau: lấy SK ra → AES-256-GCM.encrypt/decrypt → không cần X3DH nữa
```

---

## Phần 8 — Ba Tính Chất Bảo Mật X3DH Đảm Bảo

### 1. Forward Secrecy (Bảo mật tiến - quan trọng nhất)

```
Tình huống: Hacker năm 2027 lấy được private key của Bob
Câu hỏi: Hacker có giải mã được tin nhắn từ năm 2025 không?

Câu trả lời: KHÔNG

Tại sao:
- SK của mỗi phiên được tính từ EK_priv_A + OPK_priv_B
- EK_priv_A đã bị Alice xóa khỏi RAM ngay sau khi gửi tin
- OPK_priv_B đã bị Bob xóa khỏi IndexedDB sau khi nhận tin
- Dù có IK_priv_B, SPK_priv_B → vẫn thiếu EK_priv_A và OPK_priv_B
- → Không tính lại được SK → không giải mã được
```

### 2. Mutual Authentication (Xác thực hai chiều)

```
Tình huống: Hacker Carol ngồi giữa, giả mạo là Bob với Alice

Câu hỏi: Carol có lừa Alice gửi tin cho mình không?

Câu trả lời: KHÔNG (nếu Alice đã verify fingerprint)

Tại sao:
- Alice fetch key bundle từ server → SPK_pub có SPK_sig
- verifySignedPreKey(IK_pub_B, SPK_sig, SPK_pub) → Ed25519.verify
- Nếu Carol thay SPK_pub bằng key của Carol → chữ ký sai → throw Error
- Carol không có IK_priv_B → không ký lại được SPK_pub giả → bị phát hiện
```

### 3. Deniability (Phủ nhận hợp lý - tính năng thú vị)

```
Tình huống: Alice nhắn tin xấu cho Bob, sau đó bị kiện
            Bob in conversation ra làm bằng chứng

Câu hỏi: Bob có chứng minh được Alice gửi tin đó không?

Câu trả lời: Về mặt toán học, KHÔNG

Tại sao:
- Session Key SK được tính từ DH (symmetric) — cả Alice lẫn Bob đều có thể tính ra SK
- Alice có thể lập luận: "Bob tự tạo tin nhắn đó rồi mã hóa bằng SK chung"
- Không có chữ ký nào của Alice trên nội dung tin nhắn
- → Không có non-repudiation (tính không thể phủ nhận) — intentional design

Đây là tính năng, không phải bug: bảo vệ người dùng khỏi việc bị dùng tin nhắn
riêng tư làm bằng chứng pháp lý mà họ không đồng ý.
```

---

## Phần 9 — Tại Sao Dự Án Này Chọn X3DH

### Yêu cầu cứng của đề bài

| Yêu cầu | X3DH đáp ứng như thế nào |
|---|---|
| Blind Server (server không thấy plaintext) | Private keys không bao giờ lên server |
| Bob có thể offline khi Alice nhắn | Key bundle upload trước, async handshake |
| Forward Secrecy | EK + OPK bị xóa sau mỗi phiên |
| Xác thực danh tính (chống MITM) | SPK_sig + fingerprint verification |

### Tại sao không dùng giao thức khác

**TLS/HTTPS:** Bảo vệ kênh truyền, server vẫn đọc được → vi phạm mô hình Blind Server.

**RSA async:** Bob offline được, nhưng không có Forward Secrecy → dùng RSA-OAEP encrypt từng tin → nếu RSA_priv_B bị lộ, toàn bộ lịch sử bị giải mã.

**ECDH đơn giản:** Forward Secrecy có nhưng phải online cùng lúc → không phù hợp chat app.

**Double Ratchet (Signal đầy đủ):** Tốt hơn X3DH (rotate key sau từng tin nhắn), nhưng **quá phức tạp** cho scope đồ án. X3DH là nền tảng của Double Ratchet — hiểu X3DH xong mới học Double Ratchet.

**PQXDH (Post-Quantum):** Phiên bản mới của Signal (2023), kết hợp X3DH với CRYSTALS-Kyber để chống quantum computer. Nằm ngoài scope đồ án.

### X3DH là "đủ tốt" cho scope đề bài

```
Bảo vệ đủ: nghe lén mạng, rò rỉ database, server bị hack, brute-force hash
Chưa bảo vệ: thiết bị bị chiếm hoàn toàn (nhưng không giao thức nào bảo vệ được)
Không làm: Double Ratchet (rotate key mỗi tin), PQXDH (kháng quantum)
```

---

## Phần 10 — Mapping Code Thực Tế

### File [x3dh.js](../../frontend/src/crypto/x3dh.js)

```javascript
// ─── Alice gửi (performX3DH_sender) ───────────────────────────────────────

// Bước 1: Verify SPK signature
const valid = await verifySignedPreKey(IK_pub_B, SPK_sig, SPK_pub_B);
if (!valid) throw new Error('SPK signature invalid — possible MITM attack');
//  ↑ Nếu server giả mạo SPK_pub_B → chữ ký sai → dừng ngay

// Bước 2: Tạo EK ngẫu nhiên (dùng 1 lần duy nhất)
const EK = sodium.crypto_box_keypair();

// Bước 3: Convert Ed25519 → X25519 (IK dùng 2 thuật toán)
const IK_priv = sodium.crypto_sign_ed25519_sk_to_curve25519(IK_secret);
const IK_pub_B_x = sodium.crypto_sign_ed25519_pk_to_curve25519(IK_pub_B);
//  ↑ IK ban đầu là Ed25519 (để ký), cần convert sang X25519 (để DH)

// Bước 4: 4 phép DH
const DH1 = sodium.crypto_scalarmult(IK_priv, SPK_pub_B);       // mutual auth
const DH2 = sodium.crypto_scalarmult(EK.privateKey, IK_pub_B_x);// mutual auth
const DH3 = sodium.crypto_scalarmult(EK.privateKey, SPK_pub_B); // forward secrecy
const DH4 = sodium.crypto_scalarmult(EK.privateKey, OPK_pub_B); // FS mạnh (OPK)

// Bước 5: HKDF → SK
const F = new Uint8Array(32).fill(0xFF); // Signal spec: phân biệt X25519 vs X448
const IKM = concat(F, DH1, DH2, DH3, DH4);
const SK = await hkdf(IKM);

// Bước 6: Xóa ngay sau khi dùng → RAM clean
DH1.fill(0); DH2.fill(0); DH3.fill(0); DH4.fill(0);
IK_priv.fill(0);
EK.privateKey.fill(0);
```

```javascript
// ─── Bob nhận (performX3DH_receiver) ──────────────────────────────────────

// 4 phép DH chiều NGƯỢC — kết quả BẰNG Alice
const DH1 = sodium.crypto_scalarmult(SPK_priv, IK_pub_A_x);  // = DH(IK_A, SPK_B)
const DH2 = sodium.crypto_scalarmult(IK_priv, EK_pub_A);     // = DH(EK_A, IK_B)
const DH3 = sodium.crypto_scalarmult(SPK_priv, EK_pub_A);    // = DH(EK_A, SPK_B)
const DH4 = sodium.crypto_scalarmult(OPK_priv, EK_pub_A);    // = DH(EK_A, OPK_B)

// OPK đã dùng → xóa vĩnh viễn
OPK_priv.fill(0);  // ← Perfect Forward Secrecy: Bob cũng không tính lại được SK này
```

### File [keyGen.js](../../frontend/src/crypto/keyGen.js)

```javascript
// Tạo IK: Ed25519 (ký) → convert sang X25519 khi cần DH
const pair = sodium.crypto_sign_keypair();
// IK_pub = 32 bytes Ed25519 public key → upload lên server
// IK_secret = 64 bytes Ed25519 secret key → lưu IndexedDB

// Tạo SPK: X25519 + ký bằng IK
const pair = sodium.crypto_box_keypair();
const SPK_sig = sodium.crypto_sign_detached(pair.publicKey, IK_secret);
// SPK_sig = 64 bytes Ed25519 signature → ai có IK_pub đều verify được

// Tạo 100 OPK: X25519 thuần
const pair = sodium.crypto_box_keypair();
// pub → server, priv → IndexedDB (wrapped)
```

---

## Tóm Tắt

```
X3DH giải quyết bài toán:
"Alice và Bob thỏa thuận khóa bí mật, không cần gặp mặt,
 không cần online cùng lúc, server không biết khóa,
 và nếu bị lộ khóa trong tương lai vẫn không giải mã được quá khứ"

Bốn phép DH = bốn lớp bảo vệ:
  DH1 + DH2 → Xác thực hai chiều (không MITM được)
  DH3       → Forward Secrecy cơ bản
  DH4       → Perfect Forward Secrecy nhờ OPK dùng 1 lần

So sánh nhanh:
  RSA async  → async ✅, nhưng không Forward Secrecy ❌
  ECDH đơn  → Forward Secrecy ✅, nhưng cần online cùng lúc ❌
  TLS        → bảo vệ kênh truyền, server vẫn đọc được ❌
  X3DH       → cả ba ưu điểm ✅
```

---

*Tài liệu này mô tả đúng code trong [x3dh.js](../../frontend/src/crypto/x3dh.js) và [keyGen.js](../../frontend/src/crypto/keyGen.js). Thư viện sử dụng: `libsodium-wrappers` (X25519, Ed25519) + `Web Crypto API` (HKDF, AES-GCM).*
