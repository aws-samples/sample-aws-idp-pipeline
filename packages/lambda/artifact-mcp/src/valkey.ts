import Valkey from 'iovalkey';

export const valkey = new Valkey({
  host: process.env.ELASTICACHE_ENDPOINT,
  port: 6379,
  tls: {},
});

export async function getConnectionIdsByUsername(
  username: string,
): Promise<string[]> {
  return valkey.smembers(`ws:username:${username}`);
}
