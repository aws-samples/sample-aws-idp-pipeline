import { useAuth } from 'react-oidc-context';
import * as React from 'react';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import Config from '../../config';
import { Link, useLocation } from '@tanstack/react-router';

// Navigation icons
const ProjectsIcon = () => (
  <svg
    className="w-5 h-5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const ArtifactsIcon = () => (
  <svg
    className="w-5 h-5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polygon points="12 2 2 7 12 12 22 7 12 2" />
    <polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" />
  </svg>
);

const SettingsIcon = () => (
  <svg
    className="w-5 h-5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const LogoutIcon = () => (
  <svg
    className="w-5 h-5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

const CollapseIcon = ({ collapsed }: { collapsed: boolean }) => (
  <svg
    className={`w-4 h-4 transition-transform ${collapsed ? 'rotate-180' : ''}`}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

const OpenInNewIcon = () => (
  <svg
    className="w-4 h-4"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

/**
 * Defines the App layout with sidebar navigation.
 */
const SIDEBAR_COLLAPSED_KEY = 'idp-sidebar-collapsed';
const THEME_KEY = 'idp-theme';

const AppLayout: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { user, removeUser, signoutRedirect, clearStaleState } = useAuth();
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  });

  const toggleSidebar = () => {
    const newValue = !sidebarCollapsed;
    setSidebarCollapsed(newValue);
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(newValue));
  };

  // Apply theme class from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(THEME_KEY);
    const theme = stored === 'light' ? 'light' : 'dark';
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(theme);
  }, []);

  const navItems = [
    {
      to: '/',
      label: t('nav.projects'),
      icon: <ProjectsIcon />,
      matchPaths: ['/', '/projects'],
    },
    {
      to: '/artifacts',
      label: t('nav.artifacts'),
      icon: <ArtifactsIcon />,
    },
  ];

  const isNavItemActive = (item: (typeof navItems)[0]) => {
    if (item.matchPaths) {
      return item.matchPaths.some(
        (path) => pathname === path || pathname.startsWith(`${path}/`),
      );
    }
    return pathname === item.to || pathname.startsWith(`${item.to}/`);
  };

  const handleLogout = () => {
    removeUser();
    signoutRedirect({
      post_logout_redirect_uri: window.location.origin,
      extraQueryParams: {
        redirect_uri: window.location.origin,
        response_type: 'code',
      },
    });
    clearStaleState();
  };

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
        {/* Logo */}
        <div className="sidebar-header">
          <a href="/" className="sidebar-brand">
            <img
              src="/logo.png"
              alt={`${Config.applicationName} logo`}
              className="sidebar-logo"
            />
            {!sidebarCollapsed && (
              <span className="sidebar-app-name">{Config.applicationName}</span>
            )}
          </a>
          <button
            type="button"
            className="sidebar-collapse-btn"
            onClick={toggleSidebar}
            title={sidebarCollapsed ? t('nav.expand') : t('nav.collapse')}
          >
            <CollapseIcon collapsed={sidebarCollapsed} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`sidebar-nav-item ${isNavItemActive(item) ? 'active' : ''}`}
              title={sidebarCollapsed ? item.label : undefined}
            >
              {item.icon}
              {!sidebarCollapsed && <span>{item.label}</span>}
            </Link>
          ))}
        </nav>

        {/* AI Disclaimer */}
        {!sidebarCollapsed && (
          <div className="sidebar-disclaimer">{t('sidebar.aiDisclaimer')}</div>
        )}

        {/* Bottom Section */}
        <div className="sidebar-footer">
          {/* Documentation Link */}
          <a
            href="https://github.com/aws-samples/sample-aws-idp-pipeline/blob/main/README.md"
            target="_blank"
            rel="noopener noreferrer"
            className="sidebar-doc-link"
            title={sidebarCollapsed ? t('nav.documentation') : undefined}
          >
            <OpenInNewIcon />
            {!sidebarCollapsed && <span>{t('nav.documentation')}</span>}
          </a>

          {/* Settings Link */}
          <Link
            to="/settings"
            className={`sidebar-doc-link ${pathname === '/settings' || pathname.startsWith('/settings/') ? 'active' : ''}`}
            title={sidebarCollapsed ? t('nav.settings') : undefined}
          >
            <SettingsIcon />
            {!sidebarCollapsed && <span>{t('nav.settings')}</span>}
          </Link>

          {/* User Info */}
          <div className="sidebar-user">
            <div
              className="sidebar-user-info"
              title={
                sidebarCollapsed
                  ? (user?.profile?.['cognito:username'] as string)
                  : undefined
              }
            >
              <div className="sidebar-user-avatar">
                {(user?.profile?.['cognito:username'] as string)
                  ?.charAt(0)
                  .toUpperCase()}
              </div>
              {!sidebarCollapsed && (
                <div className="sidebar-user-details">
                  <p className="sidebar-user-name">
                    {user?.profile?.['cognito:username'] as string}
                  </p>
                </div>
              )}
            </div>
            {!sidebarCollapsed && (
              <button
                type="button"
                className="sidebar-logout-btn"
                onClick={handleLogout}
                title={t('nav.logout')}
              >
                <LogoutIcon />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="app-main">
        <section className="card">{children}</section>
        {/* Hide footer on project detail pages */}
        {!pathname.match(/^\/projects\/[^/]+/) && (
          <footer className="app-footer">
            <span className="text-xs font-medium bg-gradient-to-r from-slate-400 to-slate-500 dark:from-slate-500 dark:to-slate-600 bg-clip-text text-transparent">
              Powered by Korea PACE Team
            </span>
          </footer>
        )}
      </main>
    </div>
  );
};

export default AppLayout;
