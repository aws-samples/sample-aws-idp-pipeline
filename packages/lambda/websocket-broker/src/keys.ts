export const KEYS = {
  conn: (connectionId: string) => `ws:conn:${connectionId}`,
  connProjects: (connectionId: string) => `ws:conn:${connectionId}:projects`,
  username: (username: string) => `ws:username:${username}`,
  project: (projectId: string) => `ws:project:${projectId}`,
  userSub: (sub: string) => `ws:usersub:${sub}`,
};
