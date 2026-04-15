// ─────────────────────────────────────────────────────────
// js/ui.js — UI Helpers, Page Control, Data Loading
// ─────────────────────────────────────────────────────────
import { API_BASE_URL, authFetch, getSetting } from './api.js';

// ── App state (shared with main.js via getters/setters) ──
let isOnline = false;
let isMissionActive = false;
let currentMissionStatus = 'active';

export function getIsOnline() { return isOnline; }
export function getIsMissionActive() { return isMissionActive; }
export function getCurrentMissionStatus() { return currentMissionStatus; }
export function setIsOnline(v) { isOnline = v; }
export function setIsMissionActive(v) { isMissionActive = v; }
export function setCurrentMissionStatus(v) { currentMissionStatus = v; }

// ── Toast Notifications ───────────────────────────────────
const TOAST_ICONS = { success: '✅', error: '🚫', info: 'ℹ️', warning: '⚠️' };

export function showNotification(msg, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="toast-icon">${TOAST_ICONS[type] || 'ℹ️'}</span><span class="toast-msg">${msg}</span>`;
    container.appendChild(toast);
    const dismiss = () => {
        toast.classList.add('hiding');
        toast.addEventListener('animationend', () => toast.remove(), { once: true });
    };
    toast.addEventListener('click', dismiss);
    setTimeout(dismiss, duration);
}

// ── Confirm Dialog ────────────────────────────────────────
let _confirmResolve = null;
export function showConfirm({ title = 'Are you sure?', message = '', icon = '❓', okLabel = 'Confirm', okColor = '#f44336' } = {}) {
    document.getElementById('confirm-title').innerText = title;
    document.getElementById('confirm-message').innerText = message;
    document.getElementById('confirm-icon').innerText = icon;
    const okBtn = document.getElementById('confirm-ok-btn');
    okBtn.innerText = okLabel;
    okBtn.style.background = okColor;
    okBtn.onclick = () => { _closeConfirm(true); };
    document.getElementById('confirm-modal').classList.remove('hidden');
    return new Promise(resolve => { _confirmResolve = resolve; });
}
function _closeConfirm(result) {
    document.getElementById('confirm-modal').classList.add('hidden');
    if (_confirmResolve) { _confirmResolve(result); _confirmResolve = null; }
}
// Exposed for HTML inline onclick
export function confirmReject() { _closeConfirm(false); }

// ── Page Routing (SPA) ────────────────────────────────────
const ALL_PAGES = [
    "home", "about", "trips", "support", "settings", "passenger", "driver",
    "driver-reg", "profile", "driver-route-share", "driver-command-center",
    "passenger-route-search", "passenger-mission-status", "passenger-picking-up",
    "passenger-ride-started", "passenger-payment", "driver-picking-up",
    "driver-ride-started", "driver-payment", "earnings"
];

export function showPage(pageName, _loadEarnings, _loadMyActivity, _loadSettings) {
    try {
        const userData = JSON.parse(localStorage.getItem("user") || "{}");
        const allowedUtilityPages = ['trips', 'earnings', 'profile'];

        // 1. Immediate Visibility Toggle (Fail-Safe)
        ALL_PAGES.forEach(p => {
            const el = document.getElementById("page-" + p);
            if (el) el.classList.add("hidden");
        });

        const activePage = document.getElementById("page-" + pageName);
        if (activePage) {
            activePage.classList.remove("hidden");
        } else {
            throw new Error(`Target page 'page-${pageName}' not found in DOM.`);
        }

        // 2. State Blocking Logic (with strict casting)
        const onlineBool = !!isOnline;
        const missionBool = !!isMissionActive;

        if (onlineBool && pageName !== 'driver' && !missionBool && !allowedUtilityPages.includes(pageName)) {
            showNotification('Shift Active! Go Offline to switch modes.', 'warning');
            // We still allow the page to show if we've reached here, but we warn. 
            // Or we can force it back to 'driver' if you prefer. For now, let's just warn to avoid getting stuck.
        }

        const passengerActiveRide = localStorage.getItem("passengerActiveRide");
        const passengerMissionPages = [
            'passenger-mission-status', 'passenger-picking-up',
            'passenger-ride-started', 'passenger-payment', 'profile', 'trips', 'earnings'
        ];

        if (passengerActiveRide && !passengerMissionPages.includes(pageName)) {
            showNotification("Active Ride! Finish your trip before switching.", 'warning');
            // Don't return, let the UI at least show something.
        }

        const driverMissionPages = [
            'driver', 'driver-command-center', 'driver-picking-up',
            'driver-ride-started', 'driver-payment', 'profile', 'trips', 'earnings'
        ];
        if (missionBool && !driverMissionPages.includes(pageName)) {
            showNotification("Active Trajectory! Finish mission before switching.", 'warning');
        }

        // 3. UI Decorations
        document.querySelectorAll(".nav-links a").forEach(link => link.classList.remove("active"));
        const currentNav = document.getElementById("nav-" + pageName);
        if (currentNav) currentNav.classList.add("active");

        // 4. Page-specific Initializers
        if (pageName === 'earnings' && typeof _loadEarnings === 'function') _loadEarnings();
        if (pageName === 'trips' && typeof _loadMyActivity === 'function') _loadMyActivity();
        if (pageName === 'settings' && typeof _loadSettings === 'function') _loadSettings();

        if (pageName === 'profile' && userData.email) {
            const profName = document.getElementById("prof-name");
            const profEmail = document.getElementById("prof-email");
            const genSelect = document.getElementById("edit-gender");
            if (profName) profName.innerText = userData.name || "User";
            if (profEmail) profEmail.innerText = userData.email;
            if (genSelect) genSelect.value = userData.gender || "Male";
            loadDriverSubProfile(userData);
        }

        // 5. History Update
        try {
            history.pushState({ page: pageName }, '', `#${pageName}`);
        } catch (e) { console.warn("history.pushState failed", e); }

    } catch (err) {
        console.error("Navigation Error:", err);
        showNotification("Navigation Error: " + err.message, "error");
    }
}

