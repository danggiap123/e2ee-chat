import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import * as storage from '../db/storage.js';
import { performX3DH_receiver } from '../crypto/x3dh.js';
import { decryptMessage } from '../crypto/aesGcm.js';
import {
  connectSocket,
  disconnectSocket,
  onSocketEvent,
  offSocketEvent,
} from '../services/socket.js';

export function useWebSocket() {
  const { token, userId, IK_secret, SPK_priv, wrappingKey } = useAuth();

  const [onlineUsers,       setOnlineUsers]       = useState(new Set());
  const [isConnected,       setIsConnected]       = useState(false);
  const [isSessionReplaced, setIsSessionReplaced] = useState(false);

  // Map<conversationId, CryptoKey> — cache SK trong RAM để tránh đọc IndexedDB mỗi tin
  // useRef thay vì useState vì thay đổi Map không cần trigger re-render
  const sessionKeysRef = useRef(new Map());

  // Chat.jsx đăng ký callback qua onNewMessage() để nhận tin mới real-time
  const newMsgCallbackRef = useRef(null);

  // Chat.jsx đăng ký callback qua onKeyUploaded() khi peer vừa upload key lần đầu
  const keyUploadedCallbackRef = useRef(null);

  // Chat.jsx đăng ký callback qua onMessageDeleted() khi peer xóa tin nhắn của họ
  const messageDeletedCallbackRef = useRef(null);

  // ─── Refs cho crypto values ───────────────────────────────────────────────────
  // Vấn đề: useEffect chạy 1 lần khi mount, handler bên trong "đóng băng" giá trị
  // tại thời điểm đó. Sau unlock(), wrappingKey/IK_secret/SPK_priv thay đổi nhưng
  // handler cũ không biết (stale closure).
  // Giải pháp: useRef — ref là object ổn định, .current luôn trỏ giá trị mới nhất.
  const wrappingKeyRef = useRef(wrappingKey);
  const IK_secretRef = useRef(IK_secret);
  const SPK_privRef = useRef(SPK_priv);
  const userIdRef = useRef(userId);

  // Đồng bộ ref mỗi khi giá trị thay đổi (chạy sau mỗi render nếu dep thay đổi)
  useEffect(() => { wrappingKeyRef.current = wrappingKey; }, [wrappingKey]);
  useEffect(() => { IK_secretRef.current = IK_secret; }, [IK_secret]);
  useEffect(() => { SPK_privRef.current = SPK_priv; }, [SPK_priv]);
  useEffect(() => { userIdRef.current = userId; }, [userId]);

  // ─── Kết nối WebSocket khi có token ──────────────────────────────────────────
  useEffect(() => {
    if (!token) return;

    connectSocket(token);

    // Server gửi 'connected' ngay sau khi xác thực JWT thành công
    // onlineUsers là mảng userId đang kết nối tại thời điểm này
    onSocketEvent('connected', (msg) => {
      setIsConnected(true);
      setIsSessionReplaced(false); // reset khi kết nối lại thành công
      setOnlineUsers(new Set(msg.onlineUsers));
    });

    // Ai đó vừa kết nối hoặc ngắt kết nối → cập nhật Set
    // Dùng functional update (prev => ...) để tránh capture giá trị cũ của onlineUsers
    onSocketEvent('presence', (msg) => {
      setOnlineUsers(prev => {
        const next = new Set(prev);
        if (msg.status === 'online') next.add(msg.userId);
        else next.delete(msg.userId);
        return next;
      });
    });

    // Tin nhắn mới đến → decrypt rồi gọi callback
    onSocketEvent('message', (msg) => {
      handleIncoming(msg).catch(err =>
        console.error('[useWebSocket] handleIncoming error:', err)
      );
    });

    // Peer vừa upload key lần đầu → gọi callback để Chat.jsx cập nhật ikPub trong state
    onSocketEvent('key_uploaded', (msg) => {
      keyUploadedCallbackRef.current?.({ userId: msg.userId, ikPub: msg.ikPub });
    });

    // Peer vừa xóa tin nhắn của họ → gọi callback để Chat.jsx xóa khỏi UI
    onSocketEvent('message_deleted', (msg) => {
      messageDeletedCallbackRef.current?.({ messageId: msg.messageId, conversationId: msg.conversationId });
    });

    // Tab này bị thay thế bởi tab mới của cùng tài khoản → hiện overlay, không reconnect
    onSocketEvent('session_replaced', () => {
      setIsSessionReplaced(true);
      setIsConnected(false);
    });

    return () => {
      offSocketEvent('connected');
      offSocketEvent('presence');
      offSocketEvent('message');
      offSocketEvent('key_uploaded');
      offSocketEvent('message_deleted');
      offSocketEvent('session_replaced');
      setIsConnected(false);
      disconnectSocket();
    };
  }, [token]); // chỉ re-run khi token thay đổi (login/logout) — refs lo phần còn lại

  // ─── Xử lý tin nhắn đến ──────────────────────────────────────────────────────
  // Hàm này được gọi từ handler đăng ký trong useEffect (closure cũ từ lần mount đầu).
  // Toàn bộ giá trị mutable đều đọc qua .current → không bị stale dù closure cũ.
  async function handleIncoming(msg) {
    const {
      conversationId, msgId, senderId,
      ciphertext, iv, aad,
      ekPub, opkId, ikPub,
      createdAt,
    } = msg;

    const wKey = wrappingKeyRef.current;
    const uid = userIdRef.current;

    // Bước 1: tìm SK — RAM cache trước, IndexedDB sau
    let SK = sessionKeysRef.current.get(conversationId) ?? null;
    if (!SK && wKey) {
      SK = await storage.loadSession(conversationId, wKey);
      if (SK) sessionKeysRef.current.set(conversationId, SK);
    }

    // Bước 2: không có SK + có ekPub → tin X3DH đầu tiên → chạy receiver
    if (!SK && ekPub) {
      const ik = IK_secretRef.current;
      const spk = SPK_privRef.current;

      if (!ik || !spk || !wKey) {
        // Lý thuyết không xảy ra: Chat chỉ render khi !isLocked (keys đã có trong RAM)
        dispatchMsg(conversationId, { id: msgId, senderId, plaintext: null, createdAt, isDecryptError: true });
        return;
      }

      try {
        // Chỉ unwrap đúng 1 OPK theo opkId — 1 AES-GCM decrypt thay vì 100
        const OPK_priv = await storage.getOPK(uid, opkId, wKey);

        if (!OPK_priv) {
          // OPK không tìm thấy — đã bị xóa hoặc opkId sai
          dispatchMsg(conversationId, { id: msgId, senderId, plaintext: null, createdAt, isDecryptError: true });
          return;
        }

        const { SK: newSK } = await performX3DH_receiver(
          { IK_secret: ik, SPK_priv: spk, OPK_priv },
          { ikPub, ekPub }
        );

        // Lưu SK vào IndexedDB + RAM cache
        await storage.saveSession(conversationId, newSK, wKey);
        // Xóa OPK đã dùng — OPK chỉ được dùng 1 lần (forward secrecy)
        await storage.deleteOPK(uid, opkId);
        sessionKeysRef.current.set(conversationId, newSK);
        SK = newSK;
      } catch (err) {
        console.error('[useWebSocket] X3DH receiver error:', err);
        dispatchMsg(conversationId, { id: msgId, senderId, plaintext: null, createdAt, isDecryptError: true });
        return;
      }
    }

    // Bước 3: vẫn không có SK → không thể giải mã
    if (!SK) {
      dispatchMsg(conversationId, { id: msgId, senderId, plaintext: null, createdAt, isDecryptError: true });
      return;
    }

    // Bước 4: decrypt — trả null nếu ciphertext bị tamper (AAD không khớp)
    const plaintext = await decryptMessage(ciphertext, iv, aad, SK);
    dispatchMsg(conversationId, {
      id: msgId,
      senderId,
      plaintext,
      createdAt,
      isDecryptError: plaintext === null,
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  function dispatchMsg(conversationId, message) {
    newMsgCallbackRef.current?.({ conversationId, message });
  }

  // Chat.jsx gọi hàm này 1 lần để đăng ký callback nhận tin mới
  // Dùng ref thay vì state — thay đổi callback không cần re-render
  function onNewMessage(callback) {
    newMsgCallbackRef.current = callback;
  }

  function onKeyUploaded(callback) {
    keyUploadedCallbackRef.current = callback;
  }

  function onMessageDeleted(callback) {
    messageDeletedCallbackRef.current = callback;
  }

  // Kết nối lại sau khi bị session_replaced — không cần reload trang
  // connectSocket tự reset intentionalClose=false trước khi _connect
  function reconnect() {
    if (token) connectSocket(token);
  }

  return {
    onlineUsers,       // Set<userId> — dùng để hiển thị chấm xanh online
    isConnected,       // boolean — hiển thị "đang kết nối..." nếu false
    isSessionReplaced, // boolean — true khi tab này bị thay thế bởi tab mới cùng tài khoản
    onNewMessage,      // (callback) => void — Chat.jsx đăng ký để nhận tin real-time
    onKeyUploaded,     // (callback) => void — Chat.jsx đăng ký để nhận event key_uploaded
    onMessageDeleted,  // (callback) => void — Chat.jsx đăng ký để nhận event message_deleted
    reconnect,         // () => void — kết nối lại WS sau session_replaced
    sessionKeysRef,    // MutableRefObject<Map> — Chat.jsx đọc/ghi SK khi gửi tin
  };
}
