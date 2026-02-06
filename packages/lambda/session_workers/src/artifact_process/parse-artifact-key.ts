export interface ArtifactKeyInfo {
  userId: string;
  projectId: string;
  artifactId: string;
  filename: string;
}

/**
 * Parse S3 key for artifact files.
 * Pattern: {user_id}/{project_id}/artifacts/{artifact_id}/{filename}
 * Example: drskur/proj_xxxxx/artifacts/art_xxxx/파일명.pptx
 */
export function parseArtifactS3Key(key: string): ArtifactKeyInfo | null {
  const match = key.match(
    /^([^/]+)\/(proj_[^/]+)\/artifacts\/(art_[^/]+)\/(.+)$/,
  );

  if (!match) {
    return null;
  }

  return {
    userId: match[1],
    projectId: match[2],
    artifactId: match[3],
    filename: match[4],
  };
}
