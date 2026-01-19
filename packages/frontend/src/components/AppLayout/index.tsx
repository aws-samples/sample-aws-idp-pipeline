import { useAuth } from 'react-oidc-context';
import * as React from 'react';
import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import Config from '../../config';
import { Link, useLocation } from '@tanstack/react-router';

const UI_LANGUAGES = [
  { code: 'ko', name: '한국어', flag: '🇰🇷' },
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'ja', name: '日本語', flag: '🇯🇵' },
];

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

const TestIcon = () => (
  <svg
    className="w-5 h-5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
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

/**
 * Defines the App layout with sidebar navigation.
 */
const LAST_PROJECT_KEY = 'idp-last-project';
const SIDEBAR_COLLAPSED_KEY = 'idp-sidebar-collapsed';

const AppLayout: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { user, removeUser, signoutRedirect, clearStaleState } = useAuth();
  const { pathname } = useLocation();
  const { t, i18n } = useTranslation();
  const [showLangDropdown, setShowLangDropdown] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  });
  const langDropdownRef = useRef<HTMLDivElement>(null);

  const toggleSidebar = () => {
    const newValue = !sidebarCollapsed;
    setSidebarCollapsed(newValue);
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(newValue));
  };

  // Track and save last visited project
  useEffect(() => {
    const match = pathname.match(/^\/projects\/([^/]+)/);
    if (match) {
      localStorage.setItem(LAST_PROJECT_KEY, match[1]);
    }
  }, [pathname]);

  const getProjectsPath = () => {
    const lastProject = localStorage.getItem(LAST_PROJECT_KEY);
    return lastProject ? `/projects/${lastProject}` : '/';
  };

  const navItems = [
    {
      to: getProjectsPath(),
      label: t('nav.projects'),
      icon: <ProjectsIcon />,
      matchPaths: ['/', '/projects'],
    },
    { to: '/test', label: 'Test', icon: <TestIcon /> },
    { to: '/settings', label: t('nav.settings'), icon: <SettingsIcon /> },
  ];

  const isNavItemActive = (item: (typeof navItems)[0]) => {
    if (item.matchPaths) {
      return item.matchPaths.some(
        (path) => pathname === path || pathname.startsWith(`${path}/`),
      );
    }
    return pathname === item.to || pathname.startsWith(`${item.to}/`);
  };

  const currentLang =
    UI_LANGUAGES.find((l) => l.code === i18n.language) || UI_LANGUAGES[1];

  const handleLanguageChange = (langCode: string) => {
    i18n.changeLanguage(langCode);
    setShowLangDropdown(false);
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

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        langDropdownRef.current &&
        !langDropdownRef.current.contains(event.target as Node)
      ) {
        setShowLangDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
        {/* Logo */}
        <div className="sidebar-header">
          <a href="/" className="sidebar-brand">
            <img
              src={Config.logo}
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

        {/* Bottom Section */}
        <div className="sidebar-footer">
          {/* Language Selector */}
          <div className="sidebar-lang-selector" ref={langDropdownRef}>
            <button
              type="button"
              className="sidebar-lang-button"
              onClick={() => setShowLangDropdown(!showLangDropdown)}
              title={sidebarCollapsed ? currentLang.name : undefined}
            >
              <span className="lang-flag">{currentLang.flag}</span>
              {!sidebarCollapsed && (
                <>
                  <span className="lang-name">{currentLang.name}</span>
                  <svg
                    className={`lang-chevron ${showLangDropdown ? 'open' : ''}`}
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </>
              )}
            </button>
            {showLangDropdown && (
              <div className="sidebar-lang-dropdown">
                {UI_LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    type="button"
                    className={`lang-option ${i18n.language === lang.code ? 'active' : ''}`}
                    onClick={() => handleLanguageChange(lang.code)}
                  >
                    <span className="lang-flag">{lang.flag}</span>
                    <span className="lang-name">{lang.name}</span>
                    {i18n.language === lang.code && (
                      <svg
                        className="lang-check"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

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
      </main>
    </div>
  );
};

export default AppLayout;
