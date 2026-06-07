import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import * as api from '../services/api.js';
import * as storage from '../db/storage.js';
import { performX3DH_receiver } from '../crypto/x3dh.js';
import { decryptMessage } from '../crypto/aesGcm.js';

// conversationId  : UUID của conversation đang xem
// sessionKeysRef  : MutableRefObject<Map> từ useWebSocket — chia sẻ SK cache để không load lại IndexedDB
export function useMessages(conversationId, sessionKeysRef) {
  const { token, userId, IK_secret, SPK_priv, wrappingKey } = useAuth();

  const [messages,  setMessages]  = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore,   setHasMore]   = useState(true);

  const cursorRef = useRef(null); // ID tin cuối đã load — dùng cho loadMore

  // Refs để các hàm async luôn đọc giá trị mới nhất mà không cần re-run effect
  const wrappingKeyRef = useRef(wrappingKey);
  const IK_secretRef   = useRef(IK_secret);
  const SPK_privRef    = useRef(SPK_priv);
  const userIdRef      = useRef(userId);
  const tokenRef       = useRef(token);

  useEffect(() => { wrappingKeyRef.current = wrappingKey; }, [wrappingKey]);
  useEffect(() => { IK_secretRef.current   = IK_secret;   }, [IK_secret]);
  useEffect(() => { SPK_privRef.current    = SPK_priv;    }, [SPK_priv]);
  useEffect(() => { userIdRef.current      = userId;      }, [userId]);
  useEffect(() => { tokenRef.current       = token;       }, [token]);

  // Reset toàn bộ state khi user chuyển sang conversation khác rồi load lại từ đầu
  useEffect(() => {
    if (!conversationId) return;
    setMessages([]);
    setHasMore(true);
    cursorRef.current = null;
    fetchBatch(null);
  }, [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Lấy SK: RAM cache → IndexedDB ───────────────────────────────────────────
  async function getSK(convId) {
    // Ưu tiên RAM cache từ useWebSocket — tránh đọc IndexedDB lại nếu đã có
    if (sessionKeysRef?.current.has(convId)) {
      return sessionKeysRef.current.get(convId);
    }

    const wKey = wrappingKeyRef.current;
    if (!wKey) return null;

    const SK = await storage.loadSession(convId, wKey);
    // Ghi vào cache để lần sau dùng lại
    if (SK) sessionKeysRef?.current.set(convId, SK);
    return SK;
  }

  // ─── X3DH receiver cho tin đầu tiên trong lịch sử ───────────────────────────
  // Chỉ cần chạy 1 lần / conversation — khi chưa có SK trong IndexedDB
  async function runX3DHReceiver(initMsg, convId) {
    const ik   = IK_secretRef.current;
    const spk  = SPK_privRef.current;
    const wKey = wrappingKeyRef.current;
    const uid  = userIdRef.current;

    if (!ik || !spk || !wKey) return null;

    const OPK_priv = await storage.getOPK(uid, initMsg.opkId, wKey);
    if (!OPK_priv) return null; // OPK đã bị xóa hoặc opkId sai

    const { SK } = await performX3DH_receiver(
      { IK_secret: ik, SPK_priv: spk, OPK_priv },
      { ikPub: initMsg.ikPub, ekPub: initMsg.ekPub }
    );

    // Lưu SK vào IndexedDB + cache — OPK dùng 1 lần, xóa ngay
    await storage.saveSession(convId, SK, wKey);
    await storage.deleteOPK(uid, initMsg.opkId);
    sessionKeysRef?.current.set(convId, SK);

    return SK;
  }

  // ─── Load 1 batch tin nhắn ───────────────────────────────────────────────────
  async function fetchBatch(cursor) {
    const tok = tokenRef.current;
    if (!conversationId || !tok) return;

    setIsLoading(true);
    try {
      const { messages: raw, nextCursor } = await api.loadMessages(tok, conversationId, cursor);

      // Bước 1: lấy SK từ cache / IndexedDB
      let SK = await getSK(conversationId);

      // Bước 2: chưa có SK → tìm tin X3DH init trong batch và chạy receiver
      // Server trả newest-first → tin X3DH init (oldest, có ekPub) nằm cuối mảng raw
      // Phải lấy SK trước rồi mới decrypt được tất cả tin còn lại trong batch
      if (!SK) {
        const initMsg = raw.find(m => m.ekPub);
        if (initMsg) {
          try {
            SK = await runX3DHReceiver(initMsg, conversationId);
          } catch (err) {
            console.error('[useMessages] X3DH receiver error:', err);
          }
        }
      }

      // Bước 3: decrypt song song — tất cả tin trong 1 conversation dùng cùng 1 SK
      const decrypted = await Promise.all(raw.map(async (m) => {
        if (!SK) {
          return { id: m.id, senderId: m.senderId, plaintext: null, createdAt: m.createdAt, isDecryptError: true };
        }
        const plaintext = await decryptMessage(m.ciphertext, m.iv, m.aad, SK);
        return {
          id:             m.id,
          senderId:       m.senderId,
          plaintext,
          createdAt:      m.createdAt,
          isDecryptError: plaintext === null,
        };
      }));

      // Bước 4: đảo ngược để hiển thị cũ → mới từ trên xuống dưới
      const ordered = [...decrypted].reverse();

      if (cursor === null) {
        // Load lần đầu — thay toàn bộ
        setMessages(ordered);
      } else {
        // loadMore — prepend tin cũ hơn lên đầu danh sách
        setMessages(prev => [...ordered, ...prev]);
      }

      cursorRef.current = nextCursor;
      setHasMore(nextCursor !== null);
    } catch (err) {
      console.error('[useMessages] fetchBatch error:', err);
    } finally {
      setIsLoading(false);
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────────────

  // Gọi khi user scroll lên đầu để xem tin cũ hơn
  function loadMore() {
    if (!hasMore || isLoading || !cursorRef.current) return;
    fetchBatch(cursorRef.current);
  }

  // Chat.jsx gọi hàm này khi useWebSocket nhận tin mới real-time
  // msg = { id, senderId, plaintext, createdAt, isDecryptError }
  function addMessage(msg) {
    setMessages(prev => {
      // Chống trùng: ACK từ server và real-time relay có thể mang cùng msgId
      if (prev.some(m => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  }

  // Chat.jsx gọi sau khi DELETE /messages/:id thành công
  function removeMessage(id) {
    setMessages(prev => prev.filter(m => m.id !== id));
  }

  return { messages, isLoading, hasMore, loadMore, addMessage, removeMessage };
}
