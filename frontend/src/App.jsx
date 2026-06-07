import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Chat from './pages/Chat.jsx';
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
                <Chat />
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
