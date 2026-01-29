import Valkey from 'iovalkey';

export const valkey = new Valkey({
  host: process.env.ELASTICACHE_ENDPOINT,
  port: 6379,
  tls: {},
});
