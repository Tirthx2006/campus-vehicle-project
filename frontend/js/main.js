// ─────────────────────────────────────────────────────────
// js/main.js — App Entry Point & Orchestrator
// type="module" in index.html
// ─────────────────────────────────────────────────────────
import { API_BASE_URL, authFetch, getSetting } from './api.js';
import {
    mapInstances, chosenFromPlace, chosenDestinationPlace, selectionPinLat, selectionPinLng,
    setChosenFromPlace, setChosenDestinationPlace,
    initMaps, invalidateSelectionMap, drawRouteMap
} from './map.js';
import {
    socket, setSocketHandlers,
    startGPSBroadcasting, stopGPSBroadcasting,
    listenForPassengerRequests, stopListeningForPassengerRequests,
    listenForRideStatusUpdates, stopListeningForRideStatusUpdates,
    listenForQuickDropAccepted, listenForQuickRequests, stopListeningForQuickRequests
} from './socket.js';
import {
    showNotification, showConfirm, confirmReject,
    showPage as _showPageRaw, syncDriverUI, toggleSidebar, toggleButtonLoading,
    renderRequestList, hydratePaymentModal, applyRideAccepted,
    forceClearPassengerState as _forceClear,
    loadMyActivity, loadEarnings, loadSettings, saveSettings,
    checkPasswordStrength, togglePassword, handleEnter,
    getIsOnline, getIsMissionActive, getCurrentMissionStatus,
    setIsOnline, setIsMissionActive, setCurrentMissionStatus
} from './ui.js';
import { initRouter } from './router.js';

const CAMPUS_COORDS = { lat: 23.5354, lng: 72.4573 };

// ── Wrapped showPage that injects data-load callbacks ────
function showPage(pageName) {
    _showPageRaw(pageName, loadEarnings, loadMyActivity, loadSettings);
    // Invalidate selection map when route search becomes visible
    if (pageName === 'passenger-route-search') {
        setTimeout(() => invalidateSelectionMap(searchActiveRoutes), 250);
    }
    // Handle home default mode
    if (pageName === 'home') {
        const mode = getSetting('defaultMode', 'passenger');
        if (!getIsOnline() && !getIsMissionActive() && !localStorage.getItem("passengerActiveRide")) {
            setTimeout(() => { if (mode === 'driver') enterDriver(); }, 0);
        }
    }
}

// Make showPage available globally for HTML inline handlers
window.showPageWrapper = showPage;

// ── Wire socket handlers ──────────────────────────────────
setSocketHandlers({
    showPage,
    showNotification,
    renderRequestList,
    hydratePaymentModal,
    applyRideAccepted: (driverName, driverEmail, destination, vehicleModel, vehicleNumber) => {
        applyRideAccepted(driverName, driverEmail, destination, vehicleModel, vehicleNumber);
    },
    forceClearPassengerState: () => forceClearPassengerState()
});

function forceClearPassengerState() {
    _forceClear(showPage, stopListeningForRideStatusUpdates);
}

