# Thuật Toán Mã Hóa Đầu Cuối (E2EE)

---

## Tổng quan kiến trúc mã hóa

```
┌────────────────────────────────────────────────────────────────────┐
│                    Mô hình Blind Server                              │
│                                                                      │
│  Alice (Browser)         Server          Bob (Browser)              │
│  ────────────────         ──────         ───────────────            │
│  plaintext                                plaintext                 │
│      │                                        ▲                     │
│      ▼                                        │                     │
│  [AES-256-GCM]    ciphertext    [AES-256-GCM]                      │
│      │           ──────────►         │                              │
│      │            lưu + relay        │                              │
│      │                               │                              │
│  Session Key (SK)                Session Key (SK)                   │
│      ▲                               ▲                              │
│      │                               │                              │
│  [X3DH Protocol]  key bundle  [X3DH Protocol]                      │
│      └─────────── ─────────── ───────┘                              │
│                   (public key only)                                  │
│                                                                      │
│  Server chỉ thấy: ciphertext, IV, AAD — KHÔNG thấy plaintext       │
└────────────────────────────────────────────────────────────────────┘
```

Hệ thống dùng **3 tầng mã hóa** lồng nhau:

| Tầng | Thuật toán | Mục đích |
|---|---|---|
| 1 | **PBKDF2-SHA256** (600k vòng) | Bảo vệ private key khi lưu thiết bị |
| 2 | **X3DH** (4× X25519 DH + HKDF) | Trao đổi Session Key bất đồng bộ |
| 3 | **AES-256-GCM** | Mã hóa từng tin nhắn với SK |

---

## Phần 1: X3DH — Extended Triple Diffie-Hellman

### 1.1 Lý Thuyết

**X3DH** (hay Extended Triple Diffie-Hellman) là giao thức do Open Whisper Systems (Signal) thiết kế năm 2016. Mục tiêu: cho phép Alice gửi tin nhắn cho Bob **kể cả khi Bob offline**, và cả 2 tính ra **cùng 1 Session Key** mà **không cần gặp nhau trực tiếp**.

**Diffie-Hellman cơ bản (nhắc lại):**
```
Alice có: a (private), A = g^a (public)
Bob có:   b (private), B = g^b (public)

Alice tính: B^a = g^(b×a)
Bob tính:   A^b = g^(a×b)
→ Cùng ra g^(ab) — kẻ nhìn vào đường truyền chỉ thấy A, B nhưng không tính được g^(ab)
```

**Với X25519 (Elliptic Curve DH):**
```
X25519(private, public) = public^private trên đường cong Curve25519
Kết quả = 32 bytes shared secret
```

**Tại sao cần 4 phép DH, không phải 1?**

| DH | Vai trò | Loại bảo đảm |
|---|---|---|
| DH1 = X25519(IK_priv_A, SPK_pub_B) | Alice xác thực Bob | Mutual Authentication |
| DH2 = X25519(EK_priv, IK_pub_B) | Bob xác thực Alice | Mutual Authentication |
| DH3 = X25519(EK_priv, SPK_pub_B) | EK ephemeral + SPK | Forward Secrecy |
| DH4 = X25519(EK_priv, OPK_pub_B) | OPK dùng 1 lần | Forward Secrecy (OPK) |

- **Mutual Authentication (DH1 + DH2)**: chứng minh cả 2 bên đều có private key tương ứng. Kẻ giả danh không có IK_priv → không tính được DH đúng.
- **Forward Secrecy (DH3 + DH4)**: EK_priv bị xóa sau X3DH. Nếu SK bị lộ trong tương lai, kẻ tấn công vẫn không thể tính lại SK vì EK_priv không còn tồn tại.

**Tại sao OPK (One-Time PreKey)?**
OPK tạo thêm 1 tầng forward secrecy. Mỗi OPK chỉ dùng 1 lần rồi xóa. Nếu session key bị lộ, các session cũ dùng OPK khác vẫn an toàn.

---

### 1.2 Pseudo Code

