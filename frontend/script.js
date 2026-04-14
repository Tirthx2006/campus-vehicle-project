// ─────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────
const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const API_BASE_URL = isLocal
    ? "http://localhost:5000"
    : "https://campus-vehicle-project.onrender.com";

// Campus centre coordinates (Ganpat University)
const CAMPUS_COORDS = { lat: 23.5354, lng: 72.4573 };

// ─────────────────────────────────────────────────────────
// OPEN SOURCE MAPS (Leaflet + OSRM + Nominatim)
// ─────────────────────────────────────────────────────────
let mapsReady = false;
const mapInstances = {};
let chosenDestinationPlace = null;
let chosenFromPlace = null;    // Driver's typed starting point (route-share form)
let liveCarMarker = null;

document.addEventListener("DOMContentLoaded", initMaps);

function initMaps() {
    mapsReady = true;

    // ── Driver: starting-point autocomplete (route-share publish form)
    attachAutocomplete("rs-from", (place) => {
        chosenFromPlace = place;
        // If destination is already chosen, refresh the preview map with the real origin
        if (chosenDestinationPlace) showDestinationPreview(chosenDestinationPlace);
    });

    // ── Driver: destination autocomplete (route-share publish form)
    attachAutocomplete("rs-destination", (place) => {
        chosenDestinationPlace = place;
        showDestinationPreview(place);
    });

    // ── Passenger: destination search autocomplete
    // When the user types manually, clear any stale map-pin coords so the
    // backend receives a text-only query (no accidental coordinate override).
    attachAutocomplete("ps-search-destination", (place) => {
        selectionPinLat = null;
        selectionPinLng = null;
        searchActiveRoutes();
    });

    // ── Passenger: interactive selection map (initialized when page is shown)
    initSelectionMap();
}

// ─────────────────────────────────────────────────────────
// INTERACTIVE DESTINATION SELECTION MAP (Passenger Route Search)
// ─────────────────────────────────────────────────────────
let selectionMap = null;
let selectionMarker = null;
let selectionPinLat = null;  // lat of the last tapped pin
let selectionPinLng = null;  // lng of the last tapped pin

function initSelectionMap() {
    const mapDiv = document.getElementById("ps-selection-map");
    if (!mapDiv || selectionMap) return;

    // Default view — will be overridden by GPS below
    selectionMap = L.map(mapDiv, { zoomControl: true }).setView([CAMPUS_COORDS.lat, CAMPUS_COORDS.lng], 9);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(selectionMap);

    // Try to centre on the passenger's real location
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            pos => {
                if (selectionMap) {
                    selectionMap.setView([pos.coords.latitude, pos.coords.longitude], 12);
                }
            },
            () => { /* silently stay at default view */ },
            { enableHighAccuracy: false, maximumAge: 30000, timeout: 6000 }
        );
    }

    // Click anywhere on the map to place/move the pin
    selectionMap.on('click', async (e) => {
        const { lat, lng } = e.latlng;
        selectionPinLat = lat;
        selectionPinLng = lng;
        _placeSelectionPin(lat, lng);

        // Reverse geocode via Nominatim to fill the text box
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`);
            const data = await res.json();
            if (data && data.display_name) {
                const shortName = data.display_name.split(',')[0];
                const input = document.getElementById("ps-search-destination");
                if (input) {
                    input.value = shortName;
                    // Trigger search WITH coordinates for proximity matching
                    searchActiveRoutes(lat, lng);
                }
            }
        } catch (err) {
            console.error("Reverse geocode error", err);
        }
    });

    // Fix map tile rendering after it may have been hidden
    setTimeout(() => selectionMap && selectionMap.invalidateSize(), 300);
}

function _placeSelectionPin(lat, lng) {
    if (!selectionMap) return;
    const latLng = [lat, lng];
    if (selectionMarker) {
        selectionMarker.setLatLng(latLng);
    } else {
        const pinIcon = L.icon({
            iconUrl: 'https://cdn-icons-png.flaticon.com/512/684/684908.png',
            iconSize: [32, 32],
            iconAnchor: [16, 32]
        });
        selectionMarker = L.marker(latLng, { icon: pinIcon, draggable: true }).addTo(selectionMap);

        // Also support drag-end for reverse geocoding
        selectionMarker.on('dragend', async (e) => {
            const pos = e.target.getLatLng();
            selectionPinLat = pos.lat;
            selectionPinLng = pos.lng;
            try {
                const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${pos.lat}&lon=${pos.lng}&format=json`);
                const data = await res.json();
                if (data && data.display_name) {
                    const shortName = data.display_name.split(',')[0];
                    const input = document.getElementById("ps-search-destination");
                    if (input) {
                        input.value = shortName;
                        searchActiveRoutes(pos.lat, pos.lng);
                    }
                }
            } catch (err) {
                console.error("Reverse geocode drag error", err);
            }
        });
    }
    selectionMap.setView(latLng, Math.max(selectionMap.getZoom(), 12));
}

let autocompleteTimer = null;
function attachAutocomplete(inputId, onPlace) {
    const input = document.getElementById(inputId);
    if (!input) return;

    const dropdown = document.createElement("div");
    dropdown.className = "autocomplete-dropdown hidden";
    input.parentNode.appendChild(dropdown);

    input.addEventListener("input", (e) => {
        clearTimeout(autocompleteTimer);
        const val = e.target.value.trim();
        if (val.length < 3) {
            dropdown.classList.add("hidden");
            return;
        }

        autocompleteTimer = setTimeout(async () => {
            try {
                const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(val)}&countrycodes=IN&format=json&limit=5`);
                const results = await res.json();

                dropdown.innerHTML = "";
                if (results.length === 0) {
                    dropdown.classList.add("hidden");
                    return;
                }

                results.forEach(itemData => {
                    const item = document.createElement("div");
                    item.className = "autocomplete-item";
                    item.innerText = itemData.display_name;
                    item.onclick = () => {
                        // We format the text to the primary location name to keep UI clean
                        const shortName = itemData.display_name.split(',')[0];
                        input.value = shortName;
                        dropdown.classList.add("hidden");

                        onPlace({
                            geometry: { location: { lat: parseFloat(itemData.lat), lng: parseFloat(itemData.lon) } },
                            formatted_address: itemData.display_name,
                            name: shortName
                        });
                    };
                    dropdown.appendChild(item);
                });
                dropdown.classList.remove("hidden");
            } catch (err) {
                console.error("Autocomplete fetch error", err);
            }
        }, 500);
    });

    document.addEventListener("click", (e) => {
        if (e.target !== input && !dropdown.contains(e.target)) {
            dropdown.classList.add("hidden");
        }
    });
}

// Show a mini map + ETA on the Route Share form
async function showDestinationPreview(place) {
    const mapDiv = document.getElementById("rs-map-container");
    const etaWrap = document.getElementById("rs-eta-wrap");
    const etaText = document.getElementById("rs-eta-text");
    if (!mapDiv) return;

    mapDiv.classList.remove("hidden");

    if (mapInstances["rs-map-container"]) {
        mapInstances["rs-map-container"].map.remove();
    }

    const destLat = place.geometry.location.lat;
    const destLng = place.geometry.location.lng;
    const destCoords = [destLat, destLng];

    // ── Resolve the starting point ──
    // Priority: autocomplete selection → typed text geocoded → CAMPUS_COORDS fallback
    let originLat = CAMPUS_COORDS.lat;
    let originLng = CAMPUS_COORDS.lng;

    if (chosenFromPlace && chosenFromPlace.geometry && chosenFromPlace.geometry.location) {
        // Driver selected from autocomplete dropdown
        originLat = chosenFromPlace.geometry.location.lat;
        originLng = chosenFromPlace.geometry.location.lng;
    } else {
        // Attempt to geocode whatever is typed in rs-from
        const fromText = (document.getElementById("rs-from")?.value || "").trim();
        if (fromText.length > 2) {
            try {
                const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(fromText)}&countrycodes=IN&format=json&limit=1`);
                const results = await res.json();
                if (results.length > 0) {
                    originLat = parseFloat(results[0].lat);
                    originLng = parseFloat(results[0].lon);
                    // Cache it so we don't re-geocode
                    chosenFromPlace = {
                        geometry: { location: { lat: originLat, lng: originLng } },
                        formatted_address: results[0].display_name,
                        name: fromText
                    };
                }
            } catch (err) {
                console.warn("rs-from geocode error", err);
            }
        }
    }

    const originCoords = [originLat, originLng];

    // Initialize Leaflet Map centred between origin and destination
    const midLat = (originLat + destLat) / 2;
    const midLng = (originLng + destLng) / 2;
    const map = L.map(mapDiv, { zoomControl: false, dragging: false, scrollWheelZoom: false }).setView([midLat, midLng], 9);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    // Starting-point marker (green) + destination marker (red)
    L.circleMarker(originCoords, { radius: 8, color: '#2ecc71', fillColor: '#2ecc71', fillOpacity: 1, weight: 2 })
        .bindTooltip('Start', { permanent: false }).addTo(map);
    L.circleMarker(destCoords,   { radius: 8, color: '#f44336', fillColor: '#f44336', fillOpacity: 1, weight: 2 })
        .bindTooltip('Destination', { permanent: false }).addTo(map);

    mapInstances["rs-map-container"] = { map };

    // Fetch OSRM Route between the ACTUAL origin and destination
    try {
        const routeData = await fetchRouteOSRM([originLng, originLat], [destLng, destLat]);
        if (routeData) {
            L.geoJSON(routeData.geometry, { style: { color: '#4e69e2', weight: 4 } }).addTo(map);
            map.fitBounds(L.geoJSON(routeData.geometry).getBounds(), { padding: [20, 20] });

            if (etaWrap && etaText) {
                etaText.innerText = `${routeData.durationText} drive · ${routeData.distanceText}`;
                etaWrap.classList.remove("hidden");
            }
        }
    } catch (err) {
        console.error("OSRM Route Error", err);
    }
}

