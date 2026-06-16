import { createContext, useContext, useState } from 'react';
import sodium from 'libsodium-wrappers';
import {
  generateIdentityKey,
  generateSignedPreKey,
  generateOneTimePreKeys,
  deriveWrappingKey,
  toBase64,
} from '../crypto/keyGen.js';
import * as storage from '../db/storage.js';
import * as api from '../services/api.js';

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // ── localStorage state (còn sau reload) ─────────────────────────────────────
  const [token,    setToken]    = useState(() => localStorage.getItem('token'));
  const [userId,   setUserId]   = useState(() => localStorage.getItem('userId'));
  const [username, setUsername] = useState(() => localStorage.getItem('username'));
  const [role,     setRole]     = useState(() => localStorage.getItem('role') ?? 'USER');

  // ── RAM state (mất khi reload — đúng với thiết kế E2EE) ─────────────────────
  const [wrappingKey, setWrappingKey] = useState(null);
  const [IK_secret,   setIKSecret]    = useState(null);
  const [IK_pub,      setIKPub]       = useState(null);
  const [SPK_priv,    setSPKPriv]     = useState(null);

  // ── Derived state ────────────────────────────────────────────────────────────
  const isAuthenticated = token !== null;
  // isLocked = true sau reload: localStorage có token nhưng wrappingKey mất khỏi RAM
  // → ProtectedRoute hiện UnlockModal thay vì Chat
  const isLocked = isAuthenticated && wrappingKey === null;

  // ── register ─────────────────────────────────────────────────────────────────
  // Chỉ làm 2 việc: tạo tài khoản trên server + sinh/lưu key cục bộ
  // KHÔNG login, KHÔNG upload key — upload key là việc của login()
  async function register(usernameInput, password, email) {
    await sodium.ready;

    // 1. Sinh keys cục bộ — chưa cần mạng
    const { IK_pub, IK_secret } = await generateIdentityKey();
    const { SPK_priv }          = await generateSignedPreKey(IK_secret);
    const opkList               = await generateOneTimePreKeys(100);

    // 2. Derive wrappingKey — PBKDF2 600k iterations, chạy 1 lần duy nhất
    const wrapSalt    = crypto.getRandomValues(new Uint8Array(16));
    const wKey        = await deriveWrappingKey(password, wrapSalt);

    // 3. Tạo tài khoản trên server → lấy userId làm primary key cho IndexedDB
    const { userId } = await api.register(usernameInput, password, email);

    // 4. Wrap và lưu private keys vào IndexedDB — storage.savePrivateKeys tự wrap
    await storage.savePrivateKeys(userId, wrapSalt, wKey, IK_secret, SPK_priv, opkList);

    // caller (Register.jsx) tự navigate('/login') sau khi hàm này resolve
  }

  // ── login ────────────────────────────────────────────────────────────────────
  // Xác thực server + unwrap key từ IndexedDB + upload public key lên server
  async function login(usernameInput, password) {
    await sodium.ready;

    // 1. Xác thực với server → nhận JWT
    const { token: t, userId: uid, username: uname, role: r } = await api.login(usernameInput, password);

    // 2. Kiểm tra thiết bị có key không
    // false = user đổi máy hoặc xóa browser data → không thể decrypt
    const hasKeys = await storage.hasPrivateKeys(uid);
    if (!hasKeys) throw new Error('DEVICE_NOT_REGISTERED');

    // 3. Lấy wrapSalt từ IndexedDB → derive wrappingKey
    // wrapSalt phải đọc TRƯỚC khi có wrappingKey (gà-trứng được giải bằng getWrapSalt)
    const wrapSalt = await storage.getWrapSalt(uid);
    const wKey     = await deriveWrappingKey(password, wrapSalt);

    // 4. Unwrap tất cả private keys — password sai → AES-GCM throw → bắt lên
    const keys = await storage.loadPrivateKeys(uid, wKey);

    // 5. Upload public keys lên server (idempotent — 409 nếu đã upload rồi)
    // Derive lại public keys từ private keys — deterministic nên ra cùng giá trị
    const SPK_pub = sodium.crypto_scalarmult_base(keys.SPK_priv);
    const spkSig  = sodium.crypto_sign_detached(SPK_pub, keys.IK_secret);
    const opkPubs = [...keys.opkMap.entries()].map(([id, priv]) => ({
      id,
      pub: toBase64(sodium.crypto_scalarmult_base(priv)),
    }));

    try {
      await api.uploadKeys(t, {
        ikPub:  toBase64(keys.IK_pub),
        spkPub: toBase64(SPK_pub),
        spkSig: toBase64(spkSig),
        opkPubs,
      });
    } catch (err) {
      // 409 = bundle đã tồn tại từ lần login trước → bỏ qua, không phải lỗi
      if (!err.message.startsWith('Key bundle đã tồn tại')) throw err;
    }

    // 6. Lưu auth info vào localStorage — còn sau reload
    localStorage.setItem('token',    t);
    localStorage.setItem('userId',   uid);
    localStorage.setItem('username', uname);
    localStorage.setItem('role',     r ?? 'USER');
    setToken(t);
    setUserId(uid);
    setUsername(uname);
    setRole(r ?? 'USER');

    // 7. Đưa keys vào RAM — mất khi reload (đúng với thiết kế)
    setWrappingKey(wKey);
    setIKSecret(keys.IK_secret);
    setIKPub(keys.IK_pub);
    setSPKPriv(keys.SPK_priv);
  }

  // ── unlock (sau reload) ──────────────────────────────────────────────────────
  // KHÔNG gọi server — chỉ unwrap key từ IndexedDB bằng password
  async function unlock(password) {
    // 1. Lấy wrapSalt — nếu null = thiết bị này chưa có key
    const wrapSalt = await storage.getWrapSalt(userId);
    if (!wrapSalt) throw new Error('DEVICE_NOT_REGISTERED');

    // 2. Derive wrappingKey — PBKDF2, ~0.5s, chạy cục bộ
    const wKey = await deriveWrappingKey(password, wrapSalt);

    // 3. Unwrap — password sai → throw 'Sai mật khẩu — không thể mở khóa private key'
    const keys = await storage.loadPrivateKeys(userId, wKey);
    if (!keys) throw new Error('DEVICE_NOT_REGISTERED');

    // 4. Set RAM state → isLocked tự chuyển false → ProtectedRoute re-render → Chat hiện
    setWrappingKey(wKey);
    setIKSecret(keys.IK_secret);
    setIKPub(keys.IK_pub);
    setSPKPriv(keys.SPK_priv);
  }

  // ── logout ───────────────────────────────────────────────────────────────────
  async function logout() {
    // 1. Revoke token trên server — network fail cũng không chặn logout
    try { await api.logout(token); } catch { /* ignore */ }

    // 2. Xóa localStorage
    localStorage.removeItem('token');
    localStorage.removeItem('userId');
    localStorage.removeItem('username');
    localStorage.removeItem('role');

    // 3. Clear toàn bộ state — wrappingKey và key material xóa khỏi RAM
    // KHÔNG xóa IndexedDB — wrapped keys vẫn còn, login lại vẫn dùng được
    setToken(null);
    setUserId(null);
    setUsername(null);
    setRole('USER');
    setWrappingKey(null);
    setIKSecret(null);
    setIKPub(null);
    setSPKPriv(null);
  }

  const value = {
    // identity
    token, userId, username, role,
    // crypto material (RAM only)
    wrappingKey, IK_secret, IK_pub, SPK_priv,
    // derived
    isAuthenticated, isLocked,
    // actions
    register, login, unlock, logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Hook tiện ích — dùng thay vì useContext(AuthContext) trực tiếp
// Guard chống dùng ngoài AuthProvider
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth phải dùng trong AuthProvider');
  return ctx;
}
