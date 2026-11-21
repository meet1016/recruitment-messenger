import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  CheckCheck,
  Download,
  FileText,
  Lock,
  MessageSquarePlus,
  Mic,
  Paperclip,
  Phone,
  Reply,
  Search,
  Send,
  Shield,
  Square,
  Video,
  X,
} from 'lucide-react';
import { apiRequest, realtimeClient } from '../lib/api';
import { Avatar } from './Avatar';
import { LoggedInUser } from './LoginView';
import { ActiveCallSession } from './CallModal';
import {
  availabilityMeta,
  formatBytes,
  formatDateTimeInTz,
  formatTimeOnly,
  interviewStatusMeta,
} from '../lib/format';

interface MessagingWorkspaceProps {
  user: LoggedInUser;
  onlineUserIds: string[];
  onStartCall: (session: ActiveCallSession) => void;
  onConversationsUpdated: () => void;
  initialCandidateId?: string;
  initialConversationId?: string;
}

const REACTION_CHOICES = ['👍', '✅', '📅', '👏'];

function getThreadMeta(conv: any, userRole: LoggedInUser['role']) {
  const threadType = conv.thread_type || 'candidate_recruiter';

  if (threadType === 'team_lead_candidate') {
    if (userRole === 'candidate') {
      return {
        title: conv.recruiter_name,
        avatar: conv.recruiter_avatar,
        peerId: conv.recruiter_id,
        subtitle: 'Team Lead · Direct Chat',
        badge: 'Team Lead',
        hasCandidateContext: false,
      };
    }
    return {
      title: conv.candidate_name,
      avatar: conv.candidate_avatar,
      peerId: conv.candidate_id,
      subtitle: `${conv.technology || 'Candidate'} · Direct with Team Lead`,
      badge: 'Direct · Candidate',
      hasCandidateContext: true,
    };
  }

  if (threadType === 'team_lead_recruiter') {
    if (userRole === 'recruiter') {
      return {
        title: conv.candidate_name,
        avatar: conv.candidate_avatar,
        peerId: conv.candidate_id,
        subtitle: 'Team Lead · Direct Chat',
        badge: 'Team Lead',
        hasCandidateContext: false,
      };
    }
    return {
      title: conv.recruiter_name,
      avatar: conv.recruiter_avatar,
      peerId: conv.recruiter_id,
      subtitle: 'Recruiter · Direct with Team Lead',
      badge: 'Direct · Recruiter',
      hasCandidateContext: false,
    };
  }

  // candidate_recruiter shared thread
  if (userRole === 'candidate') {
    return {
      title: conv.recruiter_name,
      avatar: conv.recruiter_avatar,
      peerId: conv.recruiter_id,
      subtitle: 'Assigned Recruiter',
      badge: '',
      hasCandidateContext: false,
    };
  }
  if (userRole === 'team_lead') {
    return {
      title: `${conv.candidate_name} ↔ ${conv.recruiter_name}`,
      avatar: conv.candidate_avatar,
      peerId: conv.candidate_id,
      subtitle: `${conv.technology || 'Candidate'} · Recruiter: ${conv.recruiter_name}${conv.is_active === 0 ? ' · Archived' : ''}`,
      badge: 'Shared Thread',
      hasCandidateContext: true,
    };
  }
  return {
    title: conv.candidate_name,
    avatar: conv.candidate_avatar,
    peerId: conv.candidate_id,
    subtitle: `${conv.technology || 'Candidate'}${conv.visa_status ? ` · ${conv.visa_status}` : ''}`,
    badge: '',
    hasCandidateContext: true,
  };
}

