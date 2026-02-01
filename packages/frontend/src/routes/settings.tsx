import { createFileRoute } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
});

const UI_LANGUAGES = [
  { code: 'ko', name: '한국어', flag: '🇰🇷' },
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'ja', name: '日本語', flag: '🇯🇵' },
];

const THEME_KEY = 'idp-theme';

const AMAZON_SOFTWARE_LICENSE = `Amazon Software License

1. Definitions

"Licensor" means any person or entity that distributes its Work under this license.
"Software" means the original work of authorship made available under this license.
"Work" means the Software and any additions to or derivative works of the Software that are made available under this license.
The terms "reproduce," "reproduction," "derivative works," and "distribution" have the meaning as provided under U.S. copyright law; provided, however, that for the purposes of this license, derivative works shall not include works that remain separable from, or merely link (or bind by name) to the interfaces of, the Work.
Works, including the Software, are "made available" under this license by including in or with the Work either (a) a copyright notice referencing the applicability of this license to the Work, or (b) a copy of this license.

2. License Grants

2.1 Copyright Grant. Subject to the terms and conditions of this license, each Licensor grants to you a perpetual, worldwide, non-exclusive, royalty-free, copyright license to reproduce, prepare derivative works of, publicly display, publicly perform, sublicense and distribute its Work and any resulting derivative works in any form.

2.2 Patent Grant. Subject to the terms and conditions of this license, each Licensor grants to you a perpetual, worldwide, non-exclusive, royalty-free patent license to make, have made, use, sell, offer for sale, import, and otherwise transfer its Work, in whole or in part. The foregoing license applies only to the patent claims licensable by Licensor that would be infringed by Licensor's Work (or portion thereof) individually and excluding any combinations with any other materials or technology.

3. Limitations

3.1 Redistribution. You may reproduce or distribute the Work only if (a) you do so under this license, (b) you include a complete copy of this license with your distribution, and (c) you retain without modification any copyright, patent, trademark, or attribution notices that are present in the Work.

3.2 Derivative Works. You may specify that additional or different terms apply to the use, reproduction, and distribution of your derivative works of the Work ("Your Terms") only if (a) Your Terms provide that the use limitation in Section 3.3 applies to your derivative works, and (b) you identify the specific derivative works that are subject to Your Terms. Notwithstanding Your Terms, this license (including the redistribution requirements in Section 3.1) will continue to apply to the Work itself.

3.3 Use Limitation. The Work and any derivative works thereof only may be used or intended for use with the web services, computing platforms or applications provided by Amazon.com, Inc. or its affiliates, including Amazon Web Services, Inc.

3.4 Patent Claims. If you bring or threaten to bring a patent claim against any Licensor (including any claim, cross-claim or counterclaim in a lawsuit) to enforce any patents that you allege are infringed by any Work, then your rights under this license from such Licensor (including the grants in Sections 2.1 and 2.2) will terminate immediately.

3.5 Trademarks. This license does not grant any rights to use any Licensor's or its affiliates' names, logos, or trademarks, except as necessary to reproduce the notices described in this license.

3.6 Termination. If you violate any term of this license, then your rights under this license (including the grants in Sections 2.1 and 2.2) will terminate immediately.

4. Disclaimer of Warranty.

THE WORK IS PROVIDED "AS IS" WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING WARRANTIES OR CONDITIONS OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE OR NON-INFRINGEMENT. YOU BEAR THE RISK OF UNDERTAKING ANY ACTIVITIES UNDER THIS LICENSE. SOME STATES' CONSUMER LAWS DO NOT ALLOW EXCLUSION OF AN IMPLIED WARRANTY, SO THIS DISCLAIMER MAY NOT APPLY TO YOU.

5. Limitation of Liability.

EXCEPT AS PROHIBITED BY APPLICABLE LAW, IN NO EVENT AND UNDER NO LEGAL THEORY, WHETHER IN TORT (INCLUDING NEGLIGENCE), CONTRACT, OR OTHERWISE SHALL ANY LICENSOR BE LIABLE TO YOU FOR DAMAGES, INCLUDING ANY DIRECT, INDIRECT, SPECIAL, INCIDENTAL, OR CONSEQUENTIAL DAMAGES ARISING OUT OF OR RELATED TO THIS LICENSE, THE USE OR INABILITY TO USE THE WORK (INCLUDING BUT NOT LIMITED TO LOSS OF GOODWILL, BUSINESS INTERRUPTION, LOST PROFITS OR DATA, COMPUTER FAILURE OR MALFUNCTION, OR ANY OTHER COMMERCIAL DAMAGES OR LOSSES), EVEN IF THE LICENSOR HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.

Effective Date - April 18, 2008 (c) 2008 Amazon.com, Inc. or its affiliates. All rights reserved.`;

