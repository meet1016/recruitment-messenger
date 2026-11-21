import { useCallback, useEffect, useState } from 'react';
import { apiRequest, realtimeClient, setAuthToken } from './lib/api';
import { LoginView, LoggedInUser } from './components/LoginView';
import { AppShell } from './components/AppShell';
import { DashboardView } from './components/DashboardView';
import { MessagingWorkspace } from './components/MessagingWorkspace';
import { AvailabilityView } from './components/AvailabilityView';
import { InterviewsView } from './components/InterviewsView';
import { DirectoryView } from './components/DirectoryView';
import { DocumentsAndProfileView } from './components/DocumentsAndProfileView';
import { ComplaintsView } from './components/ComplaintsView';
import { ActiveCallSession, CallModal } from './components/CallModal';
import {
  AuditLogsView,
  CallsView,
  NotificationsView,
  RemindersView,
  ReportsView,
  SettingsView,
} from './components/SecondaryViews';

export default function App() {
  const [user, setUser] = useState<LoggedInUser | null>(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [openComplaints, setOpenComplaints] = useState(0);
  const [refreshTick, setRefreshTick] = useState(0);
  const [activeCall, setActiveCall] = useState<ActiveCallSession | null>(null);
  const [chatTargetCandidateId, setChatTargetCandidateId] = useState<string | undefined>(undefined);
  const [chatTargetConversationId, setChatTargetConversationId] = useState<string | undefined>(undefined);
  const [scheduleTargetCandidateId, setScheduleTargetCandidateId] = useState<string | undefined>(undefined);

  const syncBadges = useCallback(async () => {
    try {
      const [convRes, notifRes, cmpRes] = await Promise.all([
        apiRequest<{ conversations: any[] }>('/api/conversations'),
        apiRequest<{ notifications: any[] }>('/api/notifications'),
        apiRequest<{ openCount: number }>('/api/complaints'),
      ]);
      const msgCount = convRes.conversations.reduce((acc, c) => acc + (Number(c.unread_count) || 0), 0);
      const notifCount = notifRes.notifications.filter((n) => !n.is_read).length;
      setUnreadMessages(msgCount);
      setUnreadNotifications(notifCount);
      setOpenComplaints(cmpRes.openCount || 0);
    } catch {
      // ignore if session ended
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    try {
      const me = await apiRequest<{ user: LoggedInUser; onlineUserIds: string[] }>('/api/auth/me');
      setUser(me.user);
      setOnlineUserIds(me.onlineUserIds || []);
    } catch {
      // ignore
    }
  }, []);

  const handleAuthenticated = (token: string, authedUser: LoggedInUser) => {
    setAuthToken(token);
    setUser(authedUser);
    setActiveTab('dashboard');
    realtimeClient.connect(token);
  };

  const handleLogout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    realtimeClient.disconnect();
    setAuthToken(null);
    setUser(null);
    setActiveCall(null);
    setUnreadMessages(0);
    setUnreadNotifications(0);
    setOpenComplaints(0);
    setChatTargetCandidateId(undefined);
    setChatTargetConversationId(undefined);
  };

  useEffect(() => {
    if (!user) return;
    syncBadges();

    const unsubscribe = realtimeClient.subscribe((evt) => {
      if (evt.type === 'presence:sync') {
        setOnlineUserIds(evt.onlineUserIds || []);
      } else if (evt.type === 'presence:update') {
        setOnlineUserIds((prev) => {
          const next = new Set(prev);
          if (evt.online) next.add(evt.userId);
          else next.delete(evt.userId);
          return Array.from(next);
        });
      } else if (
        evt.type === 'message:new' ||
        evt.type === 'notification:new' ||
        evt.type === 'assignment:changed' ||
        evt.type === 'complaint:new' ||
        evt.type === 'complaint:updated'
      ) {
        syncBadges();
        setRefreshTick((t) => t + 1);
      } else if (evt.type === 'call:invite') {
        setActiveCall({
          callId: evt.callId,
          conversationId: evt.conversationId,
          peerUserId: evt.fromUserId,
          peerName: evt.fromUserName || 'Participant',
          callType: evt.callType === 'video' ? 'video' : 'audio',
          direction: 'incoming',
          offerSdp: evt.offer,
        });
      }
    });

    return () => {
      unsubscribe();
    };
  }, [user?.id, syncBadges]);

  if (!user) {
    return <LoginView onAuthenticated={handleAuthenticated} />;
  }

  const handleNavigate = (tab: string, ctx?: { candidateId?: string; conversationId?: string }) => {
    if (tab === 'messages') {
      setChatTargetCandidateId(ctx?.candidateId);
      setChatTargetConversationId(ctx?.conversationId);
    }
    if (ctx?.candidateId && tab === 'interviews') {
      setScheduleTargetCandidateId(ctx.candidateId);
    } else if (tab !== 'interviews') {
      setScheduleTargetCandidateId(undefined);
    }
    setActiveTab(tab);
  };

  const handleStartDirectChat = async (targetUserId: string) => {
    try {
      const res = await apiRequest<{ conversationId: string }>('/api/conversations/direct', {
        method: 'POST',
        body: { targetUserId },
      });
      handleNavigate('messages', { conversationId: res.conversationId });
    } catch {
      handleNavigate('messages');
    }
  };

  return (
    <>
      <AppShell
        user={user}
        activeTab={activeTab}
        onSelectTab={(tab) => handleNavigate(tab)}
        unreadMessages={unreadMessages}
        unreadNotifications={unreadNotifications}
        openComplaints={openComplaints}
        onLogout={handleLogout}
      >
        {activeTab === 'dashboard' && (
          <DashboardView user={user} onNavigate={handleNavigate} refreshTick={refreshTick} />
        )}

        {activeTab === 'messages' && (
          <MessagingWorkspace
            user={user}
            onlineUserIds={onlineUserIds}
            onStartCall={setActiveCall}
            onConversationsUpdated={syncBadges}
            initialCandidateId={chatTargetCandidateId}
            initialConversationId={chatTargetConversationId}
          />
        )}

        {activeTab === 'availability' && (
          <AvailabilityView
            user={user}
            onScheduleInterviewForCandidate={
              user.role !== 'candidate'
                ? (candId) => handleNavigate('interviews', { candidateId: candId })
                : undefined
            }
          />
        )}

        {activeTab === 'interviews' && (
          <InterviewsView user={user} preselectCandidateId={scheduleTargetCandidateId} />
        )}

        {activeTab === 'complaints' && (
          <ComplaintsView
            user={user}
            onOpenCandidateChat={(candId) => handleNavigate('messages', { candidateId: candId })}
            onOpenDirectChat={handleStartDirectChat}
            onComplaintsUpdated={syncBadges}
          />
        )}

        {activeTab === 'candidates' && user.role !== 'candidate' && (
          <DirectoryView
            user={user}
            mode="candidates"
            onOpenChatForCandidate={(candId) => handleNavigate('messages', { candidateId: candId })}
          />
        )}

        {activeTab === 'recruiters' && user.role === 'team_lead' && (
          <DirectoryView
            user={user}
            mode="recruiters"
            onOpenChatForCandidate={(candId) => handleNavigate('messages', { candidateId: candId })}
          />
        )}

        {activeTab === 'assignments' && user.role === 'team_lead' && (
          <DirectoryView
            user={user}
            mode="assignments"
            onOpenChatForCandidate={(candId) => handleNavigate('messages', { candidateId: candId })}
          />
        )}

        {activeTab === 'documents' && user.role === 'candidate' && (
          <DocumentsAndProfileView user={user} mode="documents" onUserUpdated={refreshProfile} />
        )}

        {activeTab === 'profile' && user.role === 'candidate' && (
          <DocumentsAndProfileView user={user} mode="profile" onUserUpdated={refreshProfile} />
        )}

        {activeTab === 'calls' && <CallsView user={user} />}

        {activeTab === 'reminders' && user.role !== 'candidate' && <RemindersView user={user} />}

        {activeTab === 'notifications' && (
          <NotificationsView user={user} onNavigate={handleNavigate} onReadAll={syncBadges} />
        )}

        {activeTab === 'audit' && user.role === 'team_lead' && <AuditLogsView user={user} />}

        {activeTab === 'reports' && user.role === 'team_lead' && <ReportsView />}

        {activeTab === 'settings' && <SettingsView user={user} onUserUpdated={refreshProfile} />}
      </AppShell>

      {activeCall && <CallModal session={activeCall} onClose={() => setActiveCall(null)} />}
    </>
  );
}
