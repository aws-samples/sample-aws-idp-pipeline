export const KEYS = {
  conn: (connectionId: string) => `ws:conn:${connectionId}`,
  user: (userSub: string) => `ws:user:${userSub}`,
};
