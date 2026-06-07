import { useState, useRef } from 'react';

// onSend         : (text: string) => Promise<void>
// isSending      : boolean
// disabled       : boolean — khi fingerprint chưa verify
// replyTo        : { id, senderUsername, preview } | null — tin đang được trả lời
// onCancelReply  : () => void — xóa trạng thái reply
export default function MessageInput({ onSend, isSending, disabled, replyTo, onCancelReply }) {
  const [text, setText] = useState('');
  const textareaRef = useRef(null);

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || isSending || disabled) return;
    setText('');
    // Reset chiều cao textarea về 1 dòng sau khi gửi
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    await onSend(trimmed);
  }

  // Enter → gửi, Shift+Enter → xuống dòng
  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // Auto-resize textarea theo nội dung, tối đa 5 dòng (~120px)
  function handleInput(e) {
    setText(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  }

  return (
    <div className="border-t border-gray-200 bg-white px-4 py-3">
      {/* Reply preview bar — hiện khi user bấm nút reply trên một tin nhắn */}
      {replyTo && (
        <div className="flex items-start gap-2 mb-2.5 bg-blue-50 rounded-xl px-3 py-2 border-l-4 border-blue-500">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-blue-600 leading-tight">
              Đang trả lời {replyTo.senderUsername}
            </p>
            <p className="text-xs text-gray-500 truncate mt-0.5">{replyTo.preview}</p>
          </div>
          <button
            onClick={onCancelReply}
            className="shrink-0 p-0.5 rounded text-gray-400 hover:text-gray-600 hover:bg-blue-100 transition-colors"
            title="Hủy trả lời"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {disabled && (
        <p className="text-xs text-amber-600 mb-2 text-center">
          Xác minh danh tính trước khi nhắn tin để đảm bảo bảo mật
        </p>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          disabled={disabled || isSending}
          placeholder={disabled ? 'Cần xác minh danh tính trước...' : 'Nhắn tin... (Enter để gửi)'}
          rows={1}
          className="flex-1 resize-none rounded-2xl border border-gray-300 px-4 py-2.5 text-sm
            focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
            disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed
            max-h-30 overflow-y-auto leading-relaxed"
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || isSending || disabled}
          className="shrink-0 w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center
            hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {isSending ? (
            // Spinner đơn giản khi đang gửi
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          ) : (
            // Icon send (paper plane)
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