// ── Boot ──────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
    // Check token — if none, redirect to login.html (MPA)
    const token = localStorage.getItem("token");
    if (!token) {
        window.location.replace('login.html');
        return;
    }

    const savedUser = localStorage.getItem("user");
    const isOnline = localStorage.getItem("isOnline") === "true";
    const isMissionActive = localStorage.getItem("isMissionActive") === "true";

    // IMPORTANT: Sync state BEFORE initializing router/maps to ensure blockers are active
    setIsOnline(isOnline);
    setIsMissionActive(isMissionActive);

    // Init maps & router
    initMaps(searchActiveRoutes);
    initRouter(showPage);

    loadSettings();

    if (savedUser) {
        const userData = JSON.parse(savedUser);
        // Show nav with user name
        const navName = document.getElementById("nav-user-name");
        if (navName) navName.innerText = userData.name.split(' ')[0];
        document.getElementById("home-page")?.classList.remove("hidden");

        syncDriverUI();

        if (isMissionActive) {
            showPage('driver-command-center');
            socket.emit("join", userData.email);
            listenForPassengerRequests();
            startGPSBroadcasting();

            authFetch(`${API_BASE_URL}/get-active-mission`)
                .then(res => res.json())
                .then(mission => {
                    if (!mission.active) {
                        setIsMissionActive(false);
                        localStorage.removeItem("isMissionActive");
                        localStorage.removeItem("activeMissionDestination");
                        showNotification('Your previous mission has ended.', 'info');
                        showPage('home');
                        return;
                    }

                    document.getElementById("cc-destination").innerText = mission.destination;
                    document.getElementById("cc-seats").innerText = `${mission.bookedSeats}/${mission.totalSeats}`;
                    document.getElementById("cc-fare").innerText = `₹${parseFloat(mission.fare).toFixed(2)}`;
                    setCurrentMissionStatus(mission.status || 'active');
                    renderRequestList(mission.requests);

                    if (mission.destLat && mission.destLng) {
                        localStorage.setItem("activeMissionDestLat", mission.destLat);
                        localStorage.setItem("activeMissionDestLng", mission.destLng);
                    }

                    const actionBtn = document.getElementById("cmd-action-btn");
                    if (actionBtn) {
                        if (mission.status === "in_progress") {
                            actionBtn.innerHTML = "💰 Settle Payments";
                            actionBtn.style.background = "#f39c12";
                            actionBtn.onclick = requestPaymentsPhase;
                            showPage('driver-ride-started');
                            setTimeout(() => {
                                const map = document.getElementById("cc-map-container");
                                const wrapper = document.getElementById("ride-started-map-wrapper");
                                if (map && wrapper) wrapper.appendChild(map);
                            }, 500);
                        } else if (mission.status === "payment_pending") {
                            actionBtn.innerHTML = "🏁 Close Mission";
                            actionBtn.style.background = "#2ecc71";
                            actionBtn.onclick = closeMissionPhase;
                            showPage('driver-payment');
                            const container = document.getElementById("cc-requests-container");
                            const wrapper = document.getElementById("payment-requests-wrapper");
                            if (wrapper && container) wrapper.appendChild(container);
                        } else {
                            actionBtn.innerHTML = "► Start Trajectory";
                            actionBtn.style.background = "#4e69e2";
                            actionBtn.onclick = handleMissionAction;
                        }
                    }

                    localStorage.setItem("activeMissionDestination", mission.destination);
                    const storedFromLat = parseFloat(localStorage.getItem("activeMissionFromLat"));
                    const storedFromLng = parseFloat(localStorage.getItem("activeMissionFromLng"));
                    const mapOrigin = (storedFromLat && storedFromLng)
                        ? { lat: storedFromLat, lng: storedFromLng }
                        : CAMPUS_COORDS;
                    const destCoords = (mission.destLat && mission.destLng)
                        ? { lat: mission.destLat, lng: mission.destLng }
                        : mission.destination;

                    drawRouteMap("cc-map-container", mapOrigin, destCoords, (dur, dist) => {
                        const etaWrap = document.getElementById("cc-eta-wrap");
                        const etaEl = document.getElementById("cc-eta");
                        if (etaWrap && etaEl) { etaEl.innerText = dur; etaWrap.classList.remove("hidden"); }
                    });
                })
                .catch(() => {
                    document.getElementById("cc-destination").innerText = "Resumed Trajectory";
                    const savedDest = localStorage.getItem("activeMissionDestination");
                    const savedFromLat = parseFloat(localStorage.getItem("activeMissionFromLat"));
                    const savedFromLng = parseFloat(localStorage.getItem("activeMissionFromLng"));
                    const fallbackOrigin = (savedFromLat && savedFromLng)
                        ? { lat: savedFromLat, lng: savedFromLng }
                        : CAMPUS_COORDS;
                    if (savedDest) drawRouteMap("cc-map-container", fallbackOrigin, savedDest, (dur) => {
                        const etaEl = document.getElementById("cc-eta");
                        const etaWrap = document.getElementById("cc-eta-wrap");
                        if (etaEl && etaWrap) { etaEl.innerText = dur; etaWrap.classList.remove("hidden"); }
                    });
                    socket.emit("request_current_rides", { driverEmail: userData.email });
                });
        }

        // Passenger: restore active ride
        const activeRideId = localStorage.getItem("passengerActiveRide");
        if (activeRideId) {
            authFetch(`${API_BASE_URL}/my-ride-status?rideId=${activeRideId}`)
                .then(res => res.json())
                .then(data => {
                    showPage('passenger-mission-status');
                    listenForRideStatusUpdates(activeRideId);

                    if (['accepted', 'arrived', 'in_progress', 'payment_pending'].includes(data.status)) {
                        if (data.destLat && data.destLng) {
                            localStorage.setItem("passengerRideDestLat", data.destLat);
                            localStorage.setItem("passengerRideDestLng", data.destLng);
                        }
                        if (data.fromLat && data.fromLng) {
                            localStorage.setItem("passengerRideDepartureLat", data.fromLat);
                            localStorage.setItem("passengerRideDepartureLng", data.fromLng);
                        }
                        applyRideAccepted(data.driverName, data.driverEmail, data.destination, data.vehicleModel, data.vehicleNumber);
                        if (data.status === 'payment_pending') {
                            showPage('passenger-payment');
                            hydratePaymentModal({ type: data.rideType, fare: data.fare, upiId: data.upiId, qrPhoto: data.qrPhoto });
                        } else if (data.status === 'in_progress') {
                            showPage('passenger-ride-started');
                        } else if (data.status === 'arrived') {
                            const text = document.getElementById("pickup-status-text");
                            if (text) text.innerText = "Driver has arrived! Please board the vehicle.";
                        }
                    } else if (data.status === 'pending') {
                        // Stay on waiting screen
                    } else {
                        showNotification('Your previous ride session has ended.', 'info');
                        forceClearPassengerState();
                    }
                })
                .catch(() => {
                    showPage('passenger-mission-status');
                    listenForRideStatusUpdates(activeRideId);
                });
        }

        if (!isMissionActive && !activeRideId) {
            showPage('home');
        }
    } else {
        window.location.replace('login.html');
    }
});

// ── Auth functions (MPA pages only use these via login.html/signup.html)
// These remain here for the FORGOT PASSWORD modal inside index.html
export function openForgotModal() {
    ['fp-step1', 'fp-step2', 'fp-step3'].forEach((id, i) => {
        document.getElementById(id).className = i === 0 ? 'step active' : 'step';
    });
    ['fp-email', 'fp-otp', 'fp-newpw', 'fp-newpw2'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('forgot-modal').classList.remove('hidden');
}

export function closeForgotModal() {
    document.getElementById('forgot-modal').classList.add('hidden');
}

export async function fpSendOtp() {
    const email = document.getElementById('fp-email').value.trim();
    if (!email) { showNotification('Please enter your email.', 'warning'); return; }
    const btn = document.querySelector('#fp-step1 #fp-submit-btn');
    btn.disabled = true; btn.innerText = 'Sending...';
    try {
        const res = await fetch(`${API_BASE_URL}/forgot-password`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await res.json();
        showNotification(data.message, 'info', 5000);
        document.getElementById('fp-step2-msg').innerText = `OTP sent to ${email}. Check your inbox.`;
        document.getElementById('fp-step1').className = 'step';
        document.getElementById('fp-step2').className = 'step active';
    } catch { showNotification('Network error. Try again.', 'error'); }
    finally { btn.disabled = false; btn.innerText = 'Send OTP'; }
}

export function fpVerifyOtp() {
    const otp = document.getElementById('fp-otp').value.trim();
    if (otp.length !== 6) { showNotification('OTP must be exactly 6 digits.', 'warning'); return; }
    document.getElementById('fp-step2').className = 'step';
    document.getElementById('fp-step3').className = 'step active';
}

export async function fpResetPassword() {
    const email = document.getElementById('fp-email').value.trim();
    const otp = document.getElementById('fp-otp').value.trim();
    const pw1 = document.getElementById('fp-newpw').value;
    const pw2 = document.getElementById('fp-newpw2').value;
    if (pw1 !== pw2) { showNotification('Passwords do not match.', 'warning'); return; }
    const btn = document.querySelector('#fp-step3 #fp-submit-btn');
    btn.disabled = true; btn.innerText = 'Resetting...';
    try {
        const res = await fetch(`${API_BASE_URL}/reset-password`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, otp, newPassword: pw1 })
        });
        const data = await res.json();
        if (res.ok) { showNotification('Password reset! Please log in.', 'success', 5000); closeForgotModal(); }
        else showNotification(data.message || 'Reset failed.', 'error');
    } catch { showNotification('Network error.', 'error'); }
    finally { btn.disabled = false; btn.innerText = 'Reset Password'; }
}

