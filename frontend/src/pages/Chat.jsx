import { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { useMessages } from '../hooks/useMessages.js';
import * as api from '../services/api.js';
import * as storage from '../db/storage.js';
import { performX3DH_sender } from '../crypto/x3dh.js';
import { encryptMessage } from '../crypto/aesGcm.js';
import { toBase64, fromBase64 } from '../crypto/keyGen.js';
import ChatSidebar from '../components/ChatSidebar.jsx';
import MessageList from '../components/MessageList.jsx';
import MessageInput from '../components/MessageInput.jsx';
import FingerprintModal from '../components/FingerprintModal.jsx';
import ConfirmModal from '../components/ConfirmModal.jsx';

export default function Chat() {
  const { token, userId, username, IK_secret, IK_pub, wrappingKey, logout } = useAuth();

  // ─── Danh sách conversations ──────────────────────────────────────────────────
  const [conversations,  setConversations]  = useState([]);
  const [activeConvId,   setActiveConvId]   = useState(null);
  const [activePeer,     setActivePeer]     = useState(null); // { id, username, ikPub }
  const [isVerified,     setIsVerified]     = useState(false);
  const [showFingerprint, setShowFingerprint] = useState(false);
  const [isSending,      setIsSending]      = useState(false);
  const [sendError,      setSendError]      = useState('');
  const [replyTo,        setReplyTo]        = useState(null); // { id, senderUsername, preview }
  const [unreadCounts,   setUnreadCounts]   = useState(new Map()); // Map<convId, number>
  // confirmModal: { type: 'deleteMessage'|'deleteConv', id } — null khi không hiện
  const [confirmModal,   setConfirmModal]   = useState(null);

  // ─── Hooks ───────────────────────────────────────────────────────────────────
  const { onlineUsers, isConnected, isSessionReplaced, onNewMessage, onKeyUploaded, onMessageDeleted, reconnect, sessionKeysRef } = useWebSocket();
  const { messages, isLoading, hasMore, loadMore, addMessage, removeMessage } = useMessages(activeConvId, sessionKeysRef);

  // ─── Load danh sách conversations khi vào trang ──────────────────────────────
  useEffect(() => {
    if (!token) return;
    api.listConversations(token)
      .then(({ conversations: list }) => setConversations(list))
      .catch(err => console.error('[Chat] listConversations:', err));
  }, [token]);

  // ─── Đăng ký callback nhận tin real-time ─────────────────────────────────────
  // Dùng ref để callback không bị stale dù onNewMessage chỉ đăng ký 1 lần
  const activeConvIdRef  = useRef(activeConvId);
  const addMessageRef    = useRef(addMessage);
  const removeMessageRef = useRef(removeMessage);
  useEffect(() => { activeConvIdRef.current  = activeConvId;  }, [activeConvId]);
  useEffect(() => { addMessageRef.current    = addMessage;    }, [addMessage]);
  useEffect(() => { removeMessageRef.current = removeMessage; }, [removeMessage]);

  // Peer vừa upload key → cập nhật ikPub trong conversations + activePeer (không cần reload)
  useEffect(() => {
    onKeyUploaded(({ userId, ikPub }) => {
      setConversations(prev =>
        prev.map(c => c.peer.id === userId ? { ...c, peer: { ...c.peer, ikPub } } : c)
      );
      setActivePeer(prev => prev?.id === userId ? { ...prev, ikPub } : prev);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Peer xóa tin nhắn → xóa khỏi UI nếu đang xem conversation đó
  useEffect(() => {
    onMessageDeleted(({ messageId, conversationId }) => {
      if (conversationId === activeConvIdRef.current) {
        removeMessageRef.current?.(messageId);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onNewMessage(({ conversationId, message }) => {
      // Nếu đang xem đúng conversation đó → thêm tin vào danh sách
      if (conversationId === activeConvIdRef.current) {
        addMessageRef.current?.(message);
      } else {
        // Conversation không active → tăng unread badge
        setUnreadCounts(prev => {
          const m = new Map(prev);
          m.set(conversationId, (m.get(conversationId) ?? 0) + 1);
          return m;
        });
      }
      // Luôn bump conversation lên đầu sidebar khi có tin mới
      setConversations(prev => {
        const idx = prev.findIndex(c => c.conversationId === conversationId);
        if (idx === -1) return prev;
        const updated = { ...prev[idx], lastMessageAt: message.createdAt };
        return [updated, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
      });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Conversation vừa tạo mới qua search → reload để lấy peer.ikPub ─────────
  // Nếu không reload: object tạm có ikPub=null → FingerprintModal không mở được
  async function handleConvCreated(conversationId, peerId) {
    try {
      const { conversations: fresh } = await api.listConversations(token);
      setConversations(fresh);
      const conv = fresh.find(c => c.conversationId === conversationId);
      if (conv) {
        handleSelectConv(conv);
      }
    } catch (err) {
      console.error('[Chat] handleConvCreated reload error:', err);
    }
  }

  // ─── Chọn conversation ────────────────────────────────────────────────────────
  function handleSelectConv(conv) {
    setActiveConvId(conv.conversationId);
    setActivePeer(conv.peer);
    setIsVerified(conv.fingerprintVerified);
    setSendError('');
    setReplyTo(null);

    // Clear unread badge khi mở conversation
    setUnreadCounts(prev => {
      if (!prev.has(conv.conversationId)) return prev;
      const m = new Map(prev);
      m.delete(conv.conversationId);
      return m;
    });

    // Nếu conversation mới tạo (qua search) chưa có trong danh sách → thêm vào
    setConversations(prev => {
      if (prev.find(c => c.conversationId === conv.conversationId)) return prev;
      return [conv, ...prev];
    });
  }

  // ─── Lấy hoặc tạo Session Key ─────────────────────────────────────────────────
  // Trả về { SK, ekPub?, opkId?, ikPub? }
  // ekPub/opkId/ikPub chỉ có khi SK mới được tạo qua X3DH sender (tin đầu tiên)
  async function getOrCreateSK(conversationId, peerId) {
    // Bước 1: kiểm tra RAM cache từ useWebSocket
    const cached = sessionKeysRef.current.get(conversationId);
    if (cached) return { SK: cached };

    // Bước 2: kiểm tra IndexedDB
    const stored = await storage.loadSession(conversationId, wrappingKey);
    if (stored) {
      sessionKeysRef.current.set(conversationId, stored);
      return { SK: stored };
    }

    // Bước 3: chưa có SK → X3DH sender
    // Fetch key bundle của Bob — server tự pop 1 OPK khỏi pool
    const bundle = await api.fetchKeyBundle(token, peerId);

    const { SK, EK_pub, OPK_id, IK_pub: myIKPub } = await performX3DH_sender(
      { IK_secret, IK_pub },
      bundle
    );

    // Lưu SK vào IndexedDB + RAM cache
    await storage.saveSession(conversationId, SK, wrappingKey);
    sessionKeysRef.current.set(conversationId, SK);

    return {
      SK,
      ekPub: toBase64(EK_pub),
      opkId: OPK_id,
      ikPub: toBase64(myIKPub),
    };
  }

  // ─── Xóa tin nhắn — mở modal confirm, thực hiện sau khi user xác nhận ────────
  function handleDeleteMessage(msgId) {
    setConfirmModal({ type: 'deleteMessage', id: msgId });
  }

  async function doDeleteMessage(msgId) {
    setConfirmModal(null);
    try {
      await api.deleteMessage(token, msgId);
      removeMessage(msgId);
    } catch (err) {
      console.error('[Chat] deleteMessage error:', err);
    }
  }

  // ─── Xóa conversation — mở modal confirm, thực hiện sau khi user xác nhận ───
  function handleDeleteConv(convId) {
    setConfirmModal({ type: 'deleteConv', id: convId });
  }

  async function doDeleteConv(convId) {
    setConfirmModal(null);
    try {
      await api.deleteConversation(token, convId);
      setConversations(prev => prev.filter(c => c.conversationId !== convId));
      // Nếu đang xem conversation bị xóa → về màn hình chờ
      if (activeConvId === convId) {
        setActiveConvId(null);
        setActivePeer(null);
        setIsVerified(false);
        setReplyTo(null);
      }
    } catch (err) {
      console.error('[Chat] deleteConversation error:', err);
    }
  }

  // ─── Gửi tin nhắn ────────────────────────────────────────────────────────────
  async function handleSend(text) {
    if (!activeConvId || !activePeer || isSending) return;
    setSendError('');
    setIsSending(true);

    // Nếu đang reply → wrap plaintext thành JSON để lưu thông tin trả lời
    // Format: { t: nội dung, r: { id: msgId gốc, u: tên người gửi gốc, p: preview 100 ký tự đầu } }
    const currentReply = replyTo;
    const payload = currentReply
      ? JSON.stringify({ t: text, r: { id: currentReply.id, u: currentReply.senderUsername, p: currentReply.preview.slice(0, 100) } })
      : text;

    setReplyTo(null); // Clear reply state ngay lập tức (UX tốt hơn)

    try {
      const { SK, ekPub, opkId, ikPub } = await getOrCreateSK(activeConvId, activePeer.id);
      const { ciphertext, iv, aad } = await encryptMessage(payload, SK, activeConvId, userId);

      const { messageId, createdAt } = await api.sendMessage(token, {
        conversationId: activeConvId,
        ciphertext, iv, aad,
        // 3 trường này chỉ có ở tin X3DH đầu tiên — tin thường là undefined → server lưu null
        ekPub, opkId, ikPub,
      });

      // Thêm tin vào UI ngay (optimistic) — WS ACK sẽ đến sau và bị dedup theo messageId
      addMessage({ id: messageId, senderId: userId, plaintext: payload, createdAt, isDecryptError: false });

      // Bump conversation lên đầu sidebar
      setConversations(prev => {
        const idx = prev.findIndex(c => c.conversationId === activeConvId);
        if (idx === -1) return prev;
        const updated = { ...prev[idx], lastMessageAt: createdAt };
        return [updated, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
      });
    } catch (err) {
      console.error('[Chat] handleSend error:', err);
      setSendError('Không thể gửi tin: ' + err.message);
    } finally {
      setIsSending(false);
    }
  }

  // ─── Verify fingerprint xong ─────────────────────────────────────────────────
  function handleVerified() {
    setIsVerified(true);
    setShowFingerprint(false);
    // Cập nhật conversation trong danh sách
    setConversations(prev =>
      prev.map(c =>
        c.conversationId === activeConvId
          ? { ...c, fingerprintVerified: true }
          : c
      )
    );
  }

  // ─── Map<userId, peer> để MessageList hiển thị tên ───────────────────────────
  const peersMap = useMemo(() => {
    const m = new Map();
    if (activePeer) m.set(activePeer.id, activePeer);
    return m;
  }, [activePeer]);

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden">
      {/* Sidebar trái */}
      <ChatSidebar
        conversations={conversations}
        activeConvId={activeConvId}
        onlineUsers={onlineUsers}
        onSelectConv={handleSelectConv}
        onConvCreated={handleConvCreated}
        onDeleteConv={handleDeleteConv}
        unreadCounts={unreadCounts}
        username={username}
        userId={userId}
        token={token}
        isConnected={isConnected}
        onLogout={logout}
      />

      {/* Khu vực chat phải */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeConvId && activePeer ? (
          <>
            {/* Header conversation */}
            <div className="bg-white border-b border-gray-200 px-5 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-semibold"
                    style={{ backgroundColor: `hsl(${[...activePeer.id].reduce((a, c) => a + c.charCodeAt(0), 0) % 360}, 55%, 42%)` }}>
                    {activePeer.username.slice(0, 2).toUpperCase()}
                  </div>
                  {onlineUsers.has(activePeer.id) && (
                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-400 rounded-full border-2 border-white" />
                  )}
                </div>
                <div>
                  <p className="font-semibold text-gray-900 text-sm">{activePeer.username}</p>
                  <p className="text-xs text-gray-500">
                    {onlineUsers.has(activePeer.id) ? 'Đang hoạt động' : 'Không hoạt động'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Badge bảo mật */}
                {isVerified ? (
                  <span className="text-xs bg-green-50 text-green-700 border border-green-200 rounded-full px-3 py-1 flex items-center gap-1">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 1l2.39 4.843L18 6.86l-4 3.9.944 5.5L10 13.77l-4.944 2.49L6 10.76 2 6.86l5.61-1.017L10 1z" clipRule="evenodd" />
                    </svg>
                    E2EE · Đã xác minh
                  </span>
                ) : (
                  <button
                    onClick={() => setShowFingerprint(true)}
                    className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-3 py-1 hover:bg-amber-100 transition-colors"
                  >
                    Xác minh danh tính
                  </button>
                )}
              </div>
            </div>

            {/* Banner lỗi gửi tin */}
            {sendError && (
              <div className="bg-red-50 text-red-600 text-xs text-center py-2 px-4 border-b border-red-100">
                {sendError}
                <button onClick={() => setSendError('')} className="ml-2 underline">Đóng</button>
              </div>
            )}

            {/* Danh sách tin nhắn */}
            <MessageList
              messages={messages}
              userId={userId}
              myUsername={username}
              isLoading={isLoading}
              hasMore={hasMore}
              onLoadMore={loadMore}
              peers={peersMap}
              onDeleteMessage={handleDeleteMessage}
              onReply={setReplyTo}
            />

            {/* Ô nhập tin */}
            <MessageInput
              onSend={handleSend}
              isSending={isSending}
              disabled={!isVerified}
              replyTo={replyTo}
              onCancelReply={() => setReplyTo(null)}
            />
          </>
        ) : (
          // Màn hình chờ khi chưa chọn conversation
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-3">
            <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center">
              <svg className="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <p className="text-gray-700 font-medium">Chọn một cuộc trò chuyện</p>
            <p className="text-sm text-gray-400 max-w-xs">
              Tìm người dùng trong thanh tìm kiếm bên trái để bắt đầu nhắn tin E2EE.
            </p>
          </div>
        )}
      </div>

      {/* Fingerprint Modal */}
      {showFingerprint && IK_pub && activePeer?.ikPub && (
        <FingerprintModal
          myIKPub={IK_pub}
          peerIKPub={activePeer.ikPub}
          peerUsername={activePeer.username}
          conversationId={activeConvId}
          token={token}
          onClose={() => setShowFingerprint(false)}
          onVerified={handleVerified}
        />
      )}

      {/* Overlay: tab này bị thay thế bởi phiên mới của cùng tài khoản */}
      {isSessionReplaced && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm text-center space-y-4">
            <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center mx-auto">
              <svg className="w-7 h-7 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-gray-900 text-base">Phiên đăng nhập bị thay thế</p>
              <p className="text-sm text-gray-500 mt-1">
                Tài khoản này vừa đăng nhập ở một tab khác. Tab này không còn nhận được tin nhắn mới.
              </p>
            </div>
            <button
              onClick={reconnect}
              className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              Kết nối lại
            </button>
          </div>
        </div>
      )}

      {/* Modal xác nhận xóa tin nhắn */}
      {confirmModal?.type === 'deleteMessage' && (
        <ConfirmModal
          title="Xóa tin nhắn?"
          body="Tin nhắn sẽ bị xóa vĩnh viễn. Người nhận cũng sẽ không thấy tin này nữa."
          confirmLabel="Xóa"
          danger
          onConfirm={() => doDeleteMessage(confirmModal.id)}
          onCancel={() => setConfirmModal(null)}
        />
      )}

      {/* Modal xác nhận xóa conversation */}
      {confirmModal?.type === 'deleteConv' && (
        <ConfirmModal
          title="Xóa cuộc trò chuyện?"
          body="Toàn bộ lịch sử tin nhắn sẽ bị xóa vĩnh viễn và không thể khôi phục."
          confirmLabel="Xóa"
          danger
          onConfirm={() => doDeleteConv(confirmModal.id)}
          onCancel={() => setConfirmModal(null)}
        />
      )}

      {/* Thông báo khi peer chưa upload key (ikPub null) */}
      {showFingerprint && (!activePeer?.ikPub) && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm text-center space-y-4">
            <p className="text-gray-700">
              <span className="font-medium">{activePeer?.username}</span> chưa upload public key lên server.
              Yêu cầu họ đăng nhập lại để upload key.
            </p>
            <button
              onClick={() => setShowFingerprint(false)}
              className="px-6 py-2 bg-gray-100 rounded-xl text-sm font-medium hover:bg-gray-200"
            >
              Đóng
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