```
FUNCTION X3DH_SETUP_ALICE(alice, bob_key_bundle):
  INPUT:
    alice = {
      IK_secret: Ed25519 private key (64B),
      IK_pub:    Ed25519 public key  (32B)
    }
    bob_key_bundle = {
      IK_pub_B:  Ed25519 public key  (32B),
      SPK_pub_B: X25519 public key   (32B),
      SPK_sig:   Ed25519 signature   (64B),
      OPK_pub_B: X25519 public key   (32B),
      OPK_id:    UUID
    }

  STEP 1: Verify SPK signature
    IF NOT Ed25519.verify(SPK_sig, SPK_pub_B, IK_pub_B):
      THROW "Possible MITM attack"
    // Đảm bảo SPK_pub_B thực sự được Bob ký, không phải server giả mạo

  STEP 2: Generate Ephemeral Key (dùng 1 lần)
    EK = X25519.generateKeypair()
    // EK.privateKey bị xóa sau bước 6, không bao giờ lưu lại

  STEP 3: Convert Ed25519 → X25519 (vì DH cần X25519)
    IK_priv_x = Ed25519ToX25519.private(alice.IK_secret)
    IK_pub_B_x = Ed25519ToX25519.public(bob_key_bundle.IK_pub_B)

  STEP 4: Compute 4 Diffie-Hellman operations
    DH1 = X25519(IK_priv_x,     SPK_pub_B)  // IK_A × SPK_B
    DH2 = X25519(EK.privateKey, IK_pub_B_x) // EK_A × IK_B
    DH3 = X25519(EK.privateKey, SPK_pub_B)  // EK_A × SPK_B
    DH4 = X25519(EK.privateKey, OPK_pub_B)  // EK_A × OPK_B
    // Mỗi DH = 32 bytes shared secret

  STEP 5: Derive Session Key via HKDF
    F   = 0xFF × 32 bytes     // domain separator (Signal spec)
    IKM = F || DH1 || DH2 || DH3 || DH4   // 32 + 128 = 160 bytes
    SK  = HKDF-SHA256(
            IKM  = IKM,
            salt = 0x00 × 32,
            info = "E2EEChat_v1"
          )
    // SK = 256-bit AES-GCM key

  STEP 6: Erase sensitive material (Forward Secrecy)
    ZERO_OUT(DH1, DH2, DH3, DH4)  // .fill(0)
    ZERO_OUT(IK_priv_x)            // X25519 variant chỉ dùng tạm
    ZERO_OUT(EK.privateKey)        // không bao giờ cần lại

  RETURN {
    SK:     256-bit AES-GCM key,
    EK_pub: EK.publicKey,    // gửi cho Bob — cần để tính DH2,3,4
    OPK_id: bob_key_bundle.OPK_id,  // gửi cho Bob — cần để tìm OPK_priv
    IK_pub: alice.IK_pub     // gửi cho Bob — cần để tính DH1
  }


FUNCTION X3DH_RECEIVE_BOB(bob, init_message):
  INPUT:
    bob = {
      IK_secret: Ed25519 private key (64B),
      SPK_priv:  X25519 private key  (32B),
      OPK_priv:  X25519 private key  (32B)   // load từ IndexedDB theo OPK_id
    }
    init_message = {
      IK_pub_A: Ed25519 public key of Alice (32B),
      EK_pub_A: X25519 public key           (32B),
      OPK_id:   UUID
    }

  STEP 1: Convert Ed25519 → X25519
    IK_priv_x   = Ed25519ToX25519.private(bob.IK_secret)
    IK_pub_A_x  = Ed25519ToX25519.public(init_message.IK_pub_A)

  STEP 2: Compute 4 DH — tất cả phép đối xứng với Alice
    DH1 = X25519(SPK_priv,  IK_pub_A_x)   // đối xứng DH1 Alice: IK_A × SPK_B
    DH2 = X25519(IK_priv_x, EK_pub_A)     // đối xứng DH2 Alice: EK_A × IK_B
    DH3 = X25519(SPK_priv,  EK_pub_A)     // đối xứng DH3 Alice: EK_A × SPK_B
    DH4 = X25519(OPK_priv,  EK_pub_A)     // đối xứng DH4 Alice: EK_A × OPK_B

  STEP 3: Derive Session Key (cùng công thức với Alice)
    IKM = F || DH1 || DH2 || DH3 || DH4
    SK  = HKDF-SHA256(IKM, salt=0×32, info="E2EEChat_v1")
    // SK = cùng giá trị với Alice ← DH property đảm bảo điều này

  STEP 4: Erase và cleanup
    ZERO_OUT(DH1, DH2, DH3, DH4, IK_priv_x, OPK_priv)
    DELETE_FROM_INDEXEDDB(OPK_id)  // OPK dùng 1 lần — không dùng lại

  RETURN { SK }
```

