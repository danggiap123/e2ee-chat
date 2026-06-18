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
    <div className="px-2">
      <button
        onClick={onClick}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-left
          ${isActive ? 'bg-slate-700/80' : 'hover:bg-slate-800/70'}`}
      >
        <div className="relative shrink-0">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-sm font-bold"
            style={{ backgroundColor: hashColor(name) }}>
            {name.slice(0, 2).toUpperCase()}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className={`text-sm truncate ${hasUnread ? 'font-semibold text-slate-100' : 'font-medium text-slate-200'}`}>
              {name}
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
          <p className="text-xs text-slate-500 truncate">{memberCount} thành viên</p>
        </div>
      </button>
    </div>
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
