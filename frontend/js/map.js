// ─────────────────────────────────────────────────────────
// js/map.js — All Leaflet / OSRM / Nominatim Logic
// ─────────────────────────────────────────────────────────

const CAMPUS_COORDS = { lat: 23.5354, lng: 72.4573 };

// ── Module-level map state (persists across SPA page switches) ──
export const mapInstances = {};
export let selectionMap = null;
export let selectionMarker = null;
export let selectionPinLat = null;
export let selectionPinLng = null;
export let chosenDestinationPlace = null;
export let chosenFromPlace = null;
export let liveCarMarker = null;

// Allow modules to mutate these (e.g. socket.js updates liveCarMarker)
export function setLiveCarMarker(val) { liveCarMarker = val; }
export function setSelectionPin(lat, lng) { selectionPinLat = lat; selectionPinLng = lng; }
export function setChosenFromPlace(val) { chosenFromPlace = val; }
export function setChosenDestinationPlace(val) { chosenDestinationPlace = val; }

// ── Entry: called once on DOMContentLoaded in main.js ─────
export function initMaps(onSearchActiveRoutes) {
    // Driver: starting-point autocomplete
    attachAutocomplete("rs-from", (place) => {
        chosenFromPlace = place;
        if (chosenDestinationPlace) showDestinationPreview(chosenDestinationPlace);
    });

    // Driver: destination autocomplete
    attachAutocomplete("rs-destination", (place) => {
        chosenDestinationPlace = place;
        showDestinationPreview(place);
    });

    // Passenger: destination search autocomplete — clears pin coords on manual type
    attachAutocomplete("ps-search-destination", () => {
        selectionPinLat = null;
        selectionPinLng = null;
        if (onSearchActiveRoutes) onSearchActiveRoutes(null, null);
    });

    initSelectionMap(onSearchActiveRoutes);
}

// ── Passenger interactive selection map ──────────────────
export function initSelectionMap(onSearchActiveRoutes) {
    const mapDiv = document.getElementById("ps-selection-map");
    if (!mapDiv || selectionMap) return;

    selectionMap = L.map(mapDiv, { zoomControl: true }).setView([CAMPUS_COORDS.lat, CAMPUS_COORDS.lng], 9);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(selectionMap);

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            pos => { if (selectionMap) selectionMap.setView([pos.coords.latitude, pos.coords.longitude], 12); },
            () => { },
            { enableHighAccuracy: false, maximumAge: 30000, timeout: 6000 }
        );
    }

    selectionMap.on('click', async (e) => {
        const { lat, lng } = e.latlng;
        selectionPinLat = lat;
        selectionPinLng = lng;
        _placeSelectionPin(lat, lng);

        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`);
            const data = await res.json();
            if (data && data.display_name) {
                const shortName = data.display_name.split(',')[0];
                const input = document.getElementById("ps-search-destination");
                if (input) {
                    input.value = shortName;
                    if (onSearchActiveRoutes) onSearchActiveRoutes(lat, lng);
                }
            }
        } catch (err) { console.error("Reverse geocode error", err); }
    });

    setTimeout(() => selectionMap && selectionMap.invalidateSize(), 300);
}

export function invalidateSelectionMap() {
    if (selectionMap) selectionMap.invalidateSize();
    else initSelectionMap();
}

function _placeSelectionPin(lat, lng) {
    if (!selectionMap) return;
    const latLng = [lat, lng];
    if (selectionMarker) {
        selectionMarker.setLatLng(latLng);
    } else {
        const pinIcon = L.icon({
            iconUrl: 'https://cdn-icons-png.flaticon.com/512/684/684908.png',
            iconSize: [32, 32], iconAnchor: [16, 32]
        });
        selectionMarker = L.marker(latLng, { icon: pinIcon, draggable: true }).addTo(selectionMap);

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
                    if (input) { input.value = shortName; }
                }
            } catch (err) { console.error("Reverse geocode drag error", err); }
        });
    }
    selectionMap.setView(latLng, Math.max(selectionMap.getZoom(), 12));
}

// ── Nominatim autocomplete ────────────────────────────────
let autocompleteTimer = null;
export function attachAutocomplete(inputId, onPlace) {
    const input = document.getElementById(inputId);
    if (!input) return;

    const dropdown = document.createElement("div");
    dropdown.className = "autocomplete-dropdown hidden";
    input.parentNode.appendChild(dropdown);

    input.addEventListener("input", (e) => {
        clearTimeout(autocompleteTimer);
        const val = e.target.value.trim();
        if (val.length < 3) { dropdown.classList.add("hidden"); return; }

        autocompleteTimer = setTimeout(async () => {
            try {
                const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(val)}&countrycodes=IN&format=json&limit=5&email=broskisupport@gmail.com`, {
                    headers: { 'Accept-Language': 'en-US,en;q=0.9' }
                });
                const results = await res.json();
                dropdown.innerHTML = "";
                if (results.length === 0) { dropdown.classList.add("hidden"); return; }
                results.forEach(itemData => {
                    const item = document.createElement("div");
                    item.className = "autocomplete-item";
                    item.innerText = itemData.display_name;
                    item.onclick = () => {
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
            } catch (err) { console.error("Autocomplete fetch error", err); }
        }, 500);
    });

    document.addEventListener("click", (e) => {
        if (e.target !== input && !dropdown.contains(e.target)) dropdown.classList.add("hidden");
    });
}

