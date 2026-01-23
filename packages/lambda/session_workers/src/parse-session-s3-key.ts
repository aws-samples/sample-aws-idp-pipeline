export interface SessionKeyInfo {
  userId: string;
  projectId: string;
}

export interface MessageKeyInfo extends SessionKeyInfo {
  sessionId: string;
  agentId: string;
}

export function parseSessionS3Key(key: string): SessionKeyInfo | null {
  // sessions/{user_id}/{project_id}/...
  const match = key.match(/^sessions\/([^/]+)\/(proj_[^/]+)\//);
  if (!match) {
    return null;
  }
  return {
    userId: match[1],
    projectId: match[2],
  };
}

export function parseMessageS3Key(key: string): MessageKeyInfo | null {
  // sessions/{user_id}/{project_id}/{session_id}/agents/{agent_id}/messages/message_*.json
  const match = key.match(
    /^sessions\/([^/]+)\/(proj_[^/]+)\/(session_[^/]+)\/agents\/([^/]+)\/messages\/message_\d+\.json$/,
  );
  if (!match) {
    return null;
  }
  return {
    userId: match[1],
    projectId: match[2],
    sessionId: match[3],
    agentId: match[4],
  };
}
