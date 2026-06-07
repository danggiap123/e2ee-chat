import Avatar from './Avatar.jsx';

// conv          : { conversationId, peer: { id, username, ikPub }, fingerprintVerified, lastMessageAt }
// isActive      : boolean
// isOnline      : boolean
// onClick       : () => void
// onDeleteConv  : () => void — xóa conversation khỏi danh sách
// unreadCount   : number — số tin chưa đọc (hiện badge xanh nếu > 0)
export default function ConversationItem({ conv, isActive, isOnline, onClick, onDeleteConv, unreadCount }) {
  const { peer, lastMessageAt, fingerprintVerified } = conv;

  const timeStr = lastMessageAt
    ? new Date(lastMessageAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    : '';

  const hasUnread = (unreadCount ?? 0) > 0;

  return (
    // div wrapper với group để nút xóa hiện khi hover
    <div className="relative group">
      <button
        onClick={onClick}
        // pr-8 để text không bị nút xóa che khuất khi hover
        className={`w-full flex items-center gap-3 px-4 py-3 pr-8 hover:bg-gray-100 transition-colors text-left
          ${isActive ? 'bg-blue-50 border-r-2 border-blue-500' : ''}`}
      >
        <div className="relative shrink-0">
          <Avatar username={peer.username} userId={peer.id} />
          {isOnline && (
            <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-400 rounded-full border-2 border-white" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className={`text-sm truncate ${hasUnread ? 'font-semibold text-gray-900' : 'font-medium text-gray-900'}`}>
              {peer.username}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              {timeStr && (
                <span className={`text-xs ${hasUnread ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>
                  {timeStr}
                </span>
              )}
              {/* Badge số tin chưa đọc */}
              {hasUnread && (
                <span className="inline-flex items-center justify-center min-w-4.5 h-4.5 text-[10px] font-bold text-white bg-blue-600 rounded-full px-1 leading-none">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </div>
          </div>
          {!fingerprintVerified && (
            <p className="text-xs text-amber-600 truncate">Chưa xác minh danh tính</p>
          )}
        </div>
      </button>

      {/* Nút xóa conversation — chỉ hiện khi hover, dùng stopPropagation để không trigger onClick của button cha */}
      <button
        onClick={(e) => { e.stopPropagation(); onDeleteConv?.(); }}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg
          text-gray-400 hover:text-red-500 hover:bg-red-50
          opacity-0 group-hover:opacity-100 transition-all"
        title="Xóa cuộc trò chuyện"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    </div>
  );
}
