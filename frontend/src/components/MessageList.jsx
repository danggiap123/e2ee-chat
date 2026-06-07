import { useEffect, useRef } from 'react';
import Avatar from './Avatar.jsx';

// Tách plaintext dạng plain string vs JSON-wrapped (khi có reply)
// Format reply: JSON.stringify({ t: text, r: { id, u: senderUsername, p: preview } })
// Backward-compatible: nếu không parse được JSON thì dùng raw string
function parsePlaintext(raw) {
  if (!raw) return { text: null, replyTo: null };
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj.t === 'string') return { text: obj.t, replyTo: obj.r ?? null };
  } catch {}
  return { text: raw, replyTo: null };
}

// messages       : [{ id, senderId, plaintext, createdAt, isDecryptError }]
// userId         : string — để phân biệt tin của mình vs người kia
// myUsername     : string — tên hiển thị khi mình là sender trong reply
// isLoading      : boolean
// hasMore        : boolean
// onLoadMore     : () => void
// peers          : Map<userId, { username, ikPub }> — lấy tên hiển thị
// onDeleteMessage: (msgId) => void — xóa tin nhắn của mình
// onReply        : ({ id, senderUsername, preview }) => void — click reply
export default function MessageList({
  messages, userId, myUsername, isLoading, hasMore, onLoadMore, peers,
  onDeleteMessage, onReply,
}) {
  const bottomRef  = useRef(null);
  const listRef    = useRef(null);
  const prevLenRef = useRef(0);

  // Scroll xuống cuối khi có tin mới (không scroll khi load more tin cũ ở trên)
  useEffect(() => {
    if (messages.length > prevLenRef.current) {
      const added = messages.length - prevLenRef.current;
      const isLoadMore = prevLenRef.current > 0 && added > 1;
      if (!isLoadMore) {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }
    prevLenRef.current = messages.length;
  }, [messages.length]);

  // Infinite scroll: khi user scroll lên đầu danh sách → load thêm tin cũ
  function handleScroll() {
    if (!listRef.current) return;
    if (listRef.current.scrollTop < 80 && hasMore && !isLoading) {
      onLoadMore();
    }
  }

  function formatTime(iso) {
    return new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  }

  if (messages.length === 0 && !isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        Chưa có tin nhắn nào. Hãy bắt đầu cuộc trò chuyện!
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-4 py-3 space-y-1"
    >
      {/* Spinner load more ở đầu danh sách */}
      {isLoading && (
        <div className="text-center py-2">
          <span className="text-xs text-gray-400 animate-pulse">Đang tải tin cũ hơn...</span>
        </div>
      )}

      {messages.map((msg, i) => {
        const isMine = msg.senderId === userId;
        const peer = peers?.get(msg.senderId);
        const peerUsername = peer?.username ?? msg.senderId.slice(0, 8);
        const senderUsername = isMine ? (myUsername ?? 'Bạn') : peerUsername;

        // Gộp tin nhắn liên tiếp của cùng 1 người — chỉ hiện avatar ở tin đầu của chuỗi
        const prevMsg = messages[i - 1];
        const isFirst = !prevMsg || prevMsg.senderId !== msg.senderId;

        const { text, replyTo } = parsePlaintext(msg.plaintext);

        return (
          <div
            key={msg.id}
            className={`flex items-end gap-2 ${isMine ? 'flex-row-reverse' : 'flex-row'} group`}
          >
            {/* Avatar slot — luôn chiếm 32px để căn thẳng hàng */}
            <div className="w-8 shrink-0">
              {!isMine && isFirst && (
                <Avatar username={peerUsername} userId={msg.senderId} size="sm" />
              )}
            </div>

            {/* Cột nội dung: tên + reply block + bubble + timestamp */}
            <div className={`max-w-[70%] flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
              {/* Tên người gửi — chỉ hiện ở tin đầu của chuỗi, chỉ khi không phải mình */}
              {!isMine && isFirst && (
                <span className="text-xs text-gray-500 mb-1 px-1">{peerUsername}</span>
              )}

              {/* Reply quoted block — hiện phía trên bubble nếu tin này là reply */}
              {replyTo && (
                <div className={`text-xs mb-1 px-2 py-1 rounded-lg border-l-2 border-gray-400
                  bg-gray-100 ${isMine ? 'self-end' : 'self-start'} max-w-50`}>
                  <p className="font-semibold text-gray-700 leading-tight">{replyTo.u}</p>
                  <p className="text-gray-500 truncate leading-tight">{replyTo.p}</p>
                </div>
              )}

              {/* Hàng ngang: bubble + nút hành động (reply / xóa) */}
              <div className={`flex items-center gap-1.5 ${isMine ? 'flex-row-reverse' : ''}`}>
                {/* Bubble tin nhắn */}
                <div
                  className={`px-3 py-2 rounded-2xl text-sm leading-relaxed
                    ${isMine
                      ? 'bg-blue-600 text-white rounded-br-sm'
                      : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm shadow-sm'}
                    ${msg.isDecryptError ? 'opacity-50 italic' : ''}`}
                >
                  {msg.isDecryptError
                    ? '⚠ Không thể giải mã tin nhắn này'
                    : text}
                </div>

                {/* Nút hành động — hiện khi hover vào message group */}
                {!msg.isDecryptError && (
                  <div className="flex items-center gap-0.5 invisible group-hover:visible shrink-0">
                    {/* Nút reply */}
                    <button
                      onClick={() => onReply?.({ id: msg.id, senderUsername, preview: text })}
                      className="p-1 rounded-full text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition-colors"
                      title="Trả lời"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                      </svg>
                    </button>

                    {/* Nút xóa — chỉ hiện với tin của mình */}
                    {isMine && (
                      <button
                        onClick={() => onDeleteMessage?.(msg.id)}
                        className="p-1 rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                        title="Xóa tin nhắn"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                )}
              </div>

              <span className="text-xs text-gray-400 mt-0.5 px-1">
                {formatTime(msg.createdAt)}
              </span>
            </div>
          </div>
        );
      })}

      {/* Anchor để scroll xuống cuối */}
      <div ref={bottomRef} />
    </div>
  );
}