// Draw a route map in any container div.
async function drawRouteMap(containerId, origin, destination, onEta) {
    const mapDiv = document.getElementById(containerId);
    if (!mapDiv) return;

    mapDiv.classList.remove("hidden");

    // Destroy previous instance
    if (mapInstances[containerId]) {
        mapInstances[containerId].map.remove();
    }

    const map = L.map(mapDiv, { zoomControl: false }).setView([origin.lat, origin.lng], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    mapInstances[containerId] = { map };

    // Draw origin marker immediately so user sees something
    L.circleMarker([origin.lat, origin.lng], { radius: 6, color: '#2ecc71', fillOpacity: 1 }).addTo(map);

    // Parse destination coordinates (could be string or obj)
    let destLng, destLat;
    if (typeof destination === 'string') {
        // Fallback geocode since backend stores destination as string right now
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(destination)}&countrycodes=IN&format=json&limit=5`);
            const results = await res.json();
            if (results.length > 0) {
                // Use the first result, prefer results with more specific info
                const best = results[0];
                destLat = parseFloat(best.lat);
                destLng = parseFloat(best.lon);
            } else {
                // Geocoding failed - show map centered on origin at least
                map.setView([origin.lat, origin.lng], 11);
                console.warn("Could not geocode destination:", destination);
                return;
            }
        } catch (e) {
            map.setView([origin.lat, origin.lng], 11);
            console.error("Geocoding error", e);
            return;
        }
    } else {
        destLat = destination.lat;
        destLng = destination.lng;
    }

    // Draw destination marker
    const destMarker = L.circleMarker([destLat, destLng], { radius: 6, color: '#f44336', fillOpacity: 1 }).addTo(map);

    try {
        const routeData = await fetchRouteOSRM([origin.lng, origin.lat], [destLng, destLat]);
        if (routeData) {
            L.geoJSON(routeData.geometry, { style: { color: '#4e69e2', weight: 5, opacity: 0.8 } }).addTo(map);
            map.fitBounds(L.geoJSON(routeData.geometry).getBounds(), { padding: [30, 30] });

            if (onEta) {
                onEta(routeData.durationText, routeData.distanceText);
            }
        } else {
            // No route found - center map between origin and destination
            const midLat = (origin.lat + destLat) / 2;
            const midLng = (origin.lng + destLng) / 2;
            map.setView([midLat, midLng], 10);
            console.warn("No route found between origin and destination");
        }
    } catch (err) {
        // Show the markers even if route fetch fails
        const midLat = (origin.lat + destLat) / 2;
        const midLng = (origin.lng + destLng) / 2;
        map.setView([midLat, midLng], 10);
        console.error("drawRouteMap OSRM error", err);
    }
}

// Helper to fetch route from OSRM
async function fetchRouteOSRM(startLngLat, endLngLat) {
    const url = `https://router.project-osrm.org/route/v1/driving/${startLngLat[0]},${startLngLat[1]};${endLngLat[0]},${endLngLat[1]}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.routes && json.routes.length > 0) {
        const r = json.routes[0];
        const distKm = (r.distance / 1000).toFixed(1);
        const mins = Math.ceil(r.duration / 60);
        return {
            geometry: r.geometry,
            distanceText: `${distKm} km`,
            durationText: `${mins} mins`
        };
    }
    return null;
}

// ─────────────────────────────────────────────────────────
// NOTIFICATION SYSTEM
// Replaces all browser alert() / confirm() calls.
// ─────────────────────────────────────────────────────────
const TOAST_ICONS = { success: '✅', error: '🚫', info: 'ℹ️', warning: '⚠️' };

function showNotification(msg, type = 'info', duration = 4000) {
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

// Promise-based replacement for confirm().
// Usage: showConfirm({ title, message, icon, okLabel, okColor }).then(ok => { if(ok) ... })
let _confirmResolve = null;
function showConfirm({ title = 'Are you sure?', message = '', icon = '❓', okLabel = 'Confirm', okColor = '#f44336' } = {}) {
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
function _confirmReject() { _closeConfirm(false); }

// ─────────────────────────────────────────────────────────
// SOCKET.IO
// ─────────────────────────────────────────────────────────
const socket = io(API_BASE_URL, {
    auth: {
        token: localStorage.getItem("token")
    }
});

socket.on("connect", () => {
    console.log("Socket connected:", socket.id);
    const userData = JSON.parse(localStorage.getItem("user"));
    if (userData) socket.emit("join", userData.email);
});

socket.on("disconnect", () => console.log("Socket disconnected"));

// ─────────────────────────────────────────────────────────
// JWT HELPER
// ─────────────────────────────────────────────────────────
function authFetch(url, options = {}) {
    const token = localStorage.getItem("token");
    return fetch(url, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { "Authorization": `Bearer ${token}` } : {}),
            ...(options.headers || {})
        }
    });
}

// ─────────────────────────────────────────────────────────
// PAGE ELEMENTS
// ─────────────────────────────────────────────────────────
const signup = document.getElementById('signup-page');
const login = document.getElementById('login-page');
const home = document.getElementById('home-page');

// ─────────────────────────────────────────────────────────
// APP STATE
// ─────────────────────────────────────────────────────────
let isOnline = false;
let isMissionActive = false;

// Helper: read a setting from localStorage (with a safe default)
function getSetting(key, defaultVal = true) {
    try {
        const s = JSON.parse(localStorage.getItem('appSettings') || '{}');
        return (key in s) ? s[key] : defaultVal;
    } catch { return defaultVal; }
}

// ─────────────────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────────────────
window.onload = function () {
    const savedUser = localStorage.getItem("user");
    isOnline = localStorage.getItem("isOnline") === "true";
    isMissionActive = localStorage.getItem("isMissionActive") === "true";

    loadSettings(); // Restore saved toggle/select preferences

    if (savedUser) {
        goToHome();
        syncDriverUI();

        if (isMissionActive) {
            const userData = JSON.parse(savedUser);
            showPage('driver-command-center');
            socket.emit("join", userData.email);
            listenForPassengerRequests();

            // Restore full Command Center state from the server
            authFetch(`${API_BASE_URL}/get-active-mission`)
                .then(res => res.json())
                .then(mission => {
                    if (!mission.active) {
                        // Ride no longer exists on the server — unlock the UI
                        isMissionActive = false;
                        localStorage.removeItem("isMissionActive");
                        localStorage.removeItem("activeMissionDestination");
                        showNotification('Your previous mission has ended.', 'info');
                        showPage('home');
                        return;
                    }
                    // Hydrate the Command Center with real data
                    document.getElementById("cc-destination").innerText = mission.destination;
                    document.getElementById("cc-seats").innerText = `${mission.bookedSeats}/${mission.totalSeats}`;
                    document.getElementById("cc-fare").innerText = `₹${parseFloat(mission.fare).toFixed(2)}`;
                    renderRequestList(mission.requests);

                    // Store coordinates in localStorage for map restoration
                    if (mission.destLat && mission.destLng) {
                        localStorage.setItem("activeMissionDestLat", mission.destLat);
                        localStorage.setItem("activeMissionDestLng", mission.destLng);
                    }

                    const actionBtn = document.getElementById("cmd-action-btn");
                    if (actionBtn) {
                        if (mission.status === "in_progress") {
                            actionBtn.innerHTML = "💰 Settle Payments";
                            actionBtn.style.background = "#f39c12"; // Orange
                        } else if (mission.status === "payment_pending") {
                            actionBtn.innerHTML = "🏁 Close Mission";
                            actionBtn.style.background = "#2ecc71"; // Green
                        } else {
                            actionBtn.innerHTML = "► Start Trajectory";
                            actionBtn.style.background = "#4e69e2"; // Blue
                        }
                    }

                    const dest = mission.destination;
                    localStorage.setItem("activeMissionDestination", dest);
                    
                    // Use coordinates if available, otherwise try localStorage fallback
                    const destCoords = (mission.destLat && mission.destLng) 
                        ? { lat: mission.destLat, lng: mission.destLng }
                        : localStorage.getItem("activeMissionDestLat")
                            ? { lat: parseFloat(localStorage.getItem("activeMissionDestLat")), lng: parseFloat(localStorage.getItem("activeMissionDestLng")) }
                            : dest;
                    
                    drawRouteMap("cc-map-container", CAMPUS_COORDS, destCoords, (dur, dist) => {
                        const etaWrap = document.getElementById("cc-eta-wrap");
                        const etaEl = document.getElementById("cc-eta");
                        if (etaWrap && etaEl) {
                            etaEl.innerText = dur;
                            etaWrap.classList.remove("hidden");
                        }
                    });
                })
                .catch(() => {
                    // Network failure — fall back to socket-based restore
                    document.getElementById("cc-destination").innerText = "Resumed Trajectory";
                    const savedDest = localStorage.getItem("activeMissionDestination");
                    if (savedDest) drawRouteMap("cc-map-container", CAMPUS_COORDS, savedDest, (dur) => {
                        const etaEl = document.getElementById("cc-eta");
                        const etaWrap = document.getElementById("cc-eta-wrap");
                        if (etaEl && etaWrap) { etaEl.innerText = dur; etaWrap.classList.remove("hidden"); }
                    });
                    socket.emit("request_current_rides", { driverEmail: userData.email });
                });
        }

        const activeRideId = localStorage.getItem("passengerActiveRide");
        if (activeRideId) {
            // Check current status immediately on refresh instead of waiting for a socket event
            authFetch(`${API_BASE_URL}/my-ride-status?rideId=${activeRideId}`)
                .then(res => res.json())
                .then(data => {
                    showPage('passenger-mission-status');
                    listenForRideStatusUpdates(activeRideId);

                    if (data.status === 'accepted' || data.status === 'arrived') {
                        // Already accepted or arrived — restore the full accepted UI
                        if (data.destLat && data.destLng) {
                            localStorage.setItem("passengerRideDestLat", data.destLat);
                            localStorage.setItem("passengerRideDestLng", data.destLng);
                        }
                        _applyRideAccepted(data.driverName, data.driverEmail, data.destination, data.vehicleModel, data.vehicleNumber);
                        
                        // If arrived, also show the arrived notification state
                        if (data.status === 'arrived') {
                            const text = document.getElementById("pickup-status-text");
                            if (text) text.innerText = "Driver has arrived! Please board the vehicle.";
                        }
                    } else if (data.status === 'pending') {
                        // Still waiting — just show the waiting orb (already default state)
                    } else {
                        // driver_ended / not_found / paid — clear and go home
                        showNotification('Your previous ride session has ended.', 'info');
                        forceClearPassengerState();
                    }
                })
                .catch(() => {
                    // Network problem — still register listeners and show waiting state
                    showPage('passenger-mission-status');
                    listenForRideStatusUpdates(activeRideId);
                });
        }
    } else {
        goToSignup();
    }
};

// ─────────────────────────────────────────────────────────
// SOCKET EVENT LISTENERS
// ─────────────────────────────────────────────────────────