// ── Sidebar ───────────────────────────────────────────────
export function toggleSidebar() {
    const menu = document.getElementById("side-menu");
    const overlay = document.getElementById("sidebar-overlay");
    menu.classList.toggle("active");
    overlay.classList.toggle("hidden");
    if (menu.classList.contains("active")) {
        const userData = JSON.parse(localStorage.getItem("user"));
        document.getElementById("side-name").innerText = userData?.name || "";
        document.getElementById("side-gender-display").innerText = "Gender: " + (userData?.gender || "Not Set");
    }
}

// ── Driver UI Sync ────────────────────────────────────────
export function syncDriverUI() {
    const statusDot = document.getElementById("driver-status-indicator");
    const btn = document.getElementById("toggle-shift-btn");
    const backBtn = document.getElementById("driver-back-btn");
    const instruction = document.getElementById("driver-instruction");

    if (statusDot && btn) {
        statusDot.innerText = isOnline ? "● Online" : "● Offline";
        statusDot.style.color = isOnline ? "#2ecc71" : "#f44336";
        btn.innerText = isOnline ? "End Shift" : "Go Online";
        btn.style.background = isOnline ? "#f44336" : "#2ecc71";
        if (instruction) {
            instruction.innerText = isOnline
                ? "🟢 You are LIVE. Students can now see and request you."
                : "You are currently invisible to passengers.";
            instruction.style.color = isOnline ? "#1a8a4a" : "";
        }
        if (backBtn) {
            backBtn.style.opacity = isOnline ? "0.5" : "1";
            backBtn.style.cursor = isOnline ? "not-allowed" : "pointer";
        }
    }
}

// ── Button loader ────────────────────────────────────────
export function toggleButtonLoading(buttonId, isLoading, originalText) {
    const btn = document.getElementById(buttonId);
    if (!btn) return;
    if (isLoading) {
        btn.disabled = true;
        btn.innerHTML = `<span class="loading-spinner"></span> Processing...`;
        btn.style.opacity = "0.7";
        btn.style.cursor = "not-allowed";
    } else {
        btn.disabled = false;
        btn.innerHTML = originalText;
        btn.style.opacity = "1";
        btn.style.cursor = "pointer";
    }
}

