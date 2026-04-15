// ─────────────────────────────────────────────────────────
// js/api.js — API Configuration & Fetch Helpers (No UI deps)
// ─────────────────────────────────────────────────────────

const host = window.location.hostname;
const isLocal = host === "localhost" || host === "127.0.0.1" || host.startsWith("192.168.") || host.startsWith("10.") || host.startsWith("172.");
export const API_BASE_URL = isLocal
    ? `http://${host}:5000`
    : "https://campus-vehicle-project.onrender.com";

export const CAMPUS_COORDS = { lat: 23.5354, lng: 72.4573 };

// ── JWT fetch wrapper ──────────────────────────────────────
export function authFetch(url, options = {}) {
    const token = localStorage.getItem("token");
    return fetch(url, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { "Authorization": `Bearer ${token}` } : {}),
            ...(options.headers || {})
        }
    }).then(response => {
        if (response.status === 401) {
            localStorage.removeItem("token");
            window.location.replace("login.html");
        }
        return response;
    });
}

// ── Settings helper ────────────────────────────────────────
export function getSetting(key, defaultVal = true) {
    try {
        const s = JSON.parse(localStorage.getItem('appSettings') || '{}');
        return (key in s) ? s[key] : defaultVal;
    } catch { return defaultVal; }
}
