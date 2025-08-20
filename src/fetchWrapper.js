// src/fetchWrapper.js
import { API_BASE } from "./config";

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    credentials: "include" // ✅ send cookies (auth)
  });

  if (!res.ok) {
    let err;
    try {
      err = await res.json();
    } catch {
      err = { error: res.statusText };
    }
    throw new Error(err.error || "Request failed");
  }

  return res.json();
}

// --- API methods ---

export function requestAccess(email) {
  return request("/request-access", {
    method: "POST",
    body: JSON.stringify({ email })
  });
}

export function listFiles() {
  return request("/list");
}

export function deleteFile(path) {
  return request(`/delete?path=${encodeURIComponent(path)}`, {
    method: "DELETE"
  });
}

// Special: file upload
export async function uploadFile(file) {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API_BASE}/upload`, {
    method: "POST",
    body: formData,
    credentials: "include"
  });

  if (!res.ok) {
    let err;
    try {
      err = await res.json();
    } catch {
      err = { error: res.statusText };
    }
    throw new Error(err.error || "Upload failed");
  }

  return res.json();
}

// Special: file download (returns Blob)
export async function downloadFile(path) {
  const res = await fetch(`${API_BASE}/download?path=${encodeURIComponent(path)}`, {
    credentials: "include"
  });
  if (!res.ok) throw new Error("Download failed");
  return res.blob();
}
