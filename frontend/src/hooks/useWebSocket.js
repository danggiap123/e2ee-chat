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

  // Map<conversationId|groupSessionKey, CryptoKey> — cache SK trong RAM
  const sessionKeysRef = useRef(new Map());

  const newMsgCallbackRef      = useRef(null);
  const newGroupMsgCallbackRef = useRef(null);
  const keyUploadedCallbackRef = useRef(null);
  const messageDeletedCallbackRef = useRef(null);

  // Refs tránh stale closure trong handler đăng ký 1 lần khi mount
  const wrappingKeyRef = useRef(wrappingKey);
  const IK_secretRef   = useRef(IK_secret);
  const SPK_privRef    = useRef(SPK_priv);
  const userIdRef      = useRef(userId);

  useEffect(() => { wrappingKeyRef.current = wrappingKey; }, [wrappingKey]);
  useEffect(() => { IK_secretRef.current   = IK_secret;   }, [IK_secret]);
  useEffect(() => { SPK_privRef.current    = SPK_priv;    }, [SPK_priv]);
  useEffect(() => { userIdRef.current      = userId;      }, [userId]);

  // ─── Kết nối WebSocket ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;

    connectSocket(token);

    onSocketEvent('connected', (msg) => {
      setIsConnected(true);
      setIsSessionReplaced(false);
      setOnlineUsers(new Set(msg.onlineUsers));
    });

    onSocketEvent('presence', (msg) => {
      setOnlineUsers(prev => {
        const next = new Set(prev);
        if (msg.status === 'online') next.add(msg.userId);
        else next.delete(msg.userId);
        return next;
      });
    });

    // Tin nhắn 1-1
    onSocketEvent('message', (msg) => {
      handleIncoming(msg).catch(err =>
        console.error('[useWebSocket] handleIncoming error:', err)
      );
    });

    // Tin nhắn group
    onSocketEvent('group_message', (msg) => {
      handleGroupIncoming(msg).catch(err =>
        console.error('[useWebSocket] handleGroupIncoming error:', err)
      );
    });

    onSocketEvent('key_uploaded', (msg) => {
      keyUploadedCallbackRef.current?.({ userId: msg.userId, ikPub: msg.ikPub });
    });

    onSocketEvent('message_deleted', (msg) => {
      messageDeletedCallbackRef.current?.({ messageId: msg.messageId, conversationId: msg.conversationId });
    });

    onSocketEvent('session_replaced', () => {
      setIsSessionReplaced(true);
      setIsConnected(false);
    });

    return () => {
      offSocketEvent('connected');
      offSocketEvent('presence');
      offSocketEvent('message');
      offSocketEvent('group_message');
      offSocketEvent('key_uploaded');
      offSocketEvent('message_deleted');
      offSocketEvent('session_replaced');
      setIsConnected(false);
      disconnectSocket();
    };
  }, [token]);

  // ─── Xử lý tin nhắn 1-1 đến ──────────────────────────────────────────────────
  async function handleIncoming(msg) {
    const { conversationId, msgId, senderId, ciphertext, iv, aad, ekPub, opkId, ikPub, createdAt } = msg;
    const wKey = wrappingKeyRef.current;
    const uid  = userIdRef.current;

    let SK = sessionKeysRef.current.get(conversationId) ?? null;
    if (!SK && wKey) {
      SK = await storage.loadSession(conversationId, wKey);
      if (SK) sessionKeysRef.current.set(conversationId, SK);
    }

    if (!SK && ekPub) {
      const ik  = IK_secretRef.current;
      const spk = SPK_privRef.current;
      if (!ik || !spk || !wKey) {
        dispatchMsg(conversationId, { id: msgId, senderId, plaintext: null, createdAt, isDecryptError: true });
        return;
      }
      try {
        const OPK_priv = await storage.getOPK(uid, opkId, wKey);
        if (!OPK_priv) {
          dispatchMsg(conversationId, { id: msgId, senderId, plaintext: null, createdAt, isDecryptError: true });
          return;
        }
        const { SK: newSK } = await performX3DH_receiver(
          { IK_secret: ik, SPK_priv: spk, OPK_priv },
          { ikPub, ekPub }
        );
        await storage.saveSession(conversationId, newSK, wKey);
        await storage.deleteOPK(uid, opkId);
        sessionKeysRef.current.set(conversationId, newSK);
        SK = newSK;
      } catch (err) {
        console.error('[useWebSocket] X3DH receiver error:', err);
        dispatchMsg(conversationId, { id: msgId, senderId, plaintext: null, createdAt, isDecryptError: true });
        return;
      }
    }

    if (!SK) {
      dispatchMsg(conversationId, { id: msgId, senderId, plaintext: null, createdAt, isDecryptError: true });
      return;
    }

    const plaintext = await decryptMessage(ciphertext, iv, aad, SK);
    dispatchMsg(conversationId, { id: msgId, senderId, plaintext, createdAt, isDecryptError: plaintext === null });
  }

  // ─── Xử lý tin nhắn group đến ────────────────────────────────────────────────
  // SK được cache với key = `${groupId}:${senderId}` — tách biệt với SK của 1-1
  async function handleGroupIncoming(msg) {
    const { groupId, msgId, senderId, ciphertext, iv, aad, ekPub, opkId, ikPub, createdAt } = msg;
    const wKey    = wrappingKeyRef.current;
    const uid     = userIdRef.current;
    const cacheKey = `${groupId}:${senderId}`;

    let SK = sessionKeysRef.current.get(cacheKey) ?? null;
    if (!SK && wKey) {
      SK = await storage.loadSession(cacheKey, wKey);
      if (SK) sessionKeysRef.current.set(cacheKey, SK);
    }

    if (!SK && ekPub) {
      const ik  = IK_secretRef.current;
      const spk = SPK_privRef.current;
      if (!ik || !spk || !wKey) {
        dispatchGroupMsg(groupId, { id: msgId, senderId, plaintext: null, createdAt, isDecryptError: true });
        return;
      }
      try {
        const OPK_priv = await storage.getOPK(uid, opkId, wKey);
        if (!OPK_priv) {
          dispatchGroupMsg(groupId, { id: msgId, senderId, plaintext: null, createdAt, isDecryptError: true });
          return;
        }
        const { SK: newSK } = await performX3DH_receiver(
          { IK_secret: ik, SPK_priv: spk, OPK_priv },
          { ikPub, ekPub }
        );
        await storage.saveSession(cacheKey, newSK, wKey);
        await storage.deleteOPK(uid, opkId);
        sessionKeysRef.current.set(cacheKey, newSK);
        SK = newSK;
      } catch (err) {
        console.error('[useWebSocket] X3DH group receiver error:', err);
        dispatchGroupMsg(groupId, { id: msgId, senderId, plaintext: null, createdAt, isDecryptError: true });
        return;
      }
    }

    if (!SK) {
      dispatchGroupMsg(groupId, { id: msgId, senderId, plaintext: null, createdAt, isDecryptError: true });
      return;
    }

    const plaintext = await decryptMessage(ciphertext, iv, aad, SK);
    dispatchGroupMsg(groupId, { id: msgId, senderId, plaintext, createdAt, isDecryptError: plaintext === null });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────
  function dispatchMsg(conversationId, message) {
    newMsgCallbackRef.current?.({ conversationId, message });
  }

  function dispatchGroupMsg(groupId, message) {
    newGroupMsgCallbackRef.current?.({ groupId, message });
  }

  function onNewMessage(callback)      { newMsgCallbackRef.current      = callback; }
  function onNewGroupMessage(callback) { newGroupMsgCallbackRef.current  = callback; }
  function onKeyUploaded(callback)     { keyUploadedCallbackRef.current  = callback; }
  function onMessageDeleted(callback)  { messageDeletedCallbackRef.current = callback; }

  function reconnect() {
    if (token) connectSocket(token);
  }

  return {
    onlineUsers,
    isConnected,
    isSessionReplaced,
    onNewMessage,
    onNewGroupMessage,
    onKeyUploaded,
    onMessageDeleted,
    reconnect,
    sessionKeysRef,
  };
}