// ── Driver mission orchestration ──────────────────────────
function publishRoute() {
    const from = document.getElementById("rs-from")?.value.trim() || "";
    const destination = document.getElementById("rs-destination").value.trim();
    const seats = document.getElementById("rs-seats").value;
    const time = document.getElementById("rs-time").value;
    const fare = document.getElementById("rs-fare").value.trim();

    if (!destination || !seats || !fare) {
        showNotification('Please fill in Destination, Seats, and Fare before publishing.', 'warning');
        return;
    }

    const cpFrom = chosenFromPlace;
    const cpDest = chosenDestinationPlace;

    let destLat = null, destLng = null;
    if (cpDest?.geometry?.location) {
        destLat = cpDest.geometry.location.lat;
        destLng = cpDest.geometry.location.lng;
    }

    localStorage.setItem("activeMissionFrom", from || "Starting Point");
    localStorage.setItem("activeMissionDestination", destination);
    if (destLat && destLng) {
        localStorage.setItem("activeMissionDestLat", destLat);
        localStorage.setItem("activeMissionDestLng", destLng);
    }
    if (cpFrom?.geometry?.location) {
        localStorage.setItem("activeMissionFromLat", cpFrom.geometry.location.lat);
        localStorage.setItem("activeMissionFromLng", cpFrom.geometry.location.lng);
    } else {
        localStorage.removeItem("activeMissionFromLat");
        localStorage.removeItem("activeMissionFromLng");
    }

    authFetch(`${API_BASE_URL}/publish-route`, {
        method: "POST",
        body: JSON.stringify({
            from, destination, destLat, destLng,
            fromLat: cpFrom?.geometry?.location?.lat || null,
            fromLng: cpFrom?.geometry?.location?.lng || null,
            seats, time, fare
        })
    })
        .then(res => res.json())
        .then(() => {
            setIsMissionActive(true);
            localStorage.setItem("isMissionActive", "true");

            const routeLabel = from ? `${from} → ${destination}` : destination;
            document.getElementById("cc-destination").innerText = routeLabel;
            document.getElementById("cc-seats").innerText = `0/${seats}`;
            document.getElementById("cc-fare").innerText = `₹${fare}`;
            showPage('driver-command-center');
            listenForPassengerRequests();
            startGPSBroadcasting();

            const gpsFailOrigin = (cpFrom?.geometry?.location)
                ? { lat: cpFrom.geometry.location.lat, lng: cpFrom.geometry.location.lng }
                : CAMPUS_COORDS;

            let mapDrawn = false;
            const fallbackTimer = setTimeout(() => {
                if (!mapDrawn) { mapDrawn = true; _drawCommandCenterMap(gpsFailOrigin, destLat, destLng, destination); }
            }, 3000);

            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    pos => { if (!mapDrawn) { mapDrawn = true; clearTimeout(fallbackTimer); _drawCommandCenterMap({ lat: pos.coords.latitude, lng: pos.coords.longitude }, destLat, destLng, destination); } },
                    () => { if (!mapDrawn) { mapDrawn = true; clearTimeout(fallbackTimer); _drawCommandCenterMap(gpsFailOrigin, destLat, destLng, destination); } },
                    { enableHighAccuracy: false, maximumAge: 10000, timeout: 5000 }
                );
            } else {
                mapDrawn = true; clearTimeout(fallbackTimer);
                _drawCommandCenterMap(gpsFailOrigin, destLat, destLng, destination);
            }
        })
        .catch(() => showNotification("Failed to publish route. Check details and try again.", "error"));
}

function _drawCommandCenterMap(originCoords, destLat, destLng, destination) {
    const destCoords = (destLat && destLng) ? { lat: destLat, lng: destLng } : destination;
    drawRouteMap("cc-map-container", originCoords, destCoords, (dur, dist) => {
        const etaWrap = document.getElementById("cc-eta-wrap");
        const etaEl = document.getElementById("cc-eta");
        if (etaWrap && etaEl) { etaEl.innerText = `${dur} · ${dist}`; etaWrap.classList.remove("hidden"); }
    });
}

function cancelTrajectory() {
    showConfirm({ title: 'Abort Mission?', message: 'This will cancel the trajectory for all passengers.', icon: '🛑', okLabel: 'Yes, Abort', okColor: '#f44336' })
        .then(ok => {
            if (!ok) return;
            authFetch(`${API_BASE_URL}/cancel-route`, { method: "POST", body: JSON.stringify({}) })
                .catch(() => { })
                .finally(() => {
                    stopListeningForPassengerRequests();
                    stopGPSBroadcasting();
                    setIsMissionActive(false);
                    setCurrentMissionStatus('active');
                    localStorage.removeItem("isMissionActive");
                    localStorage.removeItem("activeMissionDestination");
                    const reqContainer = document.getElementById("cc-requests-container");
                    if (reqContainer) reqContainer.innerHTML = `<p style="color:#888;font-size:14px;">Scanning for students...</p>`;
                    const mapDiv = document.getElementById("cc-map-container");
                    if (mapDiv) mapDiv.classList.add("hidden");
                    showNotification('Mission aborted.', 'warning');
                    showPage('home');
                });
        });
}

function handleMissionAction() {
    showPage('driver-picking-up');
    const container = document.getElementById("cc-requests-container");
    const wrapper = document.getElementById("pickup-requests-wrapper");
    if (wrapper && container) wrapper.appendChild(container);
    const map = document.getElementById("cc-map-container");
    const mapWrapper = document.getElementById("pickup-map-wrapper");
    if (map && mapWrapper) mapWrapper.appendChild(map);
}

function startJourneyPhase() {
    authFetch(`${API_BASE_URL}/start-route`, { method: "POST", body: JSON.stringify({}) })
        .then(() => {
            showNotification('Trajectory Started!', 'success');
            setCurrentMissionStatus('in_progress');
            startGPSBroadcasting();
            showPage('driver-ride-started');
            const map = document.getElementById("cc-map-container");
            const mapWrapper = document.getElementById("ride-started-map-wrapper");
            if (map && mapWrapper) mapWrapper.appendChild(map);
        }).catch(() => showNotification("Failed to start", "error"));
}

function requestPaymentsPhase() {
    authFetch(`${API_BASE_URL}/request-payment`, { method: "POST", body: JSON.stringify({}) })
        .then(() => {
            showNotification('Payments requested from all passengers.', 'info');
            setCurrentMissionStatus('payment_pending');
            showPage('driver-payment');
            const container = document.getElementById("cc-requests-container");
            const wrapper = document.getElementById("payment-requests-wrapper");
            if (wrapper && container) wrapper.appendChild(container);
        }).catch(() => showNotification("Failed to request payments", "error"));
}

