import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from 'react-oidc-context';
import { useTranslation } from 'react-i18next';
import { Search, ArrowUpDown } from 'lucide-react';
import { useAwsClient } from '../hooks/useAwsClient';
import CubeLoader from '../components/CubeLoader';
import ConfirmModal from '../components/ConfirmModal';
import ProjectSettingsModal, {
  Project,
  LANGUAGES,
  CARD_COLORS,
} from '../components/ProjectSettingsModal';

type SortOption =
  | 'created_desc'
  | 'created_asc'
  | 'updated_desc'
  | 'updated_asc';

const PROJECT_SORT_KEY = 'idp-project-sort';

const getInitialSortOption = (): SortOption => {
  const stored = localStorage.getItem(PROJECT_SORT_KEY);
  if (
    stored === 'created_desc' ||
    stored === 'created_asc' ||
    stored === 'updated_desc' ||
    stored === 'updated_asc'
  ) {
    return stored;
  }
  return 'created_desc';
};

export const Route = createFileRoute('/')({
  component: ProjectsPage,
});

interface ProjectCardProps {
  project: Project;
  colorIndex: number;
  onEdit: (project: Project) => void;
  onDelete: (project: Project) => void;
  index: number;
}

function ProjectCard({
  project,
  colorIndex,
  onEdit,
  onDelete,
  index,
}: ProjectCardProps) {
  const { t } = useTranslation();
  const cardRef = useRef<HTMLDivElement>(null);
  const colors = CARD_COLORS[colorIndex % CARD_COLORS.length];

  const formatDate = (dateString: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const setGlow = (event: React.MouseEvent) => {
    const target = cardRef.current;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    target.style.setProperty('--glow-x', `${event.clientX - rect.left}px`);
    target.style.setProperty('--glow-y', `${event.clientY - rect.top}px`);
  };

  const clearGlow = () => {
    const target = cardRef.current;
    if (!target) return;
    target.style.removeProperty('--glow-x');
    target.style.removeProperty('--glow-y');
  };

  return (
    <div
      ref={cardRef}
      className="bento-card group"
      style={
        {
          '--card-border': colors.border,
          '--card-glow': colors.glow,
          '--card-delay': `${index * 80}ms`,
        } as React.CSSProperties
      }
      onMouseMove={setGlow}
      onMouseLeave={clearGlow}
    >
      <Link
        to="/projects/$projectId"
        params={{ projectId: project.project_id }}
        className="bento-card-content"
      >
        <div className="bento-card-header">
          <div className="bento-card-folder">
            <div
              className="bento-folder-back"
              style={{
                background: `linear-gradient(135deg, ${colors.back} 0%, ${colors.tab} 100%)`,
              }}
            />
            <div
              className="bento-folder-tab"
              style={{ background: colors.tab }}
            />
            <div
              className="bento-folder-front"
              style={{
                background: `linear-gradient(135deg, ${colors.front} 0%, ${colors.back} 100%)`,
              }}
            />
          </div>
        </div>

        <h3 className="bento-card-title">{project.name}</h3>

        {project.description && (
          <p className="bento-card-description">{project.description}</p>
        )}

        <div className="bento-card-footer">
          {project.language && (
            <span className="bento-card-tag">
              {LANGUAGES.find((l) => l.code === project.language)?.flag ||
                project.language.toUpperCase()}
            </span>
          )}
          <div className="bento-card-info">
            <span className="bento-card-meta">
              {project.created_at && formatDate(project.created_at)}
            </span>
            {project.created_by && (
              <span className="bento-card-author" title={project.created_by}>
                {project.created_by}
              </span>
            )}
          </div>
        </div>
      </Link>

      {/* Action buttons */}
      <div className="bento-card-actions">
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onEdit(project);
          }}
          className="bento-action-btn bento-action-edit"
          title={t('projects.editProject')}
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
            />
          </svg>
        </button>
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete(project);
          }}
          className="bento-action-btn bento-action-delete"
          title={t('projects.deleteProject')}
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </button>
      </div>

      {/* Hover glow effect */}
      <div
        className="bento-card-glow"
        style={{
          background: `radial-gradient(300px circle at var(--glow-x, 50%) var(--glow-y, 50%), var(--card-glow), transparent 60%)`,
        }}
      />
    </div>
  );
}

function ProjectsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { fetchApi } = useAwsClient();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOption, setSortOption] =
    useState<SortOption>(getInitialSortOption);

  const handleSortChange = (newSort: SortOption) => {
    setSortOption(newSort);
    localStorage.setItem(PROJECT_SORT_KEY, newSort);
  };

  const filteredProjects = useMemo(() => {
    let result = [...projects];

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.description?.toLowerCase().includes(query),
      );
    }

    // Sort
    result.sort((a, b) => {
      switch (sortOption) {
        case 'created_desc':
          return (
            new Date(b.created_at || 0).getTime() -
            new Date(a.created_at || 0).getTime()
          );
        case 'created_asc':
          return (
            new Date(a.created_at || 0).getTime() -
            new Date(b.created_at || 0).getTime()
          );
        case 'updated_desc':
          return (
            new Date(b.updated_at || 0).getTime() -
            new Date(a.updated_at || 0).getTime()
          );
        case 'updated_asc':
          return (
            new Date(a.updated_at || 0).getTime() -
            new Date(b.updated_at || 0).getTime()
          );
        default:
          return 0;
      }
    });

    return result;
  }, [projects, searchQuery, sortOption]);

  const isInitializedRef = useRef(false);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchApi<Project[]>('projects');
      setProjects(data);
    } catch (error) {
      console.error('Failed to load projects:', error);
    }
    setLoading(false);
  }, [fetchApi]);

  useEffect(() => {
    if (isInitializedRef.current) return;
    isInitializedRef.current = true;
    loadProjects();
  }, [loadProjects]);

  const openCreateModal = () => {
    setEditingProject(null);
    setShowModal(true);
  };

  const openEditModal = (project: Project) => {
    setEditingProject(project);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingProject(null);
  };

  const handleSaveProject = async (data: {
    name: string;
    description: string;
    language: string;
    color: number;
    document_prompt: string;
    ocr_model: string;
    ocr_options: Record<string, unknown>;
  }) => {
    if (editingProject) {
      await fetchApi<Project>(`projects/${editingProject.project_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    } else {
      await fetchApi<Project>('projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          created_by:
            user?.profile?.email || user?.profile?.preferred_username || '',
        }),
      });
    }
    closeModal();
    await loadProjects();
  };

  const handleDeleteProject = (project: Project) => {
    setDeleteTarget(project);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await fetchApi(`projects/${deleteTarget.project_id}`, {
        method: 'DELETE',
      });
      setDeleteTarget(null);
      await loadProjects();
    } catch (error) {
      console.error('Failed to delete project:', error);
    }
    setDeleting(false);
  };

  return (
    <div className="bento-page">
      {loading ? (
        <div className="bento-loading">
          <CubeLoader />
        </div>
      ) : (
        <>
          {/* Hero Section */}
          <header className="bento-hero">
            <div className="bento-hero-content">
              <div className="bento-hero-label">
                <span className="bento-hero-accent" />
                <span>{t('projects.heroTag')}</span>
              </div>
              <h1 className="bento-hero-title">{t('projects.heroTitle')}</h1>
              <p className="bento-hero-description">
                {t('projects.heroDescription')}
              </p>
            </div>
          </header>

          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            {/* Search */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('common.search')}
                className="w-full pl-10 pr-4 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 dark:text-white placeholder-slate-400"
              />
            </div>

            {/* Sort */}
            <div className="flex items-center gap-2">
              <ArrowUpDown className="w-4 h-4 text-slate-400" />
              <select
                value={sortOption}
                onChange={(e) => handleSortChange(e.target.value as SortOption)}
                className="pl-3 pr-7 py-2.5 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 dark:text-white"
              >
                <option value="created_desc">
                  {t('projects.sortCreatedDesc')}
                </option>
                <option value="created_asc">
                  {t('projects.sortCreatedAsc')}
                </option>
                <option value="updated_desc">
                  {t('projects.sortUpdatedDesc')}
                </option>
                <option value="updated_asc">
                  {t('projects.sortUpdatedAsc')}
                </option>
              </select>
            </div>
          </div>

          <div className="bento-grid">
            {/* New Project Card */}
            <button onClick={openCreateModal} className="bento-card-new">
              <div className="bento-card-new-icon">
                <svg
                  className="w-7 h-7"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4v16m8-8H4"
                  />
                </svg>
              </div>
              <span className="bento-card-new-label">
                {t('projects.newProject')}
              </span>
              <span className="bento-card-new-hint">
                {t('projects.clickToCreate')}
              </span>
            </button>

            {filteredProjects.map((project, index) => (
              <ProjectCard
                key={project.project_id}
                project={project}
                colorIndex={project.color ?? index}
                onEdit={openEditModal}
                onDelete={handleDeleteProject}
                index={index}
              />
            ))}
          </div>
        </>
      )}

      {/* Project Settings Modal */}
      <ProjectSettingsModal
        project={editingProject}
        isOpen={showModal}
        onClose={closeModal}
        onSave={handleSaveProject}
        isCreating={!editingProject}
      />

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title={t('projects.deleteProject')}
        message={t('projects.deleteConfirmMessage', {
          name: deleteTarget?.name,
        })}
        confirmText={t('common.delete')}
        variant="danger"
        loading={deleting}
      />
    </div>
  );
}
