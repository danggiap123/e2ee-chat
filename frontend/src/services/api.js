// Toàn bộ REST API call tập trung ở đây.
// Không có logic crypto hay React trong file này.
// Mọi component/hook chỉ import hàm từ đây, không tự viết fetch.

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// ─── Helper dùng chung ────────────────────────────────────────────────────────
// Tất cả 15 hàm bên dưới đều đi qua apiFetch.
// Lý do tập trung: tránh lặp headers, tránh lặp error handling, dễ sửa 1 chỗ.

async function apiFetch(path, options = {}, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  // Parse JSON — nếu server crash hoặc proxy lỗi có thể trả body rỗng/HTML
  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error(`Không kết nối được server — thử lại (HTTP ${res.status})`);
  }

  if (!res.ok) {
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  return body;
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────

// POST /auth/register
// Chỉ tạo user trên server — KHÔNG upload key, KHÔNG login thay user.
// Key đã được sinh + lưu IndexedDB trước khi gọi hàm này (trong Register.jsx).
// Return: { message: "Đăng ký thành công..." }
export async function register(username, password, email) {
  return apiFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password, email }),
  });
}

// POST /auth/login
// Return: { token, userId, username }
// Sau khi nhận, caller (AuthContext.login) lưu token vào localStorage + RAM state.
export async function login(username, password) {
  return apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

// POST /auth/logout
// Đưa token vào Redis blocklist → token không dùng được nữa dù chưa hết hạn.
// Gọi trước khi xóa token khỏi localStorage để đảm bảo server revoke trước.
export async function logout(token) {
  return apiFetch('/auth/logout', { method: 'POST' }, token);
}

// ─── KEYS ─────────────────────────────────────────────────────────────────────

// POST /keys/upload
// Gọi 1 lần duy nhất sau login lần đầu tiên.
// Lần login tiếp theo: server trả 409 → caller bỏ qua, không phải lỗi.
// opkPubs: [{ id: string, pub: string(base64) }] — 100 phần tử
export async function uploadKeys(token, { ikPub, spkPub, spkSig, opkPubs }) {
  return apiFetch('/keys/upload', {
    method: 'POST',
    body: JSON.stringify({ ikPub, spkPub, spkSig, opkPubs }),
  }, token);
}

// GET /keys/:userId
// Server tự động pop 1 OPK khỏi pool của userId — OPK đó không dùng được lần 2.
// Caller PHẢI gọi verifySignedPreKey(ikPub, spkSig, spkPub) ngay sau khi nhận kết quả.
// Return: { ikPub, spkPub, spkSig, opkPub, opkId } — tất cả base64
export async function fetchKeyBundle(token, userId) {
  return apiFetch(`/keys/${userId}`, {}, token);
}

// POST /keys/opk
// Gọi khi pool OPK còn < 10 (server emit low_opk qua WebSocket khi < 10).
// opkPubs: [{ id, pub }] — tối đa 100 - current
// Return: { added, previous, current }
export async function uploadMoreOPKs(token, opkPubs) {
  return apiFetch('/keys/opk', {
    method: 'POST',
    body: JSON.stringify({ opkPubs }),
  }, token);
}

// POST /keys/spk
// Rotate Signed PreKey định kỳ — chỉ thay spkPub + spkSig, IK và OPK giữ nguyên.
// spkSig phải là Ed25519.sign(IK_priv, spkPub) — server không verify, client tự chịu trách nhiệm.
export async function rotateSpk(token, { spkPub, spkSig }) {
  return apiFetch('/keys/spk', {
    method: 'POST',
    body: JSON.stringify({ spkPub, spkSig }),
  }, token);
}

// ─── CONVERSATIONS ────────────────────────────────────────────────────────────

// POST /conversations
// Idempotent: gọi nhiều lần với cùng recipientId luôn trả về cùng conversationId.
// Lý do: user có thể click "nhắn tin" nhiều lần — không tạo conversation trùng.
// Return: { conversationId, message }
export async function createConversation(token, recipientId) {
  return apiFetch('/conversations', {
    method: 'POST',
    body: JSON.stringify({ recipientId }),
  }, token);
}

// GET /conversations
// Return: { conversations: [{ conversationId, peer: {id, username}, fingerprintVerified, lastMessageAt }] }
// Đã sort mới nhất lên đầu ở server — client không cần sort lại.
export async function listConversations(token) {
  return apiFetch('/conversations', {}, token);
}

// PATCH /conversations/:convId/fingerprint
// Chỉ gọi sau khi user bấm "Xác nhận" trong FingerprintModal.
// Idempotent: nếu đã verify rồi thì server trả 200, không báo lỗi.
// Không có hàm "unverify" — một khi đã verify thì không đổi lại được.
export async function verifyFingerprint(token, conversationId) {
  return apiFetch(`/conversations/${conversationId}/fingerprint`, {
    method: 'PATCH',
  }, token);
}

// DELETE /conversations/:convId
// Xóa conversation + toàn bộ tin nhắn bên trong (server xóa Message trước vì foreign key).
// Chỉ member của conversation mới xóa được — server kiểm tra.
export async function deleteConversation(token, conversationId) {
  return apiFetch(`/conversations/${conversationId}`, {
    method: 'DELETE',
  }, token);
}

// ─── MESSAGES ─────────────────────────────────────────────────────────────────

// POST /messages
// Gửi 1 tin nhắn đã mã hóa lên server để lưu DB + relay qua WebSocket.
// ekPub, opkId, ikPub: chỉ có ở tin X3DH đầu tiên (khi SK chưa tồn tại).
//                      Tin thường 3 trường này là undefined → server lưu null.
// Return: { messageId, createdAt }
export async function sendMessage(token, { conversationId, ciphertext, iv, aad, ekPub, opkId, ikPub }) {
  return apiFetch('/messages', {
    method: 'POST',
    body: JSON.stringify({ conversationId, ciphertext, iv, aad, ekPub, opkId, ikPub }),
  }, token);
}

// GET /messages/:convId?cursor=<id>&limit=20
// cursor = undefined → load 20 tin mới nhất (server trả DESC)
// cursor = id tin cuối đã có → load 20 tin cũ hơn (scroll lên để xem lịch sử)
// Return: { messages: [...], nextCursor }
// nextCursor = null → đã load hết, không còn tin nào cũ hơn
export async function loadMessages(token, conversationId, cursor = null, limit = 20) {
  const params = new URLSearchParams({ limit });
  if (cursor) params.set('cursor', cursor);
  return apiFetch(`/messages/${conversationId}?${params}`, {}, token);
}

// DELETE /messages/:messageId
// Chỉ người gửi mới xóa được tin của mình — server kiểm tra senderId.
// Xóa ciphertext khỏi DB — tin đã xóa không thể decrypt lại.
export async function deleteMessage(token, messageId) {
  return apiFetch(`/messages/${messageId}`, {
    method: 'DELETE',
  }, token);
}

// ─── USERS ────────────────────────────────────────────────────────────────────

// GET /users?search=keyword
// Tìm user theo username (contains, case-insensitive).
// keyword nên >= 2 ký tự — validate ở FE trước khi gọi (không gọi với keyword rỗng).
// Loại bỏ bản thân khỏi kết quả — server tự xử lý.
// Return: { users: [{ id, username }] } — tối đa 20 kết quả
export async function searchUsers(token, keyword) {
  const params = new URLSearchParams({ search: keyword });
  return apiFetch(`/users?${params}`, {}, token);
}