// ── Request card renderer ─────────────────────────────────
export function renderRequestList(requests) {
    const container = document.getElementById("cc-requests-container");
    if (!container) return;

    if (!requests || requests.length === 0) {
        container.innerHTML = `<p style="color:#888;font-size:14px;">Scanning for students...</p>`;
        return;
    }

    container.innerHTML = requests.map(req => {
        const borderColor = req.status === 'paid' ? '#2ecc71' : req.status === 'arrived' ? '#f39c12' : req.status === 'accepted' ? '#4e69e2' : '#f39c12';
        const bgColor = req.status === 'paid' ? '#f0fdf4' : req.status === 'arrived' ? '#fffbf0' : '#fff';
        const statusColor = req.status === 'paid' ? '#2ecc71' : req.status === 'arrived' ? '#f39c12' : req.status === 'accepted' ? '#4e69e2' : '#f39c12';

        return `
        <div class="glass-card" data-email="${req.email}" style="margin:12px 0;padding:16px;display:flex;justify-content:space-between;align-items:center;border-left:4px solid ${borderColor};background:${bgColor};box-shadow:0 4px 12px rgba(0,0,0,0.04);border-radius:12px;">
            <div style="text-align:left;flex:1;">
                <div style="font-weight:800;color:#1a1a2e;font-size:15px;margin-bottom:4px;">${req.name}</div>
                ${req.pickupLocation ? `<div style="font-size:12px;color:#e74c3c;font-weight:bold;margin-bottom:4px;">📍 Pickup: ${req.pickupLocation}</div>` : ''}
                <div style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.5px;">Status: <span style="color:${statusColor}">${req.status}</span></div>
            </div>
            ${req.status === 'pending'
                ? `<div style="display:flex;gap:10px;">
                     <button class="btn-primary" style="width:auto;padding:8px 16px;background:#2ecc71;font-size:13px;margin:0;border-radius:10px;" onclick="window.acceptPassenger('${req.email}')">✓ Link</button>
                     <button class="btn-primary" style="width:auto;padding:8px 16px;background:#f44336;font-size:13px;margin:0;border-radius:10px;" onclick="window.rejectPassenger('${req.email}')">✕ Reject</button>
                   </div>`
                : req.status === 'paid'
                    ? '<span style="font-size:14px;color:#2ecc71;font-weight:800;background:#d5f5e3;padding:6px 12px;border-radius:8px;">✅ Settled</span>'
                    : req.status === 'arrived'
                        ? '<span style="font-size:14px;color:#f39c12;font-weight:800;background:#fff3cd;padding:6px 12px;border-radius:8px;">🚗 Arrived</span>'
                        : `<div style="display:flex;gap:10px;align-items:center;">
                     <span style="font-size:14px;color:#4e69e2;font-weight:800;background:#eef1ff;padding:6px 12px;border-radius:8px;">✓ Linked</span>
                     ${(currentMissionStatus === 'active') ? `<button class="btn-primary" style="width:auto;padding:6px 16px;background:#f39c12;font-size:12px;margin:0;border-radius:8px;" onclick="window.arrivePassenger('${req.email}', this)">📍 Arrive</button>` : ''}
                   </div>`
            }
        </div>`;
    }).join('');
}

