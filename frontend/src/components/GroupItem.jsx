import Avatar from './Avatar.jsx';

// group    : { groupId, name, createdBy, members, lastMessageAt }
// isActive : boolean
// onClick  : () => void
// unreadCount: number
export default function GroupItem({ group, isActive, onClick, unreadCount }) {
  const { name, members, lastMessageAt } = group;

  const timeStr = lastMessageAt
    ? new Date(lastMessageAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    : '';

  const hasUnread = (unreadCount ?? 0) > 0;
  const memberCount = members?.length ?? 0;

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-100 transition-colors text-left
        ${isActive ? 'bg-blue-50 border-r-2 border-blue-500' : ''}`}
    >
      {/* Avatar nhóm — dùng tên nhóm để tạo màu */}
      <div className="relative shrink-0">
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold"
          style={{ backgroundColor: hashColor(name) }}>
          {name.slice(0, 2).toUpperCase()}
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <span className={`text-sm truncate ${hasUnread ? 'font-semibold text-gray-900' : 'font-medium text-gray-900'}`}>
            {name}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            {timeStr && (
              <span className={`text-xs ${hasUnread ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>
                {timeStr}
              </span>
            )}
            {hasUnread && (
              <span className="inline-flex items-center justify-center min-w-4.5 h-4.5 text-[10px] font-bold text-white bg-blue-600 rounded-full px-1 leading-none">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </div>
        </div>
        <p className="text-xs text-gray-400 truncate">{memberCount} thành viên</p>
      </div>
    </button>
  );
}

// Hash tên nhóm thành màu HSL — tương tự Avatar.jsx
function hashColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 45%)`;
}
