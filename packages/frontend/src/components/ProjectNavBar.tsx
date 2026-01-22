import { useState, useRef, useEffect } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  ChevronRight,
  Home,
  FileText,
  Settings,
  Download,
  Upload,
  ChevronDown,
  MessageSquarePlus,
} from 'lucide-react';
import { Project, CARD_COLORS } from './ProjectSettingsModal';

interface ProjectNavBarProps {
  project: Project;
  documentCount: number;
  isConnected: boolean;
  onSettingsClick: () => void;
  onNewChat: () => void;
}

interface DropdownItem {
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  shortcut?: string;
}

interface NavMenuItem {
  label: string;
  items?: DropdownItem[];
}

function NavDropdown({
  label,
  items,
  isOpen,
  onToggle,
  onClose,
}: {
  label: string;
  items: DropdownItem[];
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={onToggle}
        className={`inline-flex items-center gap-1 h-8 px-3 text-sm font-medium rounded-md transition-colors
          ${isOpen ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'}`}
      >
        {label}
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1.5 w-52 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg shadow-black/10 dark:shadow-black/30 py-1 z-50 animate-in fade-in-0 zoom-in-95 duration-100">
          {items.map((item, index) => (
            <button
              key={index}
              onClick={() => {
                if (!item.disabled) {
                  item.onClick?.();
                  onClose();
                }
              }}
              disabled={item.disabled}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {item.icon && (
                <span className="text-slate-500 dark:text-slate-400">
                  {item.icon}
                </span>
              )}
              <span className="flex-1 text-left">{item.label}</span>
              {item.shortcut && (
                <span className="text-xs text-slate-400 dark:text-slate-500 font-mono">
                  {item.shortcut}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProjectNavBar({
  project,
  documentCount,
  isConnected,
  onSettingsClick,
  onNewChat,
}: ProjectNavBarProps) {
  const { t } = useTranslation();
  const projectColor = CARD_COLORS[project.color ?? 0] || CARD_COLORS[0];
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  const closeDropdown = () => setOpenDropdown(null);

  const menuItems: NavMenuItem[] = [
    {
      label: t('nav.tools'),
      items: [
        {
          label: t('nav.export'),
          icon: <Upload className="h-4 w-4" />,
          disabled: true,
        },
        {
          label: t('nav.import'),
          icon: <Download className="h-4 w-4" />,
          disabled: true,
        },
      ],
    },
  ];

  return (
    <nav className="flex items-center h-[69px] flex-shrink-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-4 -mx-6 -mt-6 mb-3">
      {/* Breadcrumb */}
      <div className="flex items-center">
        {/* Home */}
        <Link
          to="/"
          className="inline-flex items-center justify-center h-8 w-8 rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title={t('projects.title')}
        >
          <Home className="h-4 w-4" />
        </Link>

        {/* Separator */}
        <ChevronRight className="h-4 w-4 text-slate-300 dark:text-slate-600 mx-0.5" />

        {/* Project */}
        <div className="flex items-center gap-2 h-8 px-2 rounded-md text-sm font-medium text-slate-800 dark:text-slate-100">
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ background: projectColor.border }}
          />
          <span className="truncate max-w-[200px]" title={project.name}>
            {project.name}
          </span>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-3 ml-3 pl-3 border-l border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <FileText className="h-3.5 w-3.5" />
            <span>{documentCount}</span>
          </div>
          {isConnected && (
            <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
              <span>{t('workflow.live')}</span>
            </div>
          )}
        </div>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Menu */}
      <div className="flex items-center gap-1">
        <button
          onClick={onNewChat}
          className="inline-flex items-center gap-1.5 h-8 px-3 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors"
        >
          <MessageSquarePlus className="h-4 w-4" />
          <span>{t('chat.newChat')}</span>
        </button>

        {menuItems.map((item) => (
          <NavDropdown
            key={item.label}
            label={item.label}
            items={item.items || []}
            isOpen={openDropdown === item.label}
            onToggle={() =>
              setOpenDropdown(openDropdown === item.label ? null : item.label)
            }
            onClose={closeDropdown}
          />
        ))}

        <button
          onClick={onSettingsClick}
          className="inline-flex items-center gap-1.5 h-8 px-3 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors"
        >
          <Settings className="h-4 w-4" />
          <span>{t('nav.settings')}</span>
        </button>
      </div>
    </nav>
  );
}