function closeMissionPhase() { completeTrajectory(); }

function completeTrajectory() {
    showConfirm({ title: 'Mission Settled & Closed?', message: 'Are you sure you want to officially wrap and close the trajectory?', icon: '🏁', okLabel: 'Yes, Close', okColor: '#2ecc71' })
        .then(ok => {
            if (!ok) return;
            authFetch(`${API_BASE_URL}/complete-route`, { method: "POST", body: JSON.stringify({}) })
                .catch(() => { })
                .finally(() => {
                    stopListeningForPassengerRequests();
                    stopGPSBroadcasting();
                    setIsMissionActive(false);
                    setCurrentMissionStatus('active');
                    localStorage.removeItem("isMissionActive");
                    localStorage.removeItem("activeMissionDestination");
                    const reqContainer = document.getElementById("cc-requests-container");
                    if (reqContainer) reqContainer.innerHTML = `<p style="color:#888;font-size:14px;">Scanning for students...</p>`;
                    const mapDiv = document.getElementById("cc-map-container");
                    if (mapDiv) mapDiv.classList.add("hidden");
                    showNotification('🏁 Journey Completed!', 'success');
                    showPage('home');
                });
        });
}

function acceptPassenger(passengerEmail) {
    authFetch(`${API_BASE_URL}/accept-passenger`, { method: "POST", body: JSON.stringify({ passengerEmail }) })
        .then(async res => { const data = await res.json(); if (!res.ok) throw new Error(data.message || "Failed to link"); return data; })
        .then(data => {
            showNotification('Mission Linked! Passenger added to your trajectory.', 'success');
            document.getElementById("cc-seats").innerText = `${data.bookedSeats}/${data.totalSeats}`;
            const container = document.getElementById("cc-requests-container");
            if (container) {
                const card = container.querySelector(`[data-email="${passengerEmail}"]`);
                if (card) {
                    card.style.borderLeftColor = '#4e69e2';
                    const btns = card.querySelector('div[style*="display:flex"]');
                    if (btns) btns.outerHTML = '<span style="font-size:14px;color:#4e69e2;font-weight:800;background:#eef1ff;padding:6px 12px;border-radius:8px;">✓ Linked</span>';
                    const statusEl = card.querySelector('[style*="text-transform:uppercase"]');
                    if (statusEl) { statusEl.innerText = "Status: accepted"; statusEl.style.color = "#4e69e2"; }
                }
            }
            if (data.bookedSeats >= data.totalSeats)
                showNotification('Trajectory Full! Maximum capacity reached.', 'warning', 6000);
        })
        .catch(err => showNotification(err.message, 'error'));
}

function rejectPassenger(passengerEmail) {
    authFetch(`${API_BASE_URL}/reject-passenger`, { method: "POST", body: JSON.stringify({ passengerEmail }) })
        .then(async res => { const data = await res.json(); if (!res.ok) throw new Error(data.message || "Rejection failed"); return data; })
        .then(() => {
            showNotification('Passenger request declined.', 'info');
            const container = document.getElementById("cc-requests-container");
            if (container) {
                const card = container.querySelector(`[data-email="${passengerEmail}"]`);
                if (card) {
                    card.style.transition = "all 0.2s ease"; card.style.opacity = "0"; card.style.transform = "scale(0.95)";
                    setTimeout(() => { card.remove(); if (!container.querySelector('.glass-card')) container.innerHTML = `<p style="color:#888;font-size:14px;">Scanning for students...</p>`; }, 200);
                }
            }
            const driverEmail = JSON.parse(localStorage.getItem('user')).email;
            socket.emit("request_current_rides", { driverEmail });
        })
        .catch(err => showNotification(err.message, 'error'));
}

function arrivePassenger(email, buttonEl) {
    if (buttonEl) buttonEl.disabled = true;
    authFetch(`${API_BASE_URL}/arrive-passenger`, { method: "POST", body: JSON.stringify({ passengerEmail: email }) })
        .then(() => showNotification('Passenger alerted of your arrival.', 'success'))
        .catch(() => { if (buttonEl) buttonEl.disabled = false; showNotification('Failed to arrive', 'error'); });
}

// ── Passenger: Route Share ────────────────────────────────
function searchActiveRoutes(pinLat, pinLng) {
    const spLat = pinLat ?? selectionPinLat;
    const spLng = pinLng ?? selectionPinLng;
    const query = document.getElementById("ps-search-destination")?.value.trim() || "";
    const container = document.getElementById("search-results-container");
    if (!container) return;

    const hasPin = (spLat != null && spLng != null);
    if (!hasPin && query.length < 3) {
        container.innerHTML = `<p style="color:#888;text-align:center;font-size:14px;">Keep typing...</p>`;
        return;
    }

    const showFare = getSetting('showFare', true);
    container.innerHTML = `<p style="color:#4e69e2;text-align:center;font-size:14px;"><span class="loading-spinner"></span> Scanning trajectories...</p>`;

    let url = hasPin
        ? `${API_BASE_URL}/search-routes?destination=${encodeURIComponent(query || 'any')}&lat=${spLat}&lng=${spLng}`
        : `${API_BASE_URL}/search-routes?destination=${encodeURIComponent(query)}`;

    fetch(url)
        .then(res => res.json())
        .then(rides => {
            if (!rides || rides.length === 0) {
                container.innerHTML = `<p style="color:#888;text-align:center;font-size:14px;">No trajectories found for this route.</p>`;
                return;
            }
            container.innerHTML = rides.map(ride => {
                const routeLabel = ride.from
                    ? `<span style="color:#4e69e2;font-weight:900;font-size:15px;">${ride.from}</span><span style="color:#aaa;margin:0 6px;">→</span><span style="color:#1a1a2e;font-weight:900;font-size:15px;">${ride.destination}</span>`
                    : `<span style="color:#1a1a2e;font-weight:900;font-size:15px;">→ ${ride.destination}</span>`;
                return `
                <div class="glass-card" style="margin:16px 0;padding:20px;text-align:left;border:1px solid rgba(78,105,226,0.15);border-radius:20px;box-shadow:0 8px 24px rgba(0,0,0,0.06);background:linear-gradient(145deg,#ffffff,#f8f9ff);">
                    <div style="margin-bottom:10px;padding:10px 12px;background:linear-gradient(135deg,#f0f3ff,#e8f5e9);border-radius:12px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">${routeLabel}</div>
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
                        <div>
                            <div style="font-weight:800;color:#1a1a2e;font-size:14px;margin-bottom:4px;">${ride.driverName}</div>
                            <div style="color:#666;font-size:12px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:4px;">
                                <span style="background:#eef1ff;color:#4e69e2;padding:4px 8px;border-radius:12px;font-weight:600;">🚗 ${ride.vehicleModel || 'Verified Driver'}</span>
                                ${ride.vehicleNumber ? `<span style="background:#fff3cd;color:#856404;padding:4px 8px;border-radius:12px;font-weight:700;border:1px solid #ffc107;letter-spacing:1px;">🔖 ${ride.vehicleNumber}</span>` : ''}
                            </div>
                        </div>
                        ${showFare ? `<div style="background:#2ecc71;color:#fff;font-weight:800;padding:6px 14px;border-radius:14px;font-size:14px;box-shadow:0 4px 12px rgba(46,204,113,0.3);">₹${ride.fare.toFixed(2)}</div>` : ''}
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;background:#f4f6ff;padding:12px;border-radius:12px;">
                        <div style="display:flex;align-items:center;gap:8px;"><div style="width:30px;height:30px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.05);">🕐</div><div style="font-size:13px;color:#444;font-weight:600;">${ride.time || 'Flexible'}</div></div>
                        <div style="display:flex;align-items:center;gap:8px;"><div style="width:30px;height:30px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.05);">💺</div><div style="font-size:13px;color:#444;font-weight:600;">${ride.seats} seat${ride.seats !== 1 ? 's' : ''} left</div></div>
                    </div>
                    <button class="btn-primary" style="width:100%;margin:0;padding:12px;border-radius:14px;font-weight:700;font-size:14px;"
                        onclick="window.requestJoinRide('${ride._id}','${(ride.destination || '').replace(/'/g, "\\'")}',${ride.destLat || null},${ride.destLng || null})">
                        Join This Ride
                    </button>
                </div>`;
            }).join('');
        })
        .catch(() => { container.innerHTML = `<p style="color:#f44336;text-align:center;font-size:14px;">Signal lost. Check your connection.</p>`; });
}

