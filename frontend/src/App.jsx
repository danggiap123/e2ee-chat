import { useEffect, useState } from 'react';
import {
  generateIdentityKey, generateSignedPreKey, generateOneTimePreKeys,
  deriveWrappingKey, wrapPrivateKey, unwrapPrivateKey, toBase64,
} from './crypto/keyGen.js';
import { verifySignedPreKey, performX3DH_sender, performX3DH_receiver } from './crypto/x3dh.js';
import { encryptMessage, decryptMessage } from './crypto/aesGcm.js';
import { generateFingerprint } from './crypto/fingerprint.js';

// Hiển thị 1 dòng kết quả: tên test + pass/fail + chi tiết
function Row({ name, status, detail }) {
  const color = status === 'PASS' ? 'text-green-600' : status === 'FAIL' ? 'text-red-600' : 'text-yellow-500';
  return (
    <div className="flex gap-3 py-1 border-b border-gray-100 text-sm font-mono">
      <span className={`font-bold w-12 shrink-0 ${color}`}>{status}</span>
      <span className="font-semibold w-64 shrink-0">{name}</span>
      <span className="text-gray-600 break-all">{detail}</span>
    </div>
  );
}

export default function App() {
  const [rows, setRows] = useState([]);
  const [running, setRunning] = useState(true);

  useEffect(() => {
    runTests().then(setRows).finally(() => setRunning(false));
  }, []);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">E2EE Chat — Crypto Layer Test</h1>
      <p className="text-gray-500 text-sm mb-4">
        {running ? '⏳ Đang chạy...' : `✅ Hoàn thành — ${rows.filter(r => r.status === 'PASS').length}/${rows.length} pass`}
      </p>
      <div className="bg-white rounded border border-gray-200 p-4 space-y-0">
        {rows.map((r, i) => <Row key={i} {...r} />)}
      </div>
    </div>
  );
}

// ─── test runner ─────────────────────────────────────────────────────────────

