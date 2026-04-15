// ─────────────────────────────────────────────────────────
// js/router.js — History API Router
// ─────────────────────────────────────────────────────────

/**
 * Navigates to a named SPA page and updates the URL hash.
 * This is a thin wrapper; actual page-switch logic is in ui.js showPage().
 * @param {string} pageName - the page name (without 'page-' prefix)
 * @param {Function} showPageFn - the showPage function from ui.js
 */
export function navigate(pageName, showPageFn) {
    showPageFn(pageName);
}

/**
 * Register the popstate listener to handle browser back/forward.
 * @param {Function} showPageFn
 */
export function initRouter(showPageFn) {
    window.addEventListener('popstate', (event) => {
        // Read current hash or fall back to home
        const hash = window.location.hash.replace('#', '') || 'home';
        // Use a stripped version — only show the page, no full guard logic on back
        const allPages = [
            "home", "about", "trips", "support", "settings", "passenger", "driver",
            "driver-reg", "profile", "driver-route-share", "driver-command-center",
            "passenger-route-search", "passenger-mission-status", "passenger-picking-up",
            "passenger-ride-started", "passenger-payment", "driver-picking-up",
            "driver-ride-started", "driver-payment", "earnings"
        ];
        if (allPages.includes(hash)) {
            // Directly switch view without pushing another history entry
            allPages.forEach(p => {
                const el = document.getElementById("page-" + p);
                if (el) el.classList.add("hidden");
            });
            const el = document.getElementById("page-" + hash);
            if (el) el.classList.remove("hidden");
            document.querySelectorAll(".nav-links a").forEach(l => l.classList.remove("active"));
            const nav = document.getElementById("nav-" + hash);
            if (nav) nav.classList.add("active");
        }
    });

    // On initial load, read hash from URL if present
    const initialHash = window.location.hash.replace('#', '');
    if (initialHash && initialHash !== '') {
        // We resolve the initial page after boot (main.js handles this)
        return initialHash;
    }
    return 'home';
}