function showPickupModal(rideId, destination, destLat, destLng) {
    const modal = document.getElementById("pickup-modal");
    const input = document.getElementById("pickup-modal-input");
    const confirmBtn = document.getElementById("pickup-modal-confirm");
    const cancelBtn = document.getElementById("pickup-modal-cancel");
    if (!modal || !input || !confirmBtn) return;
    input.value = "";
    modal.classList.remove("hidden");
    setTimeout(() => input.focus(), 100);
    const onConfirm = () => { _submitPickupRequest(rideId, destination, destLat, destLng); cleanup(); };
    const onCancel = () => { modal.classList.add("hidden"); cleanup(); };
    const onEnter = (e) => { if (e.key === "Enter") onConfirm(); if (e.key === "Escape") onCancel(); };
    function cleanup() {
        confirmBtn.removeEventListener("click", onConfirm);
        if (cancelBtn) cancelBtn.removeEventListener("click", onCancel);
        input.removeEventListener("keydown", onEnter);
    }
    confirmBtn.addEventListener("click", onConfirm);
    if (cancelBtn) cancelBtn.addEventListener("click", onCancel);
    input.addEventListener("keydown", onEnter);
}

function requestJoinRide(rideId, destination, destLat, destLng) {
    showPickupModal(rideId, destination, destLat, destLng);
}

function _submitPickupRequest(rideId, destination, destLat, destLng) {
    const pickupInput = document.getElementById("pickup-modal-input");
    const pickupLocation = pickupInput ? pickupInput.value.trim() : "";
    if (!pickupLocation) { showNotification("Please enter your pickup location.", "warning"); return; }
    const modal = document.getElementById("pickup-modal");
    if (modal) modal.classList.add("hidden");
    localStorage.setItem("passengerActiveRide", rideId);
    if (destination) localStorage.setItem("passengerRideDestination", destination);
    if (destLat && destLng) {
        localStorage.setItem("passengerRideDestLat", destLat);
        localStorage.setItem("passengerRideDestLng", destLng);
    }
    authFetch(`${API_BASE_URL}/request-ride`, { method: "POST", body: JSON.stringify({ rideId, pickupLocation }) })
        .then(res => res.json())
        .then(() => {
            showNotification('Request sent! Waiting for driver to Link with you.', 'info');
            showPage('passenger-mission-status');
            listenForRideStatusUpdates(rideId);
        })
        .catch(() => { showNotification('Failed to send request. Please try again.', 'error'); localStorage.removeItem("passengerActiveRide"); });
}

function endPassengerJourney() {
    const rideStartedPage = document.getElementById("page-passenger-ride-started");
    if (rideStartedPage && !rideStartedPage.classList.contains("hidden")) {
        showNotification("You cannot leave during an active ride. Please wait for the driver to settle payments.", "warning");
        return;
    }
    showConfirm({ title: 'Leave Trajectory?', message: 'Are you sure you want to leave this trajectory?', icon: '🚪', okLabel: 'Yes, Leave', okColor: '#f44336' })
        .then(ok => {
            if (!ok) return;
            const rideId = localStorage.getItem("passengerActiveRide");
            if (rideId) {
                authFetch(`${API_BASE_URL}/leave-ride`, { method: "POST", body: JSON.stringify({ rideId }) })
                    .then(async res => {
                        if (!res.ok) { const data = await res.json().catch(() => ({})); showNotification(data.message || "Cannot leave at this stage.", "error"); return; }
                        showNotification('You have left the trajectory.', 'warning');
                        forceClearPassengerState();
                    })
                    .catch(() => { showNotification('You have left the trajectory.', 'warning'); forceClearPassengerState(); });
            } else { forceClearPassengerState(); }
        });
}

function confirmPaymentSent() {
    const type = window.currentPaymentType || "route_share";
    const rideId = localStorage.getItem("passengerActiveRide");
    if (!rideId) { showNotification("No active ride found to settle.", "error"); return; }
    const btn = document.getElementById("payment-confirm-btn");
    btn.innerText = "Processing..."; btn.disabled = true;
    authFetch(`${API_BASE_URL}/passenger-paid`, { method: "POST", body: JSON.stringify({ type, rideId }) })
        .then(() => {
            showNotification('Payment confirmation sent to driver!', 'success');
            const btn = document.getElementById("payment-confirm-btn");
            if (btn) btn.innerText = "Payment Sent! Awaiting Closure...";
        })
        .finally(() => { btn.innerText = "I have Paid via Cash / UPI"; btn.disabled = false; });
}

