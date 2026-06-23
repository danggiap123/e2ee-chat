import { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { useMessages } from '../hooks/useMessages.js';
import * as api from '../services/api.js';
import * as storage from '../db/storage.js';
import { performX3DH_sender } from '../crypto/x3dh.js';
import { encryptMessage, encryptBytes, encryptBytesWithRandomKey, decryptBytes, decryptBytesWithKey } from '../crypto/aesGcm.js';
import { toBase64 } from '../crypto/keyGen.js';
import ChatSidebar from '../components/ChatSidebar.jsx';
import MessageList from '../components/MessageList.jsx';
import MessageInput from '../components/MessageInput.jsx';
import FingerprintModal from '../components/FingerprintModal.jsx';
import ConfirmModal from '../components/ConfirmModal.jsx';
import GroupInfoPanel from '../components/GroupInfoPanel.jsx';

export default function Chat() {
  const { token, userId, username, role, IK_secret, IK_pub, wrappingKey, logout } = useAuth();

  // ─── State 1-1 ───────────────────────────────────────────────────────────────
  const [conversations,   setConversations]   = useState([]);
  const [activeConvId,    setActiveConvId]    = useState(null);
  const [activePeer,      setActivePeer]      = useState(null);
  const [isVerified,      setIsVerified]      = useState(false);
  const [showFingerprint, setShowFingerprint] = useState(false);
  const [unreadCounts,    setUnreadCounts]    = useState(new Map());

  // ─── State group ──────────────────────────────────────────────────────────────
  const [groups,            setGroups]            = useState([]);
  const [activeGroupId,     setActiveGroupId]     = useState(null);
  const [activeGroup,       setActiveGroup]       = useState(null); // { groupId, name, members, adminId, ... }
  const [unreadGroupCounts, setUnreadGroupCounts] = useState(new Map());
  const [showGroupInfo,     setShowGroupInfo]     = useState(false);

  // ─── State chung ─────────────────────────────────────────────────────────────
  const [isSending,    setIsSending]    = useState(false);
  const [sendError,    setSendError]    = useState('');
  const [replyTo,      setReplyTo]      = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);

  // ─── Hooks ───────────────────────────────────────────────────────────────────
  const {
    onlineUsers, isConnected, isSessionReplaced,
    onNewMessage, onNewGroupMessage, onKeyUploaded, onMessageDeleted,
    onGroupMemberAdded, onGroupMemberRemoved, onGroupAdminTransferred, onGroupSystemMessage,
    reconnect, sessionKeysRef,
  } = useWebSocket();

  const { messages, isLoading, hasMore, loadMore, addMessage, removeMessage } =
    useMessages(activeConvId, sessionKeysRef, activeGroupId);

  // ─── Load dữ liệu khi vào trang ──────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    api.listConversations(token)
      .then(({ conversations: list }) => setConversations(list))
      .catch(err => console.error('[Chat] listConversations:', err));
    api.listGroups(token)
      .then(({ groups: list }) => setGroups(list))
      .catch(err => console.error('[Chat] listGroups:', err));
  }, [token]);

  // ─── Refs chống stale closure ─────────────────────────────────────────────────
  const activeConvIdRef   = useRef(activeConvId);
  const activeGroupIdRef  = useRef(activeGroupId);
  const activeGroupRef    = useRef(activeGroup);
  const addMessageRef     = useRef(addMessage);
  const removeMessageRef  = useRef(removeMessage);
  useEffect(() => { activeConvIdRef.current  = activeConvId;  }, [activeConvId]);
  useEffect(() => { activeGroupIdRef.current = activeGroupId; }, [activeGroupId]);
  useEffect(() => { activeGroupRef.current   = activeGroup;   }, [activeGroup]);
  useEffect(() => { addMessageRef.current    = addMessage;    }, [addMessage]);
  useEffect(() => { removeMessageRef.current = removeMessage; }, [removeMessage]);

  // ─── Callbacks WebSocket ──────────────────────────────────────────────────────
  useEffect(() => {
    onKeyUploaded(({ userId: uid, ikPub }) => {
      setConversations(prev =>
        prev.map(c => c.peer.id === uid ? { ...c, peer: { ...c.peer, ikPub } } : c)
      );
      setActivePeer(prev => prev?.id === uid ? { ...prev, ikPub } : prev);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onMessageDeleted(({ messageId, conversationId, groupId }) => {
      if (conversationId && conversationId === activeConvIdRef.current) {
        removeMessageRef.current?.(messageId);
      } else if (groupId && groupId === activeGroupIdRef.current) {
        removeMessageRef.current?.(messageId);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Tin 1-1 đến real-time
  useEffect(() => {
    onNewMessage(({ conversationId, message }) => {
      if (conversationId === activeConvIdRef.current) {
        addMessageRef.current?.(message);
      } else {
        setUnreadCounts(prev => {
          const m = new Map(prev);
          m.set(conversationId, (m.get(conversationId) ?? 0) + 1);
          return m;
        });
      }
      setConversations(prev => {
        const idx = prev.findIndex(c => c.conversationId === conversationId);
        if (idx === -1) return prev;
        const updated = { ...prev[idx], lastMessageAt: message.createdAt };
        return [updated, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
      });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Tin group đến real-time
  useEffect(() => {
    onNewGroupMessage(({ groupId, message }) => {
      if (groupId === activeGroupIdRef.current) {
        addMessageRef.current?.(message);
      } else {
        setUnreadGroupCounts(prev => {
          const m = new Map(prev);
          m.set(groupId, (m.get(groupId) ?? 0) + 1);
          return m;
        });
      }
      setGroups(prev => {
        const idx = prev.findIndex(g => g.groupId === groupId);
        if (idx === -1) return prev;
        const updated = { ...prev[idx], lastMessageAt: message.createdAt };
        return [updated, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
      });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Thành viên mới được thêm vào nhóm
  useEffect(() => {
    onGroupMemberAdded(({ groupId, member, group: groupPayload }) => {
      // Cập nhật danh sách thành viên nếu đang xem nhóm này
      if (groupId === activeGroupIdRef.current) {
        setActiveGroup(prev => {
          if (!prev) return prev;
          if (prev.members.some(m => m.id === member.id)) return prev;
          return { ...prev, members: [...prev.members, member] };
        });
      }
      // Nếu mình vừa được thêm vào nhóm → thêm nhóm vào sidebar
      setGroups(prev => {
        const exists = prev.some(g => g.groupId === groupId);
        if (exists) {
          // Cập nhật members của nhóm đã có
          return prev.map(g => g.groupId === groupId
            ? { ...g, members: g.members.some(m => m.id === member.id) ? g.members : [...g.members, member] }
            : g
          );
        }
        // Nhóm chưa có → thêm mới (mình là người được thêm vào)
        return [groupPayload, ...prev];
      });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Thành viên bị xóa hoặc tự rời khỏi nhóm
  useEffect(() => {
    onGroupMemberRemoved(({ groupId, userId: removedUserId, newAdminId }) => {
      const isMeRemoved = removedUserId === userId;

      if (isMeRemoved) {
        // Mình bị xóa hoặc tự rời → xóa nhóm khỏi sidebar, thoát về màn hình chờ
        setGroups(prev => prev.filter(g => g.groupId !== groupId));
        if (groupId === activeGroupIdRef.current) {
          setActiveGroupId(null);
          setActiveGroup(null);
          setShowGroupInfo(false);
        }
        return;
      }

      // Người khác bị xóa → cập nhật danh sách thành viên
      if (groupId === activeGroupIdRef.current) {
        setActiveGroup(prev => {
          if (!prev) return prev;
          const updated = { ...prev, members: prev.members.filter(m => m.id !== removedUserId) };
          // Nếu admin vừa rời + có newAdminId → cập nhật adminId
          if (newAdminId) updated.adminId = newAdminId;
          return updated;
        });
      }
      setGroups(prev => prev.map(g => {
        if (g.groupId !== groupId) return g;
        const updatedMembers = g.members.filter(m => m.id !== removedUserId);
        return { ...g, members: updatedMembers, ...(newAdminId && { adminId: newAdminId }) };
      }));
    });
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Quyền admin được chuyển (không kèm rời nhóm)
  useEffect(() => {
    onGroupAdminTransferred(({ groupId, newAdminId }) => {
      if (groupId === activeGroupIdRef.current) {
        setActiveGroup(prev => prev ? { ...prev, adminId: newAdminId } : prev);
      }
      setGroups(prev => prev.map(g => g.groupId === groupId ? { ...g, adminId: newAdminId } : g));
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Tin hệ thống đến real-time → thêm vào message list nếu đang xem nhóm đó
  useEffect(() => {
    onGroupSystemMessage(({ groupId, message: sysMsg }) => {
      if (groupId === activeGroupIdRef.current) {
        addMessageRef.current?.({
          id: sysMsg.id,
          senderId: sysMsg.senderId,
          plaintext: null,
          createdAt: sysMsg.createdAt,
          isSystem: true,
          systemText: sysMsg.systemText,
          isDecryptError: false,
        });
      }
      setGroups(prev => {
        const idx = prev.findIndex(g => g.groupId === groupId);
        if (idx === -1) return prev;
        const updated = { ...prev[idx], lastMessageAt: sysMsg.createdAt };
        return [updated, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
      });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Chọn conversation 1-1 ───────────────────────────────────────────────────
  function handleSelectConv(conv) {
    setActiveConvId(conv.conversationId);
    setActivePeer(conv.peer);
    setIsVerified(conv.fingerprintVerified);
    setActiveGroupId(null);
    setActiveGroup(null);
    setSendError('');
    setReplyTo(null);
    setUnreadCounts(prev => {
      if (!prev.has(conv.conversationId)) return prev;
      const m = new Map(prev); m.delete(conv.conversationId); return m;
    });
    setConversations(prev => {
      if (prev.find(c => c.conversationId === conv.conversationId)) return prev;
      return [conv, ...prev];
    });
  }

  async function handleConvCreated(conversationId, peerId) {
    try {
      const { conversations: fresh } = await api.listConversations(token);
      setConversations(fresh);
      const conv = fresh.find(c => c.conversationId === conversationId);
      if (conv) handleSelectConv(conv);
    } catch (err) {
      console.error('[Chat] handleConvCreated:', err);
    }
  }

  // ─── Chọn group ───────────────────────────────────────────────────────────────
  async function handleSelectGroup(group) {
    setActiveGroupId(group.groupId);
    setActiveGroup(group);
    setActiveConvId(null);
    setActivePeer(null);
    setSendError('');
    setReplyTo(null);
    setShowGroupInfo(false);
    setUnreadGroupCounts(prev => {
      if (!prev.has(group.groupId)) return prev;
      const m = new Map(prev); m.delete(group.groupId); return m;
    });
    // Load members đầy đủ (ikPub + isVerifiedByMe) để hiển thị badge + shield icon
    try {
      const { members } = await api.getGroupMembers(token, group.groupId);
      setActiveGroup(prev => prev ? { ...prev, members } : prev);
    } catch (err) {
      console.error('[Chat] getGroupMembers:', err);
    }
  }

  function handleGroupCreated(group) {
    setGroups(prev => [group, ...prev]);
    handleSelectGroup(group);
  }

  // Callbacks từ GroupInfoPanel — cập nhật local state ngay (WS event cũng đến nhưng idempotent)
  function handlePanelMemberAdded(member) {
    setActiveGroup(prev => {
      if (!prev || prev.members.some(m => m.id === member.id)) return prev;
      return { ...prev, members: [...prev.members, member] };
    });
  }

  function handlePanelMemberRemoved(removedId) {
    setActiveGroup(prev => prev ? { ...prev, members: prev.members.filter(m => m.id !== removedId) } : prev);
  }

  function handlePanelAdminTransferred(newAdminId) {
    setActiveGroup(prev => prev ? { ...prev, adminId: newAdminId } : prev);
    setGroups(prev => prev.map(g => g.groupId === activeGroupId ? { ...g, adminId: newAdminId } : g));
  }

  function handlePanelLeftGroup() {
    setShowGroupInfo(false);
    setGroups(prev => prev.filter(g => g.groupId !== activeGroupId));
    setActiveGroupId(null);
    setActiveGroup(null);
  }

  // ─── Lấy hoặc tạo SK cho 1-1 ─────────────────────────────────────────────────
  async function getOrCreateSK(conversationId, peerId) {
    const cached = sessionKeysRef.current.get(conversationId);
    if (cached) return { SK: cached };

    // Nếu loadSession throw (wrappingKey không khớp session cũ) → xóa session hỏng, tạo lại
    let stored = null;
    try {
      stored = await storage.loadSession(conversationId, wrappingKey);
    } catch {
      await storage.deleteSession(conversationId);
    }
    if (stored) { sessionKeysRef.current.set(conversationId, stored); return { SK: stored }; }

    const bundle = await api.fetchKeyBundle(token, peerId);
    const { SK, EK_pub, OPK_id, IK_pub: myIKPub } = await performX3DH_sender(
      { IK_secret, IK_pub }, bundle
    );
    await storage.saveSession(conversationId, SK, wrappingKey);
    sessionKeysRef.current.set(conversationId, SK);
    return { SK, ekPub: toBase64(EK_pub), opkId: OPK_id, ikPub: toBase64(myIKPub) };
  }

  // ─── Lấy hoặc tạo SK cho group (per recipient) ───────────────────────────────
  // cacheKey = `${groupId}:${recipientId}` — tách biệt với SK 1-1
  async function getOrCreateGroupSK(groupId, recipientId) {
    const cacheKey = `${groupId}:${recipientId}`;
    const cached = sessionKeysRef.current.get(cacheKey);
    if (cached) return { SK: cached };

    let stored = null;
    try {
      stored = await storage.loadSession(cacheKey, wrappingKey);
    } catch {
      await storage.deleteSession(cacheKey);
    }
    if (stored) { sessionKeysRef.current.set(cacheKey, stored); return { SK: stored }; }

    const bundle = await api.fetchKeyBundle(token, recipientId);
    const { SK, EK_pub, OPK_id, IK_pub: myIKPub } = await performX3DH_sender(
      { IK_secret, IK_pub }, bundle
    );
    await storage.saveSession(cacheKey, SK, wrappingKey);
    sessionKeysRef.current.set(cacheKey, SK);
    return { SK, ekPub: toBase64(EK_pub), opkId: OPK_id, ikPub: toBase64(myIKPub) };
  }

  // ─── Gửi tin 1-1 ─────────────────────────────────────────────────────────────
  async function handleSend(text) {
    if (!activeConvId || !activePeer || isSending) return;
    setSendError('');
    setIsSending(true);
    const currentReply = replyTo;
    const payload = currentReply
      ? JSON.stringify({ t: text, r: { id: currentReply.id, u: currentReply.senderUsername, p: currentReply.preview.slice(0, 100) } })
      : text;
    setReplyTo(null);
    try {
      const { SK, ekPub, opkId, ikPub } = await getOrCreateSK(activeConvId, activePeer.id);
      const { ciphertext, iv, aad } = await encryptMessage(payload, SK, activeConvId, userId);
      const { messageId, createdAt } = await api.sendMessage(token, {
        conversationId: activeConvId, ciphertext, iv, aad, ekPub, opkId, ikPub,
      });
      addMessage({ id: messageId, senderId: userId, plaintext: payload, createdAt, isDecryptError: false });
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

  // ─── Gửi tin group ────────────────────────────────────────────────────────────
  // Encrypt N lần — mỗi thành viên nhận 1 bản mã riêng
  async function handleSendGroup(text) {
    if (!activeGroupId || !activeGroup || isSending) return;
    setSendError('');
    setIsSending(true);
    // Lấy replyTo và clear ngay — giống handleSend 1-1
    const currentReply = replyTo;
    const payload = currentReply
      ? JSON.stringify({ t: text, r: { id: currentReply.id, u: currentReply.senderUsername, p: currentReply.preview.slice(0, 100) } })
      : text;
    setReplyTo(null);
    try {
      const otherMembers = activeGroup.members.filter(m => m.id !== userId);
      if (otherMembers.length === 0) {
        setSendError('Nhóm không có thành viên nào khác');
        return;
      }

      // Encrypt song song cho tất cả thành viên
      const recipients = await Promise.all(otherMembers.map(async (member) => {
        const { SK, ekPub, opkId, ikPub } = await getOrCreateGroupSK(activeGroupId, member.id);
        // AAD = `${groupId}:${senderId}` — dùng groupId thay conversationId
        const { ciphertext, iv, aad } = await encryptMessage(payload, SK, activeGroupId, userId);
        return { userId: member.id, ciphertext, iv, aad, ekPub, opkId, ikPub };
      }));

      const { messageId, createdAt } = await api.sendGroupMessage(token, {
        groupId: activeGroupId, recipients,
      });

      // Dùng messageId thật từ server — tránh tempId không xóa được
      addMessage({ id: messageId, senderId: userId, plaintext: payload, createdAt, isDecryptError: false });

      setGroups(prev => {
        const idx = prev.findIndex(g => g.groupId === activeGroupId);
        if (idx === -1) return prev;
        const updated = { ...prev[idx], lastMessageAt: createdAt };
        return [updated, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
      });
    } catch (err) {
      console.error('[Chat] handleSendGroup error:', err);
      setSendError('Không thể gửi tin nhóm: ' + err.message);
    } finally {
      setIsSending(false);
    }
  }

  // ─── Gửi file/ảnh 1-1 ────────────────────────────────────────────────────────
  // File được mã hóa bằng SK của conversation → upload lên server → gửi message chứa metadata
  async function handleSendFile(file) {
    if (!activeConvId || !activePeer || isSending) return;
    setSendError('');
    setIsSending(true);
    try {
      const { SK, ekPub, opkId, ikPub } = await getOrCreateSK(activeConvId, activePeer.id);

      const { encryptedBytes, fileIv } = await encryptBytes(
        new Uint8Array(await file.arrayBuffer()), SK
      );
      const { fileId } = await api.uploadFile(token, encryptedBytes);

      const type = file.type.startsWith('image/') ? 'image' : 'file';
      // fileKey không có — receiver dùng SK của conversation để decrypt
      const filePayload = JSON.stringify({
        type, fileId, fileName: file.name, mimeType: file.type, fileSize: file.size, fileIv,
      });

      const { ciphertext, iv, aad } = await encryptMessage(filePayload, SK, activeConvId, userId);
      const { messageId, createdAt } = await api.sendMessage(token, {
        conversationId: activeConvId, ciphertext, iv, aad, ekPub, opkId, ikPub,
      });

      addMessage({ id: messageId, senderId: userId, plaintext: filePayload, createdAt, isDecryptError: false });
      setConversations(prev => {
        const idx = prev.findIndex(c => c.conversationId === activeConvId);
        if (idx === -1) return prev;
        const updated = { ...prev[idx], lastMessageAt: createdAt };
        return [updated, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
      });
    } catch (err) {
      console.error('[Chat] handleSendFile:', err);
      setSendError('Không thể gửi file: ' + err.message);
    } finally {
      setIsSending(false);
    }
  }

  // ─── Gửi file/ảnh group ───────────────────────────────────────────────────────
  // Upload 1 bản mã duy nhất (dùng random fileKey), gửi fileKey trong message payload của từng người
  async function handleSendGroupFile(file) {
    if (!activeGroupId || !activeGroup || isSending) return;
    setSendError('');
    setIsSending(true);
    try {
      const otherMembers = activeGroup.members.filter(m => m.id !== userId);
      if (otherMembers.length === 0) {
        setSendError('Nhóm không có thành viên nào khác');
        return;
      }

      const { encryptedBytes, fileIv, fileKey } = await encryptBytesWithRandomKey(
        new Uint8Array(await file.arrayBuffer())
      );
      const { fileId } = await api.uploadFile(token, encryptedBytes);

      const type = file.type.startsWith('image/') ? 'image' : 'file';
      const recipients = await Promise.all(otherMembers.map(async (member) => {
        const { SK, ekPub, opkId, ikPub } = await getOrCreateGroupSK(activeGroupId, member.id);
        // fileKey được bọc trong message payload → mã hóa bằng SK của từng người
        const filePayload = JSON.stringify({
          type, fileId, fileName: file.name, mimeType: file.type, fileSize: file.size, fileIv, fileKey,
        });
        const { ciphertext, iv, aad } = await encryptMessage(filePayload, SK, activeGroupId, userId);
        return { userId: member.id, ciphertext, iv, aad, ekPub, opkId, ikPub };
      }));

      const { messageId, createdAt } = await api.sendGroupMessage(token, { groupId: activeGroupId, recipients });

      const displayPayload = JSON.stringify({
        type, fileId, fileName: file.name, mimeType: file.type, fileSize: file.size, fileIv, fileKey,
      });
      addMessage({ id: messageId, senderId: userId, plaintext: displayPayload, createdAt, isDecryptError: false });

      setGroups(prev => {
        const idx = prev.findIndex(g => g.groupId === activeGroupId);
        if (idx === -1) return prev;
        const updated = { ...prev[idx], lastMessageAt: createdAt };
        return [updated, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
      });
    } catch (err) {
      console.error('[Chat] handleSendGroupFile:', err);
      setSendError('Không thể gửi file nhóm: ' + err.message);
    } finally {
      setIsSending(false);
    }
  }

  // ─── Download + giải mã file ──────────────────────────────────────────────────
  // fileInfo: { type, fileId, fileName, mimeType, fileSize, fileIv, fileKey? }
  // senderId: dùng để tìm SK đúng trong group (cacheKey = groupId:senderId)
  // Return: Blob URL (caller tạo link download hoặc dùng làm img src)
  async function handleDownloadFile(fileInfo, senderId) {
    const { fileId, fileIv, fileKey, mimeType, fileName } = fileInfo;
    const encryptedBytes = await api.downloadFile(token, fileId);

    let decryptedBytes;
    if (fileKey) {
      // Group: dùng fileKey random nằm trong message payload
      decryptedBytes = await decryptBytesWithKey(encryptedBytes, fileIv, fileKey);
    } else {
      // 1-1: dùng SK của conversation
      let SK = sessionKeysRef.current.get(activeConvId);
      if (!SK) {
        SK = await storage.loadSession(activeConvId, wrappingKey);
        if (SK) sessionKeysRef.current.set(activeConvId, SK);
      }
      if (!SK) throw new Error('Session key không tồn tại');
      decryptedBytes = await decryptBytes(encryptedBytes, fileIv, SK);
    }

    if (!decryptedBytes) throw new Error('Giải mã file thất bại');

    const blob = new Blob([decryptedBytes], { type: mimeType || 'application/octet-stream' });
    return URL.createObjectURL(blob);
  }

  // ─── Xóa tin nhắn / conversation ─────────────────────────────────────────────
  // fileInfo: { fileId, ... } | null — truyền từ MessageList khi xóa tin file/ảnh
  function handleDeleteMessage(msgId, fileInfo = null) {
    setConfirmModal({ type: 'deleteMessage', id: msgId, fileInfo });
  }

  async function doDeleteMessage(msgId, fileInfo) {
    setConfirmModal(null);
    try {
      // Nếu là tin file/ảnh → xóa file trên server trước (best-effort, không block nếu lỗi)
      if (fileInfo?.fileId) {
        await api.deleteFile(token, fileInfo.fileId).catch(err =>
          console.warn('[Chat] deleteFile (non-fatal):', err)
        );
      }
      await api.deleteMessage(token, msgId);
      removeMessage(msgId);
    } catch (err) { console.error('[Chat] deleteMessage:', err); }
  }

  function handleDeleteConv(convId) { setConfirmModal({ type: 'deleteConv', id: convId }); }

  async function doDeleteConv(convId) {
    setConfirmModal(null);
    try {
      await api.deleteConversation(token, convId);
      setConversations(prev => prev.filter(c => c.conversationId !== convId));
      if (activeConvId === convId) {
        setActiveConvId(null); setActivePeer(null); setIsVerified(false); setReplyTo(null);
      }
    } catch (err) { console.error('[Chat] deleteConversation:', err); }
  }

  function handleVerified() {
    setIsVerified(true);
    setShowFingerprint(false);
    setConversations(prev =>
      prev.map(c => c.conversationId === activeConvId ? { ...c, fingerprintVerified: true } : c)
    );
    // Đồng bộ sang group đang mở nếu peer là thành viên
    if (activePeer) {
      setActiveGroup(prev => {
        if (!prev) return prev;
        if (!prev.members.some(m => m.id === activePeer.id)) return prev;
        return {
          ...prev,
          members: prev.members.map(m =>
            m.id === activePeer.id ? { ...m, isVerifiedByMe: true } : m
          ),
        };
      });
    }
  }

  // Sau khi verify 1 member trong group → cập nhật isVerifiedByMe trong activeGroup
  // + đồng bộ fingerprintVerified trong conversations 1-1 nếu có
  function handlePanelMemberVerified(peerId) {
    setActiveGroup(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        members: prev.members.map(m =>
          m.id === peerId ? { ...m, isVerifiedByMe: true } : m
        ),
      };
    });
    setConversations(prev =>
      prev.map(c => c.peer?.id === peerId ? { ...c, fingerprintVerified: true } : c)
    );
    if (activePeer?.id === peerId) setIsVerified(true);
  }

  // ─── peersMap cho MessageList hiển thị tên sender ────────────────────────────
  const peersMap = useMemo(() => {
    const m = new Map();
    if (activeGroupId && activeGroup) {
      activeGroup.members.forEach(member => m.set(member.id, { id: member.id, username: member.username }));
    } else if (activePeer) {
      m.set(activePeer.id, activePeer);
    }
    return m;
  }, [activePeer, activeGroup, activeGroupId]);

  const isGroupActive = !!activeGroupId && !!activeGroup;
  const isDirectActive = !!activeConvId && !!activePeer;

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen bg-slate-100 overflow-hidden">
      <ChatSidebar
        conversations={conversations}
        activeConvId={activeConvId}
        onlineUsers={onlineUsers}
        onSelectConv={handleSelectConv}
        onConvCreated={handleConvCreated}
        onDeleteConv={handleDeleteConv}
        unreadCounts={unreadCounts}
        groups={groups}
        activeGroupId={activeGroupId}
        onSelectGroup={handleSelectGroup}
        onGroupCreated={handleGroupCreated}
        unreadGroupCounts={unreadGroupCounts}
        username={username}
        userId={userId}
        token={token}
        isConnected={isConnected}
        onLogout={logout}
        role={role}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* ── Chat 1-1 ── */}
        {isDirectActive && (
          <>
            <div className="bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between shadow-sm">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-semibold"
                    style={{ backgroundColor: `hsl(${[...activePeer.id].reduce((a,c) => a + c.charCodeAt(0), 0) % 360}, 55%, 42%)` }}>
                    {activePeer.username.slice(0, 2).toUpperCase()}
                  </div>
                  {onlineUsers.has(activePeer.id) && (
                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 border-white" />
                  )}
                </div>
                <div>
                  <p className="font-semibold text-slate-900 text-sm">{activePeer.username}</p>
                  <p className={`text-xs flex items-center gap-1 ${onlineUsers.has(activePeer.id) ? 'text-emerald-500' : 'text-slate-400'}`}>
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${onlineUsers.has(activePeer.id) ? 'bg-emerald-400' : 'bg-slate-300'}`} />
                    {onlineUsers.has(activePeer.id) ? 'Đang hoạt động' : 'Không hoạt động'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {isVerified ? (
                  <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-3 py-1 flex items-center gap-1.5 font-medium">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    E2EE · Đã xác minh
                  </span>
                ) : (
                  <button onClick={() => setShowFingerprint(true)}
                    className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-3 py-1 hover:bg-amber-100 transition-colors flex items-center gap-1.5 font-medium">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    Xác minh danh tính
                  </button>
                )}
              </div>
            </div>

            {sendError && (
              <div className="bg-red-50 text-red-600 text-xs text-center py-2 px-4 border-b border-red-100">
                {sendError}
                <button onClick={() => setSendError('')} className="ml-2 underline">Đóng</button>
              </div>
            )}

            <MessageList
              messages={messages} userId={userId} myUsername={username}
              isLoading={isLoading} hasMore={hasMore} onLoadMore={loadMore}
              peers={peersMap} onDeleteMessage={handleDeleteMessage} onReply={setReplyTo}
              onDownloadFile={handleDownloadFile}
            />
            {activePeer?.isActive === false ? (
              <div className="px-4 py-3.5 bg-slate-100 border-t border-slate-200 text-center text-sm text-slate-500 flex items-center justify-center gap-2">
                <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
                Người dùng này đã không còn trong tổ chức. Không thể gửi tin nhắn mới.
              </div>
            ) : (
              <MessageInput
                onSend={handleSend} onSendFile={handleSendFile} isSending={isSending}
                disabled={false} replyTo={replyTo} onCancelReply={() => setReplyTo(null)}
              />
            )}
          </>
        )}

        {/* ── Chat nhóm ── */}
        {isGroupActive && (
          <>
            <div className="bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between shadow-sm">
              <button
                onClick={() => setShowGroupInfo(v => !v)}
                className="flex items-center gap-3 hover:bg-slate-50 rounded-xl px-2 py-1 -ml-2 transition-colors"
              >
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm font-bold"
                  style={{ backgroundColor: `hsl(${[...activeGroup.name].reduce((a,c) => a + c.charCodeAt(0), 0) % 360}, 55%, 42%)` }}>
                  {activeGroup.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="text-left">
                  <p className="font-semibold text-slate-900 text-sm">{activeGroup.name}</p>
                  <p className="text-xs text-slate-400">{activeGroup.members?.length ?? 0} thành viên · Nhấn để xem</p>
                </div>
              </button>
              {(() => {
                const others = activeGroup.members.filter(m => m.id !== userId);
                const verified = others.filter(m => m.isVerifiedByMe).length;
                const allOk = others.length > 0 && verified === others.length;
                return allOk ? (
                  <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-3 py-1 flex items-center gap-1.5 font-medium">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    E2EE · Tất cả đã xác minh
                  </span>
                ) : (
                  <button
                    onClick={() => setShowGroupInfo(true)}
                    className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-3 py-1 hover:bg-amber-100 transition-colors flex items-center gap-1.5 font-medium"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    E2EE · {verified}/{others.length} đã xác minh
                  </button>
                );
              })()}
            </div>

            {sendError && (
              <div className="bg-red-50 text-red-600 text-xs text-center py-2 px-4 border-b border-red-100">
                {sendError}
                <button onClick={() => setSendError('')} className="ml-2 underline">Đóng</button>
              </div>
            )}

            <MessageList
              messages={messages} userId={userId} myUsername={username}
              isLoading={isLoading} hasMore={hasMore} onLoadMore={loadMore}
              peers={peersMap} onDeleteMessage={handleDeleteMessage} onReply={setReplyTo}
              onDownloadFile={handleDownloadFile}
            />
            <MessageInput
              onSend={handleSendGroup} onSendFile={handleSendGroupFile} isSending={isSending}
              disabled={false} replyTo={replyTo} onCancelReply={() => setReplyTo(null)}
            />
          </>
        )}

        {/* ── Màn hình chờ ── */}
        {!isDirectActive && !isGroupActive && (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-4">
            <div className="w-20 h-20 rounded-2xl bg-slate-200 flex items-center justify-center">
              <svg className="w-10 h-10 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <div>
              <p className="text-slate-700 font-semibold text-base">Chọn một cuộc trò chuyện</p>
              <p className="text-sm text-slate-400 mt-1 max-w-xs">
                Chọn tin nhắn 1-1 hoặc nhóm ở sidebar để bắt đầu nhắn tin.
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-400 bg-slate-200/60 rounded-full px-3 py-1.5">
              <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              Mã hóa đầu cuối · Blind Server
            </div>
          </div>
        )}
      </div>

      {/* Fingerprint Modal */}
      {showFingerprint && IK_pub && activePeer?.ikPub && (
        <FingerprintModal
          myIKPub={IK_pub} peerIKPub={activePeer.ikPub}
          peerUsername={activePeer.username}
          onClose={() => setShowFingerprint(false)}
          onVerified={handleVerified}
          onConfirm={() => api.verifyPeer(token, activePeer.id)}
        />
      )}
      {showFingerprint && !activePeer?.ikPub && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm text-center space-y-4">
            <p className="text-gray-700">
              <span className="font-medium">{activePeer?.username}</span> chưa upload public key.
            </p>
            <button onClick={() => setShowFingerprint(false)}
              className="px-6 py-2 bg-gray-100 rounded-xl text-sm font-medium hover:bg-gray-200">Đóng</button>
          </div>
        </div>
      )}

      {/* Session replaced overlay */}
      {isSessionReplaced && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm text-center space-y-4">
            <p className="font-semibold text-gray-900">Phiên đăng nhập bị thay thế</p>
            <p className="text-sm text-gray-500">Tab này không còn nhận được tin nhắn mới.</p>
            <button onClick={reconnect}
              className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700">
              Kết nối lại
            </button>
          </div>
        </div>
      )}

      {confirmModal?.type === 'deleteMessage' && (
        <ConfirmModal title="Xóa tin nhắn?" body="Tin nhắn sẽ bị xóa vĩnh viễn."
          confirmLabel="Xóa" danger
          onConfirm={() => doDeleteMessage(confirmModal.id, confirmModal.fileInfo)}
          onCancel={() => setConfirmModal(null)} />
      )}
      {confirmModal?.type === 'deleteConv' && (
        <ConfirmModal title="Xóa cuộc trò chuyện?" body="Toàn bộ lịch sử sẽ bị xóa vĩnh viễn."
          confirmLabel="Xóa" danger
          onConfirm={() => doDeleteConv(confirmModal.id)}
          onCancel={() => setConfirmModal(null)} />
      )}

      {/* GroupInfoPanel — slide in từ phải khi click tên nhóm */}
      {showGroupInfo && isGroupActive && (
        <GroupInfoPanel
          group={activeGroup}
          currentUserId={userId}
          myIKPub={IK_pub}
          token={token}
          onClose={() => setShowGroupInfo(false)}
          onMemberAdded={handlePanelMemberAdded}
          onMemberRemoved={handlePanelMemberRemoved}
          onAdminTransferred={handlePanelAdminTransferred}
          onLeftGroup={handlePanelLeftGroup}
          onMemberVerified={handlePanelMemberVerified}
        />
      )}
    </div>
  );
}