async function runTests() {
  const results = [];

  function pass(name, detail = '') { results.push({ name, status: 'PASS', detail }); }
  function fail(name, detail = '') { results.push({ name, status: 'FAIL', detail }); }

  // ── Test 1: sinh Identity Key ────────────────────────────────────────────
  try {
    const IK_test = await generateIdentityKey();
    const { IK_pub, IK_secret } = IK_test;
    // IK_pub: 32B Ed25519 public, IK_secret: 64B Ed25519 (seed 32B + pub 32B)
    if (IK_pub.length === 32 && IK_secret.length === 64)
      pass('generateIdentityKey', `pub=${toBase64(IK_pub).slice(0, 12)}...`);
    else
      fail('generateIdentityKey', `sai length: pub=${IK_pub.length} secret=${IK_secret.length}`);
  } catch (e) { fail('generateIdentityKey', e.message); }

  // ── Test 2: sinh Signed PreKey + verify chữ ký ──────────────────────────
  let IK_A, SPK_A;
  try {
    IK_A  = await generateIdentityKey();
    SPK_A = await generateSignedPreKey(IK_A.IK_secret);
    const valid = await verifySignedPreKey(IK_A.IK_pub, SPK_A.SPK_sig, SPK_A.SPK_pub);
    if (valid)
      pass('generateSignedPreKey + verify', `sig=${toBase64(SPK_A.SPK_sig).slice(0, 12)}...`);
    else
      fail('generateSignedPreKey + verify', 'chữ ký không hợp lệ');
  } catch (e) { fail('generateSignedPreKey + verify', e.message); }

  // ── Test 3: verify trả false khi SPK bị giả mạo ─────────────────────────
  try {
    const fakeKey = await generateIdentityKey();
    const valid = await verifySignedPreKey(IK_A.IK_pub, SPK_A.SPK_sig, fakeKey.IK_pub);
    if (!valid)
      pass('verifySignedPreKey (MITM)', 'false khi SPK bị thay — đúng');
    else
      fail('verifySignedPreKey (MITM)', 'trả true với key giả — SAI');
  } catch (e) { fail('verifySignedPreKey (MITM)', e.message); }

  // ── Test 4: sinh 100 OPK ─────────────────────────────────────────────────
  let OPKs_A;
  try {
    OPKs_A = await generateOneTimePreKeys(100);
    const uuids = new Set(OPKs_A.map(k => k.id));
    if (OPKs_A.length === 100 && uuids.size === 100)
      pass('generateOneTimePreKeys', '100 key, 100 id duy nhất');
    else
      fail('generateOneTimePreKeys', `length=${OPKs_A.length} unique_ids=${uuids.size}`);
  } catch (e) { fail('generateOneTimePreKeys', e.message); }

  // ── Test 5: deriveWrappingKey + wrapPrivateKey + unwrapPrivateKey ─────────
  let wrappingKey_A;
  try {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    wrappingKey_A = await deriveWrappingKey('mat_khau_alice_123', salt);
    const { wrapped, iv } = await wrapPrivateKey(IK_A.IK_secret, wrappingKey_A);
    const recovered   = await unwrapPrivateKey(wrapped, iv, wrappingKey_A);
    const same = IK_A.IK_secret.every((b, i) => b === recovered[i]);
    if (same)
      pass('wrap → unwrap IK_secret', 'byte-for-byte identical');
    else
      fail('wrap → unwrap IK_secret', 'bytes khác nhau sau unwrap');
  } catch (e) { fail('wrap → unwrap IK_secret', e.message); }

  // ── Test 6: unwrap với password sai phải throw ───────────────────────────
  try {
    const salt2       = crypto.getRandomValues(new Uint8Array(16));
    const wrongKey    = await deriveWrappingKey('sai_mat_khau', salt2);
    const { wrapped, iv } = await wrapPrivateKey(IK_A.IK_secret, wrappingKey_A);
    await unwrapPrivateKey(wrapped, iv, wrongKey);
    fail('unwrap wrong password', 'không throw — SAI');
  } catch {
    pass('unwrap wrong password', 'throw DOMException — đúng');
  }

  // ── Test 7: X3DH sender + receiver → cùng SK ────────────────────────────
  let SK_alice, SK_bob;
  try {
    const IK_B  = await generateIdentityKey();
    const SPK_B = await generateSignedPreKey(IK_B.IK_secret);
    const OPKs_B = await generateOneTimePreKeys(1);

    // Giả lập bundle server trả về (base64 như thực tế)
    const bobBundle = {
      ikPub:  toBase64(IK_B.IK_pub),
      spkPub: toBase64(SPK_B.SPK_pub),
      spkSig: toBase64(SPK_B.SPK_sig),
      opkPub: toBase64(OPKs_B[0].OPK_pub),
      opkId:  OPKs_B[0].id,
    };

    const senderResult = await performX3DH_sender(
      { IK_secret: IK_A.IK_secret, IK_pub: IK_A.IK_pub },
      bobBundle
    );
    SK_alice = senderResult.SK;

    // Bob nhận initMsg từ tin đầu của Alice
    const initMsg = {
      ikPub:  toBase64(IK_A.IK_pub),
      ekPub:  toBase64(senderResult.EK_pub),
      opkId:  bobBundle.opkId,
    };

    const receiverResult = await performX3DH_receiver(
      {
        IK_secret: IK_B.IK_secret,
        SPK_priv:  SPK_B.SPK_priv,
        OPK_priv:  OPKs_B[0].OPK_priv,
      },
      initMsg
    );
    SK_bob = receiverResult.SK;

    // Export cả 2 SK ra raw bytes để so sánh
    const raw_a = new Uint8Array(await crypto.subtle.exportKey('raw', SK_alice));
    const raw_b = new Uint8Array(await crypto.subtle.exportKey('raw', SK_bob));
    const same  = raw_a.every((b, i) => b === raw_b[i]);

    if (same)
      pass('X3DH sender + receiver', `SK khớp: ${toBase64(raw_a).slice(0, 16)}...`);
    else
      fail('X3DH sender + receiver', 'SK khác nhau');
  } catch (e) { fail('X3DH sender + receiver', e.message); }

  // ── Test 8: AES-GCM encrypt + decrypt ───────────────────────────────────
  try {
    const convId = crypto.randomUUID();
    const sender = crypto.randomUUID();
    const plain  = 'Xin chào Bob! Đây là tin nhắn bí mật 🔐';
    const enc = await encryptMessage(plain, SK_alice, convId, sender);
    const dec = await decryptMessage(enc.ciphertext, enc.iv, enc.aad, SK_alice);
    if (dec === plain)
      pass('encryptMessage + decrypt', `"${plain.slice(0, 20)}..."  → OK`);
    else
      fail('encryptMessage + decrypt', `got: "${dec}"`);
  } catch (e) { fail('encryptMessage + decrypt', e.message); }

  // ── Test 9: decrypt với SK sai trả null ─────────────────────────────────
  // SK_alice === SK_bob (đó là mục tiêu X3DH) nên phải dùng key hoàn toàn khác
  try {
    const convId  = crypto.randomUUID();
    const sender  = crypto.randomUUID();
    const enc     = await encryptMessage('hello', SK_alice, convId, sender);
    const wrongSK = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
    );
    const dec = await decryptMessage(enc.ciphertext, enc.iv, enc.aad, wrongSK);
    if (dec === null)
      pass('decrypt wrong SK → null', 'dung');
    else
      fail('decrypt wrong SK → null', `tra "${dec}" thay vi null`);
  } catch (e) { fail('decrypt wrong SK → null', e.message); }

  // ── Test 10: AAD tamper → decrypt fail ──────────────────────────────────
  try {
    const convId = crypto.randomUUID();
    const sender = crypto.randomUUID();
    const enc = await encryptMessage('hello', SK_alice, convId, sender);
    const tampered = await decryptMessage(enc.ciphertext, enc.iv, 'fake:aad', SK_alice);
    if (tampered === null)
      pass('decrypt tampered AAD → null', 'đúng');
    else
      fail('decrypt tampered AAD → null', `trả "${tampered}" thay vì null`);
  } catch (e) { fail('decrypt tampered AAD → null', e.message); }

  // ── Test 11: fingerprint Alice↔Bob = Bob↔Alice ───────────────────────────
  try {
    const IK_B2 = await generateIdentityKey();
    const fp_AB = await generateFingerprint(IK_A.IK_pub, IK_B2.IK_pub);
    const fp_BA = await generateFingerprint(IK_B2.IK_pub, IK_A.IK_pub);
    if (fp_AB === fp_BA && fp_AB.length === 60 && /^\d+$/.test(fp_AB))
      pass('generateFingerprint', fp_AB.slice(0, 15) + '...');
    else
      fail('generateFingerprint', `AB="${fp_AB}" BA="${fp_BA}"`);
  } catch (e) { fail('generateFingerprint', e.message); }

  return results;
}
