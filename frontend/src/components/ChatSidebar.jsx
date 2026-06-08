import { useState, useRef } from 'react';
import ConversationItem from './ConversationItem.jsx';
import GroupItem from './GroupItem.jsx';
import Avatar from './Avatar.jsx';
import ConfirmModal from './ConfirmModal.jsx';
import CreateGroupModal from './CreateGroupModal.jsx';
import * as api from '../services/api.js';

export default function ChatSidebar({
  conversations, activeConvId, onlineUsers,
  onSelectConv, onConvCreated, onDeleteConv, unreadCounts,
  groups, activeGroupId, onSelectGroup, onGroupCreated, unreadGroupCounts,
  username, userId, token, isConnected, onLogout,
}) {
  const [tab, setTab]                     = useState('direct'); // 'direct' | 'groups'
  const [searchQuery, setSearchQuery]     = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching]     = useState(false);
  const [searchError, setSearchError]     = useState('');
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showCreateGroup, setShowCreateGroup]     = useState(false);
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
    <div className="w-72 shrink-0 flex flex-col border-r border-gray-200 bg-white h-full">

      {/* Header: avatar + logout */}
      <div className="px-4 pt-4 pb-3 border-b border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Avatar username={username} userId={userId} size="sm" />
            <div>
              <p className="text-sm font-semibold text-gray-900 leading-tight">{username}</p>
              <p className={`text-xs leading-tight ${isConnected ? 'text-green-500' : 'text-gray-400'}`}>
                {isConnected ? 'Đã kết nối' : 'Đang kết nối...'}
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowLogoutConfirm(true)}
            title="Đăng xuất"
            className="text-gray-400 hover:text-red-500 transition-colors p-1 rounded-lg hover:bg-red-50"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex rounded-xl bg-gray-100 p-1 gap-1">
          <button
            onClick={() => setTab('direct')}
            className={`flex-1 text-xs font-medium py-1.5 rounded-lg transition-colors
              ${tab === 'direct' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Tin nhắn
          </button>
          <button
            onClick={() => setTab('groups')}
            className={`flex-1 text-xs font-medium py-1.5 rounded-lg transition-colors
              ${tab === 'groups' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Nhóm {groups?.length > 0 && `(${groups.length})`}
          </button>
        </div>

        {/* Search (chỉ ở tab direct) hoặc nút tạo nhóm (tab groups) */}
        <div className="mt-2">
          {tab === 'direct' ? (
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={handleSearchInput}
                placeholder="Tìm người dùng..."
                className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-gray-200 bg-gray-50
                  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
              />
              <svg className="w-4 h-4 text-gray-400 absolute left-2.5 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          ) : (
            <button
              onClick={() => setShowCreateGroup(true)}
              className="w-full flex items-center justify-center gap-2 py-2 text-sm font-medium
                text-blue-600 border border-blue-200 rounded-xl hover:bg-blue-50 transition-colors"
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
      <div className="flex-1 overflow-y-auto">

        {/* Tab Direct */}
        {tab === 'direct' && (
          <>
            {isShowingSearch && (
              <div className="border-b border-gray-100">
                {isSearching && <p className="text-xs text-gray-400 text-center py-3 animate-pulse">Đang tìm...</p>}
                {!isSearching && searchError && <p className="text-xs text-red-500 text-center py-3">{searchError}</p>}
                {!isSearching && !searchError && searchResults.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-3">Không tìm thấy ai</p>
                )}
                {!isSearching && searchResults.map(user => (
                  <button key={user.id} onClick={() => handleSelectSearchResult(user)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left">
                    <Avatar username={user.username} userId={user.id} size="sm" />
                    <span className="text-sm text-gray-800">{user.username}</span>
                  </button>
                ))}
              </div>
            )}
            {!isShowingSearch && conversations.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-6 px-4">
                Chưa có cuộc trò chuyện nào. Tìm người dùng để bắt đầu.
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
              <p className="text-xs text-gray-400 text-center py-6 px-4">
                Chưa có nhóm nào. Tạo nhóm mới để bắt đầu.
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
