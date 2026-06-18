# Thuật Toán Mã Hóa Đầu Cuối (E2EE)
> Viết theo đúng code thực tế: x3dh.js, keyGen.js, aesGcm.js, fingerprint.js

---

## 4 Tầng Mã Hóa

```
Tầng 1 — PBKDF2-SHA256 (600k vòng)
  Bảo vệ private key khi lưu IndexedDB
  password → wrappingKey (AES-256-GCM)

Tầng 2 — X3DH (4× X25519 DH + HKDF-SHA256)
  Trao đổi Session Key bất đồng bộ (Alice → Bob kể cả khi Bob offline)
  Kết quả: SK (AES-256-GCM key), cả 2 bên tính ra cùng SK
  Dùng cho: 1-1 và từng cặp trong group (N tin 1-1 song song)

Tầng 3 — AES-256-GCM
  Mã hóa từng tin nhắn bằng SK
  IV random mỗi tin, AAD chống replay attack

Tầng 4 — AES-256-GCM (File)
  1-1:   mã hóa file bằng SK conversation (reuse tầng 3)
  Group: sinh random fileKey → mã hóa file 1 lần → fileKey bọc trong payload từng người
```

---

## Phần 1: PBKDF2 — Bảo Vệ Private Key

### Lý thuyết

Password người dùng có entropy thấp (~30-50 bits). Private key cần entropy 256 bits.
PBKDF2 "kéo dài" password bằng cách lặp đi lặp lại 600.000 lần hash:
- Máy mạnh nhất: ~1000 guess/giây
- Brute-force 8 ký tự lowercase (26^8 ≈ 200 tỷ): 200 triệu giây ≈ 6 năm

**Salt** (16B random): ngăn rainbow table. Không có salt → cùng password = cùng wrappingKey → kẻ tấn công pre-compute bảng tra cứu.

### Pseudo code

```
DERIVE_WRAPPING_KEY(password, salt):
  keyMaterial = IMPORT_KEY(raw, UTF8(password), 'PBKDF2')
  wrappingKey = DERIVE_KEY(
    PBKDF2 { hash: SHA-256, salt: salt, iterations: 600_000 },
    keyMaterial,
    AES-GCM-256,
    extractable: false,
    usage: [encrypt, decrypt]
  )
  RETURN wrappingKey

WRAP_PRIVATE_KEY(privKey, wrappingKey):
  iv = RANDOM_BYTES(12)
  wrapped = AES-256-GCM.ENCRYPT(privKey, wrappingKey, iv)
  RETURN { wrapped: BASE64(wrapped), iv: BASE64(iv) }
```

### Thực thi — `crypto/keyGen.js`

```javascript
export async function deriveWrappingKey(password, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function wrapPrivateKey(privKey, wrappingKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, privKey);
  return { wrapped: toBase64(wrapped), iv: toBase64(iv) };
}
```

---

## Phần 2: X3DH — Trao Đổi Session Key

### Lý thuyết

**Vấn đề:** Alice muốn gửi tin nhắn mã hóa cho Bob, nhưng Bob đang offline. Làm thế nào 2 người tính ra cùng SK mà không cần gặp nhau real-time?

**Giải pháp:** X3DH (Extended Triple Diffie-Hellman) — Signal Protocol 2016.

**4 phép DH và vai trò:**

| DH | Phép tính (Alice) | Phép tính (Bob) | Mục đích |
|---|---|---|---|
| DH1 | X25519(IK_priv_A, SPK_pub_B) | X25519(SPK_priv_B, IK_pub_A_x) | Mutual Authentication |
| DH2 | X25519(EK_priv, IK_pub_B_x) | X25519(IK_priv_B_x, EK_pub_A) | Mutual Authentication |
| DH3 | X25519(EK_priv, SPK_pub_B) | X25519(SPK_priv_B, EK_pub_A) | Forward Secrecy |
| DH4 | X25519(EK_priv, OPK_pub_B) | X25519(OPK_priv_B, EK_pub_A) | Forward Secrecy (OPK) |