function listenForPassengerRequests() {
    socket.off("new_request");
    socket.off("ride_requests_list");

    // new_request: a passenger just joined — immediately inject the card into the UI
    // AND request the authoritative list from the server as a backup sync.
    socket.on("new_request", (data) => {
        if (getSetting('notifRides', true)) {
            showNotification(`📬 New request from ${data.passengerName || 'a passenger'}!`, 'info', 4000);
        }

        // ── INSTANT INJECT: add pending card directly without waiting for DB round-trip ──
        const container = document.getElementById("cc-requests-container");
        if (container) {
            // Remove the "scanning" placeholder if present
            const placeholder = container.querySelector("p");
            if (placeholder) placeholder.remove();

            // Only inject if this passenger's card isn't already rendered
            const existingCard = container.querySelector(`[data-email="${data.passengerEmail}"]`);
            if (!existingCard) {
                const card = document.createElement("div");
                card.className = "glass-card";
                card.dataset.email = data.passengerEmail;
                card.style.cssText = "margin:12px 0;padding:16px;display:flex;justify-content:space-between;align-items:center;border-left:4px solid #f39c12;background:#fff;box-shadow:0 4px 12px rgba(0,0,0,0.04);border-radius:12px;animation:slideIn .3s ease;";
                card.innerHTML = `
                    <div style="text-align:left;flex:1;">
                        <div style="font-weight:800;color:#1a1a2e;font-size:15px;margin-bottom:4px;">${data.passengerName || 'Passenger'}</div>
                        ${data.pickupLocation ? `<div style="font-size:12px;color:#e74c3c;font-weight:bold;margin-bottom:4px;">📍 Pickup: ${data.pickupLocation}</div>` : ''}
                        <div style="font-size:12px;color:#f39c12;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px;">Status: PENDING</div>
                    </div>
                    <div style="display:flex;gap:10px;">
                        <button class="btn-primary" style="width:auto;padding:8px 16px;background:#2ecc71;font-size:13px;margin:0;border-radius:10px;box-shadow:0 4px 10px rgba(46,204,113,0.3);" onclick="acceptPassenger('${data.passengerEmail}')">✓ Link</button>
                        <button class="btn-primary" style="width:auto;padding:8px 16px;background:#f44336;font-size:13px;margin:0;border-radius:10px;box-shadow:0 4px 10px rgba(244,67,54,0.3);" onclick="rejectPassenger('${data.passengerEmail}')">✕ Reject</button>
                    </div>`;
                container.appendChild(card);
            }
        }

        // Also ask server to push the authoritative full list (handles any de-sync)
        const driverEmail = JSON.parse(localStorage.getItem('user')).email;
        socket.emit("request_current_rides", { driverEmail });
    });

    // ride_requests_list: server sends the full list (on reconnect / explicit request)
    socket.on("ride_requests_list", (requests) => {
        renderRequestList(requests);
    });

    socket.off("passenger_paid");
    socket.on("passenger_paid", (data) => {
        if (getSetting('notifRides', true)) {
            showNotification(`💰 Passenger ${data.passengerEmail || 'has'} confirmed payment!`, 'success', 6000);
        }
        // Ask server to push the up-to-date list back on this socket so the UI updates to green
        const driverEmail = JSON.parse(localStorage.getItem('user')).email;
        socket.emit("request_current_rides", { driverEmail });
    });
}

function stopListeningForPassengerRequests() {
    socket.off("new_request");
    socket.off("ride_requests_list");
}

// ─────────────────────────────────────────────────────────
// Shared helper: hydrate the passenger accepted UI.
// Called both from the live socket event AND from the boot
// state-restore path so there is no duplication.
// ─────────────────────────────────────────────────────────
function _applyRideAccepted(driverName, driverEmail, destination, vehicleModel, vehicleNumber) {
    // Persist driver identity so the payment modal can display it
    localStorage.setItem("passengerLastDriver", JSON.stringify({ name: driverName, email: driverEmail }));

    showPage('passenger-picking-up');

    // Reveal driver info card
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

    // Draw the route map
    setTimeout(() => {
        const storedLat = localStorage.getItem("passengerRideDestLat");
        const storedLng = localStorage.getItem("passengerRideDestLng");
        const fallbackText = destination || localStorage.getItem("passengerRideDestination");
        const mapDest = (storedLat && storedLng) ? { lat: parseFloat(storedLat), lng: parseFloat(storedLng) } : fallbackText;

        if (mapDest) {
            // For Route Share the origin is where the driver departs — use stored departure
            // coords if available. If not available, use destination as center so the map
            // shows the relevant area rather than snapping to campus incorrectly.
            const depLat = parseFloat(localStorage.getItem("passengerRideDepartureLat"));
            const depLng = parseFloat(localStorage.getItem("passengerRideDepartureLng"));
            const mapOrigin = (depLat && depLng) ? { lat: depLat, lng: depLng } : null;

            if (mapOrigin) {
                drawRouteMap("ps-map-container", mapOrigin, mapDest, (dur, dist) => {
                    const etaWrap = document.getElementById("ps-eta-wrap");
                    const etaText = document.getElementById("ps-eta-text");
                    if (etaWrap && etaText) {
                        etaText.innerText = `${dur} drive · ${dist}`;
                        etaWrap.classList.remove("hidden");
                    }
                });
            } else {
                // No departure known — show a destination-only preview map
                const mapDiv = document.getElementById("ps-map-container");
                if (mapDiv) {
                    mapDiv.classList.remove("hidden");
                    if (mapInstances["ps-map-container"]) mapInstances["ps-map-container"].map.remove();
                    const destCoords = (typeof mapDest === 'object')
                        ? [mapDest.lat, mapDest.lng]
                        : null;
                    if (destCoords) {
                        const map = L.map(mapDiv, { zoomControl: false }).setView(destCoords, 11);
                        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
                        L.circleMarker(destCoords, { radius: 7, color: '#f44336', fillOpacity: 1 }).addTo(map);
                        mapInstances["ps-map-container"] = { map };
                    }
                }
            }
        }
    }, 100);
}

