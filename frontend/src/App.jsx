import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import UnlockModal from './components/UnlockModal.jsx';

// ─── ProtectedRoute ───────────────────────────────────────────────────────────
// Bao bọc các route yêu cầu đăng nhập (hiện tại chỉ /chat)
// 3 trường hợp:
//   1. chưa đăng nhập              → redirect /login
//   2. đã đăng nhập nhưng bị lock  → hiện UnlockModal (giữ nguyên URL /chat)
//   3. đã đăng nhập + đã unlock    → render children bình thường
function ProtectedRoute({ children }) {
  const { isAuthenticated, isLocked } = useAuth();

  if (!isAuthenticated) {
    // replace=true: /chat không nằm trong browser history
    // → bấm Back sau khi bị redirect sẽ về trang trước /chat, không bị vòng lặp
    return <Navigate to="/login" replace />;
  }

  if (isLocked) {
    // Render children phía sau để không mất URL + state
    // UnlockModal là overlay toàn màn hình, hiện lên trên Chat
    return (
      <>
        {children}
        <UnlockModal />
      </>
    );
  }

  return children;
}

// ─── Placeholder Chat ─────────────────────────────────────────────────────────
// Tạm thời để test routing — sẽ thay bằng Chat.jsx thật ở bước sau
function ChatPlaceholder() {
  const { username, logout } = useAuth();
  return (
    <div className="flex items-center justify-center h-screen bg-gray-50">
      <div className="text-center space-y-4">
        <p className="text-2xl font-semibold text-gray-700">
          Xin chào, <span className="text-blue-600">{username}</span>!
        </p>
        <p className="text-gray-400 text-sm">Chat.jsx sẽ được xây dựng ở bước tiếp theo.</p>
        <button
          onClick={logout}
          className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 text-sm"
        >
          Đăng xuất
        </button>
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    // AuthProvider phải bọc ngoài BrowserRouter vì ProtectedRoute dùng useAuth
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Trang gốc redirect thẳng về login */}
          <Route path="/" element={<Navigate to="/login" replace />} />

          <Route path="/login"    element={<Login />} />
          <Route path="/register" element={<Register />} />

          <Route
            path="/chat"
            element={
              <ProtectedRoute>
                <ChatPlaceholder />
              </ProtectedRoute>
            }
          />

          {/* Mọi route không tồn tại → về login */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