**Tại sao 4 phép không phải 1?**
- 1 phép DH không đạt được cả Authentication lẫn Forward Secrecy đồng thời
- DH1+DH2: mutual auth — cả 2 bên chứng minh có private key
- DH3+DH4: forward secrecy — EK_priv và OPK_priv bị xóa ngay → dump RAM sau cũng không tính lại được SK

**Tại sao IK là Ed25519 nhưng X3DH dùng X25519?**
- IK cần ký SPK → phải là Ed25519 (thuật toán chữ ký)
- DH cần X25519 (thuật toán key exchange)
- Curve25519 là cơ sở toán học chung → libsodium có hàm convert an toàn

**Ứng dụng trong Group Chat:**
- Không dùng Sender Keys — đơn giản hơn, dễ giải thích
- Alice thực hiện X3DH với từng member (Bob, Carol...) → N SK riêng biệt
- SK cache key = `${groupId}:${recipientId}` (sender) / `${groupId}:${senderId}` (receiver)
- Tách biệt hoàn toàn với SK 1-1 (cache key 1-1 = convId)

### Pseudo code

```
X3DH_SENDER(alice, bob_bundle):
  IF NOT Ed25519.verify(bob_bundle.spkSig, bob_bundle.spkPub, bob_bundle.ikPub):
    THROW "MITM detected"

  IK_priv_A_x  = Ed25519ToX25519.private(alice.IK_secret)
  IK_pub_B_x   = Ed25519ToX25519.public(bob_bundle.ikPub)
  EK = X25519.generateKeypair()

  DH1 = X25519(IK_priv_A_x,   bob_bundle.spkPub)
  DH2 = X25519(EK.privateKey, IK_pub_B_x)
  DH3 = X25519(EK.privateKey, bob_bundle.spkPub)
  DH4 = X25519(EK.privateKey, bob_bundle.opkPub)

  F   = 0xFF × 32 bytes  // Signal spec prefix
  IKM = F || DH1 || DH2 || DH3 || DH4  // 160 bytes
  SK  = HKDF-SHA256(IKM, salt=0x00×32, info="E2EEChat_v1")

  ZERO(DH1, DH2, DH3, DH4, IK_priv_A_x, EK.privateKey)
  RETURN { SK, EK_pub, OPK_id, IK_pub_A }


X3DH_RECEIVER(bob, init_msg):
  IK_priv_B_x = Ed25519ToX25519.private(bob.IK_secret)
  IK_pub_A_x  = Ed25519ToX25519.public(init_msg.ikPub)

  DH1 = X25519(bob.SPK_priv, IK_pub_A_x)
  DH2 = X25519(IK_priv_B_x, init_msg.ekPub)
  DH3 = X25519(bob.SPK_priv, init_msg.ekPub)
  DH4 = X25519(bob.OPK_priv, init_msg.ekPub)

  IKM = F || DH1 || DH2 || DH3 || DH4
  SK  = HKDF-SHA256(IKM, ...)

  ZERO(DH1, DH2, DH3, DH4, IK_priv_B_x, bob.OPK_priv)
  DELETE_INDEXEDDB(OPK_id)  // OPK dùng 1 lần

  RETURN { SK }
```

### Thực thi — `crypto/x3dh.js`

