import {
  Search,
  Globe,
  Paintbrush,
  Clock,
  Calculator,
  BookOpen,
  ClipboardList,
  MessageSquare,
  File,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import type { ToolRegistryEntry } from './types';

const TOOL_REGISTRY: Record<string, ToolRegistryEntry> = {
  search: {
    icon: Globe,
    resultLabel: 'chat.webSearch',
    loadingLabel: 'chat.webSearch',
    renderAsWebSearch: true,
  },
  search___summarize: {
    icon: Search,
    resultLabel: 'chat.documentSearch',
    loadingLabel: 'chat.documentSearch',
  },
  fetch_content: {
    icon: Globe,
    resultLabel: 'chat.webContent',
    loadingLabel: 'chat.fetchContent',
    renderAsFetchPreview: true,
  },
  generate_image: {
    icon: Paintbrush,
    resultLabel: 'chat.generatedImage',
    loadingLabel: 'chat.generatingImage',
  },
  current_time: {
    icon: Clock,
    resultLabel: 'chat.currentTime',
    loadingLabel: 'chat.checkingTime',
  },
  calculator: {
    icon: Calculator,
    resultLabel: 'chat.calculationResult',
    loadingLabel: 'chat.calculating',
  },
  research_agent: {
    icon: BookOpen,
    resultLabel: 'chat.researchResult',
    loadingLabel: 'chat.researching',
    renderAsMarkdown: true,
  },
  plan_agent: {
    icon: ClipboardList,
    resultLabel: 'chat.planResult',
    loadingLabel: 'chat.planning',
    renderAsMarkdown: true,
  },
  handoff_to_user: {
    icon: MessageSquare,
    resultLabel: 'chat.agentMessage',
    loadingLabel: 'chat.handingOff',
    renderAsMarkdown: true,
  },
  websearch_agent: {
    icon: Globe,
    resultLabel: 'chat.webSearch',
    loadingLabel: 'chat.webSearch',
    renderAsMarkdown: true,
  },
};

const DEFAULT_ENTRY: ToolRegistryEntry = {
  icon: Sparkles,
  resultLabel: 'chat.toolResult',
  loadingLabel: '',
};

const ARTIFACT_ENTRY: ToolRegistryEntry = {
  icon: File,
  resultLabel: 'chat.artifactSaved',
  loadingLabel: 'chat.artifactSaved',
};

export function getToolEntry(
  toolName?: string,
  isArtifact?: boolean,
): ToolRegistryEntry {
  if (isArtifact) return ARTIFACT_ENTRY;
  if (!toolName) return DEFAULT_ENTRY;
  return TOOL_REGISTRY[toolName] ?? DEFAULT_ENTRY;
}

/** Get the icon for a tool_use block (running state) with search heuristic */
export function getToolUseIcon(toolName: string): LucideIcon {
  const entry = TOOL_REGISTRY[toolName];
  if (entry) return entry.icon;
  if (toolName.toLowerCase().includes('search')) return Search;
  return Sparkles;
}