export function MessagingWorkspace({
  user,
  onlineUserIds,
  onStartCall,
  onConversationsUpdated,
  initialCandidateId,
  initialConversationId,
}: MessagingWorkspaceProps) {
  const [conversations, setConversations] = useState<any[]>([]);
  const [convSearch, setConvSearch] = useState('');
  const [threadFilter, setThreadFilter] = useState<'all' | 'shared' | 'direct'>('all');
  const [directTargets, setDirectTargets] = useState<any[]>([]);
  const [showDirectPicker, setShowDirectPicker] = useState(false);
  const [startingDirect, setStartingDirect] = useState(false);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(initialConversationId || null);
  const [messages, setMessages] = useState<any[]>([]);
  const [oversightNotice, setOversightNotice] = useState('');
  const [msgSearch, setMsgSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<any | null>(null);
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState('');

  // Right panel candidate details + private internal notes (Recruiter & Team Lead only)
  const [candidateDetail, setCandidateDetail] = useState<any | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedConv = conversations.find((c) => c.id === selectedConvId) || null;
  const selectedMeta = selectedConv ? getThreadMeta(selectedConv, user.role) : null;
  const isStaff = user.role === 'recruiter' || user.role === 'team_lead';

  const visibleConversations = conversations.filter((c) => {
    const tt = c.thread_type || 'candidate_recruiter';
    if (threadFilter === 'shared') return tt === 'candidate_recruiter';
    if (threadFilter === 'direct') return tt !== 'candidate_recruiter';
    return true;
  });

  const loadConversations = async (query = convSearch, forceSelectId?: string) => {
    try {
      const res = await apiRequest<{ conversations: any[] }>(
        `/api/conversations${query ? `?q=${encodeURIComponent(query)}` : ''}`
      );
      setConversations(res.conversations);
      if (forceSelectId) {
        setSelectedConvId(forceSelectId);
      } else if (!selectedConvId && res.conversations.length > 0) {
        const preferred = initialConversationId
          ? res.conversations.find((c) => c.id === initialConversationId)
          : initialCandidateId
          ? res.conversations.find(
              (c) => c.candidate_id === initialCandidateId && (c.thread_type || 'candidate_recruiter') === 'candidate_recruiter'
            )
          : res.conversations[0];
        setSelectedConvId((preferred || res.conversations[0]).id);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load conversations.');
    }
  };

  const loadDirectTargets = async () => {
    try {
      const res = await apiRequest<{ targets: any[] }>('/api/conversations/direct-targets');
      setDirectTargets(res.targets || []);
    } catch {
      // ignore
    }
  };

  const handleOpenDirectChat = async (targetUserId: string) => {
    if (startingDirect) return;
    setStartingDirect(true);
    setError('');
    try {
      const res = await apiRequest<{ conversationId: string }>('/api/conversations/direct', {
        method: 'POST',
        body: { targetUserId },
      });
      setShowDirectPicker(false);
      setThreadFilter('all');
      await loadConversations(convSearch, res.conversationId);
    } catch (err: any) {
      setError(err.message || 'Could not start direct chat.');
    } finally {
      setStartingDirect(false);
    }
  };

  const loadMessages = async (convId: string, search = msgSearch) => {
    try {
      const res = await apiRequest<{ messages: any[]; oversightNotice: string }>(
        `/api/conversations/${convId}/messages${search ? `?q=${encodeURIComponent(search)}` : ''}`
      );
      setMessages(res.messages);
      setOversightNotice(res.oversightNotice);
      onConversationsUpdated();
    } catch (err: any) {
      setError(err.message || 'Failed to load message history.');
    }
  };

  const loadCandidateSidebar = async (candidateId: string) => {
    if (!isStaff) return;
    try {
      const res = await apiRequest(`/api/candidates/${candidateId}`);
      setCandidateDetail(res);
    } catch {
      setCandidateDetail(null);
    }
  };

  useEffect(() => {
    loadConversations();
    loadDirectTargets();
  }, []);

  useEffect(() => {
    if (initialConversationId) {
      setSelectedConvId(initialConversationId);
      loadConversations(convSearch, initialConversationId);
    }
  }, [initialConversationId]);

  useEffect(() => {
    if (selectedConvId) {
      loadMessages(selectedConvId, msgSearch);
    }
  }, [selectedConvId, msgSearch]);

  useEffect(() => {
    if (selectedConv && isStaff && selectedMeta?.hasCandidateContext) {
      loadCandidateSidebar(selectedConv.candidate_id);
    } else {
      setCandidateDetail(null);
    }
  }, [selectedConv?.id, selectedConv?.candidate_id, selectedMeta?.hasCandidateContext]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Real-time WebSocket updates (idempotent)
  useEffect(() => {
    return realtimeClient.subscribe((evt) => {
      if (evt.type === 'message:new') {
        if (evt.conversationId === selectedConvId && evt.message) {
          setMessages((prev) =>
            prev.some((m) => m.id === evt.message.id) ? prev : [...prev, evt.message]
          );
        }
        loadConversations();
      } else if (evt.type === 'message:read' && evt.conversationId === selectedConvId) {
        setMessages((prev) =>
          prev.map((m) => (m.sender_id === user.id && !m.read_at ? { ...m, read_at: evt.readAt } : m))
        );
      } else if (evt.type === 'message:reaction' && evt.conversationId === selectedConvId) {
        setMessages((prev) =>
          prev.map((m) => (m.id === evt.messageId ? { ...m, reactions: evt.reactions } : m))
        );
      } else if (evt.type === 'typing:start' && evt.conversationId === selectedConvId) {
        setTypingUser(evt.fullName || 'Typing');
      } else if (evt.type === 'typing:stop' && evt.conversationId === selectedConvId) {
        setTypingUser(null);
      } else if (evt.type === 'assignment:changed') {
        loadConversations();
      }
    });
  }, [selectedConvId, user.id]);

  const handleDraftChange = (val: string) => {
    setDraft(val);
    if (!selectedConvId) return;
    realtimeClient.send({ type: 'typing:start', conversationId: selectedConvId });
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      realtimeClient.send({ type: 'typing:stop', conversationId: selectedConvId });
    }, 1500);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedConvId || !draft.trim() || sending) return;
    setSending(true);
    setError('');
    try {
      const res = await apiRequest<{ message: any }>(`/api/conversations/${selectedConvId}/messages`, {
        method: 'POST',
        body: {
          body: draft.trim(),
          messageType: 'text',
          replyToId: replyTo?.id || null,
        },
      });
      setMessages((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]));
      setDraft('');
      setReplyTo(null);
      realtimeClient.send({ type: 'typing:stop', conversationId: selectedConvId });
      loadConversations();
    } catch (err: any) {
      setError(err.message || 'Failed to send message.');
    } finally {
      setSending(false);
    }
  };

  const handleFileUpload = async (file: File, forceVoiceNote = false) => {
    if (!selectedConv) return;
    setUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const scopeUserId =
        selectedConv.thread_type === 'team_lead_recruiter'
          ? selectedConv.recruiter_id
          : selectedConv.candidate_id;
      form.append('candidateId', scopeUserId);
      form.append('category', forceVoiceNote ? 'voice_note' : 'chat_file');

      const uploaded = await apiRequest<{ attachment: any }>('/api/uploads', {
        method: 'POST',
        body: form,
        isFormData: true,
      });

      const isImg = file.type.startsWith('image/');
      const msgType = forceVoiceNote ? 'voice_note' : isImg ? 'image' : 'document';

      const sent = await apiRequest<{ message: any }>(`/api/conversations/${selectedConv.id}/messages`, {
        method: 'POST',
        body: {
          body: forceVoiceNote ? 'Voice note' : file.name,
          messageType: msgType,
          attachmentId: uploaded.attachment.id,
        },
      });
      setMessages((prev) => (prev.some((m) => m.id === sent.message.id) ? prev : [...prev, sent.message]));
      loadConversations();
    } catch (err: any) {
      setError(err.message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const toggleVoiceRecording = async () => {
    if (recording) {
      mediaRecorderRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordedChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
        const voiceFile = new File([blob], `voice-note-${Date.now()}.webm`, { type: 'audio/webm' });
        await handleFileUpload(voiceFile, true);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setError('Microphone permission is required to record a voice note.');
    }
  };

  const handleReact = async (messageId: string, emoji: string) => {
    try {
      const res = await apiRequest<{ reactions: Record<string, string[]> }>(`/api/messages/${messageId}/react`, {
        method: 'POST',
        body: { emoji },
      });
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, reactions: res.reactions } : m)));
    } catch {
      // ignore
    }
  };

  const handleLaunchCall = async (callType: 'audio' | 'video') => {
    if (!selectedConv || !selectedMeta) return;
    const peerUserId = selectedMeta.peerId;
    const peerName = selectedMeta.title;
    const peerAvatar = selectedMeta.avatar;

    try {
      const created = await apiRequest<{ callId: string }>('/api/calls', {
        method: 'POST',
        body: { conversationId: selectedConv.id, calleeId: peerUserId, callType },
      });
      onStartCall({
        callId: created.callId,
        conversationId: selectedConv.id,
        peerUserId,
        peerName,
        peerAvatar,
        callType,
        direction: 'outgoing',
      });
    } catch (err: any) {
      setError(err.message || 'Unable to start call.');
    }
  };

  const handleSaveInternalNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedConv || !noteDraft.trim() || savingNote) return;
    setSavingNote(true);
    try {
      const res = await apiRequest<{ note: any }>(`/api/candidates/${selectedConv.candidate_id}/notes`, {
        method: 'POST',
        body: { content: noteDraft.trim() },
      });
      setCandidateDetail((prev: any) =>
        prev ? { ...prev, internalNotes: [res.note, ...(prev.internalNotes || [])] } : prev
      );
      setNoteDraft('');
    } catch (err: any) {
      setError(err.message || 'Could not save internal note.');
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col lg:flex-row h-[calc(100vh-8.5rem)] min-h-[580px]">
      {/* LEFT PANEL: Conversations List */}
      <div className="w-full lg:w-72 xl:w-80 border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col shrink-0 max-h-72 lg:max-h-none">
        <div className="p-3.5 border-b border-slate-200 space-y-2.5">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              aria-label="Search conversations"
              value={convSearch}
              onChange={(e) => {
                setConvSearch(e.target.value);
                loadConversations(e.target.value);
              }}
              placeholder={user.role === 'team_lead' ? 'Search recruiter or candidate...' : 'Search conversations...'}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          {/* Direct Team Lead Chat Controls */}
          {user.role === 'team_lead' ? (
            <div className="space-y-2">
              <div className="flex items-center gap-1">
                {[
                  { id: 'all', label: 'All' },
                  { id: 'shared', label: 'Cand ↔ Rec' },
                  { id: 'direct', label: 'Direct' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setThreadFilter(tab.id as any)}
                    className={`flex-1 py-1 text-[11px] font-medium rounded-md border transition-colors cursor-pointer ${
                      threadFilter === tab.id
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setShowDirectPicker((v) => !v)}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
              >
                <MessageSquarePlus className="w-3.5 h-3.5" />
                {showDirectPicker ? 'Close Direct Chat Picker' : 'New Direct Chat'}
              </button>

              {showDirectPicker && (
                <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 divide-y divide-slate-200/80">
                  {directTargets.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      disabled={startingDirect}
                      onClick={() => handleOpenDirectChat(t.id)}
                      className="w-full px-3 py-2 text-left hover:bg-white flex items-center justify-between gap-2 text-xs cursor-pointer"
                    >
                      <span className="truncate font-medium text-slate-800">{t.full_name}</span>
                      <span className="text-[11px] text-slate-500 shrink-0 capitalize">
                        {t.role === 'recruiter' ? 'Recruiter' : 'Candidate'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            directTargets.length > 0 && (
              <button
                type="button"
                disabled={startingDirect}
                onClick={() => handleOpenDirectChat(directTargets[0].id)}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <MessageSquarePlus className="w-3.5 h-3.5 text-blue-600" />
                Chat with Team Lead ({directTargets[0].full_name})
              </button>
            )
          )}
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {visibleConversations.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">No active conversations found.</div>
          ) : (
            visibleConversations.map((conv) => {
              const isSelected = conv.id === selectedConvId;
              const meta = getThreadMeta(conv, user.role);
              const isOnline = onlineUserIds.includes(meta.peerId);

              return (
                <button
                  key={conv.id}
                  type="button"
                  onClick={() => setSelectedConvId(conv.id)}
                  className={`w-full p-3.5 text-left flex items-start gap-3 transition-colors cursor-pointer ${
                    isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                  }`}
                >
                  <Avatar name={meta.title} src={meta.avatar} size="sm" online={isOnline} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-slate-900 truncate">{meta.title}</span>
                      <span className="text-[11px] font-mono tabular-nums text-slate-400 shrink-0">
                        {conv.last_message_at ? formatTimeOnly(conv.last_message_at, user.timezone) : ''}
                      </span>
                    </div>
                    {meta.badge && (
                      <div className="text-[11px] text-blue-700 font-medium truncate mt-0.5">
                        {meta.badge}
                        {conv.thread_type === 'candidate_recruiter' && user.role === 'team_lead'
                          ? ` · ${conv.technology || 'Candidate'}`
                          : ''}
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <p className="text-xs text-slate-500 truncate">
                        {conv.last_message || 'Start the conversation'}
                      </p>
                      {conv.unread_count > 0 && (
                        <span className="font-mono text-[11px] font-semibold tabular-nums bg-blue-600 text-white px-1.5 py-0.5 rounded shrink-0">
                          {conv.unread_count}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* CENTER PANEL: Active Thread */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedConv && selectedMeta ? (
          <>
            {/* Thread Header */}
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <Avatar
                  name={selectedMeta.title}
                  src={selectedMeta.avatar}
                  size="sm"
                  online={onlineUserIds.includes(selectedMeta.peerId)}
                />
                <div className="min-w-0">
                  <div className="text-sm font-display font-semibold text-slate-900 truncate">
                    {selectedMeta.title}
                  </div>
                  <div className="text-xs text-slate-500 truncate">{selectedMeta.subtitle}</div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <div className="relative hidden sm:block">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="search"
                    aria-label="Search messages in conversation"
                    value={msgSearch}
                    onChange={(e) => setMsgSearch(e.target.value)}
                    placeholder="Search history..."
                    className="w-40 pl-8 pr-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                {(user.role !== 'team_lead' ||
                  (selectedConv.thread_type && selectedConv.thread_type !== 'candidate_recruiter')) && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleLaunchCall('audio')}
                      aria-label="Start audio call"
                      title="Start 1-to-1 audio call"
                      className="p-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      <Phone className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleLaunchCall('video')}
                      aria-label="Start video call"
                      title="Start 1-to-1 video call"
                      className="p-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      <Video className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Transparent Team Lead Oversight / Active Participation Notice */}
            <div className="px-5 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-2 text-xs text-slate-600">
              <Shield className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              <span>
                {user.role === 'team_lead' &&
                (!selectedConv.thread_type || selectedConv.thread_type === 'candidate_recruiter')
                  ? `Team Lead Active Mode — Messages you send here are delivered live to both ${selectedConv.candidate_name} and ${selectedConv.recruiter_name}.`
                  : oversightNotice ||
                    'Authorized Team Leads may review and participate in recruitment conversations for support and compliance.'}
              </span>
            </div>

            {error && (
              <div className="mx-5 mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center justify-between">
                <span>{error}</span>
                <button type="button" onClick={() => setError('')} aria-label="Dismiss error">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Message Feed */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {messages.length === 0 ? (
                <div className="py-12 text-center text-sm text-slate-500">
                  No messages yet. Send a message, attach a document, or record a voice note below.
                </div>
              ) : (
                messages.map((m) => {
                  const isMine = m.sender_id === user.id;
                  const isTeamLeadMsg = m.sender_role === 'team_lead';
                  const repliedMsg = m.reply_to_id ? messages.find((x) => x.id === m.reply_to_id) : null;

                  if (m.message_type === 'call_event') {
                    return (
                      <div key={m.id} className="flex justify-center">
                        <div className="text-xs text-red-700 bg-red-50 border border-red-200 px-3 py-1.5 rounded-lg">
                          {m.body} · {formatDateTimeInTz(m.created_at, user.timezone)}
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={m.id} className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
                      <div className="text-[11px] text-slate-500 mb-1 flex items-center gap-1.5">
                        <span className="font-medium text-slate-700">{m.sender_name}</span>
                        {isTeamLeadMsg && (
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-700 bg-slate-200/80 px-1.5 py-0.5 rounded">
                            Team Lead
                          </span>
                        )}
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {formatDateTimeInTz(m.created_at, user.timezone)}
                        </span>
                      </div>

                      <div
                        className={`max-w-[82%] rounded-xl px-4 py-2.5 text-sm ${
                          isMine
                            ? 'bg-blue-600 text-white'
                            : isTeamLeadMsg
                            ? 'bg-slate-900 text-white border border-slate-800'
                            : 'bg-slate-100 text-slate-900 border border-slate-200/80'
                        }`}
                      >
                        {repliedMsg && (
                          <div
                            className={`mb-2 pb-1.5 border-b text-xs ${
                              isMine ? 'border-blue-500 text-blue-100' : 'border-slate-200 text-slate-500'
                            }`}
                          >
                            Replying to {repliedMsg.sender_name}: {repliedMsg.body.slice(0, 70)}
                          </div>
                        )}

                        {m.message_type === 'image' && m.signedUrl && (
                          <a href={m.signedUrl} target="_blank" rel="noreferrer" className="block mb-2">
                            <img
                              src={m.signedUrl}
                              alt={m.attachment_name || 'Shared image'}
                              className="max-h-56 rounded-lg object-contain bg-white"
                            />
                          </a>
                        )}

                        {m.message_type === 'voice_note' && m.signedUrl && (
                          <audio controls src={m.signedUrl} className="w-60 max-w-full mb-1.5" />
                        )}

                        {m.message_type === 'document' && m.signedUrl && (
                          <a
                            href={m.signedUrl}
                            download={m.attachment_name}
                            className={`mb-2 flex items-center justify-between gap-3 px-3 py-2 rounded-lg border text-xs ${
                              isMine
                                ? 'bg-blue-700/60 border-blue-500 text-white hover:bg-blue-700'
                                : 'bg-white border-slate-200 text-slate-800 hover:bg-slate-50'
                            }`}
                          >
                            <span className="flex items-center gap-2 min-w-0">
                              <FileText className="w-4 h-4 shrink-0" />
                              <span className="truncate font-medium">{m.attachment_name}</span>
                            </span>
                            <span className="flex items-center gap-1.5 shrink-0 font-mono tabular-nums">
                              {formatBytes(m.attachment_size)}
                              <Download className="w-3.5 h-3.5" />
                            </span>
                          </a>
                        )}

                        {m.body && <p className="whitespace-pre-wrap break-words leading-relaxed">{m.body}</p>}
                      </div>

                      {/* Footer: Read receipts + Reactions + Reply */}
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
                        {isMine && (
                          <span className="inline-flex items-center gap-0.5">
                            {m.read_at ? (
                              <>
                                <CheckCheck className="w-3.5 h-3.5 text-blue-600" />
                                <span>Read</span>
                              </>
                            ) : (
                              <>
                                <Check className="w-3.5 h-3.5 text-slate-400" />
                                <span>Delivered</span>
                              </>
                            )}
                          </span>
                        )}

                        {Object.entries(m.reactions || {}).map(([emoji, userIds]) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => handleReact(m.id, emoji)}
                            className="px-1.5 py-0.5 rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
                          >
                            {emoji} {(userIds as string[]).length}
                          </button>
                        ))}

                        <button
                          type="button"
                          onClick={() => setReplyTo(m)}
                          aria-label={`Reply to message from ${m.sender_name}`}
                          className="hover:text-slate-900 inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Reply className="w-3 h-3" />
                          Reply
                        </button>

                        <div className="inline-flex items-center gap-1">
                          {REACTION_CHOICES.map((em) => (
                            <button
                              key={em}
                              type="button"
                              onClick={() => handleReact(m.id, em)}
                              aria-label={`React with ${em}`}
                              className="opacity-60 hover:opacity-100 cursor-pointer"
                            >
                              {em}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {typingUser && (
              <div className="px-5 py-1.5 text-xs text-slate-500 italic">{typingUser} is typing...</div>
            )}

            {/* Composer */}
            <div className="p-3.5 border-t border-slate-200 bg-white">
              {replyTo && (
                <div className="mb-2 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between text-xs text-slate-600">
                  <span className="truncate">
                    Replying to <strong>{replyTo.sender_name}</strong>: {replyTo.body}
                  </span>
                  <button
                    type="button"
                    onClick={() => setReplyTo(null)}
                    aria-label="Cancel reply"
                    className="p-1 text-slate-400 hover:text-slate-700"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.webp,.gif"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileUpload(f, false);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Attach document or image"
                  title="Attach PDF, DOCX, or Image"
                  className="p-2.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
                >
                  <Paperclip className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={toggleVoiceRecording}
                  aria-label={recording ? 'Stop voice note recording' : 'Record voice note'}
                  title={recording ? 'Stop & send voice note' : 'Record voice note'}
                  className={`p-2.5 rounded-lg border cursor-pointer transition-colors ${
                    recording
                      ? 'bg-red-600 border-red-600 text-white'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {recording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>
                <input
                  type="text"
                  aria-label="Message input"
                  value={draft}
                  onChange={(e) => handleDraftChange(e.target.value)}
                  placeholder="Write a message..."
                  className="flex-1 px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <button
                  type="submit"
                  disabled={sending || !draft.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  Send
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center p-8 text-sm text-slate-500">
            Select a conversation to view messages.
          </div>
        )}
      </div>

      {/* RIGHT PANEL: Candidate Profile & Private Internal Notes (Recruiter & Team Lead ONLY, when thread has a candidate) */}
      {isStaff && selectedConv && selectedMeta?.hasCandidateContext && (
        <div className="hidden xl:flex w-80 border-l border-slate-200 flex-col overflow-y-auto bg-slate-50/50 shrink-0">
          {candidateDetail ? (
            <div className="p-5 space-y-6">
              <div>
                <div className="flex items-center gap-3">
                  <Avatar
                    name={candidateDetail.candidate.full_name}
                    src={candidateDetail.candidate.avatar_url}
                    size="md"
                  />
                  <div className="min-w-0">
                    <div className="font-display text-sm font-semibold text-slate-900 truncate">
                      {candidateDetail.candidate.full_name}
                    </div>
                    <div className="text-xs text-slate-500 truncate">{candidateDetail.candidate.location}</div>
                  </div>
                </div>
                <dl className="mt-4 space-y-2 text-xs">
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Skills</dt>
                    <dd className="text-slate-800 font-medium text-right">{candidateDetail.candidate.technology}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Experience</dt>
                    <dd className="text-slate-800 font-mono tabular-nums">
                      {candidateDetail.candidate.experience_years} yrs
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Visa Status</dt>
                    <dd className="text-slate-800 font-medium">{candidateDetail.candidate.visa_status}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Rate</dt>
                    <dd className="text-slate-800 font-mono tabular-nums">
                      {candidateDetail.candidate.hourly_rate || '—'}
                    </dd>
                  </div>
                </dl>
              </div>

              {/* Today's Availability */}
              <div className="border-t border-slate-200 pt-4">
                <h4 className="font-display text-xs font-semibold text-slate-900">Today&apos;s Availability</h4>
                <div className={`mt-1 text-xs ${availabilityMeta(candidateDetail.availability.resolved.status).textClass}`}>
                  {availabilityMeta(candidateDetail.availability.resolved.status).label}
                </div>
                <div className="mt-1.5 space-y-1">
                  {candidateDetail.availability.convertedSlots.length > 0 ? (
                    candidateDetail.availability.convertedSlots.map((s: any, idx: number) => (
                      <div key={idx} className="text-xs font-mono tabular-nums text-slate-600">
                        {s.converted.startLabel} – {s.converted.endLabel} {s.converted.tzAbbr}
                      </div>
                    ))
                  ) : (
                    <div className="text-xs text-slate-500">No open slots today</div>
                  )}
                </div>
              </div>

              {/* Upcoming Interviews */}
              <div className="border-t border-slate-200 pt-4">
                <h4 className="font-display text-xs font-semibold text-slate-900">Recent Interviews</h4>
                <div className="mt-2 space-y-2">
                  {candidateDetail.interviews.slice(0, 3).map((iv: any) => (
                    <div key={iv.id} className="text-xs">
                      <div className="font-medium text-slate-800">{iv.company_name}</div>
                      <div className="text-slate-500 font-mono tabular-nums">
                        {formatDateTimeInTz(iv.start_utc, user.timezone)} ·{' '}
                        <span className={interviewStatusMeta(iv.status).textClass}>
                          {interviewStatusMeta(iv.status).label}
                        </span>
                      </div>
                    </div>
                  ))}
                  {candidateDetail.interviews.length === 0 && (
                    <div className="text-xs text-slate-500">No interviews recorded yet.</div>
                  )}
                </div>
              </div>

              {/* Private Documents */}
              <div className="border-t border-slate-200 pt-4">
                <h4 className="font-display text-xs font-semibold text-slate-900">Verified Documents</h4>
                <div className="mt-2 space-y-1.5">
                  {candidateDetail.documents.slice(0, 3).map((d: any) => (
                    <div key={d.id} className="flex items-center justify-between gap-2 text-xs text-slate-700">
                      <span className="truncate">{d.original_name}</span>
                      <span className="text-slate-400 font-mono shrink-0">{d.version_label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Private Internal Recruiter Notes */}
              <div className="border-t border-slate-200 pt-4">
                <div className="flex items-center gap-1.5 text-xs font-display font-semibold text-slate-900">
                  <Lock className="w-3.5 h-3.5 text-amber-600" />
                  Internal Notes (Private)
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Never visible to the candidate. Shared only with assigned recruiter and Team Leads.
                </p>

                <form onSubmit={handleSaveInternalNote} className="mt-2.5 space-y-2">
                  <textarea
                    rows={2}
                    aria-label="Add private internal recruiter note"
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    placeholder="Add rate guidance, client prep, or visa notes..."
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <button
                    type="submit"
                    disabled={savingNote || !noteDraft.trim()}
                    className="w-full px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                  >
                    {savingNote ? 'Saving...' : 'Save Private Note'}
                  </button>
                </form>

                <div className="mt-3 space-y-2.5">
                  {(candidateDetail.internalNotes || []).map((n: any) => (
                    <div key={n.id} className="p-2.5 rounded-lg bg-amber-50/70 border border-amber-200/80 text-xs">
                      <p className="text-slate-800 leading-relaxed">{n.content}</p>
                      <div className="mt-1.5 text-[11px] text-slate-500">
                        {n.author_name} · {formatDateTimeInTz(n.created_at, user.timezone)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-5 text-xs text-slate-500">Loading candidate context...</div>
          )}
        </div>
      )}
    </div>
  );
}