---

### 1.3 Thực Thi Trên Mã Nguồn

**File:** `x3dh.js`

```javascript
// ─── SENDER (Alice) ──────────────────────────────────────────────────────────
export async function performX3DH_sender(myKeys, bobBundle) {
  await sodium.ready;  // ← libsodium cần init async (load WASM)

  const { IK_secret, IK_pub } = myKeys;

  // Bước 1: parse base64 từ server → Uint8Array để dùng với libsodium
  const IK_pub_B  = fromBase64(bobBundle.ikPub);
  const SPK_pub_B = fromBase64(bobBundle.spkPub);
  const SPK_sig   = fromBase64(bobBundle.spkSig);
  const OPK_pub_B = fromBase64(bobBundle.opkPub);

  // Bước 2: verify SPK — quan trọng nhất, không được bỏ qua
  const valid = await verifySignedPreKey(IK_pub_B, SPK_sig, SPK_pub_B);
  if (!valid) throw new Error('SPK signature invalid — possible MITM attack');

  // Bước 3: sinh EK — X25519 keypair, chỉ dùng 1 lần trong X3DH này
  const EK = sodium.crypto_box_keypair();
  // EK.publicKey  = 32B — gửi cho Bob trong tin đầu tiên
  // EK.privateKey = 32B — dùng cho DH2, DH3, DH4 rồi XÓA NGAY

  // Bước 4: convert Ed25519 → X25519
  // IK của Alice và Bob là Ed25519 (để ký) nhưng X25519 DH cần X25519 key
  // libsodium cung cấp hàm convert bảo tồn tính chất toán học
  const IK_priv   = sodium.crypto_sign_ed25519_sk_to_curve25519(IK_secret);
  const IK_pub_B_x = sodium.crypto_sign_ed25519_pk_to_curve25519(IK_pub_B);

  // Bước 5: 4 phép DH — tất cả dùng crypto_scalarmult (X25519)
  const DH1 = sodium.crypto_scalarmult(IK_priv,        SPK_pub_B);
  const DH2 = sodium.crypto_scalarmult(EK.privateKey,  IK_pub_B_x);
  const DH3 = sodium.crypto_scalarmult(EK.privateKey,  SPK_pub_B);
  const DH4 = sodium.crypto_scalarmult(EK.privateKey,  OPK_pub_B);
  // Mỗi DH = 32B X25519 shared secret

  // Bước 6: build IKM
  const F   = new Uint8Array(32).fill(0xFF);
  const IKM = concat(F, DH1, DH2, DH3, DH4); // 160 bytes

  // Bước 7: HKDF → SK
  const SK = await hkdf(IKM);
  // SK = CryptoKey (AES-256-GCM, extractable: true)

  // Bước 8: FORWARD SECRECY — xóa tất cả giá trị tạm
  DH1.fill(0); DH2.fill(0); DH3.fill(0); DH4.fill(0);
  IK_priv.fill(0);       // X25519 variant tạm
  EK.privateKey.fill(0); // ephemeral key — KHÔNG BAO GIỜ cần lại

  return { SK, EK_pub: EK.publicKey, OPK_id: bobBundle.opkId, IK_pub };
}
```

---

## Phần 2: AES-256-GCM — Mã Hóa Tin Nhắn

### 2.1 Lý Thuyết

