import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import * as api from '../services/api.js';
import * as storage from '../db/storage.js';
import { performX3DH_receiver } from '../crypto/x3dh.js';
import { decryptMessage } from '../crypto/aesGcm.js';

// conversationId : UUID của conversation 1-1 (null khi dùng group mode)
// sessionKeysRef : MutableRefObject<Map> từ useWebSocket — chia sẻ SK cache
// groupId        : UUID của group (null khi dùng direct mode)
export function useMessages(conversationId, sessionKeysRef, groupId = null) {
  const { token, userId, IK_secret, SPK_priv, wrappingKey } = useAuth();

  const [messages,  setMessages]  = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore,   setHasMore]   = useState(true);

  const cursorRef = useRef(null);

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

  // Reset + load lại khi chuyển conversation hoặc group
  const activeId = groupId ?? conversationId;
  useEffect(() => {
    if (!activeId) return;
    setMessages([]);
    setHasMore(true);
    cursorRef.current = null;
    fetchBatch(null);
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Lấy SK cho 1-1: RAM cache → IndexedDB ───────────────────────────────────
  async function getSK(cacheKey) {
    if (sessionKeysRef?.current.has(cacheKey)) {
      return sessionKeysRef.current.get(cacheKey);
    }
    const wKey = wrappingKeyRef.current;
    if (!wKey) return null;
    const SK = await storage.loadSession(cacheKey, wKey);
    if (SK) sessionKeysRef?.current.set(cacheKey, SK);
    return SK;
  }

  // ─── X3DH receiver ────────────────────────────────────────────────────────────
  async function runX3DHReceiver(initMsg, cacheKey) {
    const ik   = IK_secretRef.current;
    const spk  = SPK_privRef.current;
    const wKey = wrappingKeyRef.current;
    const uid  = userIdRef.current;

    if (!ik || !spk || !wKey) return null;

    const OPK_priv = await storage.getOPK(uid, initMsg.opkId, wKey);
    if (!OPK_priv) return null;

    const { SK } = await performX3DH_receiver(
      { IK_secret: ik, SPK_priv: spk, OPK_priv },
      { ikPub: initMsg.ikPub, ekPub: initMsg.ekPub }
    );

    await storage.saveSession(cacheKey, SK, wKey);
    await storage.deleteOPK(uid, initMsg.opkId);
    sessionKeysRef?.current.set(cacheKey, SK);
    return SK;
  }

  // ─── Load batch cho 1-1 ──────────────────────────────────────────────────────
  async function fetchDirectBatch(cursor) {
    const tok = tokenRef.current;
    if (!conversationId || !tok) return;

    setIsLoading(true);
    try {
      const { messages: raw, nextCursor } = await api.loadMessages(tok, conversationId, cursor);

      let SK = await getSK(conversationId);
      if (!SK) {
        const initMsg = raw.find(m => m.ekPub);
        if (initMsg) {
          try { SK = await runX3DHReceiver(initMsg, conversationId); }
          catch (err) { console.error('[useMessages] X3DH error:', err); }
        }
      }

      const decrypted = await Promise.all(raw.map(async (m) => {
        if (!SK) return { id: m.id, senderId: m.senderId, plaintext: null, createdAt: m.createdAt, isDecryptError: true };
        const plaintext = await decryptMessage(m.ciphertext, m.iv, m.aad, SK);
        return { id: m.id, senderId: m.senderId, plaintext, createdAt: m.createdAt, isDecryptError: plaintext === null };
      }));

      const ordered = [...decrypted].reverse();
      if (cursor === null) setMessages(ordered);
      else setMessages(prev => [...ordered, ...prev]);

      cursorRef.current = nextCursor;
      setHasMore(nextCursor !== null);
    } catch (err) {
      console.error('[useMessages] fetchDirectBatch error:', err);
    } finally {
      setIsLoading(false);
    }
  }

  // ─── Load batch cho group ─────────────────────────────────────────────────────
  // Group có nhiều sender → mỗi sender có SK riêng, cache key = `${groupId}:${senderId}`
  async function fetchGroupBatch(cursor) {
    const tok = tokenRef.current;
    if (!groupId || !tok) return;

    setIsLoading(true);
    try {
      const { messages: raw, nextCursor } = await api.loadGroupMessages(tok, groupId, cursor);

      // Thu thập tất cả senderId duy nhất trong batch
      const senderIds = [...new Set(raw.map(m => m.senderId))];

      // Lấy SK cho từng sender (parallel)
      const skMap = new Map(); // senderId → SK
      await Promise.all(senderIds.map(async (senderId) => {
        const cacheKey = `${groupId}:${senderId}`;
        let SK = await getSK(cacheKey);

        // Chưa có SK → tìm tin X3DH init của sender này trong batch
        if (!SK) {
          const initMsg = raw.find(m => m.senderId === senderId && m.ekPub);
          if (initMsg) {
            try { SK = await runX3DHReceiver(initMsg, cacheKey); }
            catch (err) { console.error('[useMessages] group X3DH error:', err); }
          }
        }
        if (SK) skMap.set(senderId, SK);
      }));

      // Decrypt song song — system messages bỏ qua, tin thường dùng SK của sender
      const decrypted = await Promise.all(raw.map(async (m) => {
        if (m.isSystem) {
          return { id: m.id, senderId: m.senderId, plaintext: null, createdAt: m.createdAt, isSystem: true, systemText: m.systemText, isDecryptError: false };
        }
        const SK = skMap.get(m.senderId) ?? null;
        if (!SK) return { id: m.id, senderId: m.senderId, plaintext: null, createdAt: m.createdAt, isSystem: false, isDecryptError: true };
        const plaintext = await decryptMessage(m.ciphertext, m.iv, m.aad, SK);
        return { id: m.id, senderId: m.senderId, plaintext, createdAt: m.createdAt, isSystem: false, isDecryptError: plaintext === null };
      }));

      const ordered = [...decrypted].reverse();
      if (cursor === null) setMessages(ordered);
      else setMessages(prev => [...ordered, ...prev]);

      cursorRef.current = nextCursor;
      setHasMore(nextCursor !== null);
    } catch (err) {
      console.error('[useMessages] fetchGroupBatch error:', err);
    } finally {
      setIsLoading(false);
    }
  }

  function fetchBatch(cursor) {
    if (groupId) return fetchGroupBatch(cursor);
    return fetchDirectBatch(cursor);
  }

  // ─── Public API ───────────────────────────────────────────────────────────────

  function loadMore() {
    if (!hasMore || isLoading || !cursorRef.current) return;
    fetchBatch(cursorRef.current);
  }

  function addMessage(msg) {
    setMessages(prev => {
      if (prev.some(m => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  }

  function removeMessage(id) {
    setMessages(prev => prev.filter(m => m.id !== id));
  }

  return { messages, isLoading, hasMore, loadMore, addMessage, removeMessage };
}
