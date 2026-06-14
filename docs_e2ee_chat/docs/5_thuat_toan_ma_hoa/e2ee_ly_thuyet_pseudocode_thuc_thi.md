# Thuật Toán Mã Hóa Đầu Cuối (E2EE)
> Viết theo đúng code thực tế: x3dh.js, keyGen.js, aesGcm.js, fingerprint.js

---

## 3 Tầng Mã Hóa

```
Tầng 1 — PBKDF2-SHA256 (600k vòng)
  Bảo vệ private key khi lưu IndexedDB
  password → wrappingKey (AES-256-GCM)

Tầng 2 — X3DH (4× X25519 DH + HKDF-SHA256)
  Trao đổi Session Key bất đồng bộ (Alice → Bob kể cả khi Bob offline)
  Kết quả: SK (AES-256-GCM key), cả 2 bên tính ra cùng SK

Tầng 3 — AES-256-GCM
  Mã hóa từng tin nhắn bằng SK
  IV random mỗi tin, AAD chống replay attack
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
  // Bước 1: đưa password vào Web Crypto — PBKDF2 cần CryptoKey, không nhận string thô
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,        // không export được
    ['deriveKey']
  );

  // Bước 2: 600k vòng SHA-256 → AES-256-GCM key
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,               // Uint8Array(16) — random, lưu IndexedDB
      iterations: 600_000, // OWASP 2023 minimum
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,         // wrappingKey không export được — chỉ dùng trong browser
    ['encrypt', 'decrypt']
  );
}

export async function wrapPrivateKey(privKey, wrappingKey) {
  // IV riêng cho mỗi key — cùng wrappingKey nhưng ciphertext khác nhau
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    wrappingKey,
    privKey  // Uint8Array
  );
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

### Pseudo code

```
X3DH_SENDER(alice, bob_bundle):
  // Bước 1: verify SPK — chống MITM
  IF NOT Ed25519.verify(bob_bundle.spkSig, bob_bundle.spkPub, bob_bundle.ikPub):
    THROW "MITM detected"

  // Bước 2: convert Ed25519 → X25519
  IK_priv_A_x  = Ed25519ToX25519.private(alice.IK_secret)
  IK_pub_B_x   = Ed25519ToX25519.public(bob_bundle.ikPub)

  // Bước 3: Ephemeral Key — 1 lần dùng
  EK = X25519.generateKeypair()

  // Bước 4: 4 phép DH
  DH1 = X25519(IK_priv_A_x,   bob_bundle.spkPub)
  DH2 = X25519(EK.privateKey, IK_pub_B_x)
  DH3 = X25519(EK.privateKey, bob_bundle.spkPub)
  DH4 = X25519(EK.privateKey, bob_bundle.opkPub)

  // Bước 5: IKM + HKDF
  F   = 0xFF × 32 bytes  // Signal spec prefix
  IKM = F || DH1 || DH2 || DH3 || DH4  // 160 bytes
  SK  = HKDF-SHA256(IKM, salt=0x00×32, info="E2EEChat_v1")

  // Bước 6: xóa ngay (Forward Secrecy)
  ZERO(DH1, DH2, DH3, DH4, IK_priv_A_x, EK.privateKey)

  RETURN { SK, EK_pub, OPK_id, IK_pub_A }


X3DH_RECEIVER(bob, init_msg):
  IK_priv_B_x = Ed25519ToX25519.private(bob.IK_secret)
  IK_pub_A_x  = Ed25519ToX25519.public(init_msg.ikPub)

  // 4 phép DH ngược — ra cùng giá trị với sender
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
// ── hkdf() — dùng nội bộ ─────────────────────────────────────────
async function hkdf(ikm) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', ikm, 'HKDF', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),                       // 0x00 × 32 — Signal spec
      info: new TextEncoder().encode('E2EEChat_v1'),  // domain separation
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,               // extractable: true — cần export để lưu IndexedDB
    ['encrypt', 'decrypt']
  );
}

