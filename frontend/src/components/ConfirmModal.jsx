// Modal xác nhận dùng chung — thay thế window.confirm() cho các hành động nguy hiểm
// title   : tiêu đề modal
// body    : mô tả chi tiết hành động
// confirmLabel : nhãn nút xác nhận (mặc định "Xác nhận")
// onConfirm : callback khi bấm xác nhận
// onCancel  : callback khi bấm hủy hoặc click ngoài
// danger  : true → nút xác nhận màu đỏ (xóa), false → màu xanh (mặc định)
export default function ConfirmModal({ title, body, confirmLabel = 'Xác nhận', onConfirm, onCancel, danger = false }) {
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        {/* Header với màu theo loại hành động */}
        <div className={`px-6 pt-6 pb-4 ${danger ? '' : ''}`}>
          <div className="flex items-start gap-4">
            {/* Icon */}
            <div className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center
              ${danger ? 'bg-red-100' : 'bg-blue-100'}`}>
              {danger ? (
                <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
            </div>

            {/* Nội dung */}
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-gray-900 text-sm leading-tight">{title}</h3>
              <p className="text-sm text-gray-500 mt-1 leading-relaxed">{body}</p>
            </div>
          </div>
        </div>

        {/* Nút hành động */}
        <div className="flex gap-2 px-6 pb-5 pt-1 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
          >
            Hủy
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-sm font-medium text-white rounded-xl transition-colors
              ${danger ? 'bg-red-500 hover:bg-red-600 active:bg-red-700' : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
