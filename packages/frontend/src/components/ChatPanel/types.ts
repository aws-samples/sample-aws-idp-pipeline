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
  | { type: 'tool_use'; name: string; status?: 'running' | 'success' | 'error' }
  | {
      type: 'tool_result';
      resultType: 'image' | 'artifact' | 'text';
      content?: string;
      images?: ToolResultImage[];
      sources?: ToolResultSource[];
      toolName?: string;
    }
  | { type: 'stage_start'; stage: string }
  | { type: 'stage_complete'; stage: string; result: string }
  | { type: 'voice_transcript'; role: 'user' | 'assistant'; content: string };

export interface ChatPanelProps {
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
  onResearch?: (files: AttachedFile[], message?: string) => void;
  onAgentSelect?: (agentName: string | null) => void;
  onAgentClick: () => void;
  onNewChat: () => void;
  onArtifactView?: (artifactId: string) => void;
  onSourceClick?: (documentId: string, segmentId: string) => void;
  loadingSourceKey?: string | null;
  scrollPositionRef?: React.MutableRefObject<number>;
  // Research Mode
  researchMode?: boolean;
  onResearchModeChange?: (mode: boolean) => void;
  // Voice Chat
  voiceChatAvailable?: boolean;
  voiceChatState?: VoiceChatState;
  voiceChatAudioLevel?: { input: number; output: number };
  voiceChatMode?: boolean;
  selectedVoiceModel?: BidiModelType;
  onVoiceChatModeChange?: (mode: boolean) => void;
  onVoiceChatConnect?: () => void;
  onVoiceChatDisconnect?: () => void;
  onVoiceChatText?: (text: string) => void;
  onVoiceChatToggleMic?: () => void;
  onVoiceChatSettings?: () => void;
  onVoiceModelSelect?: (modelType: BidiModelType) => void;
}

export interface ToolRegistryEntry {
  icon: LucideIcon;
  resultLabel: string;
  loadingLabel: string;
  renderAsWebSearch?: boolean;
  renderAsFetchPreview?: boolean;
  renderAsMarkdown?: boolean;
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