// ── sender ────────────────────────────────────────────────────────
export async function performX3DH_sender(myKeys, bobBundle) {
  await sodium.ready;

  const { IK_secret, IK_pub } = myKeys;

  // Parse base64 → Uint8Array
  const IK_pub_B  = fromBase64(bobBundle.ikPub);
  const SPK_pub_B = fromBase64(bobBundle.spkPub);
  const SPK_sig   = fromBase64(bobBundle.spkSig);
  const OPK_pub_B = fromBase64(bobBundle.opkPub);

  // Verify SPK — bắt buộc, không được bỏ qua
  const valid = await verifySignedPreKey(IK_pub_B, SPK_sig, SPK_pub_B);
  if (!valid) throw new Error('SPK signature invalid — possible MITM attack');

  // Ephemeral Key — X25519, 1 lần
  const EK = sodium.crypto_box_keypair();

  // Convert Ed25519 → X25519
  const IK_priv   = sodium.crypto_sign_ed25519_sk_to_curve25519(IK_secret);
  const IK_pub_B_x = sodium.crypto_sign_ed25519_pk_to_curve25519(IK_pub_B);

  // 4 phép DH
  const DH1 = sodium.crypto_scalarmult(IK_priv,        SPK_pub_B);
  const DH2 = sodium.crypto_scalarmult(EK.privateKey,  IK_pub_B_x);
  const DH3 = sodium.crypto_scalarmult(EK.privateKey,  SPK_pub_B);
  const DH4 = sodium.crypto_scalarmult(EK.privateKey,  OPK_pub_B);

  const F   = new Uint8Array(32).fill(0xFF);
  const IKM = concat(F, DH1, DH2, DH3, DH4);  // 32+32+32+32+32 = 160 bytes

  const SK = await hkdf(IKM);

  // Forward Secrecy — xóa ngay sau khi tính xong
  DH1.fill(0); DH2.fill(0); DH3.fill(0); DH4.fill(0);
  IK_priv.fill(0);        // X25519 variant tạm
  EK.privateKey.fill(0);  // ephemeral — không bao giờ cần lại

  return { SK, EK_pub: EK.publicKey, OPK_id: bobBundle.opkId, IK_pub };
}

// ── receiver ──────────────────────────────────────────────────────
export async function performX3DH_receiver(myKeys, initMsg) {
  await sodium.ready;

  const { IK_secret, SPK_priv, OPK_priv } = myKeys;
  // OPK_priv: caller đã getOPK(userId, opkId, wrappingKey) trước khi gọi

  const IK_pub_A  = fromBase64(initMsg.ikPub);
  const EK_pub_A  = fromBase64(initMsg.ekPub);

  const IK_priv   = sodium.crypto_sign_ed25519_sk_to_curve25519(IK_secret);
  const IK_pub_A_x = sodium.crypto_sign_ed25519_pk_to_curve25519(IK_pub_A);

  // 4 phép DH ngược — đối xứng với sender
  const DH1 = sodium.crypto_scalarmult(SPK_priv,  IK_pub_A_x);
  const DH2 = sodium.crypto_scalarmult(IK_priv,   EK_pub_A);
  const DH3 = sodium.crypto_scalarmult(SPK_priv,  EK_pub_A);
  const DH4 = sodium.crypto_scalarmult(OPK_priv,  EK_pub_A);

  const F   = new Uint8Array(32).fill(0xFF);
  const IKM = concat(F, DH1, DH2, DH3, DH4);
  const SK  = await hkdf(IKM);  // Cùng SK với Alice ← X25519 property

  DH1.fill(0); DH2.fill(0); DH3.fill(0); DH4.fill(0);
  IK_priv.fill(0);
  OPK_priv.fill(0);  // OPK dùng 1 lần — xóa luôn
  // Caller sẽ gọi storage.deleteOPK(userId, opkId) ngay sau đây

  return { SK };
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
AAD = `"{convId}:{senderId}"` — không mã hóa nhưng được xác thực.  
Không có AAD: attacker lấy ciphertext từ conv A, replay vào conv B → Bob giải mã thành công.  
Với AAD: auth tag tính theo convId → sai conv → tag sai → null.

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
  const iv  = crypto.getRandomValues(new Uint8Array(12)); // phải random mỗi tin
  const aad = `${conversationId}:${senderId}`;

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: new TextEncoder().encode(aad),
    },
    SK,
    new TextEncoder().encode(plaintext)
  );
  // output: ciphertext_bytes + auth_tag(16B) — Web Crypto tự ghép

  return {
    ciphertext: toBase64(ciphertext),
    iv:         toBase64(iv),
    aad,        // gửi plaintext — server cần lưu để Bob verify
  };
}

