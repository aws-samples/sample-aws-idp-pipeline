export interface SessionKeyInfo {
  userId: string;
  projectId: string;
}

export function parseSessionS3Key(key: string): SessionKeyInfo | null {
  // sessions/{user_id}/{project_id}/session_{...}/agents/agent_{...}/messages/message_1.json
  const match = key.match(/^sessions\/([^/]+)\/(proj_[^/]+)\//);
  if (!match) {
    return null;
  }
  return {
    userId: match[1],
    projectId: match[2],
  };
}
