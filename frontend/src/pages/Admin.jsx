import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

// ─── Hook gọi API admin — gắn JWT vào header Authorization ───────────────────
function useAdminApi(token) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const get  = useCallback((path) =>
    fetch(`${API}${path}`, { headers }).then(r => r.json()), [token]);

  const post = useCallback((path, body) =>
    fetch(`${API}${path}`, { method: 'POST', headers, body: JSON.stringify(body) }).then(r => r.json()), [token]);

  const patch = useCallback((path) =>
    fetch(`${API}${path}`, { method: 'PATCH', headers }).then(r => r.json()), [token]);

  const del  = useCallback((path) =>
    fetch(`${API}${path}`, { method: 'DELETE', headers }).then(r => r.json()), [token]);

  return { get, post, patch, del };
}

// ─── Tab quản lý người dùng ───────────────────────────────────────────────────
function UsersTab({ api, currentUserId }) {
  const [users,    setUsers]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [actionId, setActionId] = useState(null);
  const [error,    setError]    = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const data = await api.get('/admin/users');
    setUsers(data.users ?? []);
    setLoading(false);
  }, [api]);

  useEffect(() => { load(); }, [load]);

  async function handleAction(path, userId) {
    setActionId(userId);
    setError('');
    const data = await api.patch(path);
    if (data.error) setError(data.error);
    await load();
    setActionId(null);
  }

  if (loading) return <p className="text-gray-500 text-center py-8">Đang tải...</p>;

  return (
    <div>
      {error && (
        <div className="mb-4 px-4 py-2 bg-red-50 text-red-600 text-sm rounded-lg border border-red-200">
          {error}
        </div>
      )}
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-gray-500">{users.length} người dùng</p>
        <button onClick={load} className="text-sm text-blue-600 hover:underline">Làm mới</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-gray-600">
              <th className="px-4 py-3 font-medium">Tên đăng nhập</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Ngày tạo</th>
              <th className="px-4 py-3 font-medium">Quyền</th>
              <th className="px-4 py-3 font-medium">Trạng thái</th>
              <th className="px-4 py-3 font-medium">Hành động</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map(user => {
              const isSelf = user.id === currentUserId;
              const busy   = actionId === user.id;
              return (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-800">
                    {user.username}
                    {isSelf && <span className="ml-2 text-xs text-blue-500">(bạn)</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{user.email}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(user.createdAt).toLocaleDateString('vi-VN')}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      user.role === 'ADMIN'
                        ? 'bg-purple-100 text-purple-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {user.role === 'ADMIN' ? 'Admin' : 'User'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      user.isActive
                        ? 'bg-green-100 text-green-700'
                        : 'bg-red-100 text-red-700'
                    }`}>
                      {user.isActive ? 'Đang hoạt động' : 'Đã vô hiệu hóa'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 flex-wrap">
                      {/* Nút vô hiệu hóa / kích hoạt — không tự làm với mình */}
                      {!isSelf && (
                        <button
                          disabled={busy}
                          onClick={() => handleAction(
                            user.isActive
                              ? `/admin/users/${user.id}/disable`
                              : `/admin/users/${user.id}/enable`,
                            user.id
                          )}
                          className={`px-3 py-1 rounded text-xs font-medium disabled:opacity-50 ${
                            user.isActive
                              ? 'bg-red-100 text-red-700 hover:bg-red-200'
                              : 'bg-green-100 text-green-700 hover:bg-green-200'
                          }`}
                        >
                          {busy ? '...' : user.isActive ? 'Vô hiệu hóa' : 'Kích hoạt'}
                        </button>
                      )}

                      {/* Nút cấp / thu hồi quyền admin — không tự thu hồi của mình */}
                      {user.role !== 'ADMIN' ? (
                        <button
                          disabled={busy}
                          onClick={() => handleAction(`/admin/users/${user.id}/grant-admin`, user.id)}
                          className="px-3 py-1 rounded text-xs font-medium bg-purple-100 text-purple-700 hover:bg-purple-200 disabled:opacity-50"
                        >
                          {busy ? '...' : 'Cấp Admin'}
                        </button>
                      ) : !isSelf && (
                        <button
                          disabled={busy}
                          onClick={() => handleAction(`/admin/users/${user.id}/revoke-admin`, user.id)}
                          className="px-3 py-1 rounded text-xs font-medium bg-yellow-100 text-yellow-700 hover:bg-yellow-200 disabled:opacity-50"
                        >
                          {busy ? '...' : 'Thu hồi Admin'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {users.length === 0 && (
          <p className="text-center text-gray-400 py-8">Chưa có người dùng nào</p>
        )}
      </div>
    </div>
  );
}

// ─── Tab quản lý whitelist email ──────────────────────────────────────────────
function WhitelistTab({ api }) {
  const [emails,     setEmails]     = useState([]);
  const [newEmail,   setNewEmail]   = useState('');
  const [loading,    setLoading]    = useState(true);
  const [adding,     setAdding]     = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [error,      setError]      = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const data = await api.get('/admin/whitelist');
    setEmails(data.emails ?? []);
    setLoading(false);
  }, [api]);

  useEffect(() => { load(); }, [load]);

  async function handleAdd(e) {
    e.preventDefault();
    setAdding(true);
    setError('');
    const data = await api.post('/admin/whitelist', { email: newEmail });
    if (data.error) setError(data.error);
    else setNewEmail('');
    await load();
    setAdding(false);
  }

  async function handleDelete(entry) {
    setDeletingId(entry.id);
    await api.del(`/admin/whitelist/${entry.id}`);
    await load();
    setDeletingId(null);
  }

  if (loading) return <p className="text-gray-500 text-center py-8">Đang tải...</p>;

  return (
    <div>
      <form onSubmit={handleAdd} className="flex gap-2 mb-4">
        <input
          type="email"
          placeholder="email@company.com"
          value={newEmail}
          onChange={e => setNewEmail(e.target.value)}
          className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          required
        />
        <button
          type="submit"
          disabled={adding}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
        >
          {adding ? 'Đang thêm...' : 'Thêm email'}
        </button>
      </form>
      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      <div className="flex justify-between items-center mb-3">
        <p className="text-sm text-gray-500">{emails.length} email trong whitelist</p>
        <button onClick={load} className="text-sm text-blue-600 hover:underline">Làm mới</button>
      </div>
      <div className="divide-y divide-gray-100 border rounded-lg overflow-hidden">
        {emails.map(entry => (
          <div key={entry.id} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
            <div>
              <p className="text-sm font-medium text-gray-800">{entry.email}</p>
              <p className="text-xs text-gray-400">
                Thêm lúc {new Date(entry.createdAt).toLocaleDateString('vi-VN')}
                {entry.usedAt && ` · Đã đăng ký ${new Date(entry.usedAt).toLocaleDateString('vi-VN')}`}
              </p>
            </div>
            <button
              onClick={() => handleDelete(entry)}
              disabled={deletingId === entry.id}
              className="px-3 py-1 bg-red-100 text-red-700 hover:bg-red-200 rounded text-xs font-medium disabled:opacity-50"
            >
              {deletingId === entry.id ? '...' : 'Xóa'}
            </button>
          </div>
        ))}
        {emails.length === 0 && (
          <p className="text-center text-gray-400 py-8">Whitelist đang trống</p>
        )}
      </div>
    </div>
  );
}

// ─── Trang Admin chính ────────────────────────────────────────────────────────
export default function Admin() {
  const { token, userId, username, logout } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState('users');

  const api = useAdminApi(token);

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Trang quản trị</h1>
            <p className="text-sm text-gray-500 mt-1">Đăng nhập với tư cách: <span className="font-medium">{username}</span></p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => navigate('/chat')}
              className="px-4 py-2 text-sm text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50"
            >
              Vào Chat
            </button>
            <button
              onClick={handleLogout}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-100"
            >
              Đăng xuất
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-xl shadow-sm">
          <div className="flex border-b">
            {[
              { id: 'users',     label: 'Người dùng' },
              { id: 'whitelist', label: 'Whitelist Email' },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-6 py-4 text-sm font-medium border-b-2 transition-colors ${
                  tab === t.id
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="p-6">
            {tab === 'users'     && <UsersTab api={api} currentUserId={userId} />}
            {tab === 'whitelist' && <WhitelistTab api={api} />}
          </div>
        </div>

      </div>
    </div>
  );
}