function _hydratePaymentModal(data) {
    window.currentPaymentType = data.type;
    const modal = document.getElementById("payment-modal");
    const amt = document.getElementById("payment-amount");
    const qrWrap = document.getElementById("payment-qr-container");
    const qrImg = document.getElementById("payment-qr-img");
    const upiTxt = document.getElementById("payment-upi-string");
    const driverLabel = document.getElementById("payment-driver-label");

    if (modal && amt) {
        amt.innerText = `₹${data.fare}`;

        // Show driver name + payment method label
        if (driverLabel) {
            const savedUser = JSON.parse(localStorage.getItem("passengerLastDriver") || "{}");
            const driverName = savedUser.name || data.driverName || "Your Driver";
            if (data.upiId) {
                driverLabel.innerHTML = `Pay <strong>${driverName}</strong> &nbsp;·&nbsp; UPI: <span style="color:#4e69e2;font-weight:700;">${data.upiId}</span>`;
            } else {
                driverLabel.innerHTML = `Pay <strong>${driverName}</strong> via Cash or your UPI app`;
            }
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
                // Dynamically build QR for UPI ID
                const upiLink = `upi://pay?pa=${data.upiId}&am=${data.fare}&cu=INR`;
                qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(upiLink)}`;
                upiTxt.innerText = `UPI ID: ${data.upiId}`;
                qrWrap.classList.remove("hidden");
            }
        }

        modal.classList.remove("hidden");
    }
}

function listenForRideStatusUpdates(rideId) {
    socket.off("ride_accepted");
    socket.off("ride_cancelled");
    socket.off("ride_completed");
    socket.off("ride_rejected");

    socket.on("ride_accepted", (data) => {
        // Use destination from socket event, fallback to localStorage
        const destination = data.destination || localStorage.getItem("passengerRideDestination");
        
        // Store destination coordinates from socket event for future use
        if (data.destLat && data.destLng) {
            localStorage.setItem("passengerRideDestLat", data.destLat);
            localStorage.setItem("passengerRideDestLng", data.destLng);
        }
        
        _applyRideAccepted(data.driverName, data.driverEmail, destination, data.vehicleModel, data.vehicleNumber);
        if (getSetting('notifStatus', true)) showNotification(data.message, 'success', 6000);
    });

    socket.on("ride_rejected", (data) => {
        const orb = document.getElementById("ps-status-orb");
        const text = document.getElementById("ps-status-text");
        if (orb) orb.className = "pulse-orb pending";
        if (text) text.innerText = "Request Declined. Redirecting to search...";

        const agreeEl = document.getElementById("ps-agreement-text");
        if (agreeEl) agreeEl.innerText = "The driver declined your request. You can try a different driver.";

        if (getSetting('notifStatus', true)) {
            showNotification(data.message || 'Your request was declined. Try another driver.', 'warning', 5000);
        }
        // Clear the ride from localStorage and redirect back to search after a short pause
        localStorage.removeItem("passengerActiveRide");
        localStorage.removeItem("passengerRideDestination");
        stopListeningForRideStatusUpdates();
        setTimeout(() => showPage('passenger-route-search'), 3000);
    });

    socket.on("ride_cancelled", (data) => {
        if (getSetting('notifStatus', true)) showNotification(data.message + ' Returning to home.', 'error', 5000);
        forceClearPassengerState();
    });

    socket.on("ride_started", (data) => {
        showPage('passenger-ride-started');
        const text = document.getElementById("ride-status-text");
        if (text) text.innerText = "Enjoy the ride!";
        if (getSetting('notifStatus', true)) showNotification("Mission Started!", 'info', 4000);

        // Draw the map to final destination — origin = driver's last known location
        // or fall back to departure / campus coords. Do NOT block on liveCarMarker.
        setTimeout(() => {
            const storedLat = localStorage.getItem("passengerRideDestLat");
            const storedLng = localStorage.getItem("passengerRideDestLng");
            const mapDest = (storedLat && storedLng)
                ? { lat: parseFloat(storedLat), lng: parseFloat(storedLng) }
                : localStorage.getItem("passengerRideDestination");

            let origin = CAMPUS_COORDS;
            if (liveCarMarker) {
                const pos = liveCarMarker.getLatLng();
                origin = { lat: pos.lat, lng: pos.lng };
            } else {
                const depLat = parseFloat(localStorage.getItem("passengerRideDepartureLat"));
                const depLng = parseFloat(localStorage.getItem("passengerRideDepartureLng"));
                if (depLat && depLng) origin = { lat: depLat, lng: depLng };
            }

            if (mapDest) {
                drawRouteMap("ride-map-container", origin, mapDest);
            }
        }, 150);
    });

    socket.on("driver_arrived", (data) => {
        const text = document.getElementById("pickup-status-text");
        if (text) text.innerText = "Driver has arrived! Please board the vehicle.";
        if (getSetting('notifStatus', true)) showNotification(data.message || "Driver has arrived!", 'success', 6000);
    });

    socket.on("payment_requested", (data) => {
        showPage('passenger-payment');
        _hydratePaymentModal(data);
        showNotification("You have arrived! Please settle your fare.", 'warning', 6000);
    });

    socket.on("ride_completed", (data) => {
        if (getSetting('notifStatus', true)) showNotification(data.message, 'success', 5000);
        forceClearPassengerState();
    });

    socket.on("driver_location", (data) => {
        const latLng = [data.lat, data.lng];

        // Determine which map is currently active
        const pickingUpPage = document.getElementById("page-passenger-picking-up");
        const rideStartedPage = document.getElementById("page-passenger-ride-started");

        const isPickingUp = pickingUpPage && !pickingUpPage.classList.contains("hidden");
        const isRideStarted = rideStartedPage && !rideStartedPage.classList.contains("hidden");

        let activeMapKey = null;
        if (isPickingUp) activeMapKey = "ps-map-container";
        else if (isRideStarted) activeMapKey = "ride-map-container";

        if (!activeMapKey) return; // Neither page is visible — ignore

        const mapWrapper = mapInstances[activeMapKey];
        if (!mapWrapper || !mapWrapper.map) return;

        const map = mapWrapper.map;

        if (!liveCarMarker) {
            const carIcon = L.icon({
                iconUrl: 'https://cdn-icons-png.flaticon.com/512/744/744465.png',
                iconSize: [30, 30],
                iconAnchor: [15, 15]
            });
            liveCarMarker = L.marker(latLng, { icon: carIcon }).addTo(map);
            // First ping — pan without jarring zoom
            map.panTo(latLng);
        } else {
            // If the marker is on a different map instance (phase changed), re-add it
            try {
                if (!map.hasLayer(liveCarMarker)) {
                    liveCarMarker.addTo(map);
                }
            } catch (e) { /* ignore */ }
            liveCarMarker.setLatLng(latLng);
            map.panTo(latLng);
        }
    });
}

function stopListeningForRideStatusUpdates() {
    socket.off("ride_accepted");
    socket.off("ride_cancelled");
    socket.off("ride_completed");
    socket.off("ride_rejected");
    socket.off("ride_started");
    socket.off("payment_requested");
    socket.off("driver_location");
    if (liveCarMarker) {
        liveCarMarker.remove();
        liveCarMarker = null;
    }
}

function listenForQuickDropAccepted() {
    socket.off("quick_drop_accepted");
    socket.off("quick_drop_completed");
    socket.off("quick_drop_rejected");

    socket.on("quick_drop_accepted", (data) => {
        showPage('passenger-picking-up');
        const text = document.getElementById("pickup-status-text");
        if (text) text.innerText = "Pickup Confirmed! The driver is heading to you.";

        // Read the pickup/drop we saved before navigating to this page
        const pickup = localStorage.getItem("quickDropPickup") || "your pickup location";
        const drop = localStorage.getItem("quickDropDrop") || "your drop location";
        const driverName = data.driverName || localStorage.getItem("quickDropDriverName") || "Driver";

        // Populate and reveal the driver info card with the correct Quick Drop route.
        // This also OVERWRITES any stale Route Share destination left from a previous ride.
        const infoBox = document.getElementById("ps-driver-info");
        const nameEl = document.getElementById("ps-driver-name");
        const destEl = document.getElementById("ps-driver-dest");
        if (infoBox && nameEl) {
            nameEl.innerText = `🛺  Driver: ${driverName}`;
            if (destEl) {
                destEl.innerHTML =
                    `📍 From: <strong>${pickup}</strong><br>` +
                    `🏁 To: <strong>${drop}</strong><br>` +
                    `<span style="color:#2ecc71;font-weight:bold;display:inline-block;margin-top:6px;">` +
                    `Quick Drop — on campus</span>`;
            }
            infoBox.classList.remove("hidden");
        }

        const agreeEl = document.getElementById("pickup-agreement-text");
        if (agreeEl) agreeEl.innerText = `${driverName} accepted your request. Head to the pickup point!`;

        if (getSetting('notifStatus', true)) showNotification(data.message, 'success', 6000);
    });

    socket.on("quick_drop_arrived", (data) => {
        const text = document.getElementById("pickup-status-text");
        if (text) text.innerText = "Driver has arrived at the pickup location!";
        if (getSetting('notifStatus', true)) showNotification(data.message || "Driver has arrived!", 'success', 6000);
    });

    socket.on("quick_drop_started", (data) => {
        showPage('passenger-ride-started');
        const text = document.getElementById("ride-status-text");
        if (text) text.innerText = "Drop in progress... Enjoy the ride!";
        if (getSetting('notifStatus', true)) showNotification("Drop Started!", 'info', 4000);
    });

    socket.on("payment_requested", (data) => {
        showPage('passenger-payment');
        _hydratePaymentModal(data);
        showNotification("Driver has arrived! Please settle your fare.", 'warning', 6000);
    });

    socket.on("quick_drop_completed", (data) => {
        if (getSetting('notifStatus', true)) {
            showNotification(data.message || 'Drop completed! Thanks for riding.', 'success', 6000);
        }
        // Clean up and navigate home
        socket.off("quick_drop_accepted");
        socket.off("quick_drop_completed");
        socket.off("quick_drop_rejected");
        setTimeout(() => showPage('home'), 2500);
    });

    socket.on("quick_drop_rejected", (data) => {
        if (getSetting('notifStatus', true)) {
            showNotification(data.message || 'Request declined. Try another driver.', 'warning', 5000);
        }
        // Send passenger back to campus search after a short delay
        socket.off("quick_drop_accepted");
        socket.off("quick_drop_completed");
        socket.off("quick_drop_rejected");
        setTimeout(() => showPage('passenger'), 3000);
    });
}

function listenForQuickRequests() {
    socket.off("new_quick_request");
    socket.on("new_quick_request", (data) => {
        const container = document.getElementById("request-container");
        if (!container) return;

        const card = document.createElement("div");
        card.className = "glass-card";
        card.id = `quick-req-${data.requestId}`;
        card.style.cssText = "margin:10px 0;padding:15px;border-left:4px solid #f1c40f;text-align:left;";
        card.innerHTML = `
            <div style="font-weight:bold;color:#222;font-size:16px;">${data.passengerName}</div>
            <div style="font-size:13px;color:#555;margin:8px 0;">
                <strong>From:</strong> ${data.pickup}<br>
                <strong>To:</strong> ${data.drop}
            </div>
            <div style="display:flex;gap:10px;margin-top:10px;">
                <button class="btn-primary"
                        style="background:#2ecc71;flex:1;padding:10px;"
                        onclick="acceptQuickDrop('${data.requestId}', this)">
                    ✓ Accept
                </button>
                <button class="btn-primary"
                        style="background:#f44336;flex:1;padding:10px;"
                        onclick="rejectQuickDrop('${data.requestId}', this)">
                    ✕ Decline
                </button>
            </div>`;

        const placeholder = container.querySelector("p");
        if (placeholder) placeholder.remove();
        container.appendChild(card);
    });

    socket.off("passenger_paid");
    socket.on("passenger_paid", (data) => {
        if (data.type === "quick_drop" && data.requestId) {
            if (getSetting('notifRides', true)) {
                showNotification(`💰 Payment confirmed for drop!`, 'success', 6000);
            }
            const card = document.getElementById(`quick-req-${data.requestId}`);
            if (card) {
                // Find complete button and make it flash green
                const btn = card.querySelector("button[onclick^='completeQuickDrop']");
                if (btn) {
                    btn.style.boxShadow = "0 0 15px #2ecc71";
                    btn.innerText = "✓ Confirm & Close";
                }
            }
        }
    });
}

function stopListeningForQuickRequests() {
    socket.off("new_quick_request");
}

// ─────────────────────────────────────────────────────────
// UI HELPERS
// ─────────────────────────────────────────────────────────
function syncDriverUI() {
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

function showPage(pageName) {
    const userData = JSON.parse(localStorage.getItem("user"));

    if (isOnline && pageName !== 'driver' && !isMissionActive) {
        showNotification('You must go Offline before switching tabs.', 'warning');
        return;
    }

    if (isMissionActive && pageName !== 'driver-command-center' && pageName !== 'profile') {
        showNotification("Active Trajectory! You must 'Abort Mission' before switching tabs.", 'warning');
        return;
    }

    const pages = [
        "home", "about", "trips", "support", "settings", "passenger", "driver",
        "driver-reg", "profile", "driver-route-share", "driver-command-center",
        "passenger-route-search", "passenger-mission-status", "passenger-picking-up",
        "passenger-ride-started", "passenger-payment", "driver-picking-up",
        "driver-ride-started", "driver-payment"
    ];
    // NOTE: page-driver-reg IS in this list — it gets hidden on every showPage() call.

    pages.forEach(p => {
        const el = document.getElementById("page-" + p);
        if (el) el.classList.add("hidden");
    });

    const activePage = document.getElementById("page-" + pageName);
    if (activePage) activePage.classList.remove("hidden");

    document.querySelectorAll(".nav-links a").forEach(link => link.classList.remove("active"));
    const currentNav = document.getElementById("nav-" + pageName);
    if (currentNav) currentNav.classList.add("active");

    // Page-specific init
    if (pageName === 'profile' && userData) {
        document.getElementById("prof-name").innerText = userData.name;
        document.getElementById("prof-email").innerText = userData.email;
        const genSelect = document.getElementById("edit-gender");
        if (genSelect) genSelect.value = userData.gender || "Male";
    }

    if (pageName === 'trips') loadMyActivity();
    if (pageName === 'settings') loadSettings();

    // Invalidate selection map size when route search page becomes visible
    if (pageName === 'passenger-route-search') {
        setTimeout(() => {
            if (selectionMap) selectionMap.invalidateSize();
            else initSelectionMap();
        }, 250);
    }

    // When returning to home, respect the defaultMode setting
    if (pageName === 'home') {
        const mode = getSetting('defaultMode', 'passenger');
        const navTrips = document.getElementById('nav-trips');
        // Only auto-navigate if no active ride/mission is in progress
        if (!isOnline && !isMissionActive && !localStorage.getItem("passengerActiveRide")) {
            if (navTrips) navTrips.style.display = '';

            // Check if this is a fresh navigation (i.e. we actually just landed on home)
            // Timeout prevents recursion of showPage if we call enterDriver
            setTimeout(() => {
                if (mode === 'driver') enterDriver();
            }, 0);
        }
    }
}

function enterPassenger() {
    showPage('passenger');
}

function enterDriver() {
    showPage('driver');
}

function toggleButtonLoading(buttonId, isLoading, originalText) {
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

function renderRequestList(requests) {
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
        <div class="glass-card" data-email="${req.email}" style="margin:12px 0;padding:16px;display:flex;justify-content:space-between;align-items:center;border-left:4px solid ${borderColor}; background: ${bgColor}; box-shadow: 0 4px 12px rgba(0,0,0,0.04); border-radius:12px;">
            <div style="text-align:left;flex:1;">
                <div style="font-weight:800;color:#1a1a2e;font-size:15px;margin-bottom:4px;">${req.name}</div>
                ${req.pickupLocation ? `<div style="font-size:12px;color:#e74c3c;font-weight:bold;margin-bottom:4px;">📍 Pickup: ${req.pickupLocation}</div>` : ''}
                <div style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.5px;font-weight:${req.status === 'pending' ? 'bold' : 'normal'};">Status: <span style="color:${statusColor}">${req.status}</span></div>
            </div>
            ${req.status === 'pending'
            ? `<div style="display:flex;gap:10px;">
                     <button class="btn-primary" style="width:auto;padding:8px 16px;background:#2ecc71;font-size:13px;margin:0;border-radius:10px;box-shadow:0 4px 10px rgba(46,204,113,0.3);" onclick="acceptPassenger('${req.email}')">✓ Link</button>
                     <button class="btn-primary" style="width:auto;padding:8px 16px;background:#f44336;font-size:13px;margin:0;border-radius:10px;box-shadow:0 4px 10px rgba(244,67,54,0.3);" onclick="rejectPassenger('${req.email}')">✕ Reject</button>
                   </div>`
            : req.status === 'paid'
                ? '<span style="font-size:14px;color:#2ecc71;font-weight:800;background:#d5f5e3;padding:6px 12px;border-radius:8px;">✅ Settled</span>'
            : req.status === 'arrived'
                ? '<span style="font-size:14px;color:#f39c12;font-weight:800;background:#fff3cd;padding:6px 12px;border-radius:8px;">🚗 Arrived</span>'
                : `<div style="display:flex;gap:10px;align-items:center;">
                     <span style="font-size:14px;color:#4e69e2;font-weight:800;background:#eef1ff;padding:6px 12px;border-radius:8px;">✓ Linked</span>
                     <button class="btn-primary" style="width:auto;padding:6px 16px;background:#f39c12;font-size:12px;margin:0;border-radius:8px;" onclick="arrivePassenger('${req.email}', this)">📍 Arrive</button>
                   </div>`
        }
        </div>
    `}).join('');
}

