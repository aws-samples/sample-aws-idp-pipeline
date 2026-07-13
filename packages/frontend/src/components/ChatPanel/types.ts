import type { LucideIcon } from 'lucide-react';
import type {
  ChatMessage,
  Agent,
  ChatArtifact,
  Artifact,
  Document,
  ChatAttachment,
} from '../../types/project';
import type { VoiceChatState, BidiModelType } from '../../hooks/useVoiceChat';

export interface AttachedFile {
  id: string;
  file: File;
  type: string;
  preview: string | null;
}

export interface ToolResultImage {
  src: string;
  alt: string;
}

export interface ToolResultSource {
  document_id: string;
  segment_id: string;
}

export type StreamingBlock =
  | { type: 'text'; content: string }
  | {
      type: 'tool_use';
      name: string;
      toolUseId?: string;
      input?: Record<string, unknown>;
      status?: 'running' | 'success' | 'error';
    }
  | {
      type: 'tool_result';
      resultType: 'image' | 'artifact' | 'text';
      content?: string;
      images?: ToolResultImage[];
      sources?: ToolResultSource[];
      toolName?: string;
      toolUseId?: string;
      toolInput?: Record<string, unknown>;
    }
  | { type: 'stage_start'; stage: string }
  | { type: 'stage_complete'; stage: string; result: string }
  | { type: 'voice_transcript'; role: 'user' | 'assistant'; content: string };

export interface VoiceChatProps {
  available?: boolean;
  state?: VoiceChatState;
  audioLevel?: { input: number; output: number };
  mode?: boolean;
  selectedModel?: BidiModelType;
  onModeChange?: (mode: boolean) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onText?: (text: string) => void;
  onToggleMic?: () => void;
  onSettings?: () => void;
  onModelSelect?: (modelType: BidiModelType) => void;
}

export interface ChatPanelProps {
  projectName?: string;
  projectDescription?: string;
  projectColor?: number;
  messages: ChatMessage[];
  inputMessage: string;
  sending: boolean;
  streamingBlocks: StreamingBlock[];
  loadingHistory?: boolean;
  agents?: Agent[];
  selectedAgent: Agent | null;
  artifacts?: Artifact[];
  documents?: Document[];
  onInputChange: (value: string) => void;
  onSendMessage: (files: AttachedFile[], message?: string) => void;
  onStop?: () => void;
  onAgentSelect?: (agentName: string | null) => void;
  onAgentClick: () => void;
  onNewChat: () => void;
  onArtifactView?: (artifactId: string) => void;
  onSourceClick?: (documentId: string, segmentId: string) => void;
  loadingSourceKey?: string | null;
  scrollPositionRef?: React.MutableRefObject<number>;
  voiceChat?: VoiceChatProps;
}

export interface ToolRegistryEntry {
  icon: LucideIcon;
  resultLabel: string;
  loadingLabel: string;
  renderAsWebSearch?: boolean;
  renderAsFetchPreview?: boolean;
  renderAsMarkdown?: boolean;
  renderAsGraph?: boolean;
}

export interface GraphSearchResult {
  answer?: string;
  sources: Array<{
    document_id: string;
    segment_id: string;
    qa_id?: string;
    segment_index: number;
    qa_index?: number;
    match_type?: string;
    source: string;
  }>;
  entities: Array<{
    name: string;
    type: string;
    description?: string;
  }>;
  origin_qa_ids?: string[];
  keywords?: string[];
}

export interface WebSearchResult {
  title: string;
  url: string;
  summary: string;
}

export interface FetchContentPreview {
  title: string;
  snippet: string;
}

// Re-export types used by consuming components
export type {
  ChatMessage,
  Agent,
  ChatArtifact,
  Artifact,
  Document,
  ChatAttachment,
  VoiceChatState,
  BidiModelType,
};
