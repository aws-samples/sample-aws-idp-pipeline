import Valkey from 'iovalkey';

export const valkey = new Valkey({
  host: process.env.ELASTICACHE_ENDPOINT,
  port: 6379,
  tls: {},
});

export async function getConnectionIdsByProject(
  projectId: string,
): Promise<string[]> {
  return valkey.smembers(`ws:project:${projectId}`);
}

export async function removeStaleConnection(
  connectionId: string,
  projectId: string,
): Promise<void> {
  try {
    await valkey.srem(`ws:project:${projectId}`, connectionId);
    await valkey.del(`ws:conn:${connectionId}`);
    console.log(`Removed stale connection ${connectionId} from project ${projectId}`);
  } catch (error) {
    console.error(`Failed to remove stale connection ${connectionId}:`, error);
  }
}