```javascript
async function hkdf(ikm) {
  const keyMaterial = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode('E2EEChat_v1') },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,               // extractable: true — cần export để lưu IndexedDB
    ['encrypt', 'decrypt']
  );
}

export async function performX3DH_sender(myKeys, bobBundle) {
  await sodium.ready;
  const { IK_secret, IK_pub } = myKeys;

  const IK_pub_B  = fromBase64(bobBundle.ikPub);
  const SPK_pub_B = fromBase64(bobBundle.spkPub);
  const SPK_sig   = fromBase64(bobBundle.spkSig);
  const OPK_pub_B = fromBase64(bobBundle.opkPub);

  const valid = await verifySignedPreKey(IK_pub_B, SPK_sig, SPK_pub_B);
  if (!valid) throw new Error('SPK signature invalid — possible MITM attack');

  const EK = sodium.crypto_box_keypair();
  const IK_priv    = sodium.crypto_sign_ed25519_sk_to_curve25519(IK_secret);
  const IK_pub_B_x = sodium.crypto_sign_ed25519_pk_to_curve25519(IK_pub_B);

  const DH1 = sodium.crypto_scalarmult(IK_priv,       SPK_pub_B);
  const DH2 = sodium.crypto_scalarmult(EK.privateKey, IK_pub_B_x);
  const DH3 = sodium.crypto_scalarmult(EK.privateKey, SPK_pub_B);
  const DH4 = sodium.crypto_scalarmult(EK.privateKey, OPK_pub_B);

  const F   = new Uint8Array(32).fill(0xFF);
  const IKM = concat(F, DH1, DH2, DH3, DH4);  // 160 bytes
  const SK  = await hkdf(IKM);

  DH1.fill(0); DH2.fill(0); DH3.fill(0); DH4.fill(0);
  IK_priv.fill(0);
  EK.privateKey.fill(0);

  return { SK, EK_pub: EK.publicKey, OPK_id: bobBundle.opkId, IK_pub };
}
```

---

## Phần 3: AES-256-GCM — Mã Hóa Tin Nhắn

### Lý thuyết

**AES-GCM = AEAD** (Authenticated Encryption with Associated Data):
- **Confidentiality:** không đọc được nội dung mà không có SK
- **Integrity:** 1 bit ciphertext bị sửa → auth tag sai → decrypt fail
- **AAD Authentication:** metadata bị sửa → auth tag sai → decrypt fail

**Tại sao IV phải random mỗi tin?**
AES-GCM dùng cùng `key + IV` → keystream giống nhau.
`c1 XOR c2 = plain1 XOR plain2` → loại bỏ keystream, so sánh trực tiếp 2 plaintext → lộ thông tin.

**Tại sao cần AAD?**
- 1-1: AAD = `"{convId}:{senderId}"` — bảo đảm ciphertext của conv A không relay sang conv B
- Group: AAD = `"{groupId}:{senderId}"` — nhất quán giữa sender và mọi receiver trong nhóm
- Không có AAD: attacker lấy ciphertext từ conv A, replay vào conv B → Bob giải mã thành công

### Pseudo code

```
ENCRYPT(plaintext, SK, convId, senderId):
  iv  = RANDOM_BYTES(12)
  aad = convId + ":" + senderId
  ciphertext = AES-256-GCM.ENCRYPT(UTF8(plaintext), SK, iv, UTF8(aad))
  RETURN { ciphertext: BASE64(ciphertext), iv: BASE64(iv), aad }

DECRYPT(ct, iv, aad, SK):
  TRY:
    bytes = AES-256-GCM.DECRYPT(BASE64_DECODE(ct), SK, BASE64_DECODE(iv), UTF8(aad))
    RETURN UTF8_DECODE(bytes)
  CATCH DOMException:
    RETURN null  // SK sai / IV sai / AAD sai / ciphertext bị sửa
```

### Thực thi — `crypto/aesGcm.js`

```javascript
export async function encryptMessage(plaintext, SK, conversationId, senderId) {
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const aad = `${conversationId}:${senderId}`;
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) },
    SK,
    new TextEncoder().encode(plaintext)
  );
  return { ciphertext: toBase64(ciphertext), iv: toBase64(iv), aad };
}

export async function decryptMessage(ciphertextB64, ivB64, aad, SK) {
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(ivB64), additionalData: new TextEncoder().encode(aad) },
      SK,
      fromBase64(ciphertextB64)
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;  // UI hiển thị "[Không thể giải mã]"
  }
}
```

---

## Phần 4: Mã Hóa File — E2EE cho Binary Data

### Lý thuyết

File là binary data — cần mã hóa trước khi upload lên server.

