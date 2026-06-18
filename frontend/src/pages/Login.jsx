import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { importKeysFromFile } from '../db/storage.js';

export default function Login() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [username,       setUsername]       = useState('');
  const [password,       setPassword]       = useState('');
  const [error,          setError]          = useState('');
  const [loading,        setLoading]        = useState(false);
  const [showImport,     setShowImport]     = useState(false);
  const [importStatus,   setImportStatus]   = useState(''); // '' | 'ok' | 'error'
  const [importMsg,      setImportMsg]      = useState('');
  const fileInputRef = useRef(null);

  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportStatus('');
    setImportMsg('');
    try {
      await importKeysFromFile(file);
      setImportStatus('ok');
      setImportMsg('Nhập key thành công! Hãy đăng nhập lại để mở khóa.');
      setError('');
    } catch (err) {
      setImportStatus('error');
      setImportMsg(err.message || 'Nhập file thất bại — kiểm tra lại file .e2ee.');
    } finally {
      // reset input để chọn lại file nếu cần
      e.target.value = '';
    }
  }

  // Nếu đã đăng nhập (token còn trong localStorage) → không cần login lại
  useEffect(() => {
    if (isAuthenticated) navigate('/chat', { replace: true });
  }, [isAuthenticated, navigate]);

  async function handleSubmit(e) {
    e.preventDefault();   // ngăn browser reload trang
    setError('');
    setLoading(true);

    try {
      await login(username.trim(), password);
      // login() đã set state → isAuthenticated chuyển true → useEffect ở trên navigate /chat
      // KHÔNG navigate ở đây để tránh race condition với state update
    } catch (err) {
      if (err.message === 'DEVICE_NOT_REGISTERED') {
        setError(
          'Tài khoản này chưa có khóa trên thiết bị này. ' +
          'Xuất file .e2ee từ thiết bị gốc rồi nhập vào đây.'
        );
        setShowImport(true);
      } else {
        // Hiện message gốc từ server (sai password, tài khoản không tồn tại, v.v.)
        setError(err.message || 'Đăng nhập thất bại — thử lại.');
      }
    } finally {
      // finally chạy dù có lỗi hay không — đảm bảo button luôn được bỏ disable
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-900 via-slate-800 to-blue-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">

        {/* Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-500/20 border border-blue-500/30 rounded-2xl mb-4">
            <svg className="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">E2EE Chat</h1>
          <p className="text-slate-400 text-sm mt-1">Tin nhắn được mã hóa đầu cuối</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl shadow-black/30 p-8 space-y-5">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Tên đăng nhập
              </label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="alice"
                required
                disabled={loading}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-slate-50
                           focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                           disabled:opacity-50 transition-colors"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Mật khẩu
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                disabled={loading}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-slate-50
                           focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                           disabled:opacity-50 transition-colors"
              />
            </div>

            {/* Error message */}
            {error && (
              <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <svg className="w-4 h-4 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            {/* Import .e2ee */}
            {showImport && (
              <div className="border border-amber-200 bg-amber-50 rounded-xl px-4 py-3 space-y-2">
                <p className="text-xs font-medium text-amber-800">Nhập file khóa từ thiết bị cũ</p>
                <input ref={fileInputRef} type="file" accept=".e2ee" onChange={handleImportFile} className="hidden" />
                <button type="button" onClick={() => fileInputRef.current?.click()}
                  className="w-full py-2 text-sm font-medium text-amber-700 border border-amber-300 rounded-lg hover:bg-amber-100 transition-colors">
                  Chọn file .e2ee...
                </button>
                {importStatus === 'ok' && (
                  <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1">{importMsg}</p>
                )}
                {importStatus === 'error' && (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded px-2 py-1">{importMsg}</p>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl
                         disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Đang đăng nhập...
                </span>
              ) : 'Đăng nhập'}
            </button>
          </form>

          <div className="relative">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200" /></div>
            <div className="relative flex justify-center">
              <span className="px-3 text-xs text-slate-400 bg-white">Chưa có tài khoản?</span>
            </div>
          </div>

          <Link to="/register"
            className="block w-full py-2.5 text-center text-sm font-semibold text-blue-600 border border-blue-200 rounded-xl hover:bg-blue-50 transition-colors">
            Đăng ký tài khoản
          </Link>
        </div>

        <p className="text-center text-xs text-slate-500 mt-6">
          Mọi tin nhắn được mã hóa trước khi rời khỏi thiết bị của bạn
        </p>
      </div>
    </div>
  );
}