type SettingsSection = 'display' | 'license';

function SettingsPage() {
  const { t, i18n } = useTranslation();
  const [activeSection, setActiveSection] =
    useState<SettingsSection>('display');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
    return 'dark';
  });

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem(THEME_KEY, newTheme);
  };

  useEffect(() => {
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(theme);
  }, [theme]);

  const handleLanguageChange = (langCode: string) => {
    i18n.changeLanguage(langCode);
  };

  const menuItems: {
    key: SettingsSection;
    label: string;
    icon: React.ReactNode;
  }[] = [
    {
      key: 'display',
      label: t('settings.display'),
      icon: (
        <svg
          className="w-5 h-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      ),
    },
    {
      key: 'license',
      label: t('settings.license'),
      icon: (
        <svg
          className="w-5 h-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      ),
    },
  ];

  return (
    <div className="min-h-screen bento-page" style={{ paddingTop: '0.5rem' }}>
      <div className="flex gap-6" style={{ minHeight: 'calc(100vh - 120px)' }}>
        {/* Side Menu */}
        <div className="flex flex-col w-56 flex-shrink-0">
          <div style={{ padding: '0.5rem 0 1.25rem' }}>
            <div className="bento-hero-label" style={{ marginBottom: '1rem' }}>
              <span className="bento-hero-accent" />
              <span>{t('nav.settings')}</span>
            </div>
            <h1
              className="bento-hero-title"
              style={{ fontSize: '2rem', margin: 0 }}
            >
              {t('settings.heroTitle')}
            </h1>
          </div>
          <nav className="flex flex-col gap-1">
            {menuItems.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveSection(item.key)}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all text-left ${
                  activeSection === item.key
                    ? 'bg-[var(--color-accent-light)] text-[var(--color-accent)]'
                    : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 pt-1">
          {activeSection === 'display' && (
            <div className="flex flex-col gap-8">
              {/* Language */}
              <section>
                <h3
                  className="text-base font-semibold mb-1"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {t('settings.language')}
                </h3>
                <p
                  className="text-sm mb-3"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {t('settings.selectLanguage')}
                </p>
                <select
                  value={i18n.language}
                  onChange={(e) => handleLanguageChange(e.target.value)}
                  className="px-4 py-2.5 rounded-lg border text-sm font-medium transition-all w-64"
                  style={{
                    background: 'var(--color-bg-secondary)',
                    borderColor: 'var(--color-border)',
                    color: 'var(--color-text-primary)',
                  }}
                >
                  {UI_LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                      {lang.flag} {lang.name}
                    </option>
                  ))}
                </select>
              </section>

              {/* Theme */}
              <section>
                <h3
                  className="text-base font-semibold mb-1"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {t('settings.theme')}
                </h3>
                <div className="flex gap-3 mt-4">
                  <button
                    type="button"
                    onClick={() => {
                      if (theme !== 'light') toggleTheme();
                    }}
                    className={`flex items-center gap-3 px-5 py-3 rounded-lg border text-sm font-medium transition-all ${
                      theme === 'light'
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent-light)] text-[var(--color-accent)]'
                        : 'border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:border-[var(--color-text-muted)]'
                    }`}
                  >
                    <svg
                      className="w-5 h-5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="12" r="5" />
                      <line x1="12" y1="1" x2="12" y2="3" />
                      <line x1="12" y1="21" x2="12" y2="23" />
                      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                      <line x1="1" y1="12" x2="3" y2="12" />
                      <line x1="21" y1="12" x2="23" y2="12" />
                      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                    </svg>
                    <span>{t('settings.lightMode')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (theme !== 'dark') toggleTheme();
                    }}
                    className={`flex items-center gap-3 px-5 py-3 rounded-lg border text-sm font-medium transition-all ${
                      theme === 'dark'
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent-light)] text-[var(--color-accent)]'
                        : 'border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:border-[var(--color-text-muted)]'
                    }`}
                  >
                    <svg
                      className="w-5 h-5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                    </svg>
                    <span>{t('settings.darkMode')}</span>
                  </button>
                </div>
              </section>

              <p
                className="text-xs"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {t('settings.storedInBrowser')}
              </p>
            </div>
          )}

          {activeSection === 'license' && (
            <div>
              <h3
                className="text-base font-semibold mb-4"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {t('settings.licenseTitle')}
              </h3>
              <pre
                className="text-sm leading-relaxed whitespace-pre-wrap rounded-lg p-6 overflow-auto"
                style={{
                  color: 'var(--color-text-secondary)',
                  background: 'var(--color-bg-secondary)',
                  border: '1px solid var(--color-border)',
                  maxHeight: 'calc(100vh - 180px)',
                  fontFamily: 'inherit',
                }}
              >
                {AMAZON_SOFTWARE_LICENSE}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
