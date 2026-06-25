// Configuration for the "Ask AI" chat page.
// Edit this file to change the endpoint or turn the feature on/off.
// Imported by both astro.config.mjs (sidebar + dev proxy) and AskChat.astro.

/** @type {{ enabled: boolean, endpoint: string }} */
export const askConfig = {
  // Set to false to hide the Ask AI page entirely (sidebar link + the chat UI).
  enabled: true,

  // Streaming SSE endpoint. Must emit `data: {"delta":"..."}` and `data: [DONE]`.
  endpoint: 'https://d9sagqklx4lwu.cloudfront.net',
};
