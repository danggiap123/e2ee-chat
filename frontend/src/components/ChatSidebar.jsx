import { useState, useRef } from 'react';
import ConversationItem from './ConversationItem.jsx';
import Avatar from './Avatar.jsx';
import ConfirmModal from './ConfirmModal.jsx';
import * as api from '../services/api.js';

// conversations   : [{ conversationId, peer, fingerprintVerified, lastMessageAt }]
// activeConvId    : string | null
// onlineUsers     : Set<userId>
// onSelectConv    : (conv) => void — chọn conv đã có trong danh sách
// onConvCreated   : (conversationId, peerId) => void — conversation vừa tạo mới qua search
// onDeleteConv    : (conversationId) => void — xóa conversation
// unreadCounts    : Map<conversationId, number> — badge tin chưa đọc
// username        : string — tên user hiện tại
// userId          : string
// token           : string
// isConnected     : boolean
// onLogout        : () => void
export default function ChatSidebar({
  conversations, activeConvId, onlineUsers,
  onSelectConv, onConvCreated, onDeleteConv, unreadCounts,
  username, userId, token, isConnected, onLogout,
}) {
  const [searchQuery,     setSearchQuery]     = useState('');
  const [searchResults,   setSearchResults]   = useState([]); // [{ id, username }]
  const [isSearching,     setIsSearching]     = useState(false);
  const [searchError,     setSearchError]     = useState('');
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const debounceRef = useRef(null);

  // Tìm kiếm user với debounce 400ms — tránh gọi API mỗi lần gõ 1 chữ
  function handleSearchInput(e) {
    const q = e.target.value;
    setSearchQuery(q);
    setSearchError('');

    clearTimeout(debounceRef.current);

    if (q.trim().length < 2) {
      setSearchResults([]);
      return;
    }

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

  // User click vào kết quả tìm kiếm:
  // 1. Tạo (hoặc lấy lại) conversation với người đó
  // 2. Tìm trong danh sách conversations hiện tại
  // 3. Nếu chưa có → tạo object tạm và gọi onSelectConv
  async function handleSelectSearchResult(user) {
    setSearchQuery('');
    setSearchResults([]);
    try {
      const { conversationId } = await api.createConversation(token, user.id);
      // Tìm xem conversation đã có trong danh sách chưa (idempotent — có thể đã tồn tại)
      const existing = conversations.find(c => c.conversationId === conversationId);
      if (existing) {
        onSelectConv(existing);
      } else {
        // Conversation vừa được tạo — gọi callback để Chat.jsx reload danh sách
        // Lý do: cần reload để có peer.ikPub từ server (dùng cho FingerprintModal)
        onConvCreated(conversationId, user.id);
      }
    } catch (err) {
      setSearchError(err.message);
    }
  }

  const isShowingSearch = searchQuery.trim().length >= 2;

  return (
    <>
    <div className="w-72 shrink-0 flex flex-col border-r border-gray-200 bg-white h-full">
      {/* Header */}
      <div className="px-4 py-4 border-b border-gray-100">
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
            {/* Icon logout */}
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>

        {/* Search box */}
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={handleSearchInput}
            placeholder="Tìm người dùng..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-gray-200 bg-gray-50
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent focus:bg-white"
          />
          <svg className="w-4 h-4 text-gray-400 absolute left-2.5 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>

      {/* Khu vực danh sách */}
      <div className="flex-1 overflow-y-auto">
        {/* Kết quả tìm kiếm */}
        {isShowingSearch && (
          <div className="border-b border-gray-100">
            {isSearching && (
              <p className="text-xs text-gray-400 text-center py-3 animate-pulse">Đang tìm...</p>
            )}
            {!isSearching && searchError && (
              <p className="text-xs text-red-500 text-center py-3">{searchError}</p>
            )}
            {!isSearching && !searchError && searchResults.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-3">Không tìm thấy ai</p>
            )}
            {!isSearching && searchResults.map(user => (
              <button
                key={user.id}
                onClick={() => handleSelectSearchResult(user)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
              >
                <Avatar username={user.username} userId={user.id} size="sm" />
                <span className="text-sm text-gray-800">{user.username}</span>
              </button>
            ))}
          </div>
        )}

        {/* Danh sách conversations */}
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
      </div>
    </div>

    {/* Modal xác nhận đăng xuất */}
    {showLogoutConfirm && (
      <ConfirmModal
        title="Đăng xuất?"
        body="Bạn sẽ cần nhập lại mật khẩu để mở khóa khóa riêng tư và tiếp tục nhắn tin."
        confirmLabel="Đăng xuất"
        onConfirm={() => { setShowLogoutConfirm(false); onLogout(); }}
        onCancel={() => setShowLogoutConfirm(false)}
      />
    )}
    </>
  );
}
