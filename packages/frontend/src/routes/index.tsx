import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from 'react-oidc-context';
import { useAwsClient } from '../hooks/useAwsClient';

interface Project {
  project_id: string;
  name: string;
  description: string;
  status: string;
  created_by: string | null;
  language: string | null;
  color: number | null;
  ocr_model: string | null;
  ocr_options: Record<string, unknown> | null;
  created_at: string;
  updated_at: string | null;
}

const OCR_MODELS = [
  {
    value: 'paddleocr-vl',
    name: 'PaddleOCR-VL',
    description: 'Vision-Language model for complex documents',
    hasLangOption: false,
    hasOptions: false,
  },
  {
    value: 'pp-ocrv5',
    name: 'PP-OCRv5',
    description: 'General-purpose OCR with high accuracy',
    hasLangOption: true,
    hasOptions: true,
  },
  {
    value: 'pp-structurev3',
    name: 'PP-StructureV3',
    description: 'Document structure analysis with table detection',
    hasLangOption: true,
    hasOptions: true,
  },
];

const OCR_LANGUAGES = [
  { code: '', name: 'Default (Not specified)' },
  // Primary languages
  { code: 'ch', name: 'Chinese & English' },
  { code: 'en', name: 'English' },
  { code: 'korean', name: 'Korean' },
  { code: 'japan', name: 'Japanese' },
  { code: 'chinese_cht', name: 'Chinese Traditional' },
  // Major world languages
  { code: 'french', name: 'French' },
  { code: 'german', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'es', name: 'Spanish' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ru', name: 'Russian' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'th', name: 'Thai' },
  { code: 'ms', name: 'Malay' },
  { code: 'id', name: 'Indonesian' },
  { code: 'tr', name: 'Turkish' },
  { code: 'pl', name: 'Polish' },
  { code: 'nl', name: 'Dutch' },
  // Multi-script support
  { code: 'latin', name: 'Latin (Multi-language)' },
  { code: 'arabic', name: 'Arabic Script (Multi-language)' },
  { code: 'cyrillic', name: 'Cyrillic Script (Multi-language)' },
  { code: 'devanagari', name: 'Devanagari Script (Multi-language)' },
  // South Asian languages
  { code: 'ta', name: 'Tamil' },
  { code: 'te', name: 'Telugu' },
  { code: 'ml', name: 'Malayalam' },
  { code: 'mr', name: 'Marathi' },
  { code: 'ne', name: 'Nepali' },
  { code: 'bn', name: 'Bengali' },
  { code: 'gu', name: 'Gujarati' },
  { code: 'pa', name: 'Punjabi' },
  // Middle Eastern & Central Asian
  { code: 'fa', name: 'Persian' },
  { code: 'ur', name: 'Urdu' },
  { code: 'he', name: 'Hebrew' },
  { code: 'az', name: 'Azerbaijani' },
  { code: 'uz', name: 'Uzbek' },
  // European languages
  { code: 'uk', name: 'Ukrainian' },
  { code: 'bg', name: 'Bulgarian' },
  { code: 'sr', name: 'Serbian' },
  { code: 'hr', name: 'Croatian' },
  { code: 'cs', name: 'Czech' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'ro', name: 'Romanian' },
  { code: 'fi', name: 'Finnish' },
  { code: 'sv', name: 'Swedish' },
  { code: 'no', name: 'Norwegian' },
  { code: 'da', name: 'Danish' },
  // Southeast Asian & Pacific
  { code: 'tl', name: 'Tagalog' },
  { code: 'mn', name: 'Mongolian' },
  // African languages
  { code: 'sw', name: 'Swahili' },
];

const OCR_OPTIONS_INFO = {
  use_doc_orientation_classify: {
    title: 'Document Orientation',
    description: 'Auto-detect and correct document orientation',
  },
  use_doc_unwarping: {
    title: 'Document Unwarping',
    description: 'Correct perspective distortion and warping',
  },
  use_textline_orientation: {
    title: 'Textline Orientation',
    description: 'Detect and handle rotated text lines (PP-OCRv5 only)',
  },
};

const LANGUAGES = [
  { code: 'ko', name: 'Korean', flag: 'KR' },
  { code: 'en', name: 'English', flag: 'EN' },
  { code: 'ja', name: 'Japanese', flag: 'JP' },
  { code: 'zh', name: 'Chinese', flag: 'CN' },
];

export const Route = createFileRoute('/')({
  component: ProjectsPage,
});

const FOLDER_GRADIENTS = [
  { back: '#3b82f6', tab: '#2563eb', front: '#60a5fa' },
  { back: '#8b5cf6', tab: '#7c3aed', front: '#a78bfa' },
  { back: '#10b981', tab: '#059669', front: '#34d399' },
  { back: '#f59e0b', tab: '#d97706', front: '#fbbf24' },
  { back: '#ec4899', tab: '#db2777', front: '#f472b6' },
  { back: '#06b6d4', tab: '#0891b2', front: '#22d3ee' },
  { back: '#6366f1', tab: '#4f46e5', front: '#818cf8' },
  { back: '#ef4444', tab: '#dc2626', front: '#f87171' },
];

interface ProjectFolderProps {
  project: Project;
  colorIndex: number;
  onEdit: (project: Project) => void;
  onDelete: (projectId: string) => void;
}

function ProjectFolder({
  project,
  colorIndex,
  onEdit,
  onDelete,
}: ProjectFolderProps) {
  const [isHovered, setIsHovered] = useState(false);
  const colors = FOLDER_GRADIENTS[colorIndex % FOLDER_GRADIENTS.length];

  const formatDate = (dateString: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div
      className="relative"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <Link
        to="/projects/$projectId"
        params={{ projectId: project.project_id }}
        className="block"
      >
        <div
          className="relative flex flex-col items-center p-5 rounded-2xl cursor-pointer bg-white border border-slate-200 transition-all duration-500 ease-out hover:shadow-xl hover:border-slate-300 group overflow-hidden"
          style={{
            minHeight: '220px',
            perspective: '1000px',
          }}
        >
          {/* Folder Visual */}
          <div
            className="relative flex items-center justify-center mb-2 overflow-hidden"
            style={{ height: '120px', width: '160px' }}
          >
            {/* Back of folder */}
            <div
              className="absolute w-28 h-20 rounded-lg shadow-md"
              style={{
                background: `linear-gradient(135deg, ${colors.back} 0%, ${colors.tab} 100%)`,
                transformOrigin: 'bottom center',
                transform: isHovered
                  ? 'rotateX(-8deg) scaleY(1.01)'
                  : 'rotateX(0deg) scaleY(1)',
                transition: 'transform 500ms cubic-bezier(0.16, 1, 0.3, 1)',
                zIndex: 10,
              }}
            />

            {/* Folder tab */}
            <div
              className="absolute w-10 h-3 rounded-t-md"
              style={{
                background: colors.tab,
                top: 'calc(50% - 40px - 10px)',
                left: 'calc(50% - 56px + 12px)',
                transformOrigin: 'bottom center',
                transform: isHovered
                  ? 'rotateX(-10deg) translateY(-1px)'
                  : 'rotateX(0deg) translateY(0)',
                transition: 'transform 500ms cubic-bezier(0.16, 1, 0.3, 1)',
                zIndex: 10,
              }}
            />

            {/* Front of folder */}
            <div
              className="absolute w-28 h-20 rounded-lg shadow-lg"
              style={{
                background: `linear-gradient(135deg, ${colors.front} 0%, ${colors.back} 100%)`,
                top: 'calc(50% - 40px + 3px)',
                transformOrigin: 'bottom center',
                transform: isHovered
                  ? 'rotateX(15deg) translateY(4px)'
                  : 'rotateX(0deg) translateY(0)',
                transition: 'transform 500ms cubic-bezier(0.16, 1, 0.3, 1)',
                zIndex: 30,
              }}
            />

            {/* Folder shine effect */}
            <div
              className="absolute w-28 h-20 rounded-lg overflow-hidden pointer-events-none"
              style={{
                top: 'calc(50% - 40px + 3px)',
                background:
                  'linear-gradient(135deg, rgba(255,255,255,0.4) 0%, transparent 50%)',
                transformOrigin: 'bottom center',
                transform: isHovered
                  ? 'rotateX(15deg) translateY(4px)'
                  : 'rotateX(0deg) translateY(0)',
                transition: 'transform 500ms cubic-bezier(0.16, 1, 0.3, 1)',
                zIndex: 31,
              }}
            />
          </div>

          {/* Project Info */}
          <div className="text-center w-full">
            <div className="flex items-center justify-center gap-2">
              <h3
                className="text-base font-bold text-slate-800 truncate transition-all duration-300"
                style={{
                  transform: isHovered ? 'translateY(-2px)' : 'translateY(0)',
                }}
              >
                {project.name}
              </h3>
              {project.language && (
                <span
                  className="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-semibold bg-slate-100 text-slate-600 rounded transition-all duration-300"
                  style={{
                    transform: isHovered ? 'translateY(-2px)' : 'translateY(0)',
                  }}
                >
                  {LANGUAGES.find((l) => l.code === project.language)?.flag ||
                    project.language.toUpperCase()}
                </span>
              )}
            </div>
            <div className="flex items-center justify-center gap-2 mt-1 text-xs text-slate-500">
              <span>{formatDate(project.created_at)}</span>
              {project.created_by && (
                <>
                  <span className="text-slate-300">|</span>
                  <span
                    className="truncate max-w-[80px]"
                    title={project.created_by}
                  >
                    {project.created_by}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </Link>

      {/* Action buttons */}
      <div
        className="absolute top-3 right-3 flex gap-1 transition-all duration-300 z-40"
        style={{
          opacity: isHovered ? 1 : 0,
          transform: isHovered ? 'translateY(0)' : 'translateY(-5px)',
        }}
      >
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onEdit(project);
          }}
          className="w-8 h-8 flex items-center justify-center bg-white/90 hover:bg-blue-500 hover:text-white text-slate-600 rounded-full shadow-md border border-slate-200 transition-colors"
          title="Edit project"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
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
            onDelete(project.project_id);
          }}
          className="w-8 h-8 flex items-center justify-center bg-white/90 hover:bg-red-500 hover:text-white text-slate-600 rounded-full shadow-md border border-slate-200 transition-colors"
          title="Delete project"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
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
    </div>
  );
}

