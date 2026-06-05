import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';

// Hiện khi isLocked = true (token còn nhưng wrappingKey mất sau reload)
// KHÔNG có nút đóng — user phải unlock hoặc đăng xuất
export default function UnlockModal() {
  const { username, unlock, logout } = useAuth();

  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  async function handleUnlock(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await unlock(password);
      // unlock() thành công → setWrappingKey → isLocked = false
      // → App.jsx ProtectedRoute không render modal nữa → overlay tự biến mất
    } catch (err) {
      if (err.message === 'DEVICE_NOT_REGISTERED') {
        setError('Thiết bị này không có key — đăng xuất và dùng thiết bị gốc.');
      } else {
        // AES-GCM decrypt thất bại = sai mật khẩu
        setError('Sai mật khẩu. Thử lại.');
      }
      setPassword('');   // xóa password để user nhập lại
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await logout();
    // logout() xóa localStorage + RAM → isAuthenticated = false
    // → ProtectedRoute redirect /login → modal biến mất cùng với /chat
  }

  return (
    // Overlay toàn màn hình — pointer-events-all để chặn click xuống Chat phía dưới
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-8 space-y-6 mx-4">

        {/* Header */}
        <div className="text-center space-y-1">
          <div className="text-3xl">🔒</div>
          <h2 className="text-xl font-bold text-gray-900">Phiên đã bị khóa</h2>
          <p className="text-sm text-gray-500">
            Xin chào <span className="font-medium text-gray-700">{username}</span>.
            Nhập mật khẩu để mở khóa private key.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleUnlock} className="space-y-4">
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Mật khẩu của bạn"
            required
            autoFocus
            disabled={loading}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm
                       focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                       disabled:bg-gray-50"
          />

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg
                       hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed
                       transition-colors"
          >
            {loading ? 'Đang mở khóa...' : 'Mở khóa'}
          </button>
        </form>

        {/* Đăng xuất — thoát khỏi lock khi không nhớ password */}
        <div className="text-center">
          <button
            onClick={handleLogout}
            disabled={loading}
            className="text-sm text-gray-400 hover:text-red-500 disabled:opacity-50 transition-colors"
          >
            Đăng xuất khỏi tài khoản này
          </button>
        </div>
      </div>
    </div>
  );
}
