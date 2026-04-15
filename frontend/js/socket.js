// ─────────────────────────────────────────────────────────
// js/socket.js — Socket.io Initialization & Event Listeners
// ─────────────────────────────────────────────────────────
import { API_BASE_URL, getSetting } from './api.js';
import { mapInstances, liveCarMarker, setLiveCarMarker, drawRouteMap } from './map.js';

const CAMPUS_COORDS = { lat: 23.5354, lng: 72.4573 };

// ── Socket instance ────────────────────────────────────────
export const socket = io(API_BASE_URL, {
    auth: { token: localStorage.getItem("token") }
});

socket.on("connect", () => {
    console.log("Socket connected:", socket.id);
    const userData = JSON.parse(localStorage.getItem("user"));
    if (userData) socket.emit("join", userData.email);
});
socket.on("disconnect", () => console.log("Socket disconnected"));

// ── GPS Broadcasting ──────────────────────────────────────
let gpsWatchId = null;

export function startGPSBroadcasting() {
    if (!navigator.geolocation) return;
    stopGPSBroadcasting();
    gpsWatchId = navigator.geolocation.watchPosition(
        (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            socket.emit("driver_location_update", { lat, lng });

            const mapWrapper = mapInstances["cc-map-container"];
            if (mapWrapper && mapWrapper.map) {
                const latLng = [lat, lng];
                let marker = liveCarMarker;
                if (!marker) {
                    const carIcon = L.icon({
                        iconUrl: 'https://cdn-icons-png.flaticon.com/512/744/744465.png',
                        iconSize: [30, 30], iconAnchor: [15, 15]
                    });
                    marker = L.marker(latLng, { icon: carIcon }).addTo(mapWrapper.map);
                    setLiveCarMarker(marker);
                } else {
                    marker.setLatLng(latLng);
                    if (!mapWrapper.map.hasLayer(marker)) marker.addTo(mapWrapper.map);
                }
            }
        },
        (error) => console.error("GPS Error", error),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
    );
}

export function stopGPSBroadcasting() {
    if (gpsWatchId !== null) {
        navigator.geolocation.clearWatch(gpsWatchId);
        gpsWatchId = null;
    }
}

// ── Passenger ride status listeners ───────────────────────
// These are injected via _setHandlers() from main.js to avoid circular deps
let _showPage = () => { };
let _showNotification = () => { };
let _renderRequestList = () => { };
let _hydratePaymentModal = () => { };
let _applyRideAccepted = () => { };
let _forceClearPassengerState = () => { };

export function setSocketHandlers(handlers) {
    _showPage = handlers.showPage;
    _showNotification = handlers.showNotification;
    _renderRequestList = handlers.renderRequestList;
    _hydratePaymentModal = handlers.hydratePaymentModal;
    _applyRideAccepted = handlers.applyRideAccepted;
    _forceClearPassengerState = handlers.forceClearPassengerState;
}

