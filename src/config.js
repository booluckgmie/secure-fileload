// src/config.js
const API_BASE =
  import.meta.env.VITE_API_BASE ||
  (import.meta.env.DEV
    ? "https://nexaflowdb.netlify.app/.netlify/functions/api"
    : "/.netlify/functions/api");

export { API_BASE };