**AES-GCM** (Advanced Encryption Standard — Galois/Counter Mode) là thuật toán mã hóa đối xứng với **xác thực tích hợp** (AEAD — Authenticated Encryption with Associated Data).

```
AES-256-GCM cung cấp:
  1. Bí mật (Confidentiality): không ai đọc được nội dung mà không có SK
  2. Toàn vẹn (Integrity): auth tag bị sai nếu ciphertext bị sửa dù 1 bit
  3. Xác thực AAD: bất kỳ thay đổi ở metadata (convId, senderId) → tag sai
```

**Các tham số:**
- **Key**: 256-bit = 32 bytes — SK từ X3DH
- **IV (Initialization Vector)**: 96-bit = 12 bytes — **PHẢI random cho mỗi tin**
- **AAD (Additional Authenticated Data)**: `{convId}:{senderId}` — không mã hóa nhưng được xác thực
- **Auth Tag**: 128-bit = 16 bytes — AES-GCM tự thêm vào cuối ciphertext

**Tại sao IV phải random mỗi tin?**
```
Nếu dùng IV cố định (hoặc counter):
  c1 = plaintext1 XOR keystream(K, IV)
  c2 = plaintext2 XOR keystream(K, IV)
  c1 XOR c2 = plaintext1 XOR plaintext2
  → kẻ tấn công loại bỏ được key, so sánh trực tiếp 2 plaintext
  → hoàn toàn mất bảo mật

Với IV random 12B: xác suất trùng IV = 1/2^96 ≈ 0 trong thực tế
```

---

### 2.2 Pseudo Code

```
FUNCTION ENCRYPT_MESSAGE(plaintext, SK, conversationId, senderId):
  INPUT:
    plaintext:      string — tin nhắn chưa mã hóa
    SK:             CryptoKey — AES-256-GCM session key
    conversationId: UUID string
    senderId:       UUID string

  STEP 1: Generate random IV
    iv = RANDOM_BYTES(12)   // 96-bit

  STEP 2: Build AAD (Associated Authenticated Data)
    aad = conversationId + ":" + senderId
    // ví dụ: "550e8400-e29b-41d4-a716-446655440000:alice-uuid"

  STEP 3: Encrypt
    ciphertext_with_tag = AES_256_GCM_ENCRYPT(
      plaintext = UTF8_ENCODE(plaintext),
      key       = SK,
      iv        = iv,
      aad       = UTF8_ENCODE(aad)
    )
    // Kết quả: ciphertext (len(plaintext) bytes) + auth_tag (16 bytes)
    // Tổng = len(plaintext) + 16 bytes

  STEP 4: Encode for transport
    RETURN {
      ciphertext: BASE64(ciphertext_with_tag),
      iv:         BASE64(iv),
      aad:        aad   // plaintext — server cần verify, không cần bí mật
    }


FUNCTION DECRYPT_MESSAGE(ciphertextB64, ivB64, aad, SK):
  INPUT:
    ciphertextB64: base64 string
    ivB64:         base64 string
    aad:           string
    SK:            CryptoKey

  STEP 1: Decode
    ciphertext = BASE64_DECODE(ciphertextB64)
    iv         = BASE64_DECODE(ivB64)

  STEP 2: Decrypt + Verify
    TRY:
      plaintext_bytes = AES_256_GCM_DECRYPT(
        ciphertext = ciphertext,
        key        = SK,
        iv         = iv,
        aad        = UTF8_ENCODE(aad)
      )
      // Nếu auth tag không khớp → THROW DOMException
      RETURN UTF8_DECODE(plaintext_bytes)
    CATCH DOMException:
      RETURN null  // Hiển thị "[Không thể giải mã]" thay vì crash
```

---

### 2.3 Thực Thi Trên Mã Nguồn

**File:** `aesGcm.js`