// ─────────────────────────────────────────────────────────
// MY ACTIVITY (Trips page)
// Fetches the user's ride history from the backend.
// ─────────────────────────────────────────────────────────
async function loadMyActivity() {
    const listEl = document.getElementById("trips-list");
    const loadingEl = document.getElementById("trips-loading");
    const emptyEl = document.getElementById("trips-empty");

    if (!listEl) return;
    listEl.innerHTML = "";
    if (loadingEl) loadingEl.classList.remove("hidden");
    if (emptyEl) emptyEl.classList.add("hidden");

    try {
        const res = await authFetch(`${API_BASE_URL}/my-trips`);
        const data = await res.json();

        if (loadingEl) loadingEl.classList.add("hidden");

        if (!data || data.length === 0) {
            if (emptyEl) emptyEl.classList.remove("hidden");
            return;
        }

        listEl.innerHTML = data.map(trip => {
            const isDriver = trip.role === "driver";
            const date = new Date(trip.createdAt).toLocaleDateString("en-IN", {
                day: "numeric", month: "short", year: "numeric"
            });
            return `
            <div class="trip-card ${isDriver ? 'driver-trip' : ''}">
                <div class="tc-header">
                    <span class="tc-dest">→ ${trip.destination}</span>
                    <span class="tc-badge ${isDriver ? 'driver' : 'passenger'}">${isDriver ? 'Driver' : 'Passenger'}</span>
                </div>
                <div class="tc-meta">${date} · ₹${trip.fare} per seat · ${trip.time || 'Time not set'}</div>
            </div>`;
        }).join('');

    } catch (err) {
        if (loadingEl) loadingEl.classList.add("hidden");
        if (listEl) listEl.innerHTML = `<p style="color:#f44336;text-align:center;font-size:14px;">Could not load activity. Check your connection.</p>`;
    }
}

// ─────────────────────────────────────────────────────────
// SETTINGS — persist to localStorage
// ─────────────────────────────────────────────────────────
function saveSettings() {
    const s = {
        notifRides: document.getElementById("setting-notif-rides")?.checked,
        notifStatus: document.getElementById("setting-notif-status")?.checked,
        showFare: document.getElementById("setting-show-fare")?.checked,
        defaultMode: document.getElementById("setting-default-mode")?.value
    };
    localStorage.setItem("appSettings", JSON.stringify(s));
}

function loadSettings() {
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
    } catch (e) { /* corrupt storage — ignore */ }
}

// ─────────────────────────────────────────────────────────
// AUTH LOGIC
// ─────────────────────────────────────────────────────────
function checkPasswordStrength(pw) {
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
            if (isValid) {
                el.innerText = el.innerText.replace('❌', '✅');
                el.style.color = '#2ecc71';
            } else {
                el.innerText = el.innerText.replace('✅', '❌');
                el.style.color = '#f44336';
                allValid = false;
            }
        }
    }
    return allValid;
}

function signupUser() {
    const name = document.getElementById("signup-name").value.trim();
    const email = document.getElementById("signup-email").value.trim();
    const password = document.getElementById("signup-password").value.trim();
    const gender = document.getElementById("signup-gender").value;

    if (!name || !email || !password || !gender) {
        showNotification('Please fill all details.', 'warning');
        return;
    }

    if (!checkPasswordStrength(password)) {
        showNotification('Please meet all password requirements before signing up.', 'warning');
        return;
    }

    toggleButtonLoading("signup-btn", true, "Sign up");

    fetch(`${API_BASE_URL}/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, gender })
    })
        .then(res => res.status === 201 ? res.text() : Promise.reject())
        .then(msg => { showNotification('Registered successfully! Please log in.', 'success'); goToLogin(); })
        .catch(() => showNotification('Registration Failed: User might already exist.', 'error'))
        .finally(() => toggleButtonLoading("signup-btn", false, "Sign up"));
}

function loginUser() {
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value.trim();

    if (!email || !password) {
        showNotification('Missing credentials.', 'warning');
        return;
    }

    toggleButtonLoading("login-btn", true, "Log In");

    fetch(`${API_BASE_URL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
    })
        .then(res => res.json())
        .then(data => {
            if (data.message === "Login successful") {
                localStorage.setItem("token", data.token);
                const { token: _t, ...profile } = data;
                localStorage.setItem("user", JSON.stringify(profile));
                socket.emit("join", data.email);
                goToHome();
                showPage('home');
            } else {
                showNotification('Invalid credentials. Please try again.', 'error');
            }
        })
        .catch(() => showNotification('Server unreachable. Please try later.', 'error'))
        .finally(() => toggleButtonLoading("login-btn", false, "Log In"));
}

function goToLogin() {
    if (signup) signup.classList.add('hidden');
    if (login) login.classList.remove('hidden');
    if (home) home.classList.add('hidden');
    document.body.style.backgroundColor = "#4a5585";
}

function goToSignup() {
    if (login) login.classList.add('hidden');
    if (signup) signup.classList.remove('hidden');
    if (home) home.classList.add('hidden');
    document.body.style.backgroundColor = "#4a5585";
}

function goToHome() {
    if (login) login.classList.add('hidden');
    if (signup) signup.classList.add('hidden');
    if (home) home.classList.remove('hidden');
    document.body.style.backgroundColor = "#b8c1ec";

    const userData = JSON.parse(localStorage.getItem("user"));
    if (userData && userData.name) {
        document.getElementById("nav-user-name").innerText = userData.name.split(' ')[0];
    }
}

// ─────────────────────────────────────────────────────────
// DRIVER MISSION LOGIC
// ─────────────────────────────────────────────────────────
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

    let destLat = null, destLng = null;
    if (chosenDestinationPlace && chosenDestinationPlace.geometry && chosenDestinationPlace.geometry.location) {
        destLat = chosenDestinationPlace.geometry.location.lat;
        destLng = chosenDestinationPlace.geometry.location.lng;
    }

    // Store departure & destination so Command Center and passenger map can restore after refresh
    localStorage.setItem("activeMissionFrom", from || "Starting Point");
    localStorage.setItem("activeMissionDestination", destination);
    if (destLat && destLng) {
        localStorage.setItem("activeMissionDestLat", destLat);
        localStorage.setItem("activeMissionDestLng", destLng);
    }

    authFetch(`${API_BASE_URL}/publish-route`, {
        method: "POST",
        body: JSON.stringify({ from, destination, destLat, destLng, seats, time, fare })
    })
        .then(res => res.json())
        .then(() => {
            isMissionActive = true;
            localStorage.setItem("isMissionActive", "true");

            // Show full intercity route label in Command Center
            const routeLabel = from ? `${from} → ${destination}` : destination;
            document.getElementById("cc-destination").innerText = routeLabel;
            document.getElementById("cc-seats").innerText = `0/${seats}`;
            document.getElementById("cc-fare").innerText = `₹${fare}`;
            showPage('driver-command-center');
            listenForPassengerRequests();
            startGPSBroadcasting();

            // Draw live route map in Command Center using real GPS origin if available
            const finalizePublishMap = (originCoords) => {
                const destCoords = (destLat && destLng) ? { lat: destLat, lng: destLng } : destination;
                drawRouteMap("cc-map-container", originCoords, destCoords, (dur, dist) => {
                    const etaWrap = document.getElementById("cc-eta-wrap");
                    const etaEl = document.getElementById("cc-eta");
                    if (etaWrap && etaEl) {
                        etaEl.innerText = `${dur} · ${dist}`;
                        etaWrap.classList.remove("hidden");
                    }
                });
            };

            let mapDrawn = false;
            const fallbackTimer = setTimeout(() => {
                // No GPS in time — centre on the destination itself so the map
                // shows the right area rather than snapping to campus.
                if (!mapDrawn) {
                    mapDrawn = true;
                    const fallbackOrigin = (destLat && destLng)
                        ? { lat: destLat, lng: destLng }
                        : CAMPUS_COORDS;
                    finalizePublishMap(fallbackOrigin);
                }
            }, 3000);

            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    pos => {
                        if (!mapDrawn) {
                            mapDrawn = true;
                            clearTimeout(fallbackTimer);
                            finalizePublishMap({ lat: pos.coords.latitude, lng: pos.coords.longitude });
                        }
                    },
                    () => {
                        if (!mapDrawn) {
                            mapDrawn = true;
                            clearTimeout(fallbackTimer);
                            // GPS denied — show the destination area, not campus
                            const gpsFailOrigin = (destLat && destLng)
                                ? { lat: destLat, lng: destLng }
                                : CAMPUS_COORDS;
                            finalizePublishMap(gpsFailOrigin);
                        }
                    },
                    { enableHighAccuracy: false, maximumAge: 10000, timeout: 5000 }
                );
            } else {
                mapDrawn = true;
                clearTimeout(fallbackTimer);
                const noGpsOrigin = (destLat && destLng) ? { lat: destLat, lng: destLng } : CAMPUS_COORDS;
                finalizePublishMap(noGpsOrigin);
            }
        });
}