export function hydratePaymentModal(data) {
    window.currentPaymentType = data.type;
    const page = document.getElementById("page-passenger-payment");
    const amt = document.getElementById("payment-amount");
    const qrWrap = document.getElementById("payment-qr-container");
    const qrImg = document.getElementById("payment-qr-img");
    const upiTxt = document.getElementById("payment-upi-string");
    const driverLabel = document.getElementById("payment-driver-label");

    if (page && amt) {
        amt.innerText = `₹${data.fare}`;
        if (driverLabel) {
            const savedUser = JSON.parse(localStorage.getItem("passengerLastDriver") || "{}");
            const driverName = savedUser.name || data.driverName || "Your Driver";
            driverLabel.innerHTML = data.upiId
                ? `Pay <strong>${driverName}</strong> &nbsp;·&nbsp; UPI: <span style="color:#4e69e2;font-weight:700;">${data.upiId}</span>`
                : `Pay <strong>${driverName}</strong> via Cash or your UPI app`;
        }

        if (qrWrap && qrImg && upiTxt) {
            qrWrap.classList.add("hidden");
            qrImg.removeAttribute("src");
            upiTxt.innerText = "";
            if (data.qrPhoto) {
                qrImg.src = data.qrPhoto;
                upiTxt.innerText = data.upiId ? `UPI: ${data.upiId}` : "Scan QR to Pay Driver directly";
                qrWrap.classList.remove("hidden");
            } else if (data.upiId) {
                const upiLink = `upi://pay?pa=${data.upiId}&am=${data.fare}&cu=INR`;
                qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(upiLink)}`;
                upiTxt.innerText = `UPI ID: ${data.upiId}`;
                qrWrap.classList.remove("hidden");
            }
        }
        modal.classList.remove("hidden");
    }
}

// ── Passenger ride-accepted UI hydration ─────────────────
export function applyRideAccepted(driverName, driverEmail, destination, vehicleModel, vehicleNumber) {
    localStorage.setItem("passengerLastDriver", JSON.stringify({ name: driverName, email: driverEmail }));
    showPage('passenger-picking-up');

    const infoBox = document.getElementById("ps-driver-info");
    const nameEl = document.getElementById("ps-driver-name");
    const destEl = document.getElementById("ps-driver-dest");
    if (infoBox && nameEl) {
        nameEl.innerText = `🚗  Driver: ${driverName}`;
        if (destEl) destEl.innerHTML = `Heading to: ${destination || localStorage.getItem('passengerRideDestination') || '—'}<br><span style="color:#2ecc71;font-weight:bold;display:inline-block;margin-top:6px;padding:4px 8px;background:rgba(46,204,113,0.1);border-radius:4px;">🚘 ${vehicleModel || 'Vehicle'} - ${vehicleNumber || 'Unknown Plate'}</span>`;
        infoBox.classList.remove("hidden");
    }

    const agreeEl = document.getElementById("pickup-agreement-text");
    if (agreeEl) agreeEl.innerText = `Confirmed by ${driverName}. They will pick you up en route — watch for their vehicle.`;

    // Draw route map
    setTimeout(() => {
        const storedLat = localStorage.getItem("passengerRideDestLat");
        const storedLng = localStorage.getItem("passengerRideDestLng");
        const fallbackText = destination || localStorage.getItem("passengerRideDestination");
        const mapDest = (storedLat && storedLng) ? { lat: parseFloat(storedLat), lng: parseFloat(storedLng) } : fallbackText;
        if (!mapDest) return;

        const depLat = parseFloat(localStorage.getItem("passengerRideDepartureLat"));
        const depLng = parseFloat(localStorage.getItem("passengerRideDepartureLng"));

        // Import drawRouteMap lazily to avoid module evaluation issues
        import('./map.js').then(({ drawRouteMap, mapInstances }) => {
            if (depLat && depLng) {
                drawRouteMap("ps-map-container", { lat: depLat, lng: depLng }, mapDest, (dur, dist) => {
                    const etaWrap = document.getElementById("ps-eta-wrap");
                    const etaText = document.getElementById("ps-eta-text");
                    if (etaWrap && etaText) {
                        etaText.innerText = `${dur} drive · ${dist}`;
                        etaWrap.classList.remove("hidden");
                    }
                });
            } else if (mapDest && typeof mapDest === 'object') {
                const mapDiv = document.getElementById("ps-map-container");
                if (mapDiv) {
                    mapDiv.classList.remove("hidden");
                    if (mapInstances["ps-map-container"]) mapInstances["ps-map-container"].map.remove();
                    const map = L.map(mapDiv, { zoomControl: false }).setView([mapDest.lat, mapDest.lng], 11);
                    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
                    L.circleMarker([mapDest.lat, mapDest.lng], { radius: 7, color: '#f44336', fillOpacity: 1 }).addTo(map);
                    mapInstances["ps-map-container"] = { map };
                }
            }
        });
    }, 100);
}

// ── Force-clear passenger session ────────────────────────
export function forceClearPassengerState(showPageFn, stopListenersFn) {
    if (stopListenersFn) stopListenersFn();
    localStorage.removeItem("passengerActiveRide");
    localStorage.removeItem("passengerRideDestination");
    localStorage.removeItem("passengerLastDriver");
    localStorage.removeItem("quickDropPickup");
    localStorage.removeItem("quickDropDrop");
    localStorage.removeItem("quickDropDriverName");
    localStorage.removeItem("quickDropDriverEmail");

    const orb = document.getElementById("ps-status-orb");
    const text = document.getElementById("ps-status-text");
    if (orb) orb.className = "pulse-orb pending";
    if (text) text.innerText = "Awaiting Driver Response...";

    const infoBox = document.getElementById("ps-driver-info");
    const nameEl = document.getElementById("ps-driver-name");
    const destEl = document.getElementById("ps-driver-dest");
    if (infoBox) infoBox.classList.add("hidden");
    if (nameEl) nameEl.innerText = "";
    if (destEl) destEl.innerHTML = "";

    const mapDiv = document.getElementById("ps-map-container");
    const etaWrap = document.getElementById("ps-eta-wrap");
    if (mapDiv) mapDiv.classList.add("hidden");
    if (etaWrap) etaWrap.classList.add("hidden");

    showPageFn('home');
}

// ── Data loading functions ────────────────────────────────
export async function loadMyActivity() {
    const listEl = document.getElementById("trips-list");
    const loadingEl = document.getElementById("trips-loading");
    const emptyEl = document.getElementById("trips-empty");
    if (!listEl) return;
    listEl.innerHTML = "";
    if (loadingEl) loadingEl.classList.remove("hidden");
    if (emptyEl) emptyEl.classList.add("hidden");

    try {
        const res = await authFetch(`${API_BASE_URL}/my-trips`);
        if (!res.ok) throw new Error("API failure");
        const data = await res.json();

        if (loadingEl) loadingEl.classList.add("hidden");
        if (!data || data.length === 0) {
            if (emptyEl) emptyEl.classList.remove("hidden");
            return;
        }

        listEl.innerHTML = data.map(trip => {
            const isDriver = trip.role === "driver";

            // Safer date handling
            let dateStr = "Recent";
            if (trip.createdAt) {
                const d = new Date(trip.createdAt);
                if (!isNaN(d.getTime())) {
                    dateStr = d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
                }
            }

            const statusClass = (trip.status || "completed").toLowerCase();
            return `
            <div class="trip-card ${isDriver ? 'driver-trip' : ''}">
                <div class="tc-header">
                    <span class="tc-dest">→ ${trip.destination}</span>
                    <span class="tc-status-badge ${statusClass}">${trip.status || 'Success'}</span>
                    <span class="tc-badge ${isDriver ? 'driver' : 'passenger'}">${isDriver ? 'Driver' : 'Passenger'}</span>
                </div>
                <div class="tc-meta">${dateStr} · ₹${trip.fare} per seat · ${trip.time || 'Time not set'}</div>
            </div>`;
        }).join('');
    } catch (err) {
        console.error("Activity Load Error:", err);
        if (loadingEl) loadingEl.classList.add("hidden");
        if (listEl) listEl.innerHTML = `<p style="color:#f44336;text-align:center;font-size:14px;">Could not load activity. Please check console.</p>`;
    }
}

export async function loadEarnings() {
    const container = document.getElementById('earnings-content');
    if (!container) return;
    const userData = JSON.parse(localStorage.getItem('user'));
    if (!userData?.isCampusDriver) {
        container.innerHTML = `<div class="earn-not-driver"><div class="big-icon">🛞</div><h3>You're not a driver yet</h3><p>Enroll as a campus driver to start tracking your earnings.</p><button class="btn-primary" style="margin:20px auto 0;max-width:240px;" onclick="window.showPageWrapper('driver-reg')">Enroll as Driver</button></div>`;
        return;
    }
    container.innerHTML = `<div style="text-align:center;color:#4e69e2;padding:20px;"><span class="loading-spinner"></span> Loading earnings...</div>`;
    try {
        const res = await authFetch(`${API_BASE_URL}/my-earnings`);
        const data = await res.json();
        const monthName = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
        container.innerHTML = `
        <div class="earn-stat-row">
            <div class="earn-stat"><div class="earn-stat-val">₹${data.totalMonthly}</div><div class="earn-stat-lbl">${monthName} Gross</div></div>
            <div class="earn-stat"><div class="earn-stat-val green">₹${data.netMonthly}</div><div class="earn-stat-lbl">Your Net</div></div>
            <div class="earn-stat"><div class="earn-stat-val red">₹${data.platformFee}</div><div class="earn-stat-lbl">Platform (10%)</div></div>
            <div class="earn-stat"><div class="earn-stat-val">₹${data.totalAllTime}</div><div class="earn-stat-lbl">All-Time Gross</div></div>
        </div>
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#888;font-weight:700;margin-bottom:10px;">Recent Transactions</div>
        ${data.earnings.length === 0 ? '<p style="text-align:center;color:#aaa;font-size:14px;padding:20px 0;">No earnings recorded yet.</p>' :
                data.earnings.map(e => {
                    const d = new Date(e.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                    const type = e.rideType === 'route_share' ? 'Route Share' : 'Quick Drop';
                    const tCls = e.rideType === 'route_share' ? 'qs' : 'qd';
                    const mCls = (e.paymentMethod || 'cash') === 'upi' ? 'upi' : 'cash';
                    return `<div class="earn-row">
                    <div>
                        <div style="font-weight:700;font-size:13px;color:#1a1a2e;margin-bottom:2px;">${e.passengerEmail?.split('@')[0] || 'Passenger'}</div>
                        <div style="display:flex;gap:6px;margin-top:4px;"><span class="earn-badge ${tCls}">${type}</span><span class="earn-badge ${mCls}">${(e.paymentMethod || 'cash').toUpperCase()}</span></div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-weight:900;font-size:16px;color:#2ecc71;">₹${e.fare}</div>
                        <div style="font-size:11px;color:#aaa;margin-top:2px;">${d}</div>
                    </div>
                </div>`;
                }).join('')
            }`;
    } catch { container.innerHTML = `<p style="text-align:center;color:#f44336;">Could not load earnings. Check connection.</p>`; }
}

export function loadDriverSubProfile(userData) {
    const badge = document.getElementById('prof-driver-badge');
    const details = document.getElementById('prof-driver-details');
    if (!badge || !details) return;
    if (!userData.isCampusDriver) {
        badge.innerText = 'Not a Driver';
        badge.style.background = 'rgba(244,67,54,0.1)';
        badge.style.color = '#f44336';
        details.innerHTML = `<p style="font-size:13px;color:#888;text-align:center;padding:10px 0;">You haven't enrolled as a campus driver yet.<br><br><span onclick="window.showPageWrapper('driver-reg')" style="color:#4e69e2;font-weight:700;cursor:pointer;">Enroll as Driver →</span></p>`;
        return;
    }
    badge.innerText = '✅ Verified Driver';
    badge.style.background = 'rgba(46,204,113,0.12)';
    badge.style.color = '#1a8a4a';
    authFetch(`${API_BASE_URL}/get-driver-profile`).then(r => r.json()).then(d => {
        details.innerHTML = `
        <div class="info-group"><div class="info-label">License</div><div class="info-value" style="font-size:15px;">${d.licenseNumber || '—'}</div></div>
        <div class="info-group"><div class="info-label">Vehicle</div><div class="info-value" style="font-size:15px;">${d.vehicleModel || '—'}</div></div>
        <div class="info-group"><div class="info-label">Plate</div><div class="info-value" style="font-size:15px;">${d.vehicleNumber || '—'}</div></div>
        <div class="info-group"><div class="info-label">UPI ID</div><div class="info-value" style="font-size:15px;">${d.upiId || '—'}</div></div>
        <button class="btn-primary" style="margin-top:10px;background:#4e69e2;" onclick="window.showPageWrapper('driver-reg')">Update Driver Details</button>`;
    }).catch(() => {
        details.innerHTML = `<p style="font-size:13px;color:#f44336;text-align:center;">Could not load driver details.</p>`;
    });
}

export function saveSettings() {
    const s = {
        notifRides: document.getElementById("setting-notif-rides")?.checked,
        notifStatus: document.getElementById("setting-notif-status")?.checked,
        showFare: document.getElementById("setting-show-fare")?.checked,
        defaultMode: document.getElementById("setting-default-mode")?.value
    };
    localStorage.setItem("appSettings", JSON.stringify(s));
}

export function loadSettings() {
    const raw = localStorage.getItem("appSettings");
    if (!raw) return;
    try {
        const s = JSON.parse(raw);
        const setCheck = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };
        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
        setCheck("setting-notif-rides", s.notifRides ?? true);
        setCheck("setting-notif-status", s.notifStatus ?? true);
        setCheck("setting-show-fare", s.showFare ?? true);
        setVal("setting-default-mode", s.defaultMode ?? "passenger");
    } catch { }
}

// ── Misc helpers ──────────────────────────────────────────
export function checkPasswordStrength(pw) {
    const rules = {
        'rule-length': pw.length >= 8,
        'rule-upper': /[A-Z]/.test(pw),
        'rule-lower': /[a-z]/.test(pw),
        'rule-number': /[0-9]/.test(pw),
        'rule-special': /[@$!%*?&#^]/.test(pw)
    };
    let allValid = true;
    for (const [id, isValid] of Object.entries(rules)) {
        const el = document.getElementById(id);
        if (el) {
            if (isValid) { el.innerText = el.innerText.replace('❌', '✅'); el.style.color = '#2ecc71'; }
            else { el.innerText = el.innerText.replace('✅', '❌'); el.style.color = '#f44336'; allValid = false; }
        }
    }
    return allValid;
}

export function togglePassword(inputId, icon) {
    const input = document.getElementById(inputId);
    if (input.type === "password") { input.type = "text"; icon.textContent = "🙈"; }
    else { input.type = "password"; icon.textContent = "👁️"; }
}

export function handleEnter(event, buttonId) {
    if (event.key === "Enter") { event.preventDefault(); document.getElementById(buttonId)?.click(); }
}