**1-1:** Reuse SK conversation → không cần trao đổi key thêm.

**Group:** Nếu mã hóa N lần bằng N SK riêng → upload N bản ciphertext → tốn băng thông N×.
Giải pháp: sinh random `fileKey` 256-bit → mã hóa file 1 lần → upload 1 bản → `fileKey` bọc trong message payload của từng người (mã hóa bằng SK riêng).
→ Server chỉ lưu 1 bản file, tiết kiệm băng thông N lần.

**Blind Server:** Server chỉ thấy encrypted bytes, không biết loại file hay nội dung.

### Pseudo code — Group File

```
ENCRYPT_GROUP_FILE(fileBytes):
  fileKey = RANDOM_AES256_KEY()         // 256-bit random
  fileIv  = RANDOM_BYTES(12)
  encryptedBytes = AES-256-GCM.ENCRYPT(fileBytes, fileKey, fileIv)
  RETURN { encryptedBytes, fileIv, fileKey }

// Sender: với mỗi recipient
FOR EACH member IN group:
  SK_with_member = getOrCreateGroupSK(groupId, member.id)
  payload = { type, fileId, fileName, mimeType, fileSize, fileIv, fileKey }
  ciphertext = ENCRYPT_MESSAGE(JSON(payload), SK_with_member, ...)

// Receiver: sau khi decrypt message
payload = JSON.parse(DECRYPT_MESSAGE(ciphertext, SK, ...))
encryptedBytes = DOWNLOAD_FILE(payload.fileId)
fileBytes = AES-256-GCM.DECRYPT(encryptedBytes, fileKey=payload.fileKey, fileIv=payload.fileIv)
```

### Thực thi — `crypto/aesGcm.js`

```javascript
export async function encryptBytes(bytes, SK) {
  const fileIv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: fileIv }, SK, bytes);
  return { encryptedBytes: new Uint8Array(encrypted), fileIv: toBase64(fileIv) };
}

export async function encryptBytesWithRandomKey(bytes) {
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const fileKey = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', true, ['encrypt','decrypt']);
  rawKey.fill(0);
  const fileIv  = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: fileIv }, fileKey, bytes);
  const exportedKey = await crypto.subtle.exportKey('raw', fileKey);
  return {
    encryptedBytes: new Uint8Array(encrypted),
    fileIv: toBase64(fileIv),
    fileKey: toBase64(exportedKey),
  };
}

export async function decryptBytesWithKey(encryptedBytes, fileIvB64, fileKeyB64) {
  const rawKey  = fromBase64(fileKeyB64);
  const fileKey = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(fileIvB64) },
    fileKey,
    encryptedBytes
  );
  return new Uint8Array(decrypted);
}
```

---

## Phần 5: Fingerprint — Chống MITM

### Lý thuyết

**MITM:** Server thay `IK_pub_B` bằng key của mình khi Alice `GET /keys/bob`. Alice thực hiện X3DH với server thay vì Bob → server đọc mọi tin.

**Giải pháp:** Fingerprint verification qua kênh ngoài (OOB — Out Of Band): điện thoại, gặp trực tiếp. Kênh mà server không can thiệp được.

**SHA-512 × 5200 vòng:** Mỗi guess key giả = 5200 lần SHA-512. GPU mạnh nhất = ~10^9 SHA-512/giây → 1 guess = 5.2μs. Thử 10^12 key giả = 5.2 × 10^6 giây ≈ 60 ngày. Không khả thi.

**Fingerprint là bất biến theo context:**
`generateFingerprint(IK_A, IK_B)` chỉ phụ thuộc vào 2 identity key → không đổi dù gọi từ conv 1-1 hay nhóm. Đây là nền tảng của **PeerVerification global**: verify 1 lần, xanh ở mọi nơi.

### Pseudo code