// ── Passenger: Quick Drop ─────────────────────────────────
async function searchCampusDrivers() {
    const pickup = document.getElementById("qp-pickup").value.trim();
    const drop = document.getElementById("qp-drop").value.trim();
    const resultsContainer = document.getElementById("campus-drivers-results");
    if (!pickup || !drop) { showNotification('Identify your coordinates (Pickup & Drop) first.', 'warning'); return; }
    toggleButtonLoading("search-campus-btn", true, "Scanning...");
    resultsContainer.innerHTML = `<p style="text-align:center;color:#4e69e2;">📡 Pinging nearby units...</p>`;
    try {
        const response = await fetch(`${API_BASE_URL}/search-campus-drivers`);
        const drivers = await response.json();
        if (!drivers || drivers.length === 0) {
            resultsContainer.innerHTML = `<p style="text-align:center;font-size:14px;color:#888;">No active units found in your sector.</p>`;
        } else {
            resultsContainer.innerHTML = drivers.map(driver => {
                const hasUpi = driver.driverDetails?.upiId;
                const hasQr = driver.driverDetails?.qrPhoto;
                const payBadge = hasQr
                    ? `<span style="background:#e8f5e9;color:#1a8a4a;padding:3px 8px;border-radius:8px;font-size:11px;font-weight:700;">📷 Custom QR</span>`
                    : hasUpi
                        ? `<span style="background:#e3f2fd;color:#1565c0;padding:3px 8px;border-radius:8px;font-size:11px;font-weight:700;">💳 UPI: ${hasUpi}</span>`
                        : `<span style="background:#fafafa;color:#888;padding:3px 8px;border-radius:8px;font-size:11px;">Cash only</span>`;
                const plateTag = driver.driverDetails?.vehicleNumber
                    ? `<span style="background:#fff3cd;color:#856404;border:1px solid #ffc107;padding:3px 8px;border-radius:8px;font-size:11px;font-weight:700;letter-spacing:1px;">🔖 ${driver.driverDetails.vehicleNumber}</span>`
                    : '';
                return `
                <div class="glass-card" style="margin:12px 0;padding:16px 18px;border-left:4px solid #2ecc71;text-align:left;border-radius:18px;box-shadow:0 4px 16px rgba(0,0,0,0.06);">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
                        <div style="flex:1;">
                            <div style="font-weight:800;color:#1a1a2e;font-size:15px;margin-bottom:6px;">${driver.name}</div>
                            <div style="font-size:12px;color:#555;margin-bottom:6px;">🚗 ${driver.driverDetails?.vehicleModel || 'Vehicle'} &nbsp;·&nbsp; ${driver.gender}</div>
                            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;">${plateTag}${payBadge}</div>
                        </div>
                        <button class="btn-primary" style="width:auto;padding:10px 16px;margin:0;align-self:center;border-radius:12px;"
                                onclick="window.initiateQuickRide('${driver.email}','${driver.name}')">
                            Request
                        </button>
                    </div>
                </div>`;
            }).join('');
        }
    } catch { resultsContainer.innerHTML = `<p style="color:red;">Signal lost. Retry scan.</p>`; }
    finally { toggleButtonLoading("search-campus-btn", false, "Scan for Active Beacons"); }
}

function initiateQuickRide(driverEmail, driverName) {
    const pickup = document.getElementById("qp-pickup").value.trim();
    const drop = document.getElementById("qp-drop").value.trim();
    localStorage.setItem("quickDropPickup", pickup);
    localStorage.setItem("quickDropDrop", drop);
    localStorage.setItem("quickDropDriverName", driverName);
    localStorage.setItem("quickDropDriverEmail", driverEmail);
    authFetch(`${API_BASE_URL}/request-quick-drop`, { method: "POST", body: JSON.stringify({ driverEmail, pickup, drop }) })
        .then(res => res.json())
        .then(data => {
            if (data.requestId) localStorage.setItem("passengerActiveRide", data.requestId);
            showNotification(`Request transmitted to ${driverName}. Awaiting link confirmation...`, 'info');
            showPage('passenger-mission-status');
            listenForQuickDropAccepted();
        })
        .catch(() => showNotification('Failed to transmit. Check your connection.', 'error'));
}

// ── Driver: Quick Drop controls ───────────────────────────
function startQuickRequestScanner() {
    const container = document.getElementById("request-container");
    if (container) container.innerHTML = `<p style="color:#4e69e2;font-size:14px;"><span class="loading-spinner"></span> Initializing radar...</p>`;
    listenForQuickRequests();
    setTimeout(() => {
        if (container && container.querySelector(".loading-spinner"))
            container.innerHTML = `<p style="color:#888;font-size:14px;">Scanning for nearby students...</p>`;
    }, 1500);
}

function acceptQuickDrop(requestId, buttonEl) {
    const fareInput = document.getElementById(`quick-fare-${requestId}`);
    const fare = fareInput ? parseFloat(fareInput.value) : 30;
    if (isNaN(fare) || fare < 0 || fare > 50) { showNotification("Fare must be between ₹0 and ₹50", "error"); return; }
    if (buttonEl) { buttonEl.disabled = true; buttonEl.innerText = "Accepting..."; buttonEl.style.opacity = "0.7"; }

    authFetch(`${API_BASE_URL}/accept-quick-drop`, { method: "POST", body: JSON.stringify({ requestId, fare }) })
        .then(res => res.json())
        .then(() => {
            setIsMissionActive(true);
            localStorage.setItem("isMissionActive", "true");
            showNotification('Request Accepted! Proceed to the pickup coordinates.', 'success');
            const card = document.getElementById(`quick-req-${requestId}`);
            if (card) {
                card.style.borderLeftColor = '#2ecc71';
                card.innerHTML = `
                    <div style="font-weight:bold;color:#222;font-size:16px;margin-bottom:8px;">✅ Active Drop</div>
                    <div style="font-size:13px;color:#555;margin-bottom:12px;">Head to the pickup location. Passenger notified.</div>
                    <button class="btn-primary" style="background:#f39c12;width:100%;padding:10px;" onclick="window.arriveQuickDrop('${requestId}',this)">📍 Arrive</button>`;
            }
        })
        .catch(() => {
            showNotification('Failed to accept request.', 'error');
            if (buttonEl) { buttonEl.disabled = false; buttonEl.innerText = "✓ Accept"; buttonEl.style.opacity = "1"; }
        });
}

