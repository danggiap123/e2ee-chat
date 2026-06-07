import { useState, useEffect } from 'react';
import { generateFingerprint } from '../crypto/fingerprint.js';
import { fromBase64 } from '../crypto/x3dh.js';
import * as api from '../services/api.js';

// myIKPub    : Uint8Array — IK_pub của user hiện tại (từ AuthContext)
// peerIKPub  : string base64 — IK_pub của peer (từ listConversations)
// peerUsername: string
// conversationId: string
// token      : string
// onClose    : () => void — đóng modal
// onVerified : () => void — callback sau khi verify thành công
export default function FingerprintModal({
  myIKPub, peerIKPub, peerUsername, conversationId, token, onClose, onVerified,
}) {
  const [fingerprint, setFingerprint] = useState('');
  const [isLoading,   setIsLoading]   = useState(true);
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState('');

  // Tính fingerprint khi modal mở — SHA-512 × 5200 vòng, chạy ~300ms
  useEffect(() => {
    if (!myIKPub || !peerIKPub) {
      setError('Không lấy được public key của người kia.');
      setIsLoading(false);
      return;
    }
    generateFingerprint(myIKPub, fromBase64(peerIKPub))
      .then(fp => { setFingerprint(fp); setIsLoading(false); })
      .catch(() => { setError('Không tính được fingerprint.'); setIsLoading(false); });
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  async function handleConfirm() {
    setIsConfirming(true);
    try {
      await api.verifyFingerprint(token, conversationId);
      onVerified();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsConfirming(false);
    }
  }

  // Hiển thị 60 số thành 6 nhóm × 10 chữ số — dễ đọc so sánh với người kia
  function formatFingerprint(fp) {
    const groups = [];
    for (let i = 0; i < 60; i += 10) {
      groups.push(fp.slice(i, i + 10));
    }
    return groups;
  }

  return (
    // Overlay toàn màn hình — click ngoài modal không đóng (cần hành động rõ ràng)
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5">
        <div className="text-center space-y-1">
          <h2 className="text-lg font-semibold text-gray-900">Xác minh danh tính</h2>
          <p className="text-sm text-gray-500">
            Liên hệ trực tiếp với <span className="font-medium text-gray-700">{peerUsername}</span> và
            so sánh 60 chữ số dưới đây. Nếu giống nhau, không có tấn công MITM.
          </p>
        </div>

        {/* Khu vực fingerprint */}
        <div className="bg-gray-50 rounded-xl p-4 min-h-[96px] flex items-center justify-center">
          {isLoading && (
            <p className="text-sm text-gray-400 animate-pulse">Đang tính fingerprint...</p>
          )}
          {!isLoading && error && (
            <p className="text-sm text-red-500">{error}</p>
          )}
          {!isLoading && !error && (
            <div className="grid grid-cols-3 gap-2 w-full">
              {formatFingerprint(fingerprint).map((group, i) => (
                <span
                  key={i}
                  className="font-mono text-sm text-center bg-white rounded-lg py-1.5 px-2 border border-gray-200 tracking-widest text-gray-800"
                >
                  {group}
                </span>
              ))}
            </div>
          )}
        </div>

        <p className="text-xs text-gray-400 text-center">
          Fingerprint = SHA-512 × 5200 lần trên 2 Identity Key —
          thay đổi nếu có người chen vào giữa.
        </p>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Để sau
          </button>
          <button
            onClick={handleConfirm}
            disabled={isLoading || !!error || isConfirming}
            className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isConfirming ? 'Đang lưu...' : 'Khớp rồi, xác nhận'}
          </button>
        </div>
      </div>
    </div>
  );
}
