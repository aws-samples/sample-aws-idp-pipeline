import {
  Search,
  Globe,
  Paintbrush,
  Clock,
  Calculator,
  BookOpen,
  File,
  Sparkles,
  Network,
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
  search___overview: {
    icon: BookOpen,
    resultLabel: 'chat.documentOverview',
    loadingLabel: 'chat.documentOverview',
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
  graph___graph_search: {
    icon: Network,
    resultLabel: 'chat.graphSearch',
    loadingLabel: 'chat.graphSearching',
    renderAsGraph: true,
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

export function isRegisteredTool(toolName?: string): boolean {
  return !!toolName && toolName in TOOL_REGISTRY;
}

/** Get the icon for a tool_use block (running state) with search heuristic */
export function getToolUseIcon(toolName: string): LucideIcon {
  const entry = TOOL_REGISTRY[toolName];
  if (entry) return entry.icon;
  if (toolName.toLowerCase().includes('search')) return Search;
  return Sparkles;
}
