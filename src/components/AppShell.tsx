import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  Calendar,
  CalendarClock,
  FileText,
  GitCompareArrows,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Phone,
  Settings,
  UserCircle,
  Users,
  UserCheck,
  Clock,
  X,
} from 'lucide-react';
import { Avatar } from './Avatar';
import { LoggedInUser } from './LoginView';
import { roleLabel } from '../lib/format';

export interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
}

export function getNavForRole(
  role: LoggedInUser['role'],
  unreadMessages = 0,
  unreadNotifications = 0,
  openComplaints = 0
): NavItem[] {
  if (role === 'candidate') {
    return [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'messages', label: 'Messages', icon: MessageSquare, badge: unreadMessages },
      { id: 'availability', label: 'My Availability', icon: CalendarClock },
      { id: 'interviews', label: 'Interviews', icon: Calendar },
      { id: 'complaints', label: 'Complaints', icon: AlertTriangle },
      { id: 'documents', label: 'My Documents', icon: FileText },
      { id: 'profile', label: 'My Profile', icon: UserCircle },
      { id: 'notifications', label: 'Notifications', icon: Bell, badge: unreadNotifications },
      { id: 'settings', label: 'Settings', icon: Settings },
    ];
  }

  if (role === 'recruiter') {
    return [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'candidates', label: 'My Candidates', icon: Users },
      { id: 'messages', label: 'Messages', icon: MessageSquare, badge: unreadMessages },
      { id: 'availability', label: 'Availability', icon: CalendarClock },
      { id: 'interviews', label: 'Interviews', icon: Calendar },
      { id: 'complaints', label: 'Complaints', icon: AlertTriangle, badge: openComplaints },
      { id: 'calls', label: 'Calls', icon: Phone },
      { id: 'reminders', label: 'Reminders', icon: Clock },
      { id: 'notifications', label: 'Notifications', icon: Bell, badge: unreadNotifications },
      { id: 'settings', label: 'Settings', icon: Settings },
    ];
  }

  return [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'candidates', label: 'Candidates', icon: Users },
    { id: 'recruiters', label: 'Recruiters', icon: UserCheck },
    { id: 'assignments', label: 'Assignments', icon: GitCompareArrows },
    { id: 'messages', label: 'All Conversations', icon: MessageSquare, badge: unreadMessages },
    { id: 'complaints', label: 'Complaints', icon: AlertTriangle, badge: openComplaints },
    { id: 'availability', label: 'Availability Overview', icon: CalendarClock },
    { id: 'interviews', label: 'Interview Calendar', icon: Calendar },
    { id: 'calls', label: 'Calls', icon: Phone },
    { id: 'audit', label: 'Activity Logs', icon: Activity },
    { id: 'reports', label: 'Reports', icon: BarChart3 },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];
}

interface AppShellProps {
  user: LoggedInUser;
  activeTab: string;
  onSelectTab: (tab: string) => void;
  unreadMessages: number;
  unreadNotifications: number;
  openComplaints?: number;
  onLogout: () => void;
  children: React.ReactNode;
}

export function AppShell({
  user,
  activeTab,
  onSelectTab,
  unreadMessages,
  unreadNotifications,
  openComplaints = 0,
  onLogout,
  children,
}: AppShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navItems = getNavForRole(user.role, unreadMessages, unreadNotifications, openComplaints);
  const activeItem = navItems.find((n) => n.id === activeTab) || navItems[0];

  const handleNavClick = (id: string) => {
    onSelectTab(id);
    setMobileMenuOpen(false);
  };

  const sidebarContent = (
    <div className="flex flex-col h-full bg-slate-900 text-slate-100 w-64 shrink-0">
      <div className="h-16 px-5 flex items-center justify-between border-b border-slate-800">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shrink-0">
            <MessageSquare className="w-4 h-4" />
          </div>
          <span className="font-display text-sm font-semibold tracking-tight text-white whitespace-nowrap truncate">
            Recruitment Messenger
          </span>
        </div>
        <button
          type="button"
          aria-label="Close navigation menu"
          onClick={() => setMobileMenuOpen(false)}
          className="lg:hidden p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="px-5 py-3 border-b border-slate-800/80 text-xs text-slate-400">
        {user.role === 'team_lead'
          ? 'Team Lead Administration'
          : user.role === 'recruiter'
          ? 'Recruiter Workspace'
          : 'Candidate Portal'}
      </div>

      <nav aria-label="Primary navigation" className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.id === activeTab;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleNavClick(item.id)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors cursor-pointer ${
                isActive
                  ? 'bg-blue-600 text-white font-medium'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white tracking-[0.01em]'
              }`}
            >
              <span className="flex items-center gap-3 min-w-0">
                <Icon className="w-4 h-4 shrink-0" />
                <span className="whitespace-nowrap truncate">{item.label}</span>
              </span>
              {item.badge !== undefined && item.badge > 0 && (
                <span
                  className={`font-mono text-xs tabular-nums px-1.5 py-0.5 rounded ${
                    isActive ? 'bg-blue-700 text-white' : 'bg-slate-800 text-slate-200'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-800">
        <div className="flex items-center gap-3">
          <Avatar name={user.fullName} src={user.avatarUrl} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-white truncate">{user.fullName}</div>
            <div className="text-xs text-slate-400 truncate">{roleLabel(user.role)}</div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            aria-label="Sign out"
            title="Sign out"
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:fixed lg:inset-y-0 lg:left-0 lg:z-30">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/50"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="relative z-10 flex h-full">{sidebarContent}</div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 lg:pl-64">
        <header className="sticky top-0 z-20 h-16 bg-white border-b border-slate-200 px-4 lg:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              aria-label="Open navigation menu"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 rounded-lg text-slate-600 hover:bg-slate-100"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="hidden sm:inline text-slate-400 whitespace-nowrap">
                {roleLabel(user.role)}
              </span>
              <span className="hidden sm:inline text-slate-300" aria-hidden="true">
                /
              </span>
              <h1 className="font-display text-base font-semibold text-slate-900 truncate">
                {activeItem?.label}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden md:inline text-xs text-slate-500 font-mono whitespace-nowrap">
              {user.timezone.replace('_', ' ')}
            </span>
            <button
              type="button"
              onClick={() => onSelectTab('notifications')}
              aria-label={`Notifications (${unreadNotifications} unread)`}
              className="relative p-2 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <Bell className="w-4 h-4" />
              {unreadNotifications > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-blue-600" />
              )}
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Switch Role / Sign Out
            </button>
          </div>
        </header>

        <main className="flex-1 min-w-0 p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
