import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import ConversationItem from './ConversationItem.jsx';
import GroupItem from './GroupItem.jsx';
import Avatar from './Avatar.jsx';
import ConfirmModal from './ConfirmModal.jsx';
import CreateGroupModal from './CreateGroupModal.jsx';
import * as api from '../services/api.js';
import { exportKeysToFile } from '../db/storage.js';

export default function ChatSidebar({
  conversations, activeConvId, onlineUsers,
  onSelectConv, onConvCreated, onDeleteConv, unreadCounts,
  groups, activeGroupId, onSelectGroup, onGroupCreated, unreadGroupCounts,
  username, userId, token, isConnected, onLogout, role,
}) {
  const navigate = useNavigate();
  const [tab, setTab]                     = useState('direct'); // 'direct' | 'groups'
  const [searchQuery, setSearchQuery]     = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching]     = useState(false);
  const [searchError, setSearchError]     = useState('');
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showCreateGroup, setShowCreateGroup]     = useState(false);
  const [exportError, setExportError]             = useState('');

  async function handleExportKeys() {
    setExportError('');
    try {
      await exportKeysToFile(userId);
    } catch (err) {
      setExportError(err.message);
    }
  }
  const debounceRef = useRef(null);

  function handleSearchInput(e) {
    const q = e.target.value;
    setSearchQuery(q);
    setSearchError('');
    clearTimeout(debounceRef.current);

    if (q.trim().length < 2) { setSearchResults([]); return; }

    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const { users } = await api.searchUsers(token, q.trim());
        setSearchResults(users);
      } catch (err) {
        setSearchError(err.message);
      } finally {
        setIsSearching(false);
      }
    }, 400);
  }

  async function handleSelectSearchResult(user) {
    setSearchQuery('');
    setSearchResults([]);
    try {
      const { conversationId } = await api.createConversation(token, user.id);
      const existing = conversations.find(c => c.conversationId === conversationId);
      if (existing) {
        onSelectConv(existing);
      } else {
        onConvCreated(conversationId, user.id);
      }
    } catch (err) {
      setSearchError(err.message);
    }
  }

  const isShowingSearch = tab === 'direct' && searchQuery.trim().length >= 2;

  return (
    <>
    <div className="w-72 shrink-0 flex flex-col bg-slate-900 h-full">

      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-slate-700/50">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <Avatar username={username} userId={userId} size="sm" />
            <div>
              <p className="text-sm font-semibold text-slate-100 leading-tight">{username}</p>
              <p className={`text-xs leading-tight flex items-center gap-1 ${isConnected ? 'text-emerald-400' : 'text-slate-500'}`}>
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                {isConnected ? 'Đã kết nối' : 'Đang kết nối...'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            {role === 'ADMIN' && (
              <button
                onClick={() => navigate('/admin')}
                title="Trang quản trị"
                className="text-slate-400 hover:text-purple-400 transition-colors p-1.5 rounded-lg hover:bg-slate-700/60"
              >
                <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            )}
            <button
              onClick={handleExportKeys}
              title="Xuất khóa bí mật ra file .e2ee"
              className="text-slate-400 hover:text-emerald-400 transition-colors p-1.5 rounded-lg hover:bg-slate-700/60"
            >
              <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </button>
            <button
              onClick={() => setShowLogoutConfirm(true)}
              title="Đăng xuất"
              className="text-slate-400 hover:text-red-400 transition-colors p-1.5 rounded-lg hover:bg-slate-700/60"
            >
              <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>

        {exportError && (
          <p className="text-xs text-red-400 bg-red-900/30 border border-red-700/40 rounded-lg px-2 py-1 mb-2">{exportError}</p>
        )}

        {/* Tab switcher */}
        <div className="flex rounded-xl bg-slate-800/80 p-1 gap-1">
          <button
            onClick={() => setTab('direct')}
            className={`flex-1 text-xs font-medium py-1.5 rounded-lg transition-colors
              ${tab === 'direct' ? 'bg-slate-600 text-slate-100 shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
          >
            Tin nhắn
          </button>
          <button
            onClick={() => setTab('groups')}
            className={`flex-1 text-xs font-medium py-1.5 rounded-lg transition-colors
              ${tab === 'groups' ? 'bg-slate-600 text-slate-100 shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
          >
            Nhóm {groups?.length > 0 && `(${groups.length})`}
          </button>
        </div>

        {/* Search / Tạo nhóm */}
        <div className="mt-2">
          {tab === 'direct' ? (
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={handleSearchInput}
                placeholder="Tìm người dùng..."
                className="w-full pl-9 pr-3 py-2 text-sm rounded-xl bg-slate-800/80 border border-slate-700/60
                  text-slate-100 placeholder-slate-500
                  focus:outline-none focus:ring-2 focus:ring-blue-500/70 focus:border-blue-500/50"
              />
              <svg className="w-4 h-4 text-slate-500 absolute left-2.5 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          ) : (
            <button
              onClick={() => setShowCreateGroup(true)}
              className="w-full flex items-center justify-center gap-2 py-2 text-sm font-medium
                text-blue-400 border border-blue-500/30 rounded-xl hover:bg-blue-500/10 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Tạo nhóm mới
            </button>
          )}
        </div>
      </div>

      {/* Danh sách */}
      <div className="flex-1 overflow-y-auto py-2">

        {/* Tab Direct */}
        {tab === 'direct' && (
          <>
            {isShowingSearch && (
              <div className="border-b border-slate-700/50 pb-2">
                {isSearching && <p className="text-xs text-slate-500 text-center py-3 animate-pulse">Đang tìm...</p>}
                {!isSearching && searchError && <p className="text-xs text-red-400 text-center py-3">{searchError}</p>}
                {!isSearching && !searchError && searchResults.length === 0 && (
                  <p className="text-xs text-slate-500 text-center py-3">Không tìm thấy ai</p>
                )}
                {!isSearching && searchResults.map(user => (
                  <button key={user.id} onClick={() => handleSelectSearchResult(user)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 mx-1 rounded-xl hover:bg-slate-700/60 transition-colors text-left">
                    <Avatar username={user.username} userId={user.id} size="sm" />
                    <span className="text-sm text-slate-200">{user.username}</span>
                  </button>
                ))}
              </div>
            )}
            {!isShowingSearch && conversations.length === 0 && (
              <p className="text-xs text-slate-500 text-center py-8 px-4">
                Chưa có cuộc trò chuyện nào.<br />Tìm người dùng để bắt đầu.
              </p>
            )}
            {!isShowingSearch && conversations.map(conv => (
              <ConversationItem
                key={conv.conversationId}
                conv={conv}
                isActive={conv.conversationId === activeConvId}
                isOnline={onlineUsers.has(conv.peer.id)}
                onClick={() => onSelectConv(conv)}
                onDeleteConv={() => onDeleteConv(conv.conversationId)}
                unreadCount={unreadCounts?.get(conv.conversationId) ?? 0}
              />
            ))}
          </>
        )}

        {/* Tab Groups */}
        {tab === 'groups' && (
          <>
            {(!groups || groups.length === 0) && (
              <p className="text-xs text-slate-500 text-center py-8 px-4">
                Chưa có nhóm nào.<br />Tạo nhóm mới để bắt đầu.
              </p>
            )}
            {groups?.map(group => (
              <GroupItem
                key={group.groupId}
                group={group}
                isActive={group.groupId === activeGroupId}
                onClick={() => onSelectGroup(group)}
                unreadCount={unreadGroupCounts?.get(group.groupId) ?? 0}
              />
            ))}
          </>
        )}
      </div>
    </div>

    {showLogoutConfirm && (
      <ConfirmModal
        title="Đăng xuất?"
        body="Bạn sẽ cần nhập lại mật khẩu để mở khóa khóa riêng tư và tiếp tục nhắn tin."
        confirmLabel="Đăng xuất"
        onConfirm={() => { setShowLogoutConfirm(false); onLogout(); }}
        onCancel={() => setShowLogoutConfirm(false)}
      />
    )}

    {showCreateGroup && (
      <CreateGroupModal
        token={token}
        currentUserId={userId}
        onClose={() => setShowCreateGroup(false)}
        onCreated={(group) => { setShowCreateGroup(false); onGroupCreated(group); }}
      />
    )}
    </>
  );
}
