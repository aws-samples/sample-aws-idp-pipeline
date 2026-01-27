import { Cluster } from 'iovalkey';

export const valkey = new Cluster([
  { host: process.env.ELASTICACHE_ENDPOINT, port: 6379 },
]);