function cancelTrajectory() {
    showConfirm({
        title: 'Abort Mission?',
        message: 'This will cancel the trajectory for all passengers.',
        icon: '🛑',
        okLabel: 'Yes, Abort',
        okColor: '#f44336'
    }).then(ok => {
        if (!ok) return;
        authFetch(`${API_BASE_URL}/cancel-route`, { method: "POST", body: JSON.stringify({}) })
            .catch(err => console.log("Backend error, forcing frontend unlock anyway."))
            .finally(() => {
                stopListeningForPassengerRequests();
                stopGPSBroadcasting();
                isMissionActive = false;
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
}

function startJourneyPhase() {
    authFetch(`${API_BASE_URL}/start-route`, { method: "POST", body: JSON.stringify({}) })
        .then(() => {
            showNotification('Trajectory Started!', 'success');
            startGPSBroadcasting();
            showPage('driver-ride-started');
        }).catch(err => showNotification("Failed to start", "error"));
}

function requestPaymentsPhase() {
    authFetch(`${API_BASE_URL}/request-payment`, { method: "POST", body: JSON.stringify({}) })
        .then(() => {
            showNotification('Payments requested from all passengers.', 'info');
            showPage('driver-payment');
            const container = document.getElementById("cc-requests-container");
            const wrapper = document.getElementById("payment-requests-wrapper");
            if (wrapper && container) wrapper.appendChild(container);
        }).catch(err => showNotification("Failed to request payments", "error"));
}

function closeMissionPhase() {
    completeTrajectory();
}

function arrivePassenger(email, buttonEl) {
    if (buttonEl) buttonEl.disabled = true;
    authFetch(`${API_BASE_URL}/arrive-passenger`, { method: "POST", body: JSON.stringify({ passengerEmail: email }) })
        .then(() => {
            showNotification('Passenger alerted of your arrival.', 'success');
        }).catch(err => {
            if (buttonEl) buttonEl.disabled = false;
            showNotification('Failed to arrive', 'error');
        });
}

let gpsWatchId = null;

function startGPSBroadcasting() {
    if (!navigator.geolocation) {
        showNotification("Geolocation is not supported by your browser.", "error");
        return;
    }
    stopGPSBroadcasting();
    gpsWatchId = navigator.geolocation.watchPosition(
        (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            socket.emit("driver_location_update", { lat, lng });

            // Update driver's own map
            const mapWrapper = mapInstances["cc-map-container"];
            if (mapWrapper && mapWrapper.map) {
                const latLng = [lat, lng];
                if (!liveCarMarker) {
                    const carIcon = L.icon({
                        iconUrl: 'https://cdn-icons-png.flaticon.com/512/744/744465.png',
                        iconSize: [30, 30],
                        iconAnchor: [15, 15]
                    });
                    liveCarMarker = L.marker(latLng, { icon: carIcon }).addTo(mapWrapper.map);
                } else {
                    liveCarMarker.setLatLng(latLng);
                    if (!mapWrapper.map.hasLayer(liveCarMarker)) {
                        liveCarMarker.addTo(mapWrapper.map);
                    }
                }
            }
        },
        (error) => console.error("GPS Error", error),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
    );
}

function stopGPSBroadcasting() {
    if (gpsWatchId !== null) {
        navigator.geolocation.clearWatch(gpsWatchId);
        gpsWatchId = null;
    }
}

function completeTrajectory() {
    showConfirm({
        title: 'Mission Settled & Closed?',
        message: 'Are you sure you want to officially wrap and close the trajectory?',
        icon: '🏁',
        okLabel: 'Yes, Close',
        okColor: '#2ecc71'
    }).then(ok => {
        if (!ok) return;
        authFetch(`${API_BASE_URL}/complete-route`, { method: "POST", body: JSON.stringify({}) })
            .catch(err => console.log("Backend error, forcing frontend unlock anyway."))
            .finally(() => {
                stopListeningForPassengerRequests();
                stopGPSBroadcasting();
                isMissionActive = false;
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
    authFetch(`${API_BASE_URL}/accept-passenger`, {
        method: "POST",
        body: JSON.stringify({ passengerEmail })
    })
        .then(async res => {
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || "Failed to link");
            return data;
        })
        .then(data => {
            showNotification('Mission Linked! Passenger added to your trajectory.', 'success');
            document.getElementById("cc-seats").innerText = `${data.bookedSeats}/${data.totalSeats}`;

            // Update the card immediately to "accepted" state without waiting for DB re-fetch
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

            if (data.bookedSeats >= data.totalSeats) {
                showNotification('Trajectory Full! Maximum capacity reached.', 'warning', 6000);
            }
        })
        .catch(err => showNotification(err.message, 'error'));
}

function rejectPassenger(passengerEmail) {
    authFetch(`${API_BASE_URL}/reject-passenger`, {
        method: "POST",
        body: JSON.stringify({ passengerEmail })
    })
        .then(async res => {
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || "Rejection failed");
            showNotification('Passenger request declined.', 'info');

            // Remove the card immediately to avoid UI delay
            const container = document.getElementById("cc-requests-container");
            if (container) {
                const card = container.querySelector(`[data-email="${passengerEmail}"]`);
                if (card) {
                    card.style.transition = "all 0.2s ease";
                    card.style.opacity = "0";
                    card.style.transform = "scale(0.95) translateX(10px)";
                    setTimeout(() => {
                        card.remove();
                        if (container.children.length === 0 || (container.children.length === 1 && container.children[0].tagName === 'P')) {
                            container.innerHTML = `<p style="color:#888;font-size:14px;">Scanning for students...</p>`;
                        }
                    }, 200);
                }
            }

            // The backend emits ride_rejected to the passenger via socket.
            // Re-request the updated list from the backend (no polling, one-shot socket emit).
            const driverEmail = JSON.parse(localStorage.getItem('user')).email;
            socket.emit("request_current_rides", { driverEmail });
        })
        .catch(err => showNotification(err.message, 'error'));
}

// ─────────────────────────────────────────────────────────
// PASSENGER — OUTSIDE CAMPUS (Route Share)
// ─────────────────────────────────────────────────────────
function searchActiveRoutes(pinLat, pinLng) {
    const query = document.getElementById("ps-search-destination").value.trim();
    const container = document.getElementById("search-results-container");

    // Require either a map pin OR at least 3 text chars
    const hasPin = (pinLat != null && pinLng != null);
    if (!hasPin && query.length < 3) {
        container.innerHTML = `<p style="color:#888;text-align:center;font-size:14px;">Keep typing...</p>`;
        return;
    }

    const showFare = getSetting('showFare', true);

    container.innerHTML = `<p style="color:#4e69e2;text-align:center;font-size:14px;"><span class="loading-spinner"></span> Scanning trajectories...</p>`;

    // Build URL — prefer coordinate-based search when we have a pin
    let url;
    if (hasPin) {
        url = `${API_BASE_URL}/search-routes?destination=${encodeURIComponent(query || 'any')}&lat=${pinLat}&lng=${pinLng}`;
    } else {
        url = `${API_BASE_URL}/search-routes?destination=${encodeURIComponent(query)}`;
    }

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
                <div class="glass-card" style="margin:16px 0;padding:20px;text-align:left;border:1px solid rgba(78,105,226,0.15);border-radius:20px;box-shadow:0 8px 24px rgba(0,0,0,0.06);background:linear-gradient(145deg, #ffffff, #f8f9ff);">
                    <!-- Route label — intercity From → To -->
                    <div style="margin-bottom:10px;padding:10px 12px;background:linear-gradient(135deg,#f0f3ff,#e8f5e9);border-radius:12px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                        ${routeLabel}
                    </div>
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
                        <div style="display:flex;align-items:center;gap:8px;">
                            <div style="width:30px;height:30px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.05);">🕐</div>
                            <div style="font-size:13px;color:#444;font-weight:600;">${ride.time || 'Flexible'}</div>
                        </div>
                        <div style="display:flex;align-items:center;gap:8px;">
                            <div style="width:30px;height:30px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.05);">💺</div>
                            <div style="font-size:13px;color:#444;font-weight:600;">${ride.seats} seat${ride.seats !== 1 ? 's' : ''} left</div>
                        </div>
                    </div>
                    
                    <button class="btn-primary" style="width:100%;margin:0;padding:12px;border-radius:14px;font-weight:700;font-size:14px;letter-spacing:0.5px;box-shadow:0 6px 16px rgba(78,105,226,0.3);"
                        onclick="requestJoinRide('${ride._id}', '${ride.destination ? ride.destination.replace(/'/g, "\\'") : ''}', ${ride.destLat || null}, ${ride.destLng || null})">
                        Join This Ride
                    </button>
                </div>`;
            }).join('');
        })
        .catch(err => {
            console.error("Search error:", err);
            container.innerHTML = `<p style="color:#f44336;text-align:center;font-size:14px;">Signal lost. Check your connection.</p>`;
        });
}

// ─────────────────────────────────────────────────────────
// PICKUP LOCATION MODAL (replaces prompt())
// ─────────────────────────────────────────────────────────
function showPickupModal(rideId, destination, destLat, destLng) {
    const modal = document.getElementById("pickup-modal");
    const input = document.getElementById("pickup-modal-input");
    const confirmBtn = document.getElementById("pickup-modal-confirm");
    const cancelBtn = document.getElementById("pickup-modal-cancel");

    if (!modal || !input || !confirmBtn) return;

    // Reset
    input.value = "";
    modal.classList.remove("hidden");
    setTimeout(() => input.focus(), 100);

    // Confirm handler
    const onConfirm = () => {
        _submitPickupRequest(rideId, destination, destLat, destLng);
        cleanup();
    };

    // Cancel handler
    const onCancel = () => {
        modal.classList.add("hidden");
        cleanup();
    };

    // Allow Enter key to confirm
    const onEnter = (e) => {
        if (e.key === "Enter") onConfirm();
        if (e.key === "Escape") onCancel();
    };

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
    // Replace native prompt() with a styled modal
    showPickupModal(rideId, destination, destLat, destLng);
}

function _submitPickupRequest(rideId, destination, destLat, destLng) {
    const pickupInput = document.getElementById("pickup-modal-input");
    const pickupLocation = pickupInput ? pickupInput.value.trim() : "";
    if (!pickupLocation) {
        showNotification("Please enter your pickup location.", "warning");
        return;
    }

    // Hide the modal
    const modal = document.getElementById("pickup-modal");
    if (modal) modal.classList.add("hidden");

    localStorage.setItem("passengerActiveRide", rideId);
    if (destination) localStorage.setItem("passengerRideDestination", destination);
    if (destLat && destLng) {
        localStorage.setItem("passengerRideDestLat", destLat);
        localStorage.setItem("passengerRideDestLng", destLng);
    }

    authFetch(`${API_BASE_URL}/request-ride`, {
        method: "POST",
        body: JSON.stringify({ rideId, pickupLocation })
    })
        .then(res => res.json())
        .then(() => {
            showNotification('Request sent! Waiting for driver to Link with you.', 'info');
            showPage('passenger-mission-status');
            listenForRideStatusUpdates(rideId);
        })
        .catch(() => {
            showNotification('Failed to send request. Please try again.', 'error');
            localStorage.removeItem("passengerActiveRide");
        });
}

function endPassengerJourney() {
    showConfirm({
        title: 'Leave Trajectory?',
        message: 'Are you sure you want to leave this trajectory?',
        icon: '🚪',
        okLabel: 'Yes, Leave',
        okColor: '#f44336'
    }).then(ok => {
        if (!ok) return;
        const rideId = localStorage.getItem("passengerActiveRide");
        if (rideId) {
            authFetch(`${API_BASE_URL}/leave-ride`, {
                method: "POST",
                body: JSON.stringify({ rideId })
            }).catch(err => console.log("Cleanup request failed, clearing local state anyway."));
        }
        showNotification('You have left the trajectory.', 'warning');
        forceClearPassengerState();
    });
}

function forceClearPassengerState() {
    stopListeningForRideStatusUpdates();
    localStorage.removeItem("passengerActiveRide");
    localStorage.removeItem("passengerRideDestination");
    localStorage.removeItem("passengerLastDriver");
    // Clear quick-drop context so it never leaks into the next session
    localStorage.removeItem("quickDropPickup");
    localStorage.removeItem("quickDropDrop");
    localStorage.removeItem("quickDropDriverName");
    localStorage.removeItem("quickDropDriverEmail");

    const orb = document.getElementById("ps-status-orb");
    const text = document.getElementById("ps-status-text");
    if (orb) orb.className = "pulse-orb pending";
    if (text) text.innerText = "Awaiting Driver Response...";

    // Reset and hide the driver info card so stale data never shows next session
    const infoBox = document.getElementById("ps-driver-info");
    const nameEl = document.getElementById("ps-driver-name");
    const destEl = document.getElementById("ps-driver-dest");
    if (infoBox) infoBox.classList.add("hidden");
    if (nameEl) nameEl.innerText = "";
    if (destEl) destEl.innerHTML = "";

    // Hide map + ETA
    const mapDiv = document.getElementById("ps-map-container");
    const etaWrap = document.getElementById("ps-eta-wrap");
    if (mapDiv) mapDiv.classList.add("hidden");
    if (etaWrap) etaWrap.classList.add("hidden");

    showPage('home');
}

// ─────────────────────────────────────────────────────────
// PASSENGER — INSIDE CAMPUS (Quick Drop)
// ─────────────────────────────────────────────────────────
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
                            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;">
                                ${plateTag}
                                ${payBadge}
                            </div>
                        </div>
                        <button class="btn-primary" style="width:auto;padding:10px 16px;margin:0;align-self:center;border-radius:12px;"
                                onclick="initiateQuickRide('${driver.email}', '${driver.name}')">
                            Request
                        </button>
                    </div>
                </div>`;
            }).join('');
        }
    } catch (err) {
        resultsContainer.innerHTML = `<p style="color:red;">Signal lost. Retry scan.</p>`;
    } finally {
        toggleButtonLoading("search-campus-btn", false, "Scan for Active Beacons");
    }
}

function initiateQuickRide(driverEmail, driverName) {
    const pickup = document.getElementById("qp-pickup").value.trim();
    const drop = document.getElementById("qp-drop").value.trim();

    // Persist trip context so the mission-status page can display correct info
    // regardless of which page state was shown before.
    localStorage.setItem("quickDropPickup", pickup);
    localStorage.setItem("quickDropDrop", drop);
    localStorage.setItem("quickDropDriverName", driverName);
    localStorage.setItem("quickDropDriverEmail", driverEmail);

    authFetch(`${API_BASE_URL}/request-quick-drop`, {
        method: "POST",
        body: JSON.stringify({ driverEmail, pickup, drop })
    })
        .then(res => res.json())
        .then((data) => {
            if (data.requestId) localStorage.setItem("passengerActiveRide", data.requestId);
            showNotification(`Request transmitted to ${driverName}. Awaiting link confirmation...`, 'info');
            showPage('passenger-mission-status');
            listenForQuickDropAccepted();
        })
        .catch(err => {
            console.error("TRANSMIT ERROR:", err);
            showNotification('Failed to transmit. Check the browser console (F12) for details.', 'error');
        });
}

function confirmPaymentSent() {
    const type = window.currentPaymentType || "route_share";
    const rideId = localStorage.getItem("passengerActiveRide");

    if (!rideId) {
        showNotification("No active ride found to settle.", "error");
        return;
    }

    const btn = document.getElementById("payment-confirm-btn");
    btn.innerText = "Processing...";
    btn.disabled = true;

    authFetch(`${API_BASE_URL}/passenger-paid`, {
        method: "POST",
        body: JSON.stringify({ type, rideId })
    })
        .then(() => {
            showNotification('Payment confirmation sent to driver!', 'success');
            const btn = document.getElementById("payment-confirm-btn");
            if (btn) btn.innerText = "Payment Sent! Awaiting Closure...";
        })
        .finally(() => {
            btn.innerText = "I have Paid via Cash / UPI";
            btn.disabled = false;
        });
}

// ─────────────────────────────────────────────────────────
// DRIVER — INSIDE CAMPUS (Quick Drop scanner)
// ─────────────────────────────────────────────────────────
function startQuickRequestScanner() {
    const container = document.getElementById("request-container");
    if (container) {
        container.innerHTML = `<p style="color:#4e69e2;font-size:14px;"><span class="loading-spinner"></span> Initializing radar...</p>`;
    }

    listenForQuickRequests();

    setTimeout(() => {
        if (container && container.querySelector(".loading-spinner")) {
            container.innerHTML = `<p style="color:#888;font-size:14px;">Scanning for nearby students...</p>`;
        }
    }, 1500);
}

function acceptQuickDrop(requestId, buttonEl) {
    if (buttonEl) {
        buttonEl.disabled = true;
        buttonEl.innerText = "Accepting...";
        buttonEl.style.opacity = "0.7";
    }

    authFetch(`${API_BASE_URL}/accept-quick-drop`, {
        method: "POST",
        body: JSON.stringify({ requestId })
    })
        .then(res => res.json())
        .then(() => {
            showNotification('Request Accepted! Proceed to the pickup coordinates.', 'success');
            const card = document.getElementById(`quick-req-${requestId}`);
            if (card) {
                card.style.borderLeftColor = '#2ecc71';
                card.innerHTML = `
                    <div style="font-weight:bold;color:#222;font-size:16px;margin-bottom:8px;">✅ Active Drop</div>
                    <div style="font-size:13px;color:#555;margin-bottom:12px;">Head to the pickup location. Passenger notified.</div>
                    <button class="btn-primary" style="background:#f39c12;width:100%;padding:10px;"
                            onclick="arriveQuickDrop('${requestId}', this)">
                        📍 Arrive
                    </button>`;
            }
        })
        .catch(() => {
            showNotification('Failed to accept request.', 'error');
            if (buttonEl) {
                buttonEl.disabled = false;
                buttonEl.innerText = "✓ Accept";
                buttonEl.style.opacity = "1";
            }
        });
}

function arriveQuickDrop(requestId, buttonEl) {
    if (buttonEl) {
        buttonEl.disabled = true;
        buttonEl.innerText = "Arriving...";
    }
    authFetch(`${API_BASE_URL}/arrive-quick-drop`, { method: "POST", body: JSON.stringify({ requestId }) })
        .then(() => {
            showNotification('Passenger alerted of your arrival.', 'success');
            const card = document.getElementById(`quick-req-${requestId}`);
            if (card) {
                card.innerHTML = `
                    <div style="font-weight:bold;color:#222;font-size:16px;margin-bottom:8px;">✔ Active Drop</div>
                    <div style="font-size:13px;color:#2ecc71;margin-bottom:12px;font-weight:bold;">Driver has Arrived. Waiting for start.</div>
                    <button class="btn-primary" style="background:#4e69e2;width:100%;padding:10px;"
                            onclick="startQuickDrop('${requestId}', this)">
                          ► Start Drop
                    </button>`;
            }
        }).catch(() => {
            if (buttonEl) {
                buttonEl.disabled = false;
                buttonEl.innerText = "📍 Arrive";
            }
            showNotification("Failed to arrive", "error");
        });
}

function startQuickDrop(requestId, buttonEl) {
    if (buttonEl) {
        buttonEl.disabled = true;
        buttonEl.innerText = "Starting...";
    }
    authFetch(`${API_BASE_URL}/start-quick-drop`, { method: "POST", body: JSON.stringify({ requestId }) })
        .then(() => {
            showNotification('Drop Started!', 'success');
            if (buttonEl) {
                buttonEl.disabled = false;
                buttonEl.innerText = "💰 Settle Payments";
                buttonEl.style.background = "#f39c12"; // Orange
                buttonEl.setAttribute("onclick", `requestQuickPayment('${requestId}', this)`);
            }
        })
        .catch(() => { showNotification("Failed to start drop", "error"); if (buttonEl) buttonEl.disabled = false; });
}

function requestQuickPayment(requestId, buttonEl) {
    if (buttonEl) {
        buttonEl.disabled = true;
        buttonEl.innerText = "Requesting...";
    }
    authFetch(`${API_BASE_URL}/request-quick-payment`, { method: "POST", body: JSON.stringify({ requestId }) })
        .then(() => {
            showNotification('Payment requested from passenger.', 'info');
            if (buttonEl) {
                buttonEl.disabled = false;
                buttonEl.innerText = "🏁 Close Mission";
                buttonEl.style.background = "#2ecc71"; // Green
                buttonEl.setAttribute("onclick", `completeQuickDrop('${requestId}', this)`);
            }
        })
        .catch(() => { showNotification("Failed to request payments", "error"); if (buttonEl) buttonEl.disabled = false; });
}

function completeQuickDrop(requestId, buttonEl) {
    if (buttonEl) {
        buttonEl.disabled = true;
        buttonEl.innerText = "Closing...";
        buttonEl.style.opacity = "0.7";
    }

    authFetch(`${API_BASE_URL}/complete-quick-drop`, {
        method: "POST",
        body: JSON.stringify({ requestId })
    })
        .then(res => res.json())
        .then(() => {
            showNotification('Drop closed and settled.', 'success');
            const card = document.getElementById(`quick-req-${requestId}`);
            if (card) {
                card.innerHTML = `<div style="text-align:center;color:#2ecc71;font-weight:bold;padding:10px;">✓ Drop Settled & Completed</div>`;
                setTimeout(() => card.remove(), 3000);
            }
        })
        .catch(() => {
            showNotification('Failed to complete drop.', 'error');
            if (buttonEl) {
                buttonEl.disabled = false;
                buttonEl.innerText = "🏁 Close Mission";
                buttonEl.style.opacity = "1";
            }
        });
}

function rejectQuickDrop(requestId, buttonEl) {
    if (buttonEl) {
        buttonEl.disabled = true;
        buttonEl.innerText = "Declining...";
        buttonEl.style.opacity = "0.7";
    }

    authFetch(`${API_BASE_URL}/reject-quick-drop`, {
        method: "POST",
        body: JSON.stringify({ requestId })
    })
        .then(res => res.json())
        .then(() => {
            showNotification('Request declined.', 'info');
            const card = document.getElementById(`quick-req-${requestId}`);
            if (card) card.remove();
        })
        .catch(() => {
            showNotification('Failed to decline request.', 'error');
            if (buttonEl) {
                buttonEl.disabled = false;
                buttonEl.innerText = "✕ Decline";
                buttonEl.style.opacity = "1";
            }
        });
}

// ─────────────────────────────────────────────────────────
// SHIFT TOGGLE
// ─────────────────────────────────────────────────────────
async function toggleShift() {
    const targetStatus = !isOnline;
    const originalText = isOnline ? "End Shift" : "Go Online";

    toggleButtonLoading("toggle-shift-btn", true, originalText);

    try {
        const response = await authFetch(`${API_BASE_URL}/toggle-online`, {
            method: "POST",
            body: JSON.stringify({ status: targetStatus })
        });

        if (response.ok) {
            isOnline = targetStatus;
            localStorage.setItem("isOnline", isOnline.toString());
            syncDriverUI();

            if (isOnline) {
                startQuickRequestScanner();
            } else {
                stopListeningForQuickRequests();
                const container = document.getElementById("request-container");
                if (container) container.innerHTML = `<p>Go online to see requests.</p>`;
            }
        }
    } catch (err) {
        console.error("Toggle Sync Error:", err);
        showNotification('Connection Interrupted: Could not reach Command Center.', 'error');
    } finally {
        toggleButtonLoading("toggle-shift-btn", false, isOnline ? "End Shift" : "Go Online");
    }
}

// ─────────────────────────────────────────────────────────
// DRIVER REGISTRATION
// ─────────────────────────────────────────────────────────
async function submitDriverRegistration() {
    const license = document.getElementById("reg-license").value.trim();
    const vehicleModel = document.getElementById("reg-vehicle-model").value.trim();
    const vehicleNumber = document.getElementById("reg-vehicle-num").value.trim();
    const agreed = document.getElementById("reg-terms").checked;
    const upiId = document.getElementById("reg-upi-id").value.trim();
    const qrFileInput = document.getElementById("reg-qr-photo");

    if (!license || !vehicleModel || !vehicleNumber || !agreed) {
        showNotification('Please fill all mandatory fields and agree to the terms.', 'warning');
        return;
    }

    let qrPhoto = null;
    if (qrFileInput && qrFileInput.files && qrFileInput.files[0]) {
        try {
            qrPhoto = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = error => reject(error);
                reader.readAsDataURL(qrFileInput.files[0]);
            });
        } catch (err) {
            showNotification('Error extracting your QR photo. Make sure it is a valid image.', 'error');
            return;
        }
    }

    // Warn if the QR photo is very large (> 800 KB base64) — Express default limit is 100 KB
    if (qrPhoto && qrPhoto.length > 800000) {
        showNotification('QR photo is too large. Please use an image under 600 KB.', 'error');
        return;
    }

    authFetch(`${API_BASE_URL}/update-driver-status`, {
        method: "POST",
        body: JSON.stringify({ license, vehicleModel, vehicleNumber, agreed, upiId, qrPhoto })
    })
        .then(async res => {
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || `Server error (${res.status})`);
            return data;
        })
        .then(() => {
            const userData = JSON.parse(localStorage.getItem("user"));
            userData.isCampusDriver = true;
            localStorage.setItem("user", JSON.stringify(userData));
            showNotification('Account Verified Successfully!', 'success');
            enterDriver();
        })
        .catch(err => {
            console.error('Driver registration error:', err);
            showNotification(err.message || 'Registration failed. Please try again later.', 'error');
        });
}

