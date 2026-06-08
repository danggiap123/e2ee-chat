import { useState } from 'react';
import * as api from '../services/api.js';
import Avatar from './Avatar.jsx';

// token        : string
// currentUserId: string — để loại bỏ bản thân khỏi kết quả tìm kiếm
// onClose      : () => void
// onCreated    : (group) => void — callback sau khi tạo nhóm thành công
export default function CreateGroupModal({ token, currentUserId, onClose, onCreated }) {
  const [groupName, setGroupName]     = useState('');
  const [keyword, setKeyword]         = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selected, setSelected]       = useState([]); // [{ id, username }]
  const [isSearching, setIsSearching] = useState(false);
  const [isCreating, setIsCreating]   = useState(false);
  const [error, setError]             = useState('');

  async function handleSearch() {
    if (keyword.trim().length < 2) return;
    setIsSearching(true);
    try {
      const data = await api.searchUsers(token, keyword.trim());
      // Loại bỏ bản thân và những người đã được chọn
      const filtered = data.users.filter(
        u => u.id !== currentUserId && !selected.find(s => s.id === u.id)
      );
      setSearchResults(filtered);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSearching(false);
    }
  }

  function handleSelect(user) {
    setSelected(prev => [...prev, user]);
    setSearchResults(prev => prev.filter(u => u.id !== user.id));
    setKeyword('');
  }

  function handleRemove(userId) {
    const removed = selected.find(u => u.id === userId);
    setSelected(prev => prev.filter(u => u.id !== userId));
    if (removed) setSearchResults(prev => [...prev, removed]);
  }

  async function handleCreate() {
    setError('');
    if (!groupName.trim()) {
      setError('Vui lòng nhập tên nhóm');
      return;
    }
    if (selected.length === 0) {
      setError('Vui lòng chọn ít nhất 1 thành viên');
      return;
    }

    setIsCreating(true);
    try {
      const data = await api.createGroup(token, {
        name: groupName.trim(),
        memberIds: selected.map(u => u.id),
      });
      onCreated({
        groupId: data.groupId,
        name: data.name,
        createdBy: data.createdBy,
        members: [
          { id: currentUserId, username: 'Bạn' },
          ...selected,
        ],
        lastMessageAt: new Date().toISOString(),
      });
    } catch (err) {
      setError(err.message);
      setIsCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Tạo nhóm mới</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        {/* Tên nhóm */}
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">Tên nhóm</label>
          <input
            type="text"
            value={groupName}
            onChange={e => setGroupName(e.target.value)}
            placeholder="Nhập tên nhóm..."
            className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Tìm kiếm thành viên */}
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">Thêm thành viên</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="Tìm theo username..."
              className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleSearch}
              disabled={isSearching || keyword.trim().length < 2}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {isSearching ? '...' : 'Tìm'}
            </button>
          </div>
        </div>

        {/* Kết quả tìm kiếm */}
        {searchResults.length > 0 && (
          <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 max-h-36 overflow-y-auto">
            {searchResults.map(user => (
              <button
                key={user.id}
                onClick={() => handleSelect(user)}
                className="w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-50 transition-colors text-left"
              >
                <Avatar userId={user.id} username={user.username} size="sm" />
                <span className="text-sm text-gray-800">{user.username}</span>
                <span className="ml-auto text-xs text-blue-600">+ Thêm</span>
              </button>
            ))}
          </div>
        )}

        {/* Thành viên đã chọn */}
        {selected.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 mb-2">Đã chọn ({selected.length} người):</p>
            <div className="flex flex-wrap gap-2">
              {selected.map(user => (
                <span
                  key={user.id}
                  className="flex items-center gap-1 bg-blue-50 text-blue-700 text-xs px-2 py-1 rounded-full"
                >
                  {user.username}
                  <button
                    onClick={() => handleRemove(user.id)}
                    className="hover:text-blue-900 leading-none"
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Lỗi */}
        {error && <p className="text-sm text-red-500">{error}</p>}

        {/* Nút tạo */}
        <div className="flex gap-3 pt-1">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Hủy
          </button>
          <button
            onClick={handleCreate}
            disabled={isCreating}
            className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {isCreating ? 'Đang tạo...' : 'Tạo nhóm'}
          </button>
        </div>

      </div>
    </div>
  );
}