```javascript
export async function encryptMessage(plaintext, SK, conversationId, senderId) {
  // IV phải random MỖI TIN — không dùng counter, không tái sử dụng
  const iv  = crypto.getRandomValues(new Uint8Array(12)); // 96-bit

  // AAD: authenticated metadata — server đọc được nhưng không sửa được
  // Nếu server đổi aad → auth tag sai → decrypt fail
  const aad = `${conversationId}:${senderId}`;

  const ciphertext = await crypto.subtle.encrypt(
    {
      name:           'AES-GCM',
      iv,                                             // 12B random IV
      additionalData: new TextEncoder().encode(aad),  // AAD
    },
    SK,                                               // CryptoKey từ X3DH
    new TextEncoder().encode(plaintext)               // plaintext → UTF-8 bytes
  );
  // crypto.subtle.encrypt trả ArrayBuffer: ciphertext + auth_tag (16B tự thêm)

  return {
    ciphertext: toBase64(ciphertext), // base64 để gửi qua JSON/WebSocket
    iv:         toBase64(iv),
    aad,  // gửi plaintext — Bob cần để verify, server không thể sửa (auth tag bảo vệ)
  };
}

export async function decryptMessage(ciphertextB64, ivB64, aad, SK) {
  try {
    const decrypted = await crypto.subtle.decrypt(
      {
        name:           'AES-GCM',
        iv:             fromBase64(ivB64),
        additionalData: new TextEncoder().encode(aad),
      },
      SK,
      fromBase64(ciphertextB64)  // bao gồm cả auth_tag ở cuối
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    // DOMException khi:
    //   - SK sai (khác session)
    //   - IV sai (tin bị replay)
    //   - AAD bị sửa (convId hoặc senderId bị thay đổi)
    //   - ciphertext bị tamper (auth tag không khớp)
    return null; // UI xử lý: hiển thị "[Không thể giải mã]"
  }
}
```

---

## Phần 3: PBKDF2 — Bảo Vệ Private Key

### 3.1 Lý Thuyết

**PBKDF2** (Password-Based Key Derivation Function 2) chuyển đổi password (thường ngắn, có entropy thấp) thành cryptographic key (256-bit, entropy cao) bằng cách lặp đi lặp lại nhiều vòng hash.

**Vấn đề không dùng PBKDF2:**
```
Password "abc123" = entropy ~26 bits
AES-256 key cần  = 256 bits entropy

Nếu dùng SHA256("abc123") = key:
  Kẻ tấn công brute-force 1M password/giây → crack trong vài giây
  Với GPU: hàng tỷ SHA256/giây → crack trong mili-giây
```

**Giải pháp PBKDF2:**
```
wrappingKey = PBKDF2(
  password   = "abc123",
  salt       = random 16 bytes,  ← ngăn rainbow table
  iterations = 600.000,          ← mỗi guess tốn ~1 giây
  hash       = SHA-256,
  keyLen     = 256 bits
)

Với 600k iterations: GPU mạnh nhất = ~1000 guess/giây
  Brute-force 8 ký tự lowercase = 26^8 ≈ 200 tỷ khả năng
  200 tỷ / 1000 = 200 triệu giây ≈ 6 năm
```

**Tại sao cần salt?**
Nếu không có salt: tất cả người dùng cùng password có cùng wrappingKey. Kẻ tấn công tính sẵn bảng (rainbow table) cho các password phổ biến → lookup O(1). Salt random đảm bảo mỗi người có wrappingKey khác nhau dù cùng password.

---

### 3.2 Pseudo Code

