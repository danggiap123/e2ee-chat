// Props: username, userId, size ('sm' | 'md' | 'lg')
// Màu nền: hash toàn bộ userId ra hue → HSL — cùng userId luôn cùng màu
export default function Avatar({ username = '', userId = '', size = 'md' }) {
  const hue = [...userId].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  const bg = `hsl(${hue}, 55%, 42%)`;
  const initials = username.slice(0, 2).toUpperCase() || '??';

  const cls = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-12 h-12 text-base',
  }[size] ?? 'w-10 h-10 text-sm';

  return (
    <div
      className={`${cls} rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0 select-none`}
      style={{ backgroundColor: bg }}
    >
      {initials}
    </div>
  );
}