function arriveQuickDrop(requestId, buttonEl) {
    if (buttonEl) { buttonEl.disabled = true; buttonEl.innerText = "Arriving..."; }
    authFetch(`${API_BASE_URL}/arrive-quick-drop`, { method: "POST", body: JSON.stringify({ requestId }) })
        .then(() => {
            showNotification('Passenger alerted of your arrival.', 'success');
            const card = document.getElementById(`quick-req-${requestId}`);
            if (card) card.innerHTML = `
                <div style="font-weight:bold;color:#222;font-size:16px;margin-bottom:8px;">✔ Active Drop</div>
                <div style="font-size:13px;color:#2ecc71;margin-bottom:12px;font-weight:bold;">Driver has Arrived. Waiting for start.</div>
                <button class="btn-primary" style="background:#4e69e2;width:100%;padding:10px;" onclick="window.startQuickDrop('${requestId}',this)">► Start Drop</button>`;
        }).catch(() => { if (buttonEl) { buttonEl.disabled = false; buttonEl.innerText = "📍 Arrive"; } showNotification("Failed to arrive", "error"); });
}

function startQuickDrop(requestId, buttonEl) {
    if (buttonEl) { buttonEl.disabled = true; buttonEl.innerText = "Starting..."; }
    authFetch(`${API_BASE_URL}/start-quick-drop`, { method: "POST", body: JSON.stringify({ requestId }) })
        .then(() => {
            showNotification('Drop Started!', 'success');
            if (buttonEl) { buttonEl.disabled = false; buttonEl.innerText = "💰 Settle Payments"; buttonEl.style.background = "#f39c12"; buttonEl.setAttribute("onclick", `window.requestQuickPayment('${requestId}',this)`); }
        })
        .catch(() => { showNotification("Failed to start drop", "error"); if (buttonEl) buttonEl.disabled = false; });
}

function requestQuickPayment(requestId, buttonEl) {
    if (buttonEl) { buttonEl.disabled = true; buttonEl.innerText = "Requesting..."; }
    authFetch(`${API_BASE_URL}/request-quick-payment`, { method: "POST", body: JSON.stringify({ requestId }) })
        .then(() => {
            showNotification('Payment requested from passenger.', 'info');
            if (buttonEl) { buttonEl.disabled = false; buttonEl.innerText = "🏁 Close Mission"; buttonEl.style.background = "#2ecc71"; buttonEl.setAttribute("onclick", `window.completeQuickDrop('${requestId}',this)`); }
        })
        .catch(() => { showNotification("Failed to request payments", "error"); if (buttonEl) buttonEl.disabled = false; });
}

function completeQuickDrop(requestId, buttonEl) {
    if (buttonEl) { buttonEl.disabled = true; buttonEl.innerText = "Closing..."; buttonEl.style.opacity = "0.7"; }
    authFetch(`${API_BASE_URL}/complete-quick-drop`, { method: "POST", body: JSON.stringify({ requestId }) })
        .then(res => res.json())
        .then(() => {
            setIsMissionActive(false);
            localStorage.removeItem("isMissionActive");
            showNotification('Drop closed and settled.', 'success');
            const card = document.getElementById(`quick-req-${requestId}`);
            if (card) { card.innerHTML = `<div style="text-align:center;color:#2ecc71;font-weight:bold;padding:10px;">✓ Drop Settled & Completed</div>`; setTimeout(() => card.remove(), 3000); }
        })
        .catch(() => { showNotification('Failed to complete drop.', 'error'); if (buttonEl) { buttonEl.disabled = false; buttonEl.innerText = "🏁 Close Mission"; buttonEl.style.opacity = "1"; } });
}

function rejectQuickDrop(requestId, buttonEl) {
    if (buttonEl) { buttonEl.disabled = true; buttonEl.innerText = "Declining..."; buttonEl.style.opacity = "0.7"; }
    authFetch(`${API_BASE_URL}/reject-quick-drop`, { method: "POST", body: JSON.stringify({ requestId }) })
        .then(res => res.json())
        .then(() => { showNotification('Request declined.', 'info'); const card = document.getElementById(`quick-req-${requestId}`); if (card) card.remove(); })
        .catch(() => { showNotification('Failed to decline request.', 'error'); if (buttonEl) { buttonEl.disabled = false; buttonEl.innerText = "✕ Decline"; buttonEl.style.opacity = "1"; } });
}

// ── Shift toggle ──────────────────────────────────────────
async function toggleShift() {
    const targetStatus = !getIsOnline();
    const originalText = getIsOnline() ? "End Shift" : "Go Online";
    toggleButtonLoading("toggle-shift-btn", true, originalText);
    try {
        const response = await authFetch(`${API_BASE_URL}/toggle-online`, { method: "POST", body: JSON.stringify({ status: targetStatus }) });
        if (response.ok) {
            setIsOnline(targetStatus);
            localStorage.setItem("isOnline", targetStatus.toString());
            syncDriverUI();
            if (targetStatus) {
                startQuickRequestScanner();
            } else {
                stopListeningForQuickRequests();
                const container = document.getElementById("request-container");
                if (container) container.innerHTML = `<p>Go online to see requests.</p>`;
            }
        }
    } catch { showNotification('Connection Interrupted: Could not reach Command Center.', 'error'); }
    finally { toggleButtonLoading("toggle-shift-btn", false, getIsOnline() ? "End Shift" : "Go Online"); }
}

// ── Driver registration ───────────────────────────────────
async function submitDriverRegistration() {
    const license = document.getElementById("reg-license").value.trim();
    const vehicleModel = document.getElementById("reg-vehicle-model").value.trim();
    const vehicleNumber = document.getElementById("reg-vehicle-num").value.trim();
    const agreed = document.getElementById("reg-terms").checked;
    const upiId = document.getElementById("reg-upi-id").value.trim();
    const qrFileInput = document.getElementById("reg-qr-photo");
    if (!license || !vehicleModel || !vehicleNumber || !agreed) { showNotification('Please fill all mandatory fields and agree to the terms.', 'warning'); return; }
    let qrPhoto = null;
    if (qrFileInput && qrFileInput.files && qrFileInput.files[0]) {
        try {
            qrPhoto = await new Promise((resolve, reject) => {
                const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = e => reject(e); reader.readAsDataURL(qrFileInput.files[0]);
            });
        } catch { showNotification('Error extracting your QR photo.', 'error'); return; }
    }
    if (qrPhoto && qrPhoto.length > 800000) { showNotification('QR photo is too large. Please use an image under 600 KB.', 'error'); return; }
    authFetch(`${API_BASE_URL}/update-driver-status`, { method: "POST", body: JSON.stringify({ license, vehicleModel, vehicleNumber, agreed, upiId, qrPhoto }) })
        .then(async res => { const data = await res.json(); if (!res.ok) throw new Error(data.message || `Server error (${res.status})`); return data; })
        .then(() => {
            const userData = JSON.parse(localStorage.getItem("user"));
            userData.isCampusDriver = true; localStorage.setItem("user", JSON.stringify(userData));
            showNotification('Account Verified Successfully!', 'success'); enterDriver();
        })
        .catch(err => showNotification(err.message || 'Registration failed. Please try again later.', 'error'));
}

