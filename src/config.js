// src/config.js
const API_BASE =
  import.meta.env.VITE_API_BASE ||
  (import.meta.env.DEV
    ? "http://localhost:8888/.netlify/functions/api"
    : "/.netlify/functions/api");

export { API_BASE };
