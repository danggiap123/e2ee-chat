import { useState, useRef, useEffect } from 'react';
import * as api from '../services/api.js';
import Avatar from './Avatar.jsx';
import FingerprintModal from './FingerprintModal.jsx';

// Panel thông tin nhóm — trượt vào từ bên phải khi click tên nhóm
// Props:
//   group            : { groupId, name, members: [{id, username, ikPub?, isVerifiedByMe?}], adminId }
//   currentUserId    : string
//   myIKPub          : Uint8Array — IK_pub của user hiện tại, dùng để tính fingerprint
//   token            : string
//   onClose          : () => void
//   onMemberAdded    : (member) => void
//   onMemberRemoved  : (userId) => void
//   onAdminTransferred: (newAdminId) => void
//   onLeftGroup      : () => void
//   onMemberVerified : (peerId: string) => void — cập nhật isVerifiedByMe trong Chat.jsx
export default function GroupInfoPanel({
  group, currentUserId, myIKPub, token,
  onClose, onMemberAdded, onMemberRemoved, onAdminTransferred, onLeftGroup, onMemberVerified,
}) {
  const [searchQuery,       setSearchQuery]       = useState('');
  const [searchResults,     setSearchResults]     = useState([]);
  const [isSearching,       setIsSearching]       = useState(false);
  const [showAddSearch,     setShowAddSearch]     = useState(false);
  const [actionLoading,     setActionLoading]     = useState(null);
  const [error,             setError]             = useState('');
  const [showLeaveModal,    setShowLeaveModal]    = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [selectedNewAdmin,  setSelectedNewAdmin]  = useState(null);
  // member đang mở FingerprintModal — { id, username, ikPub }
  const [fingerprintTarget, setFingerprintTarget] = useState(null);
  const searchTimerRef = useRef(null);

  const isAdmin = group.adminId === currentUserId;
  const otherMembers = group.members.filter(m => m.id !== currentUserId);

  // Tìm kiếm user để thêm — debounce 300ms
  useEffect(() => {
    if (!showAddSearch) return;
    if (searchQuery.length < 2) { setSearchResults([]); return; }
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const { users } = await api.searchUsers(token, searchQuery);
        const memberIds = new Set(group.members.map(m => m.id));
        // Lọc người đã là thành viên và chính mình
        setSearchResults(users.filter(u => !memberIds.has(u.id)));
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => clearTimeout(searchTimerRef.current);
  }, [searchQuery, showAddSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAddMember(user) {
    setActionLoading(user.id);
    setError('');
    try {
      await api.addGroupMember(token, group.groupId, user.id);
      onMemberAdded({ id: user.id, username: user.username });
      setSearchQuery('');
      setSearchResults([]);
      setShowAddSearch(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleRemoveMember(memberId) {
    setActionLoading(memberId);
    setError('');
    try {
      await api.removeGroupMember(token, group.groupId, memberId);
      onMemberRemoved(memberId);
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  }

  // Admin tự rời nhóm — phải chọn người kế nhiệm trước
  async function handleLeaveAsAdmin() {
    if (!selectedNewAdmin) { setError('Vui lòng chọn người nhận quyền admin'); return; }
    setActionLoading('leave');
    setError('');
    try {
      await api.removeGroupMember(token, group.groupId, currentUserId, selectedNewAdmin.id);
      onLeftGroup();
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  }

  // Thành viên thường tự rời nhóm
  async function handleLeaveAsMember() {
    setActionLoading('leave');
    setError('');
    try {
      await api.removeGroupMember(token, group.groupId, currentUserId);
      onLeftGroup();
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  }

  // Chuyển quyền admin (không rời nhóm)
  async function handleTransferAdmin() {
    if (!selectedNewAdmin) { setError('Vui lòng chọn người nhận quyền admin'); return; }
    setActionLoading('transfer');
    setError('');
    try {
      await api.transferAdmin(token, group.groupId, selectedNewAdmin.id);
      onAdminTransferred(selectedNewAdmin.id);
      setShowTransferModal(false);
      setSelectedNewAdmin(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  }

  function getAdminId() {
    return group.adminId;
  }

  return (
    <>
      {/* Overlay mờ phía sau panel */}
      <div
        className="fixed inset-0 z-30 bg-black/20"
        onClick={onClose}
      />

      {/* Panel trượt từ phải */}
      <div className="fixed top-0 right-0 h-full w-80 bg-white shadow-2xl z-40 flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 text-base">Thông tin nhóm</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-gray-400 hover:bg-gray-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Avatar + tên nhóm */}
        <div className="flex flex-col items-center gap-2 pt-6 pb-4 px-4">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center text-white text-2xl font-bold"
            style={{ backgroundColor: `hsl(${[...group.name].reduce((a,c) => a + c.charCodeAt(0), 0) % 360}, 55%, 42%)` }}
          >
            {group.name.slice(0, 2).toUpperCase()}
          </div>
          <p className="font-semibold text-gray-900 text-base">{group.name}</p>
          <p className="text-sm text-gray-400">{group.members.length} thành viên</p>
        </div>

        {/* Phần thành viên — cuộn được */}
        <div className="flex-1 overflow-y-auto px-4">

          {/* Error banner */}
          {error && (
            <div className="mb-3 px-3 py-2 bg-red-50 text-red-600 text-xs rounded-lg flex items-start gap-2">
              <span className="shrink-0 mt-0.5">⚠</span>
              <span>{error}</span>
              <button onClick={() => setError('')} className="ml-auto shrink-0 text-red-400 hover:text-red-600">✕</button>
            </div>
          )}

          {/* Danh sách thành viên */}
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
            Thành viên
          </p>

          <div className="space-y-1 mb-3">
            {group.members.map(member => {
              const memberIsAdmin = member.id === getAdminId();
              const isSelf = member.id === currentUserId;
              const isProcessing = actionLoading === member.id;
              const canVerify = !isSelf && !!member.ikPub && myIKPub;
              const isVerified = member.isVerifiedByMe === true;

              return (
                <div
                  key={member.id}
                  className="flex items-center gap-2.5 py-2 px-2 rounded-xl hover:bg-gray-50 transition-colors"
                >
                  <Avatar username={member.username} userId={member.id} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {member.username}
                      {isSelf && <span className="text-gray-400 font-normal"> (Bạn)</span>}
                    </p>
                    {memberIsAdmin && (
                      <span className="text-xs text-amber-600 font-medium flex items-center gap-1">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Admin
                      </span>
                    )}
                  </div>

                  {/* Shield icon xác minh — chỉ hiện với thành viên khác */}
                  {!isSelf && (
                    <button
                      onClick={() => canVerify && setFingerprintTarget(member)}
                      disabled={!canVerify}
                      title={
                        !member.ikPub ? 'Người dùng chưa upload key'
                        : isVerified    ? 'Đã xác minh — click để xem lại'
                        :                 'Click để xác minh danh tính'
                      }
                      className={`p-1.5 rounded-full transition-colors
                        ${isVerified
                          ? 'text-green-500 hover:bg-green-50'
                          : canVerify
                            ? 'text-gray-300 hover:text-blue-500 hover:bg-blue-50'
                            : 'text-gray-200 cursor-not-allowed'
                        }`}
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd"
                          d="M10 1.944A11.954 11.954 0 012.166 5C2.056 5.649 2 6.319 2 7c0 5.225 3.34 9.67 8 11.317C14.66 16.67 18 12.225 18 7c0-.682-.057-1.35-.166-2.001A11.954 11.954 0 0110 1.944zM11 14a1 1 0 11-2 0 1 1 0 012 0zm0-7a1 1 0 10-2 0v3a1 1 0 102 0V7z"
                          clipRule="evenodd" />
                      </svg>
                    </button>
                  )}

                  {/* Nút xóa thành viên — admin thấy với tất cả trừ chính mình */}
                  {isAdmin && !isSelf && (
                    <button
                      onClick={() => handleRemoveMember(member.id)}
                      disabled={isProcessing}
                      className="p-1.5 rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                      title="Xóa khỏi nhóm"
                    >
                      {isProcessing ? (
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M13 7a4 4 0 11-8 0 4 4 0 018 0zM9 14a6 6 0 00-6 6v1h12v-1a6 6 0 00-6-6zM21 12h-6" />
                        </svg>
                      )}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Nút + Thêm thành viên (chỉ admin thấy) */}
          {isAdmin && (
            <div className="mb-4">
              {!showAddSearch ? (
                <button
                  onClick={() => setShowAddSearch(true)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-blue-300 text-blue-600 text-sm hover:bg-blue-50 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  Thêm thành viên
                </button>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-1">
                    <input
                      autoFocus
                      type="text"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="Tìm theo username..."
                      className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                    <button
                      onClick={() => { setShowAddSearch(false); setSearchQuery(''); setSearchResults([]); }}
                      className="p-2 text-gray-400 hover:text-gray-600"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  {isSearching && (
                    <p className="text-xs text-gray-400 text-center py-1 animate-pulse">Đang tìm...</p>
                  )}

                  {searchResults.length > 0 && (
                    <div className="border border-gray-100 rounded-xl overflow-hidden shadow-sm">
                      {searchResults.map(user => (
                        <button
                          key={user.id}
                          onClick={() => handleAddMember(user)}
                          disabled={actionLoading === user.id}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-blue-50 transition-colors text-left disabled:opacity-50"
                        >
                          <Avatar username={user.username} userId={user.id} size="sm" />
                          <span className="text-sm font-medium text-gray-800">{user.username}</span>
                          {actionLoading === user.id && (
                            <svg className="w-4 h-4 ml-auto animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                            </svg>
                          )}
                        </button>
                      ))}
                    </div>
                  )}

                  {!isSearching && searchQuery.length >= 2 && searchResults.length === 0 && (
                    <p className="text-xs text-gray-400 text-center py-1">Không tìm thấy người dùng nào</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Nút chuyển quyền admin (chỉ admin thấy, không rời nhóm) */}
          {isAdmin && otherMembers.length > 0 && (
            <button
              onClick={() => { setShowTransferModal(true); setSelectedNewAdmin(null); setError(''); }}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-gray-600 hover:bg-gray-100 transition-colors mb-1"
            >
              <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
              Chuyển quyền admin
            </button>
          )}
        </div>

        {/* Footer: nút Rời nhóm */}
        <div className="px-4 py-4 border-t border-gray-100">
          <button
            onClick={() => { setShowLeaveModal(true); setSelectedNewAdmin(null); setError(''); }}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium text-red-600 hover:bg-red-50 border border-red-200 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Rời nhóm
          </button>
        </div>
      </div>

      {/* Modal xác nhận rời nhóm */}
      {showLeaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="font-semibold text-gray-900 text-base">
              {isAdmin ? 'Chuyển quyền admin & Rời nhóm' : 'Rời nhóm?'}
            </h3>

            {isAdmin ? (
              <>
                <p className="text-sm text-gray-500">
                  Bạn là admin. Hãy chọn người sẽ tiếp nhận quyền admin trước khi rời nhóm.
                </p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {otherMembers.map(m => (
                    <button
                      key={m.id}
                      onClick={() => setSelectedNewAdmin(m)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-left transition-colors
                        ${selectedNewAdmin?.id === m.id
                          ? 'bg-blue-50 border border-blue-300 text-blue-800'
                          : 'hover:bg-gray-50 text-gray-700'}`}
                    >
                      <Avatar username={m.username} userId={m.id} size="sm" />
                      {m.username}
                      {selectedNewAdmin?.id === m.id && (
                        <svg className="w-4 h-4 ml-auto text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
                {error && <p className="text-xs text-red-500">{error}</p>}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => { setShowLeaveModal(false); setError(''); }}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                  >
                    Hủy
                  </button>
                  <button
                    onClick={handleLeaveAsAdmin}
                    disabled={!selectedNewAdmin || actionLoading === 'leave'}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
                  >
                    {actionLoading === 'leave' ? 'Đang rời...' : 'Rời nhóm'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-500">
                  Bạn sẽ không nhận được tin nhắn mới từ nhóm này nữa.
                </p>
                {error && <p className="text-xs text-red-500">{error}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowLeaveModal(false); setError(''); }}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                  >
                    Hủy
                  </button>
                  <button
                    onClick={handleLeaveAsMember}
                    disabled={actionLoading === 'leave'}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
                  >
                    {actionLoading === 'leave' ? 'Đang rời...' : 'Rời nhóm'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* FingerprintModal — mở khi click shield icon của 1 member */}
      {fingerprintTarget && myIKPub && (
        <FingerprintModal
          myIKPub={myIKPub}
          peerIKPub={fingerprintTarget.ikPub}
          peerUsername={fingerprintTarget.username}
          onClose={() => setFingerprintTarget(null)}
          onConfirm={() => api.verifyPeer(token, fingerprintTarget.id)}
          onVerified={() => {
            onMemberVerified(fingerprintTarget.id);
            setFingerprintTarget(null);
          }}
        />
      )}

      {/* Modal chuyển quyền admin (không rời nhóm) */}
      {showTransferModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="font-semibold text-gray-900 text-base">Chuyển quyền admin</h3>
            <p className="text-sm text-gray-500">Chọn thành viên sẽ trở thành admin mới.</p>

            <div className="space-y-1 max-h-48 overflow-y-auto">
              {otherMembers.map(m => (
                <button
                  key={m.id}
                  onClick={() => setSelectedNewAdmin(m)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-left transition-colors
                    ${selectedNewAdmin?.id === m.id
                      ? 'bg-blue-50 border border-blue-300 text-blue-800'
                      : 'hover:bg-gray-50 text-gray-700'}`}
                >
                  <Avatar username={m.username} userId={m.id} size="sm" />
                  {m.username}
                  {selectedNewAdmin?.id === m.id && (
                    <svg className="w-4 h-4 ml-auto text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              ))}
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => { setShowTransferModal(false); setError(''); setSelectedNewAdmin(null); }}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
              >
                Hủy
              </button>
              <button
                onClick={handleTransferAdmin}
                disabled={!selectedNewAdmin || actionLoading === 'transfer'}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {actionLoading === 'transfer' ? 'Đang chuyển...' : 'Chuyển quyền'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
