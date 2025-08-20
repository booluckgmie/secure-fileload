export function requestAccess(email) {
  return request("/request-access", {
    method: "POST",  // ✅ must be POST
    body: JSON.stringify({ email })
  });
}

export function uploadFile(file) {
  const formData = new FormData();
  formData.append("file", file);
  return fetch(`${API_BASE}/upload`, {
    method: "POST",  // ✅ must be POST
    body: formData,
    credentials: "include"
  }).then(res => res.json());
}

export function listFiles() {
  return request("/list", { method: "GET" }); // ✅ allowed GET
}