export async function decryptMessage(ciphertextB64, ivB64, aad, SK) {
  try {
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv:             fromBase64(ivB64),
        additionalData: new TextEncoder().encode(aad),
      },
      SK,
      fromBase64(ciphertextB64)  // bao gồm auth_tag ở cuối
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;  // UI hiển thị "[Không thể giải mã]"
  }
}
```

---

## Phần 4: Fingerprint — Chống MITM

### Lý thuyết

**MITM:** Server thay `IK_pub_B` bằng key của mình khi Alice `GET /keys/bob`. Alice thực hiện X3DH với server thay vì Bob → server đọc mọi tin.

**Giải pháp:** Fingerprint verification qua kênh ngoài (OOB — Out Of Band): điện thoại, gặp trực tiếp. Kênh mà server không can thiệp được.

**SHA-512 × 5200 vòng:** Mỗi guess key giả = 5200 lần SHA-512. GPU mạnh nhất = ~10^9 SHA-512/giây → 1 guess = 5.2μs. Thử 10^12 key giả = 5.2 × 10^6 giây ≈ 60 ngày. Không khả thi.

### Pseudo code

```
GENERATE_FINGERPRINT(IK_pub_A, IK_pub_B):
  // Sort canonical — cả 2 bên ra cùng kết quả
  [first, second] = LEX_SORT(IK_pub_A, IK_pub_B)

  combined = CONCAT(first, second)  // 64 bytes

  // 5200 vòng SHA-512
  hash = SHA-512(combined)
  FOR i = 1 TO 5199:
    hash = SHA-512(hash)

  // Chuyển sang 60 chữ số decimal
  digits = (BIGINT(HEX(hash)) MOD 10^60).padStart(60, '0')
  RETURN digits
```

### Thực thi — `crypto/fingerprint.js`

```javascript
function lexCompare(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

export async function generateFingerprint(IK_pub_A, IK_pub_B) {
  // Sort canonical — Alice gọi (A,B), Bob gọi (B,A) → cùng [first, second]
  const [first, second] = lexCompare(IK_pub_A, IK_pub_B) <= 0
    ? [IK_pub_A, IK_pub_B]
    : [IK_pub_B, IK_pub_A];

  // Ghép 64 bytes
  const combined = new Uint8Array(64);
  combined.set(first, 0);
  combined.set(second, 32);

  // SHA-512 × 5200 vòng
  let hash = await crypto.subtle.digest('SHA-512', combined);
  for (let i = 0; i < 5199; i++) {
    hash = await crypto.subtle.digest('SHA-512', hash);
  }

  // BigInt → 60 chữ số decimal
  const hex = Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return (BigInt('0x' + hex) % (10n ** 60n))
    .toString()
    .padStart(60, '0');
  // 10n, 60n: BigInt literals — cần vì số vượt quá Number.MAX_SAFE_INTEGER
}
```

---

## Bảng Câu Hỏi GV Thường Hỏi

| Câu hỏi | Trả lời chính xác theo code |
|---|---|
| Upload key xảy ra ở đâu? | Trong `AuthContext.login()` — không phải register(). Vì POST /keys/upload cần JWT mà JWT chỉ có sau login. |
| Register có tạo JWT không? | Không. Server chỉ trả `{userId, message}`. Sau register phải đăng nhập thủ công. |
| Khi reload trang thì sao? | `isLocked=true` → UnlockModal hiện ra → user nhập password → PBKDF2 → unwrap key từ IndexedDB. Không gọi server. |
| 409 khi upload key có phải lỗi không? | Không. Login lần 2 trở đi server trả 409 (bundle đã tồn tại). Code bắt và bỏ qua: `if (!err.message.startsWith('Key bundle đã tồn tại')) throw err`. |
| Tại sao 4 phép DH trong X3DH? | DH1+DH2: mutual authentication. DH3+DH4: forward secrecy. 1 phép không đạt được cả 2. |
| Forward secrecy hoạt động thế nào? | `EK.privateKey.fill(0)` và `DH1-4.fill(0)` ngay sau X3DH. Dump RAM sau không tính lại được SK. |
| Tại sao IV random mỗi tin? | Cùng key + cùng IV → keystream giống nhau → XOR 2 ciphertext = XOR 2 plaintext. |
| AAD là gì, bỏ đi sao? | Authenticated metadata `{convId}:{senderId}`. Bỏ → attacker replay ciphertext từ conv A sang conv B thành công. |
| Tại sao bcrypt cost=12? | ~250ms/hash. Brute-force 1M password = 250.000 giây ≈ 3 ngày. |
| Timing attack protection? | Dùng `DUMMY_HASH` dù user không tồn tại → `bcrypt.compare()` vẫn tốn ~250ms → thời gian response như nhau. |