```
FUNCTION DERIVE_WRAPPING_KEY(password, salt):
  INPUT:
    password: string — mật khẩu người dùng nhập
    salt:     Uint8Array(16) — random bytes, lưu cùng IndexedDB record

  STEP 1: Import password as raw key material
    keyMaterial = IMPORT_KEY(
      format   = 'raw',
      keyData  = UTF8_ENCODE(password),
      algorithm = 'PBKDF2',
      usage    = ['deriveKey']
    )
    // Bước này chỉ "đưa password vào hệ thống Web Crypto"
    // Không có computation ở đây

  STEP 2: Derive AES-256-GCM key via PBKDF2
    wrappingKey = DERIVE_KEY(
      algorithm = PBKDF2 {
        hash:       SHA-256,
        salt:       salt,
        iterations: 600_000
      },
      baseKey    = keyMaterial,
      derivedKey = AES-GCM { length: 256 },
      extractable = false,        // không thể export wrappingKey ra ngoài
      usages     = ['encrypt', 'decrypt']
    )
    // 600k vòng SHA-256 xảy ra ở đây → ~1 giây
    RETURN wrappingKey


FUNCTION WRAP_PRIVATE_KEY(privKey, wrappingKey):
  INPUT:
    privKey:     Uint8Array — private key cần bảo vệ
    wrappingKey: CryptoKey — AES-256-GCM từ deriveWrappingKey

  iv = RANDOM_BYTES(12)    // IV riêng cho key này
  wrapped = AES_256_GCM_ENCRYPT(privKey, wrappingKey, iv)
  RETURN { wrapped: BASE64(wrapped), iv: BASE64(iv) }
  // Lưu { wrapSalt, wrappedIK, ivIK, wrappedSPK, ivSPK, wrappedOPKs[] }
  // vào IndexedDB

FUNCTION UNWRAP_PRIVATE_KEY(wrappedB64, ivB64, wrappingKey):
  TRY:
    privKey_bytes = AES_256_GCM_DECRYPT(
      BASE64_DECODE(wrappedB64), wrappingKey, BASE64_DECODE(ivB64)
    )
    RETURN privKey_bytes
  CATCH DOMException:
    THROW "Sai mật khẩu — không thể mở khóa private key"
    // DOMException xảy ra khi wrappingKey sai (password sai)
```

---

### 3.3 Thực Thi Trên Mã Nguồn

**File:** `keyGen.js`

```javascript
export async function deriveWrappingKey(password, salt) {
  // Bước 1: đưa password vào Web Crypto — PBKDF2 cần CryptoKey, không nhận string thô
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),  // password → UTF-8 bytes
    'PBKDF2',           // thuật toán sẽ dùng keyMaterial này
    false,              // extractable: false — không thể export keyMaterial
    ['deriveKey']       // usage: chỉ để derive key khác
  );

  // Bước 2: 600k vòng PBKDF2 → AES-256-GCM key
  return crypto.subtle.deriveKey(
    {
      name:       'PBKDF2',
      salt,               // Uint8Array(16) — random, lưu IndexedDB
      iterations: 600_000, // NIST SP 800-132 recommendation (2023)
      hash:       'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,          // extractable: false — wrappingKey không thể export
    ['encrypt', 'decrypt']
  );
  // Hàm này chạy ~1 giây — chỉ gọi 1 lần khi register/login
  // Không gọi lại mỗi khi wrap/unwrap key (đã có wrappingKey rồi)
}
```

---

## Phần 4: Fingerprint Verification — Chống MITM

### 4.1 Lý Thuyết

**Man-in-the-Middle (MITM):** Server có thể thay thế `IK_pub_B` (public key của Bob) bằng key của mình khi Alice fetch. Alice sẽ thực hiện X3DH với server thay vì Bob → server đọc được mọi tin nhắn.

**Fingerprint verification** giải quyết bằng cách cho phép 2 người **xác minh key ngoài băng tần** (out-of-band) — qua điện thoại, gặp trực tiếp — kênh mà server không can thiệp được.

### 4.2 Pseudo Code

```
FUNCTION GENERATE_FINGERPRINT(IK_pub_A, IK_pub_B):
  INPUT: 2 Uint8Array(32) — thứ tự tùy ý

  STEP 1: Canonical sort
    IF LEXICOGRAPHIC_COMPARE(IK_pub_A, IK_pub_B) <= 0:
      [first, second] = [IK_pub_A, IK_pub_B]
    ELSE:
      [first, second] = [IK_pub_B, IK_pub_A]
    // Alice gọi (A, B), Bob gọi (B, A) → cùng [first, second]

  STEP 2: Concatenate
    combined = CONCAT(first, second)   // 64 bytes

  STEP 3: Iterative SHA-512 (5200 vòng)
    hash = SHA_512(combined)
    FOR i FROM 1 TO 5199:
      hash = SHA_512(hash)
    // hash = 64 bytes SHA-512 output

  STEP 4: Convert to decimal string
    hex    = HEX_ENCODE(hash)                // 128 ký tự hex
    bignum = HEX_TO_BIGINT(hex)             // số nguyên lớn
    digits = (bignum MOD 10^60).toString()  // lấy 60 chữ số
    digits = digits.padStart(60, '0')       // đảm bảo đủ 60 chữ số

  RETURN digits   // "123456789012345678901234567890123456789012345678901234567890"
```