// ── Route Share destination preview map ───────────────────
export async function showDestinationPreview(place) {
    const mapDiv = document.getElementById("rs-map-container");
    const etaWrap = document.getElementById("rs-eta-wrap");
    const etaText = document.getElementById("rs-eta-text");
    if (!mapDiv) return;

    mapDiv.classList.remove("hidden");
    if (mapInstances["rs-map-container"]) {
        mapInstances["rs-map-container"].map.remove();
        delete mapInstances["rs-map-container"];
    }

    const destLat = place.geometry.location.lat;
    const destLng = place.geometry.location.lng;
    const destCoords = [destLat, destLng];

    let originLat = CAMPUS_COORDS.lat;
    let originLng = CAMPUS_COORDS.lng;

    if (chosenFromPlace && chosenFromPlace.geometry && chosenFromPlace.geometry.location) {
        originLat = chosenFromPlace.geometry.location.lat;
        originLng = chosenFromPlace.geometry.location.lng;
    } else {
        const fromText = (document.getElementById("rs-from")?.value || "").trim();
        if (fromText.length > 2) {
            try {
                const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(fromText)}&countrycodes=IN&format=json&limit=1&email=broskisupport@gmail.com`, {
                    headers: { 'Accept-Language': 'en-US,en;q=0.9' }
                });
                const results = await res.json();
                if (results.length > 0) {
                    originLat = parseFloat(results[0].lat);
                    originLng = parseFloat(results[0].lon);
                    chosenFromPlace = {
                        geometry: { location: { lat: originLat, lng: originLng } },
                        formatted_address: results[0].display_name,
                        name: fromText
                    };
                }
            } catch (err) { console.warn("rs-from geocode error", err); }
        }
    }

    const originCoords = [originLat, originLng];
    const midLat = (originLat + destLat) / 2;
    const midLng = (originLng + destLng) / 2;
    const map = L.map(mapDiv, { zoomControl: false, dragging: false, scrollWheelZoom: false }).setView([midLat, midLng], 9);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    L.circleMarker(originCoords, { radius: 8, color: '#2ecc71', fillColor: '#2ecc71', fillOpacity: 1, weight: 2 }).bindTooltip('Start', { permanent: false }).addTo(map);
    L.circleMarker(destCoords, { radius: 8, color: '#f44336', fillColor: '#f44336', fillOpacity: 1, weight: 2 }).bindTooltip('Destination', { permanent: false }).addTo(map);
    mapInstances["rs-map-container"] = { map };
    setTimeout(() => { if (map) map.invalidateSize(); }, 300);

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
    } catch (err) { console.error("OSRM Route Error", err); }
}

// ── Generic route map drawer ──────────────────────────────
export async function drawRouteMap(containerId, origin, destination, onEta) {
    const mapDiv = document.getElementById(containerId);
    if (!mapDiv) return;

    mapDiv.classList.remove("hidden");
    if (mapInstances[containerId]) {
        mapInstances[containerId].map.remove();
        delete mapInstances[containerId];
    }

    const map = L.map(mapDiv, { zoomControl: false }).setView([origin.lat, origin.lng], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    mapInstances[containerId] = { map };
    setTimeout(() => { if (map) map.invalidateSize(); }, 300);

    L.circleMarker([origin.lat, origin.lng], { radius: 6, color: '#2ecc71', fillOpacity: 1 }).addTo(map);

    let destLng, destLat;
    if (typeof destination === 'string') {
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(destination)}&countrycodes=IN&format=json&limit=5&email=broskisupport@gmail.com`, {
                headers: { 'Accept-Language': 'en-US,en;q=0.9' }
            });
            const results = await res.json();
            if (results.length > 0) {
                destLat = parseFloat(results[0].lat);
                destLng = parseFloat(results[0].lon);
            } else {
                map.setView([origin.lat, origin.lng], 11);
                return;
            }
        } catch (e) { map.setView([origin.lat, origin.lng], 11); return; }
    } else {
        destLat = destination.lat;
        destLng = destination.lng;
    }

    L.circleMarker([destLat, destLng], { radius: 6, color: '#f44336', fillOpacity: 1 }).addTo(map);

    try {
        const routeData = await fetchRouteOSRM([origin.lng, origin.lat], [destLng, destLat]);
        if (routeData) {
            L.geoJSON(routeData.geometry, { style: { color: '#4e69e2', weight: 5, opacity: 0.8 } }).addTo(map);
            map.fitBounds(L.geoJSON(routeData.geometry).getBounds(), { padding: [30, 30] });
            if (onEta) onEta(routeData.durationText, routeData.distanceText);
        } else {
            map.setView([(origin.lat + destLat) / 2, (origin.lng + destLng) / 2], 10);
        }
    } catch (err) {
        map.setView([(origin.lat + destLat) / 2, (origin.lng + destLng) / 2], 10);
        console.error("drawRouteMap OSRM error", err);
    }
}

// ── OSRM helper ───────────────────────────────────────────
export async function fetchRouteOSRM(startLngLat, endLngLat) {
    const url = `https://router.project-osrm.org/route/v1/driving/${startLngLat[0]},${startLngLat[1]};${endLngLat[0]},${endLngLat[1]}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.routes && json.routes.length > 0) {
        const r = json.routes[0];
        const distKm = (r.distance / 1000).toFixed(1);
        const mins = Math.ceil(r.duration / 60);
        return { geometry: r.geometry, distanceText: `${distKm} km`, durationText: `${mins} mins` };
    }
    return null;
}