function ProjectsPage() {
  const { user } = useAuth();
  const { fetchApi } = useAwsClient();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showAdvancedModal, setShowAdvancedModal] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    language: 'ko',
    color: 0,
  });
  const [advancedSettings, setAdvancedSettings] = useState({
    ocr_model: 'paddleocr-vl',
    ocr_lang: '',
    use_doc_orientation_classify: false,
    use_doc_unwarping: false,
    use_textline_orientation: false,
  });
  const [saving, setSaving] = useState(false);

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
    loadProjects();
  }, [loadProjects]);

  const openCreateModal = () => {
    setEditingProject(null);
    setFormData({ name: '', description: '', language: 'ko', color: 0 });
    setAdvancedSettings({
      ocr_model: 'paddleocr-vl',
      ocr_lang: '',
      use_doc_orientation_classify: false,
      use_doc_unwarping: false,
      use_textline_orientation: false,
    });
    setShowModal(true);
  };

  const openEditModal = (project: Project) => {
    setEditingProject(project);
    setFormData({
      name: project.name,
      description: project.description,
      language: project.language || 'ko',
      color: project.color ?? 0,
    });
    const ocrOptions = project.ocr_options as Record<string, unknown> | null;
    setAdvancedSettings({
      ocr_model: project.ocr_model || 'paddleocr-vl',
      ocr_lang: (ocrOptions?.lang as string) || '',
      use_doc_orientation_classify:
        (ocrOptions?.use_doc_orientation_classify as boolean) || false,
      use_doc_unwarping: (ocrOptions?.use_doc_unwarping as boolean) || false,
      use_textline_orientation:
        (ocrOptions?.use_textline_orientation as boolean) || false,
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingProject(null);
    setFormData({ name: '', description: '', language: 'ko', color: 0 });
    setAdvancedSettings({
      ocr_model: 'paddleocr-vl',
      ocr_lang: '',
      use_doc_orientation_classify: false,
      use_doc_unwarping: false,
      use_textline_orientation: false,
    });
  };

  const handleSave = async () => {
    if (!formData.name.trim()) return;

    setSaving(true);
    try {
      // Build ocr_options based on selected model
      const selectedModel = OCR_MODELS.find(
        (m) => m.value === advancedSettings.ocr_model,
      );
      let ocrOptions: Record<string, unknown> | null = null;

      if (selectedModel?.hasOptions) {
        ocrOptions = {
          lang: advancedSettings.ocr_lang || undefined,
          use_doc_orientation_classify:
            advancedSettings.use_doc_orientation_classify,
          use_doc_unwarping: advancedSettings.use_doc_unwarping,
        };
        // use_textline_orientation is only for pp-ocrv5
        if (advancedSettings.ocr_model === 'pp-ocrv5') {
          ocrOptions.use_textline_orientation =
            advancedSettings.use_textline_orientation;
        }
      }

      if (editingProject) {
        await fetchApi<Project>(`projects/${editingProject.project_id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formData.name,
            description: formData.description,
            language: formData.language,
            color: formData.color,
            ocr_model: advancedSettings.ocr_model,
            ocr_options: ocrOptions,
          }),
        });
      } else {
        await fetchApi<Project>('projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formData.name,
            description: formData.description,
            language: formData.language,
            color: formData.color,
            ocr_model: advancedSettings.ocr_model,
            ocr_options: ocrOptions,
            created_by:
              user?.profile?.email || user?.profile?.preferred_username,
          }),
        });
      }
      closeModal();
      await loadProjects();
    } catch (error) {
      console.error('Failed to save project:', error);
    }
    setSaving(false);
  };

  const handleDeleteProject = async (projectId: string) => {
    if (!window.confirm('Are you sure you want to delete this project?'))
      return;
    try {
      await fetchApi(`projects/${projectId}`, { method: 'DELETE' });
      await loadProjects();
    } catch (error) {
      console.error('Failed to delete project:', error);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="flex justify-between items-center mb-8 flex-shrink-0">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Projects</h1>
          <p className="text-slate-500 mt-1">
            Manage your document analysis projects
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
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
          <span className="font-medium">New Project</span>
        </button>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-slate-500">Loading projects...</span>
          </div>
        </div>
      ) : projects.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-10 w-10 text-slate-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-slate-700 mb-1">
              No projects yet
            </h3>
            <p className="text-slate-500 mb-4">
              Create your first project to get started
            </p>
            <button
              onClick={openCreateModal}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Create Project
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto pb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {/* New Project Card */}
            <button
              onClick={openCreateModal}
              className="group flex flex-col items-center justify-center p-5 bg-slate-50 border-2 border-dashed border-slate-300 rounded-2xl hover:border-blue-400 hover:bg-blue-50/50 transition-all duration-300"
              style={{ minHeight: '220px' }}
            >
              <div className="w-16 h-16 flex items-center justify-center bg-slate-200 group-hover:bg-blue-200 rounded-2xl mb-4 transition-all duration-300 group-hover:scale-110">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-8 w-8 text-slate-500 group-hover:text-blue-600 transition-colors"
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
              <span className="text-slate-600 group-hover:text-blue-600 font-semibold transition-colors">
                New Project
              </span>
              <span className="text-xs text-slate-400 mt-1">
                Click to create
              </span>
            </button>

            {/* Project Folders */}
            {projects.map((project) => (
              <ProjectFolder
                key={project.project_id}
                project={project}
                colorIndex={project.color ?? 0}
                onEdit={openEditModal}
                onDelete={handleDeleteProject}
              />
            ))}
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl"
            style={{
              animation: 'modalIn 0.3s ease-out',
            }}
          >
            <h2 className="text-xl font-bold text-slate-800 mb-4">
              {editingProject ? 'Edit Project' : 'Create New Project'}
            </h2>

            <div className="space-y-4">
              {editingProject && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Project ID
                  </label>
                  <div className="px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg text-slate-600 text-sm font-mono">
                    {editingProject.project_id}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Project Name
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder="My Project"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      description: e.target.value,
                    })
                  }
                  placeholder="Project description..."
                  rows={3}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none transition-shadow"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Language
                </label>
                <select
                  value={formData.language}
                  onChange={(e) =>
                    setFormData({ ...formData, language: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow"
                >
                  {LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                      {lang.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Folder Color
                </label>
                <div className="flex gap-2 flex-wrap">
                  {FOLDER_GRADIENTS.map((gradient, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => setFormData({ ...formData, color: index })}
                      className={`w-10 h-10 rounded-lg transition-all ${
                        formData.color === index
                          ? 'ring-2 ring-offset-2 ring-blue-500 scale-110'
                          : 'hover:scale-105'
                      }`}
                      style={{
                        background: `linear-gradient(135deg, ${gradient.front} 0%, ${gradient.back} 100%)`,
                      }}
                      title={`Color ${index + 1}`}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-between items-center mt-6">
              <button
                type="button"
                onClick={() => setShowAdvancedModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
                Advanced Settings
              </button>
              <div className="flex gap-3">
                <button
                  onClick={closeModal}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={!formData.name.trim() || saving}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? 'Saving...' : editingProject ? 'Save' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Advanced Settings Modal */}
      {showAdvancedModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60]">
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl max-h-[90vh] overflow-y-auto"
            style={{ animation: 'modalIn 0.3s ease-out' }}
          >
            <h2 className="text-lg font-bold text-slate-800 mb-4">
              Advanced Settings
            </h2>

            <div className="space-y-5">
              {/* OCR Model Selection */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  OCR Model
                </label>
                <div className="space-y-2">
                  {OCR_MODELS.map((model) => (
                    <label
                      key={model.value}
                      className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-all ${
                        advancedSettings.ocr_model === model.value
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="ocr_model"
                        value={model.value}
                        checked={advancedSettings.ocr_model === model.value}
                        onChange={(e) =>
                          setAdvancedSettings({
                            ...advancedSettings,
                            ocr_model: e.target.value,
                            // Reset options when switching to VL model
                            ...(e.target.value === 'paddleocr-vl'
                              ? {
                                  ocr_lang: '',
                                  use_doc_orientation_classify: false,
                                  use_doc_unwarping: false,
                                  use_textline_orientation: false,
                                }
                              : {}),
                          })
                        }
                        className="mt-1"
                      />
                      <div>
                        <div className="font-medium text-slate-800">
                          {model.name}
                        </div>
                        <div className="text-xs text-slate-500">
                          {model.description}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Language Selection - only for pp-ocrv5 and pp-structurev3 */}
              {OCR_MODELS.find((m) => m.value === advancedSettings.ocr_model)
                ?.hasLangOption && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    OCR Language
                  </label>
                  <select
                    value={advancedSettings.ocr_lang}
                    onChange={(e) =>
                      setAdvancedSettings({
                        ...advancedSettings,
                        ocr_lang: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow"
                  >
                    {OCR_LANGUAGES.map((lang) => (
                      <option key={lang.code} value={lang.code}>
                        {lang.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-500 mt-1">
                    Select the primary language of documents in this project
                  </p>
                </div>
              )}

              {/* Processing Options - only for pp-ocrv5 and pp-structurev3 */}
              {OCR_MODELS.find((m) => m.value === advancedSettings.ocr_model)
                ?.hasOptions && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Processing Options
                  </label>
                  <div className="space-y-3">
                    {/* Document Orientation */}
                    <label className="flex items-start gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:border-slate-300 transition-all">
                      <input
                        type="checkbox"
                        checked={advancedSettings.use_doc_orientation_classify}
                        onChange={(e) =>
                          setAdvancedSettings({
                            ...advancedSettings,
                            use_doc_orientation_classify: e.target.checked,
                          })
                        }
                        className="mt-0.5"
                      />
                      <div>
                        <div className="font-medium text-slate-800 text-sm">
                          {OCR_OPTIONS_INFO.use_doc_orientation_classify.title}
                        </div>
                        <div className="text-xs text-slate-500">
                          {
                            OCR_OPTIONS_INFO.use_doc_orientation_classify
                              .description
                          }
                        </div>
                      </div>
                    </label>

                    {/* Document Unwarping */}
                    <label className="flex items-start gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:border-slate-300 transition-all">
                      <input
                        type="checkbox"
                        checked={advancedSettings.use_doc_unwarping}
                        onChange={(e) =>
                          setAdvancedSettings({
                            ...advancedSettings,
                            use_doc_unwarping: e.target.checked,
                          })
                        }
                        className="mt-0.5"
                      />
                      <div>
                        <div className="font-medium text-slate-800 text-sm">
                          {OCR_OPTIONS_INFO.use_doc_unwarping.title}
                        </div>
                        <div className="text-xs text-slate-500">
                          {OCR_OPTIONS_INFO.use_doc_unwarping.description}
                        </div>
                      </div>
                    </label>

                    {/* Textline Orientation - only for pp-ocrv5 */}
                    {advancedSettings.ocr_model === 'pp-ocrv5' && (
                      <label className="flex items-start gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:border-slate-300 transition-all">
                        <input
                          type="checkbox"
                          checked={advancedSettings.use_textline_orientation}
                          onChange={(e) =>
                            setAdvancedSettings({
                              ...advancedSettings,
                              use_textline_orientation: e.target.checked,
                            })
                          }
                          className="mt-0.5"
                        />
                        <div>
                          <div className="font-medium text-slate-800 text-sm">
                            {OCR_OPTIONS_INFO.use_textline_orientation.title}
                          </div>
                          <div className="text-xs text-slate-500">
                            {
                              OCR_OPTIONS_INFO.use_textline_orientation
                                .description
                            }
                          </div>
                        </div>
                      </label>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowAdvancedModal(false)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes modalIn {
          from {
            opacity: 0;
            transform: scale(0.95) translateY(-10px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