// ─────────────────────────────────────────────────────────
// PROFILE
// ─────────────────────────────────────────────────────────
async function updateGenderInDB(newGender) {
    const userData = JSON.parse(localStorage.getItem("user"));
    if (!userData) return;

    const statusLabel = document.createElement("span");
    statusLabel.innerText = " Saving...";
    statusLabel.style.fontSize = "12px";
    statusLabel.style.color = "#4e69e2";
    document.getElementById("edit-gender").after(statusLabel);

    try {
        const response = await authFetch(`${API_BASE_URL}/update-profile`, {
            method: "POST",
            body: JSON.stringify({ gender: newGender })
        });

        if (response.ok) {
            userData.gender = newGender;
            localStorage.setItem("user", JSON.stringify(userData));
            const sideGender = document.getElementById("side-gender-display");
            if (sideGender) sideGender.innerText = "Gender: " + newGender;
            statusLabel.innerText = " ✅ Saved";
        } else {
            statusLabel.innerText = " ❌ Failed";
        }
    } catch (err) {
        statusLabel.innerText = " ❌ Error";
    }

    setTimeout(() => statusLabel.remove(), 2000);
}

// ─────────────────────────────────────────────────────────
// NAVIGATION / MODE SELECTION
// ─────────────────────────────────────────────────────────
let currentMainMode = '';

