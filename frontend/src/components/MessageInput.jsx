import { useState, useRef, useEffect } from 'react';

// onSend         : (text: string) => Promise<void>
// onSendFile     : (file: File) => Promise<void>
// isSending      : boolean
// disabled       : boolean — khi fingerprint chưa verify
// replyTo        : { id, senderUsername, preview } | null — tin đang được trả lời
// onCancelReply  : () => void — xóa trạng thái reply
export default function MessageInput({ onSend, onSendFile, isSending, disabled, replyTo, onCancelReply }) {
  const [text, setText] = useState('');
  const [fileError, setFileError] = useState('');
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const prevIsSendingRef = useRef(isSending);

  // Khi isSending chuyển true → false (gửi xong) → focus lại textarea
  useEffect(() => {
    if (prevIsSendingRef.current && !isSending && !disabled) {
      textareaRef.current?.focus();
    }
    prevIsSendingRef.current = isSending;
  }, [isSending, disabled]);

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || isSending || disabled) return;
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.focus();
    }
    await onSend(trimmed);
  }

  // Ctrl+V paste ảnh từ clipboard → gửi ngay như file ảnh
  // Nếu clipboard chứa text thuần → paste bình thường vào textarea (không chặn)
  function handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (!file) continue;
        e.preventDefault(); // chặn paste text/binary vào textarea
        if (file.size > 10 * 1024 * 1024) {
          setFileError('Ảnh quá lớn — tối đa 10MB');
          return;
        }
        setFileError('');
        onSendFile?.(file);
        return;
      }
    }
    // Không có file trong clipboard → paste text bình thường, không làm gì thêm
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // reset để có thể chọn lại cùng file
    if (file.size > 10 * 1024 * 1024) {
      setFileError('File quá lớn — tối đa 10MB');
      return;
    }
    setFileError('');
    onSendFile?.(file);
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
      {fileError && (
        <p className="text-xs text-red-500 mb-2 text-center">{fileError}</p>
      )}
      <div className="flex items-end gap-2">
        {/* Nút đính kèm file/ảnh */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || isSending}
          title="Gửi file hoặc ảnh (tối đa 10MB)"
          className="shrink-0 w-10 h-10 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center
            hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileChange}
        />
        <textarea
          ref={textareaRef}
          value={text}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
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