### 4.3 Thực Thi Trên Mã Nguồn

**File:** `fingerprint.js`

```javascript
function lexCompare(a, b) {
  // So sánh lexicographic giữa 2 Uint8Array
  // Trả < 0 nếu a < b, > 0 nếu a > b, = 0 nếu bằng
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

export async function generateFingerprint(IK_pub_A, IK_pub_B) {
  // Bước 1: sort canonical → Alice và Bob luôn ra cùng kết quả
  const [first, second] = lexCompare(IK_pub_A, IK_pub_B) <= 0
    ? [IK_pub_A, IK_pub_B]
    : [IK_pub_B, IK_pub_A];

  // Bước 2: ghép 64 bytes
  const combined = new Uint8Array(first.length + second.length);
  combined.set(first, 0);
  combined.set(second, first.length);

  // Bước 3: SHA-512 × 5200 vòng
  // Tại sao 5200? Signal dùng số này — đủ để brute-force không khả thi
  // mà vẫn chạy xong trong ~300ms trên máy hiện đại
  let hash = await crypto.subtle.digest('SHA-512', combined);
  for (let i = 0; i < 5199; i++) {
    hash = await crypto.subtle.digest('SHA-512', hash);
  }

  // Bước 4: hex → BigInt → 60 chữ số decimal
  const hex = Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  // hex = 128 ký tự hex string

  const digits = (BigInt('0x' + hex) % (10n ** 60n))
    .toString()
    .padStart(60, '0');
  // 10n, 60n: BigInt literals — cần BigInt vì số quá lớn cho Number
  // padStart: đảm bảo luôn đủ 60 chữ số (có thể leading zeros)

  return digits;
}
```

---

## Tóm Tắt So Sánh & Câu Trả Lời GV

| Câu hỏi | Trả lời |
|---|---|
| Tại sao dùng Ed25519 cho IK? | IK cần ký SPK → phải là thuật toán chữ ký. X25519 chỉ là DH, không ký được. |
| Tại sao IK_secret 64B thay vì 32B? | libsodium format Ed25519: 64B = seed(32B) + public(32B). IK_pub = IK_secret.slice(32). |
| Tại sao convert Ed25519 → X25519? | DH cần X25519. 2 thuật toán dùng cùng toán học (Curve25519) nhưng khác biểu diễn. |
| Tại sao 4 phép DH? | 2 phép cho mutual auth, 2 phép cho forward secrecy. 1 phép không đạt cả 2 mục tiêu. |
| Forward secrecy hoạt động thế nào? | EK_priv và DH outputs bị xóa (.fill(0)) ngay sau X3DH. Không ai dump memory sau này tính lại được SK. |
| Tại sao salt PBKDF2? | Ngăn rainbow table. Không có salt → cùng password = cùng wrappingKey → bảng tra cứu pre-computed. |
| Tại sao IV AES-GCM random mỗi tin? | Nếu IV trùng với cùng key: kẻ tấn công XOR 2 ciphertext → loại bỏ keystream. |
| AAD là gì, bỏ đi sao? | Metadata được xác thực nhưng không mã hóa. Bỏ → replay attack: ciphertext từ conv A có thể gửi vào conv B. |
| Fingerprint 5200 vòng để làm gì? | Mỗi guess key giả = 5200 SHA-512. 1M guess = 5.2 tỷ hash ≈ không khả thi. |
| Hệ thống này có Double Ratchet không? | Không — đây là session-level forward secrecy. SK cố định cho 1 session. Signal thêm Double Ratchet để có per-message forward secrecy. Đưa vào hướng phát triển tương lai. |