// ── Profile ───────────────────────────────────────────────
async function updateGenderInDB(newGender) {
    const userData = JSON.parse(localStorage.getItem("user"));
    if (!userData) return;
    const statusLabel = document.createElement("span");
    statusLabel.innerText = " Saving..."; statusLabel.style.cssText = "font-size:12px;color:#4e69e2;";
    document.getElementById("edit-gender").after(statusLabel);
    try {
        const response = await authFetch(`${API_BASE_URL}/update-profile`, { method: "POST", body: JSON.stringify({ gender: newGender }) });
        if (response.ok) {
            userData.gender = newGender; localStorage.setItem("user", JSON.stringify(userData));
            const sideGender = document.getElementById("side-gender-display");
            if (sideGender) sideGender.innerText = "Gender: " + newGender;
            statusLabel.innerText = " ✅ Saved";
        } else { statusLabel.innerText = " ❌ Failed"; }
    } catch { statusLabel.innerText = " ❌ Error"; }
    setTimeout(() => statusLabel.remove(), 2000);
}

// ── Navigation mode selection ─────────────────────────────
let currentMainMode = '';
function enterPassenger() {
    if (localStorage.getItem("passengerActiveRide")) {
        showNotification('You are already in an active trajectory!', 'warning');
        showPage('passenger-mission-status'); return;
    }
    currentMainMode = 'passenger';
    showBranchSelection("Choose your Destination Scope");
}

function enterDriver() {
    const userData = JSON.parse(localStorage.getItem("user"));
    if (!userData) { window.location.replace('login.html'); return; }
    if (userData.isCampusDriver === true) {
        currentMainMode = 'driver';
        showBranchSelection("Set your Driving Scope");
    } else { showPage('driver-reg'); }
}

function showBranchSelection(title) {
    document.getElementById("branch-title").innerText = title;
    document.getElementById("branch-selection-overlay").classList.remove("hidden");
}

function hideBranchSelection() {
    document.getElementById("branch-selection-overlay").classList.add("hidden");
}

function selectSubMode(subMode) {
    hideBranchSelection();
    if (subMode === 'campus') {
        showPage(currentMainMode === 'driver' ? 'driver' : 'passenger');
    } else {
        if (currentMainMode === 'driver') {
            setChosenFromPlace(null); setChosenDestinationPlace(null);
            const rsFrom = document.getElementById("rs-from"); const rsDest = document.getElementById("rs-destination");
            if (rsFrom) rsFrom.value = ""; if (rsDest) rsDest.value = "";
            const mapDiv = document.getElementById("rs-map-container");
            if (mapDiv) {
                mapDiv.classList.add("hidden");
                if (mapInstances["rs-map-container"]) { mapInstances["rs-map-container"].map.remove(); delete mapInstances["rs-map-container"]; }
            }
            const etaWrap = document.getElementById("rs-eta-wrap"); if (etaWrap) etaWrap.classList.add("hidden");
        }
        showPage(currentMainMode === 'driver' ? 'driver-route-share' : 'passenger-route-search');
    }
}

// ── Logout ────────────────────────────────────────────────
function logout() {
    if (getIsOnline() || getIsMissionActive()) { showNotification('You cannot logout while a shift or mission is active.', 'warning'); return; }
    document.getElementById("logout-modal").classList.remove("hidden");
}

function closeLogoutModal() { document.getElementById("logout-modal").classList.add("hidden"); }

function confirmLogout() {
    socket.disconnect();
    localStorage.clear();
    const menu = document.getElementById("side-menu"); const overlay = document.getElementById("sidebar-overlay");
    if (menu) menu.classList.remove("active"); if (overlay) overlay.classList.add("hidden");
    document.querySelectorAll('input').forEach(input => input.value = "");
    window.location.replace('login.html');
}

function exitDriverMode() {
    if (getIsOnline()) { showNotification("Active Shift! You must click 'End Shift' before leaving this tab.", 'warning'); return; }
    showPage('home');
}

// ── Ghost Protocol ────────────────────────────────────────
window.addEventListener("beforeunload", function () {
    const missionActive = localStorage.getItem("isMissionActive") === "true";
    const currentlyOnline = localStorage.getItem("isOnline") === "true";
    const token = localStorage.getItem("token");
    if (token && (missionActive || currentlyOnline)) {
        const blob = new Blob([JSON.stringify({})], { type: 'application/json' });
        navigator.sendBeacon(`${API_BASE_URL}/emergency-cleanup?token=${token}`, blob);
    }
});

// ── Expose all functions as window globals ─────────────────
// (so inline onclick attributes in index.html still work)
Object.assign(window, {
    showPage, toggleSidebar, logout, closeLogoutModal, confirmLogout,
    togglePassword, handleEnter, checkPasswordStrength, saveSettings,
    // Driver mission
    publishRoute, cancelTrajectory, handleMissionAction,
    startJourneyPhase, requestPaymentsPhase, closeMissionPhase,
    acceptPassenger, rejectPassenger, arrivePassenger,
    // Quick Drop driver
    startQuickRequestScanner, acceptQuickDrop, rejectQuickDrop,
    arriveQuickDrop, startQuickDrop, requestQuickPayment, completeQuickDrop,
    toggleShift, submitDriverRegistration, exitDriverMode,
    // Passenger
    searchActiveRoutes, requestJoinRide, endPassengerJourney, confirmPaymentSent,
    searchCampusDrivers, initiateQuickRide,
    enterPassenger, enterDriver, selectSubMode, hideBranchSelection,
    updateGenderInDB,
    // Forgot password
    openForgotModal, closeForgotModal, fpSendOtp, fpVerifyOtp, fpResetPassword,
    // Confirm dialog
    confirmReject
});