```
GENERATE_FINGERPRINT(IK_pub_A, IK_pub_B):
  [first, second] = LEX_SORT(IK_pub_A, IK_pub_B)
  combined = CONCAT(first, second)  // 64 bytes

  hash = SHA-512(combined)
  FOR i = 1 TO 5199:
    hash = SHA-512(hash)

  digits = (BIGINT(HEX(hash)) MOD 10^60).padStart(60, '0')
  RETURN digits
```

### Thực thi — `crypto/fingerprint.js`

```javascript
export async function generateFingerprint(IK_pub_A, IK_pub_B) {
  const [first, second] = lexCompare(IK_pub_A, IK_pub_B) <= 0
    ? [IK_pub_A, IK_pub_B]
    : [IK_pub_B, IK_pub_A];

  const combined = new Uint8Array(64);
  combined.set(first, 0);
  combined.set(second, 32);

  let hash = await crypto.subtle.digest('SHA-512', combined);
  for (let i = 0; i < 5199; i++) {
    hash = await crypto.subtle.digest('SHA-512', hash);
  }

  const hex = Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return (BigInt('0x' + hex) % (10n ** 60n))
    .toString()
    .padStart(60, '0');
}
```

---

## Bảng Câu Hỏi GV Thường Hỏi

| Câu hỏi | Trả lời chính xác theo code |
|---|---|
| Upload key xảy ra ở đâu? | Trong `AuthContext.login()` — không phải register(). Vì POST /keys/upload cần JWT mà JWT chỉ có sau login. |
| Register có tạo JWT không? | Không. Server chỉ trả `{userId, message}`. Sau register phải đăng nhập thủ công. |
| Khi reload trang thì sao? | `isLocked=true` → UnlockModal hiện ra → user nhập password → PBKDF2 → unwrap key từ IndexedDB. Không gọi server. |
| 409 khi upload key có phải lỗi không? | Không. Login lần 2 server trả 409 (bundle đã tồn tại). Code bắt và bỏ qua. |
| Tại sao 4 phép DH trong X3DH? | DH1+DH2: mutual authentication. DH3+DH4: forward secrecy. 1 phép không đạt được cả 2. |
| Forward secrecy hoạt động thế nào? | `EK.privateKey.fill(0)` và `DH1-4.fill(0)` ngay sau X3DH. Dump RAM sau không tính lại được SK. |
| Tại sao IV random mỗi tin? | Cùng key + cùng IV → keystream giống nhau → XOR 2 ciphertext = XOR 2 plaintext. |
| AAD là gì, bỏ đi sao? | Authenticated metadata. Bỏ → attacker replay ciphertext từ conv A sang conv B thành công. |
| Tại sao bcrypt cost=12? | ~250ms/hash. Brute-force 1M password = 250.000 giây ≈ 3 ngày. |
| Timing attack protection? | DUMMY_HASH dù user không tồn tại → bcrypt.compare() vẫn tốn ~250ms → thời gian response như nhau. |
| Group chat mã hóa thế nào? | N tin 1-1 song song. Alice có SK riêng với từng member. Không dùng Sender Keys. |
| Group file upload mấy lần? | 1 lần. fileKey random → mã hóa file 1 lần → fileKey bọc trong payload từng người. Server lưu 1 bản. |
| PeerVerification global là gì? | Verify Bob 1 lần → bản ghi trong DB → hiệu lực ở mọi nhóm. Fingerprint không đổi theo context. |
| ADMIN_SEED_EMAIL hoạt động thế nào? | Email đặc biệt bypass whitelist, tự nhận ADMIN khi đăng ký. Chỉ có tác dụng 1 lần. |
| Vô hiệu hóa user có xóa tin không? | Không. Ciphertext vẫn còn. Receiver đã có SK → vẫn giải mã được tin cũ. |
| Race condition revoke-admin giải quyết thế nào? | `$transaction` + `SELECT FOR UPDATE` trong PostgreSQL. Request thứ 2 phải đợi thứ 1 commit. |
| Tại sao SPA navigate sang /admin? | Reload → wrappingKey mất khỏi RAM → về /chat cần UnlockModal. SPA giữ React state → wrappingKey còn. |