// ── Driver: Passenger request listeners ───────────────────
export function listenForPassengerRequests() {
    socket.off("new_request");
    socket.off("ride_requests_list");
    socket.off("passenger_disconnected");
    socket.off("peer_reconnected");
    socket.off("passenger_paid");

    socket.on("passenger_disconnected", () => {
        if (getSetting('notifRides', true))
            _showNotification(`⚠️ A passenger has disconnected. 30 seconds to reconnect.`, 'warning', 8000);
    });

    socket.on("peer_reconnected", (data) => {
        if (data.who === "passenger")
            _showNotification(`✅ Passenger has reconnected!`, 'success', 5000);
    });

    socket.on("new_request", (data) => {
        if (getSetting('notifRides', true))
            _showNotification(`📬 New request from ${data.passengerName || 'a passenger'}!`, 'info', 4000);

        const container = document.getElementById("cc-requests-container");
        if (container) {
            const placeholder = container.querySelector("p");
            if (placeholder) placeholder.remove();
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
                        <button class="btn-primary" style="width:auto;padding:8px 16px;background:#2ecc71;font-size:13px;margin:0;border-radius:10px;" onclick="window.acceptPassenger('${data.passengerEmail}')">✓ Link</button>
                        <button class="btn-primary" style="width:auto;padding:8px 16px;background:#f44336;font-size:13px;margin:0;border-radius:10px;" onclick="window.rejectPassenger('${data.passengerEmail}')">✕ Reject</button>
                    </div>`;
                container.appendChild(card);
            }
        }

        const driverEmail = JSON.parse(localStorage.getItem('user')).email;
        socket.emit("request_current_rides", { driverEmail });
    });

    socket.on("ride_requests_list", (requests) => {
        _renderRequestList(requests);
    });

    socket.on("passenger_paid", (data) => {
        if (getSetting('notifRides', true))
            _showNotification(`💰 Passenger ${data.passengerEmail || 'has'} confirmed payment!`, 'success', 6000);
        const driverEmail = JSON.parse(localStorage.getItem('user')).email;
        socket.emit("request_current_rides", { driverEmail });
    });
}

export function stopListeningForPassengerRequests() {
    socket.off("new_request");
    socket.off("ride_requests_list");
    socket.off("passenger_disconnected");
    socket.off("peer_reconnected");
    socket.off("passenger_paid");
}

// ── Passenger: Ride status listeners ─────────────────────
export function listenForRideStatusUpdates(rideId) {
    socket.off("ride_accepted");
    socket.off("ride_cancelled");
    socket.off("ride_completed");
    socket.off("ride_rejected");
    socket.off("ride_started");
    socket.off("payment_requested");
    socket.off("driver_location");
    socket.off("driver_arrived");
    socket.off("peer_reconnected");

    socket.on("peer_reconnected", (data) => {
        _showNotification(data.who === "driver" ? "✅ Driver has reconnected!" : "✅ Passenger has reconnected.", 'success', 5000);
    });

    socket.on("ride_accepted", (data) => {
        const destination = data.destination || localStorage.getItem("passengerRideDestination");
        if (data.destLat && data.destLng) {
            localStorage.setItem("passengerRideDestLat", data.destLat);
            localStorage.setItem("passengerRideDestLng", data.destLng);
        }
        if (data.fromLat && data.fromLng) {
            localStorage.setItem("passengerRideDepartureLat", data.fromLat);
            localStorage.setItem("passengerRideDepartureLng", data.fromLng);
        }
        _applyRideAccepted(data.driverName, data.driverEmail, destination, data.vehicleModel, data.vehicleNumber);
        if (getSetting('notifStatus', true)) _showNotification(data.message, 'success', 6000);
    });

    socket.on("ride_rejected", (data) => {
        const orb = document.getElementById("ps-status-orb");
        const text = document.getElementById("ps-status-text");
        if (orb) orb.className = "pulse-orb pending";
        if (text) text.innerText = "Request Declined. Redirecting to search...";
        if (getSetting('notifStatus', true))
            _showNotification(data.message || 'Your request was declined. Try another driver.', 'warning', 5000);
        localStorage.removeItem("passengerActiveRide");
        localStorage.removeItem("passengerRideDestination");
        stopListeningForRideStatusUpdates();
        setTimeout(() => _showPage('passenger-route-search'), 3000);
    });

    socket.on("ride_cancelled", (data) => {
        if (getSetting('notifStatus', true)) _showNotification(data.message + ' Returning to home.', 'error', 5000);
        _forceClearPassengerState();
    });

    socket.on("ride_started", (data) => {
        _showPage('passenger-ride-started');
        const text = document.getElementById("ride-status-text");
        if (text) text.innerText = "Enjoy the ride!";
        if (getSetting('notifStatus', true)) _showNotification("Mission Started!", 'info', 4000);

        setTimeout(() => {
            const storedLat = localStorage.getItem("passengerRideDestLat");
            const storedLng = localStorage.getItem("passengerRideDestLng");
            const mapDest = (storedLat && storedLng)
                ? { lat: parseFloat(storedLat), lng: parseFloat(storedLng) }
                : localStorage.getItem("passengerRideDestination");

            let origin = CAMPUS_COORDS;
            const curMarker = liveCarMarker;
            if (curMarker) {
                const pos = curMarker.getLatLng();
                origin = { lat: pos.lat, lng: pos.lng };
            } else {
                const depLat = parseFloat(localStorage.getItem("passengerRideDepartureLat"));
                const depLng = parseFloat(localStorage.getItem("passengerRideDepartureLng"));
                if (depLat && depLng) origin = { lat: depLat, lng: depLng };
            }
            if (mapDest) drawRouteMap("ride-map-container", origin, mapDest);
        }, 150);
    });

    socket.on("driver_arrived", (data) => {
        const text = document.getElementById("pickup-status-text");
        if (text) text.innerText = "Driver has arrived! Please board the vehicle.";
        if (getSetting('notifStatus', true)) _showNotification(data.message || "Driver has arrived!", 'success', 6000);
    });

    socket.on("payment_requested", (data) => {
        _showPage('passenger-payment');
        _hydratePaymentModal(data);
        _showNotification("You have arrived! Please settle your fare.", 'warning', 6000);
    });

    socket.on("ride_completed", (data) => {
        if (getSetting('notifStatus', true)) _showNotification(data.message, 'success', 5000);
        _forceClearPassengerState();
    });

    socket.on("driver_location", (data) => {
        const latLng = [data.lat, data.lng];
        const pickingUpPage = document.getElementById("page-passenger-picking-up");
        const rideStartedPage = document.getElementById("page-passenger-ride-started");
        const isPickingUp = pickingUpPage && !pickingUpPage.classList.contains("hidden");
        const isRideStarted = rideStartedPage && !rideStartedPage.classList.contains("hidden");
        let activeMapKey = isPickingUp ? "ps-map-container" : isRideStarted ? "ride-map-container" : null;
        if (!activeMapKey) return;

        const mapWrapper = mapInstances[activeMapKey];
        if (!mapWrapper || !mapWrapper.map) return;
        const map = mapWrapper.map;

        let marker = liveCarMarker;
        if (!marker) {
            const carIcon = L.icon({
                iconUrl: 'https://cdn-icons-png.flaticon.com/512/744/744465.png',
                iconSize: [30, 30], iconAnchor: [15, 15]
            });
            marker = L.marker(latLng, { icon: carIcon }).addTo(map);
            setLiveCarMarker(marker);
            map.panTo(latLng);
        } else {
            try {
                if (!map.hasLayer(marker)) marker.addTo(map);
            } catch (e) { }
            marker.setLatLng(latLng);
            map.panTo(latLng);
        }
    });
}

export function stopListeningForRideStatusUpdates() {
    socket.off("ride_accepted");
    socket.off("ride_cancelled");
    socket.off("ride_completed");
    socket.off("ride_rejected");
    socket.off("ride_started");
    socket.off("payment_requested");
    socket.off("driver_location");
    socket.off("driver_arrived");
    const marker = liveCarMarker;
    if (marker) { marker.remove(); setLiveCarMarker(null); }
}

// ── Quick Drop listeners ──────────────────────────────────
export function listenForQuickDropAccepted() {
    socket.off("quick_drop_accepted");
    socket.off("quick_drop_completed");
    socket.off("quick_drop_rejected");
    socket.off("quick_drop_arrived");
    socket.off("quick_drop_started");
    socket.off("payment_requested");

    socket.on("quick_drop_accepted", (data) => {
        _showPage('passenger-picking-up');
        const text = document.getElementById("pickup-status-text");
        if (text) text.innerText = "Pickup Confirmed! The driver is heading to you.";

        const pickup = localStorage.getItem("quickDropPickup") || "your pickup location";
        const drop = localStorage.getItem("quickDropDrop") || "your drop location";
        const driverName = data.driverName || localStorage.getItem("quickDropDriverName") || "Driver";

        // ── NEW: Show fare chip so passenger sees what driver charged ──
        const fare = data.fare != null ? data.fare : null;

        const infoBox = document.getElementById("ps-driver-info");
        const nameEl = document.getElementById("ps-driver-name");
        const destEl = document.getElementById("ps-driver-dest");
        if (infoBox && nameEl) {
            nameEl.innerText = `🛺  Driver: ${driverName}`;
            if (destEl) {
                destEl.innerHTML =
                    `📍 From: <strong>${pickup}</strong><br>` +
                    `🏁 To: <strong>${drop}</strong><br>` +
                    (fare != null
                        ? `<span id="qd-fare-chip" style="display:inline-flex;align-items:center;gap:6px;margin-top:8px;background:linear-gradient(135deg,#f39c12,#e67e22);color:#fff;font-weight:800;font-size:14px;padding:6px 14px;border-radius:20px;box-shadow:0 4px 10px rgba(243,156,18,0.35);">💰 ₹${fare} · Set by Driver</span><br><span style="font-size:11px;color:#888;margin-top:4px;display:block;">You may cancel before pickup if fare is unacceptable.</span>`
                        : ``) +
                    `<span style="color:#2ecc71;font-weight:bold;display:inline-block;margin-top:6px;">Quick Drop — on campus</span>`;
            }
            infoBox.classList.remove("hidden");
        }

        const agreeEl = document.getElementById("pickup-agreement-text");
        if (agreeEl) agreeEl.innerText = `${driverName} accepted your request. Head to the pickup point!`;

        if (getSetting('notifStatus', true)) _showNotification(data.message, 'success', 6000);
    });

    socket.on("quick_drop_arrived", (data) => {
        const text = document.getElementById("pickup-status-text");
        if (text) text.innerText = "Driver has arrived at the pickup location!";
        if (getSetting('notifStatus', true)) _showNotification(data.message || "Driver has arrived!", 'success', 6000);
    });

    socket.on("quick_drop_started", (data) => {
        _showPage('passenger-ride-started');
        const text = document.getElementById("ride-status-text");
        if (text) text.innerText = "Drop in progress... Enjoy the ride!";
        if (getSetting('notifStatus', true)) _showNotification("Drop Started!", 'info', 4000);
    });

    socket.on("payment_requested", (data) => {
        _showPage('passenger-payment');
        _hydratePaymentModal(data);
        _showNotification("Driver has arrived! Please settle your fare.", 'warning', 6000);
    });

    socket.on("quick_drop_completed", (data) => {
        if (getSetting('notifStatus', true))
            _showNotification(data.message || 'Drop completed! Thanks for riding.', 'success', 6000);
        socket.off("quick_drop_accepted");
        socket.off("quick_drop_completed");
        socket.off("quick_drop_rejected");
        socket.off("quick_drop_arrived");
        socket.off("quick_drop_started");
        setTimeout(() => _showPage('home'), 2500);
    });

    socket.on("quick_drop_rejected", (data) => {
        if (getSetting('notifStatus', true))
            _showNotification(data.message || 'Request declined. Try another driver.', 'warning', 5000);
        socket.off("quick_drop_accepted");
        socket.off("quick_drop_completed");
        socket.off("quick_drop_rejected");
        setTimeout(() => _showPage('passenger'), 3000);
    });
}

// ── Driver: Quick request scanner ─────────────────────────
export function listenForQuickRequests() {
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
            <div style="margin-top:10px;background:#f9f9f9;padding:8px;border-radius:8px;">
                <label style="font-size:12px;color:#666;font-weight:bold;">Set Fare (Max ₹50):</label>
                <div style="display:flex;align-items:center;margin-top:4px;">
                    <span style="font-weight:bold;color:#4e69e2;margin-right:6px;">₹</span>
                    <input type="number" id="quick-fare-${data.requestId}" value="30" min="0" max="50" style="flex:1;padding:6px;border-radius:6px;border:1px solid #ccc;font-size:14px;">
                </div>
            </div>
            <div style="display:flex;gap:10px;margin-top:10px;">
                <button class="btn-primary" style="background:#2ecc71;flex:1;padding:10px;"
                        onclick="window.acceptQuickDrop('${data.requestId}', this)">✓ Accept</button>
                <button class="btn-primary" style="background:#f44336;flex:1;padding:10px;"
                        onclick="window.rejectQuickDrop('${data.requestId}', this)">✕ Decline</button>
            </div>`;

        const placeholder = container.querySelector("p");
        if (placeholder) placeholder.remove();
        container.appendChild(card);
    });

    socket.off("passenger_paid");
    socket.on("passenger_paid", (data) => {
        if (data.type === "quick_drop" && data.requestId) {
            if (getSetting('notifRides', true))
                _showNotification(`💰 Payment confirmed for drop!`, 'success', 6000);
            const card = document.getElementById(`quick-req-${data.requestId}`);
            if (card) {
                const btn = card.querySelector("button[onclick*='completeQuickDrop']");
                if (btn) { btn.style.boxShadow = "0 0 15px #2ecc71"; btn.innerText = "✓ Confirm & Close"; }
            }
        }
    });
}

export function stopListeningForQuickRequests() {
    socket.off("new_quick_request");
}
