import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  ChevronRight,
  Home,
  Settings,
  ChevronDown,
  RefreshCw,
} from 'lucide-react';
import { Project, CARD_COLORS } from './ProjectSettingsModal';
import { useAwsClient } from '../hooks/useAwsClient';

interface ProjectNavBarProps {
  project: Project;
  onSettingsClick: () => void;
}

export default function ProjectNavBar({
  project,
  onSettingsClick,
}: ProjectNavBarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { fetchApi } = useAwsClient();
  const projectColor = CARD_COLORS[project.color ?? 0] || CARD_COLORS[0];

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true);
    try {
      const data = await fetchApi<Project[]>('projects');
      setProjects(data);
    } catch (error) {
      console.error('Failed to load projects:', error);
    }
    setLoadingProjects(false);
  }, [fetchApi]);

  // Fetch projects once on first dropdown open
  const projectsLoadedRef = useRef(false);
  useEffect(() => {
    if (dropdownOpen && !projectsLoadedRef.current) {
      projectsLoadedRef.current = true;
      loadProjects();
    }
  }, [dropdownOpen, loadProjects]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [dropdownOpen]);

  const handleSelectProject = (p: Project) => {
    setDropdownOpen(false);
    if (p.project_id !== project.project_id) {
      navigate({
        to: '/projects/$projectId',
        params: { projectId: p.project_id },
      });
    }
  };

  return (
    <nav className="glow-through flex items-center h-[68px] min-h-[68px] flex-shrink-0 bg-white dark:bg-transparent border-b border-slate-200 dark:border-white/[0.08] px-4">
      {/* Breadcrumb */}
      <div className="flex items-center">
        {/* Home */}
        <Link
          to="/"
          className="inline-flex items-center justify-center h-8 w-8 rounded-md text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          title={t('projects.title')}
        >
          <Home className="h-4 w-4" />
        </Link>

        {/* Separator */}
        <ChevronRight className="h-4 w-4 text-slate-300 dark:text-slate-600 mx-0.5" />

        {/* Project Switcher */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen((v) => !v)}
            className={`flex items-center gap-2 h-8 px-2 rounded-md text-sm font-medium transition-colors ${
              dropdownOpen
                ? 'text-slate-900 dark:text-white'
                : 'text-slate-800 dark:text-slate-100 hover:text-slate-600 dark:hover:text-slate-300'
            }`}
          >
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: projectColor.border }}
            />
            <span className="truncate max-w-[200px]" title={project.name}>
              {project.name}
            </span>
            <ChevronDown
              className={`h-3.5 w-3.5 text-slate-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {/* Dropdown */}
          {dropdownOpen && (
            <div className="glass-panel absolute left-0 top-full mt-1 z-50 min-w-[240px] max-w-[320px] max-h-[320px] overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg py-1">
              {/* Project Home + Refresh */}
              <div className="flex items-center">
                <Link
                  to="/"
                  onClick={() => setDropdownOpen(false)}
                  className="glass-menu-item flex-1 flex items-center gap-2.5 px-3 py-2 text-left text-sm text-slate-700 dark:text-slate-200 transition-colors"
                >
                  <Home className="h-4 w-4 text-slate-400 dark:text-slate-500" />
                  <span>{t('projects.title')}</span>
                </Link>
                <button
                  onClick={loadProjects}
                  disabled={loadingProjects}
                  className="glass-menu-item p-1.5 mr-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded transition-colors disabled:opacity-50"
                  title={t('common.refresh', 'Refresh')}
                >
                  <RefreshCw
                    className={`h-3 w-3 ${loadingProjects ? 'animate-spin' : ''}`}
                  />
                </button>
              </div>
              <div className="my-1 border-t border-slate-200 dark:border-white/[0.1]" />

              {loadingProjects && projects.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-slate-400">
                  {t('common.loading')}
                </div>
              ) : projects.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-slate-400">
                  {t('projects.noProjects')}
                </div>
              ) : (
                projects.map((p) => {
                  const color = CARD_COLORS[p.color ?? 0] || CARD_COLORS[0];
                  const isActive = p.project_id === project.project_id;
                  return (
                    <button
                      key={p.project_id}
                      onClick={() => handleSelectProject(p)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                        isActive
                          ? 'nav-project-active border-l-2 border-blue-500'
                          : 'glass-menu-item border-l-2 border-transparent'
                      }`}
                    >
                      <span
                        className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ring-2 ${isActive ? 'ring-blue-400/50' : 'ring-transparent'}`}
                        style={{ background: color.border }}
                      />
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-sm truncate ${
                            isActive
                              ? 'font-semibold text-blue-600 dark:text-blue-300'
                              : 'text-slate-700 dark:text-slate-200'
                          }`}
                        >
                          {p.name}
                        </p>
                        {p.description && (
                          <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
                            {p.description}
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Description & Owner */}
        {(project.created_by || project.description) && (
          <div className="flex flex-col justify-center ml-2 pl-3 border-l border-slate-200 dark:border-white/[0.1] text-xs text-slate-400 dark:text-slate-500 max-w-[400px] divide-y divide-slate-200 dark:divide-white/[0.1]">
            {project.description && (
              <span
                className="truncate leading-tight pb-0.5"
                title={project.description}
              >
                {project.description}
              </span>
            )}
            {project.created_by && (
              <span className="truncate leading-tight pt-0.5 text-[10px]">
                {project.created_by}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Menu */}
      <div className="flex items-center gap-1">
        <button
          onClick={onSettingsClick}
          className="glass-menu-item inline-flex items-center gap-1.5 h-8 px-3 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-md transition-colors"
        >
          <Settings className="h-4 w-4" />
          <span>{t('nav.settings')}</span>
        </button>
      </div>
    </nav>
  );
}
