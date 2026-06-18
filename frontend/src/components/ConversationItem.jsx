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
    <div className="relative group px-2">
      <button
        onClick={onClick}
        className={`w-full flex items-center gap-3 px-3 py-2.5 pr-8 rounded-xl transition-colors text-left
          ${isActive ? 'bg-slate-700/80' : 'hover:bg-slate-800/70'}`}
      >
        <div className="relative shrink-0">
          <Avatar username={peer.username} userId={peer.id} />
          {isOnline && (
            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 border-slate-900" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className={`text-sm truncate ${hasUnread ? 'font-semibold text-slate-100' : 'font-medium text-slate-200'}`}>
              {peer.username}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              {timeStr && (
                <span className={`text-xs ${hasUnread ? 'text-blue-400 font-medium' : 'text-slate-500'}`}>
                  {timeStr}
                </span>
              )}
              {hasUnread && (
                <span className="inline-flex items-center justify-center min-w-4.5 h-4.5 text-[10px] font-bold text-white bg-blue-500 rounded-full px-1 leading-none">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </div>
          </div>
          {!fingerprintVerified && (
            <p className="text-xs text-amber-400/80 truncate">Chưa xác minh danh tính</p>
          )}
        </div>
      </button>

      <button
        onClick={(e) => { e.stopPropagation(); onDeleteConv?.(); }}
        className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg
          text-slate-500 hover:text-red-400 hover:bg-slate-700
          opacity-0 group-hover:opacity-100 transition-all"
        title="Xóa cuộc trò chuyện"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    </div>
  );
}