function enterPassenger() {
    if (localStorage.getItem("passengerActiveRide")) {
        showNotification('You are already in an active trajectory!', 'warning');
        showPage('passenger-mission-status');
        return;
    }
    currentMainMode = 'passenger';
    showBranchSelection("Choose your Destination Scope");
}

function enterDriver() {
    const userData = JSON.parse(localStorage.getItem("user"));
    if (!userData) return goToLogin();

    if (userData.isCampusDriver === true) {
        currentMainMode = 'driver';
        showBranchSelection("Set your Driving Scope");
    } else {
        showPage('driver-reg');
    }
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
            // Reset form state so a fresh trip always starts clean
            chosenFromPlace = null;
            chosenDestinationPlace = null;
            const rsFrom = document.getElementById("rs-from");
            const rsDest = document.getElementById("rs-destination");
            if (rsFrom) rsFrom.value = "";
            if (rsDest) rsDest.value = "";
            const mapDiv = document.getElementById("rs-map-container");
            if (mapDiv) {
                mapDiv.classList.add("hidden");
                if (mapInstances["rs-map-container"]) {
                    mapInstances["rs-map-container"].map.remove();
                    delete mapInstances["rs-map-container"];
                }
            }
            const etaWrap = document.getElementById("rs-eta-wrap");
            if (etaWrap) etaWrap.classList.add("hidden");
        }
        showPage(currentMainMode === 'driver' ? 'driver-route-share' : 'passenger-route-search');
    }
}

// ─────────────────────────────────────────────────────────
// SIDEBAR / MISC
// ─────────────────────────────────────────────────────────
function toggleSidebar() {
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

function togglePassword(inputId, icon) {
    const input = document.getElementById(inputId);
    if (input.type === "password") {
        input.type = "text";
        icon.textContent = "🙈";
    } else {
        input.type = "password";
        icon.textContent = "👁️";
    }
}

function exitDriverMode() {
    if (isOnline) {
        showNotification("Active Shift! You must click 'End Shift' before leaving this tab.", 'warning');
        return;
    }
    showPage('home');
}

function clearAllInputs() {
    document.querySelectorAll('input').forEach(input => input.value = "");
}

// ─────────────────────────────────────────────────────────
// LOGOUT
// ─────────────────────────────────────────────────────────
function logout() {
    if (isOnline || isMissionActive) {
        showNotification('You cannot logout while a shift or mission is active.', 'warning');
        return;
    }
    document.getElementById("logout-modal").classList.remove("hidden");
}

function closeLogoutModal() {
    document.getElementById("logout-modal").classList.add("hidden");
}

function confirmLogout() {
    socket.disconnect();
    localStorage.clear();

    const menu = document.getElementById("side-menu");
    const overlay = document.getElementById("sidebar-overlay");
    if (menu) menu.classList.remove("active");
    if (overlay) overlay.classList.add("hidden");

    clearAllInputs();
    window.location.reload();
}

// ─────────────────────────────────────────────────────────
// KEYBOARD SHORTCUTS
// ─────────────────────────────────────────────────────────
function handleEnter(event, buttonId) {
    if (event.key === "Enter") {
        event.preventDefault();
        document.getElementById(buttonId).click();
    }
}

document.getElementById("signup-password").addEventListener("keypress", e => handleEnter(e, "signup-btn"));
document.getElementById("login-password").addEventListener("keypress", e => handleEnter(e, "login-btn"));

// ─────────────────────────────────────────────────────────
// GHOST PROTOCOL — sendBeacon on tab close
// ─────────────────────────────────────────────────────────
window.addEventListener("beforeunload", function () {
    const missionActive = localStorage.getItem("isMissionActive") === "true";
    const currentlyOnline = localStorage.getItem("isOnline") === "true";
    const token = localStorage.getItem("token");

    if (token && (missionActive || currentlyOnline)) {
        const blob = new Blob([JSON.stringify({})], { type: 'application/json' });
        navigator.sendBeacon(`${API_BASE_URL}/emergency-cleanup?token=${token}`, blob);
    }
});