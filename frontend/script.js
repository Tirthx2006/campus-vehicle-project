const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const API_BASE_URL = isLocal
    ? "http://localhost:5000"
    : "https://campus-vehicle-project.onrender.com";

const signup = document.getElementById('signup-page');
const login = document.getElementById('login-page');
const home = document.getElementById('home-page');

let isOnline = false;
let isMissionActive = false;
let requestPoller = null; // Store interval ID
let statusPoller = null;  // Store interval ID
let quickRequestPoller = null;
let routeSearchPoller = null;
let passengerStatusPoller = null;

window.onload = function () {
    const savedUser = localStorage.getItem("user");
    isOnline = localStorage.getItem("isOnline") === "true";
    isMissionActive = localStorage.getItem("isMissionActive") === "true";

    if (savedUser) {
        goToHome();
        syncDriverUI();

        if (isMissionActive) {
            showPage('driver-command-center');
            startRequestPoller();

            // Re-fetch UI data so it doesn't say "---" and "0/0"
            const userData = JSON.parse(savedUser);
            fetch(`${API_BASE_URL}/get-ride-requests?driverEmail=${userData.email}`)
                .then(res => res.json())
                .then(requests => {
                    // Just triggering the poller will fetch the requests, but ideally 
                    // we'd have a backend route to fetch the destination and seats too!
                    document.getElementById("cc-destination").innerText = "Resumed Trajectory";
                })
                .catch(() => {
                    // If it completely fails, unlock them
                    localStorage.removeItem("isMissionActive");
                    showPage('home');
                });
        }
    } else {
        goToSignup();
    }
};

function syncDriverUI() {
    const statusDot = document.getElementById("driver-status-indicator");
    const btn = document.getElementById("toggle-shift-btn");
    const backBtn = document.getElementById("driver-back-btn");

    if (statusDot && btn) {
        statusDot.innerText = isOnline ? "● Online" : "● Offline";
        statusDot.style.color = isOnline ? "#2ecc71" : "#f44336";
        btn.innerText = isOnline ? "End Shift" : "Go Online";
        btn.style.background = isOnline ? "#f44336" : "#2ecc71";

        if (backBtn) {
            backBtn.style.opacity = isOnline ? "0.5" : "1";
            backBtn.style.cursor = isOnline ? "not-allowed" : "pointer";
        }
    }
}

function showPage(pageName) {
    const userData = JSON.parse(localStorage.getItem("user"));

    if (isOnline && pageName !== 'driver' && !isMissionActive) {
        alert("⚠️ You must go Offline before switching tabs.");
        return;
    }

    if (isMissionActive && pageName !== 'driver-command-center' && pageName !== 'profile') {
        alert("⚠️ Active Trajectory! You must 'Abort Mission' before switching tabs.");
        return;
    }

    const pages = [
        "home", "about", "trips", "support", "passenger", "driver",
        "driver-reg", "profile", "settings", "driver-route-share",
        "driver-command-center", "passenger-route-search",
        "passenger-mission-status"
    ];

    pages.forEach(p => {
        const el = document.getElementById("page-" + p);
        if (el) el.classList.add("hidden");
    });

    const activePage = document.getElementById("page-" + pageName);
    if (activePage) activePage.classList.remove("hidden");

    document.querySelectorAll(".nav-links a").forEach(link => link.classList.remove("active"));
    const currentNav = document.getElementById("nav-" + pageName);
    if (currentNav) currentNav.classList.add("active");

    if (pageName === 'profile' && userData) {
        document.getElementById("prof-name").innerText = userData.name;
        document.getElementById("prof-email").innerText = userData.email;
        const genSelect = document.getElementById("edit-gender");
        if (genSelect) genSelect.value = userData.gender || "Male";
    }
}
//----------------------------------- loading buttonsss--------------------
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

// ------------------------------ AUTH LOGIC ------------------------------------------------
function signupUser() {
    const name = document.getElementById("signup-name").value.trim();
    const email = document.getElementById("signup-email").value.trim();
    const password = document.getElementById("signup-password").value.trim();
    const gender = document.getElementById("signup-gender").value;

    if (!name || !email || !password || !gender) {
        alert("Please fill all details");
        return;
    }

    toggleButtonLoading("signup-btn", true, "Sign up");

    fetch(`${API_BASE_URL}/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, gender })
    })
        .then(res => res.status === 201 ? res.text() : Promise.reject(res.text()))
        .then(data => {
            alert(data);
            goToLogin();
        })
        .catch(err => alert("Registration Failed: User might already exist."))
        .finally(() => toggleButtonLoading("signup-btn", false, "Sign up"));
}

function loginUser() {
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value.trim();

    if (!email || !password) return alert("Missing credentials");

    toggleButtonLoading("login-btn", true, "Log In");

    fetch(`${API_BASE_URL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
    })
        .then(res => res.json())
        .then(data => {
            if (data.message === "Login successful") {
                localStorage.setItem("user", JSON.stringify(data));
                goToHome();
                showPage('home');
            } else {
                alert("Invalid credentials");
            }
        })
        .catch(() => alert("Server unreachable"))
        .finally(() => toggleButtonLoading("login-btn", false, "Log In"));
}

function goToLogin() {
    // We use the variables defined at the top
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

// --- DRIVER MISSION LOGIC ---
function publishRoute() {
    const userData = JSON.parse(localStorage.getItem("user"));
    const routeData = {
        driverEmail: userData.email,
        driverName: userData.name,
        destination: document.getElementById("rs-destination").value.trim(),
        seats: document.getElementById("rs-seats").value,
        time: document.getElementById("rs-time").value,
        fare: document.getElementById("rs-fare").value.trim()
    };

    if (!routeData.destination || !routeData.seats || !routeData.fare) return alert("Fill all fields");

    fetch(`${API_BASE_URL}/publish-route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(routeData)
    })
        .then(res => res.json())
        .then(() => {
            isMissionActive = true;
            localStorage.setItem("isMissionActive", "true");
            document.getElementById("cc-destination").innerText = routeData.destination;
            document.getElementById("cc-seats").innerText = `0/${routeData.seats}`;
            document.getElementById("cc-fare").innerText = `$${routeData.fare}`;
            showPage('driver-command-center');
            startRequestPoller();
        });
}

function startRequestPoller() {
    if (requestPoller) clearInterval(requestPoller);
    const userData = JSON.parse(localStorage.getItem("user"));
    requestPoller = setInterval(() => {
        fetch(`${API_BASE_URL}/get-ride-requests?driverEmail=${userData.email}`)
            .then(res => res.json())
            .then(requests => {
                const container = document.getElementById("cc-requests-container");
                if (requests.length === 0) {
                    container.innerHTML = `<p style="color:#888; font-size:14px;">Scanning for students...</p>`;
                    return;
                }
                container.innerHTML = requests.map(req => `
                <div class="glass-card" style="margin: 10px 0; padding: 12px; display: flex; justify-content: space-between; align-items: center; border-left: 4px solid #4e69e2;">
                    <div style="text-align:left;">
                        <div style="font-weight: bold; color: #222;">${req.name}</div>
                        <div style="font-size: 11px; color: #666;">Status: ${req.status}</div>
                    </div>
                    ${req.status === 'pending' ? `<button class="btn-primary" style="width: auto; padding: 5px 15px; background: #2ecc71;" onclick="acceptPassenger('${req.email}')">Link</button>` : '<span>Linked</span>'}
                </div>`).join('');
            });
    }, 4000);
}

// Bulletproof Abort Mission
function cancelTrajectory() {
    if (confirm("Abort Mission? This will cancel the trajectory for all passengers.")) {
        const userData = JSON.parse(localStorage.getItem("user"));

        fetch(`${API_BASE_URL}/cancel-route`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ driverEmail: userData.email })
        })
            .then(res => res.json())
            .catch(err => console.log("Backend error, forcing frontend unlock anyway."))
            .finally(() => {
                // ALWAYS run this cleanup, even if the backend failed
                if (requestPoller) clearInterval(requestPoller);
                isMissionActive = false;
                localStorage.removeItem("isMissionActive");

                const reqContainer = document.getElementById("cc-requests-container");
                if (reqContainer) reqContainer.innerHTML = `<p style="color:#888; font-size:14px;">Scanning for students...</p>`;

                showPage('home');
            });
    }
}

// Bulletproof Finish Journey
function completeTrajectory() {
    if (confirm("Have you reached the destination? This will complete the mission.")) {
        const userData = JSON.parse(localStorage.getItem("user"));

        fetch(`${API_BASE_URL}/complete-route`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ driverEmail: userData.email })
        })
            .then(res => res.json())
            .catch(err => console.log("Backend error, forcing frontend unlock anyway."))
            .finally(() => {
                // ALWAYS run this cleanup
                if (requestPoller) clearInterval(requestPoller);
                isMissionActive = false;
                localStorage.removeItem("isMissionActive");

                const reqContainer = document.getElementById("cc-requests-container");
                if (reqContainer) reqContainer.innerHTML = `<p style="color:#888; font-size:14px;">Scanning for students...</p>`;

                alert("🏁 Journey Completed!");
                showPage('home');
            });
    }
}

// --- UTILS ---
function toggleSidebar() {
    const menu = document.getElementById("side-menu");
    const overlay = document.getElementById("sidebar-overlay");
    menu.classList.toggle("active");
    overlay.classList.toggle("hidden");
    if (menu.classList.contains("active")) {
        const userData = JSON.parse(localStorage.getItem("user"));
        document.getElementById("side-name").innerText = userData.name;
        document.getElementById("side-gender-display").innerText = "Gender: " + (userData.gender || "Not Set");
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

async function updateGenderInDB(newGender) {
    const userData = JSON.parse(localStorage.getItem("user"));
    if (!userData || !userData.email) return;

    // Use a small label or text feedback for the dropdown since it's not a button
    const statusLabel = document.createElement("span");
    statusLabel.innerText = " Saving...";
    statusLabel.style.fontSize = "12px";
    statusLabel.style.color = "#4e69e2";
    document.getElementById("edit-gender").after(statusLabel);

    try {
        const response = await fetch(`${API_BASE_URL}/update-profile`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: userData.email, gender: newGender })
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

let currentMainMode = ''; // To track if we are in 'passenger' or 'driver'

function enterPassenger() {
    // Check if they are already in a ride!
    if (localStorage.getItem("passengerActiveRide")) {
        alert("⚠️ You are already in an active trajectory!");
        showPage('passenger-mission-status');
        return;
    }

    currentMainMode = 'passenger';
    showBranchSelection("Choose your Destination Scope");
}

function enterDriver() {
    const userData = JSON.parse(localStorage.getItem("user"));
    if (!userData) return goToLogin();

    // Check if they are already verified in the database
    if (userData.isCampusDriver === true) {
        currentMainMode = 'driver';
        showBranchSelection("Set your Driving Scope");
    } else {
        // If they are new, send them to the registration form
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
        // ✅ This MUST match the ID in your front.html
        showPage(currentMainMode === 'driver' ? 'driver-route-share' : 'passenger-route-search');
    }
}


// ✅ Add the Passenger Status Poller
function startPassengerStatusPoller(rideId) {
    const userData = JSON.parse(localStorage.getItem("user"));
    if (passengerStatusPoller) clearInterval(passengerStatusPoller);

    passengerStatusPoller = setInterval(() => {
        fetch(`${API_BASE_URL}/get-my-request-status?rideId=${rideId}&email=${userData.email}`)
            .then(res => res.json())
            .then(data => {
                if (data.status === 'accepted') {
                    // Driver Accepted
                    const orb = document.getElementById("ps-status-orb");
                    if (orb) orb.className = "pulse-orb accepted";
                    document.getElementById("ps-status-text").innerText = "Mission Confirmed! Meet your Driver.";
                }
                else if (data.status === 'driver_ended' || data.status === 'kicked') {
                    // 🚨 DRIVER ABORTED OR FINISHED
                    alert("🛑 The driver has ended this trajectory. Returning to home.");
                    forceClearPassengerState();
                }
            })
            .catch(err => console.log("Waiting for radar connection..."));
    }, 4000); // Checks every 4 seconds
}

// Passenger clicks "Finish / Leave Journey"
function endPassengerJourney() {
    if (confirm("Are you sure you want to leave this trajectory?")) {
        const rideId = localStorage.getItem("passengerActiveRide");
        const userData = JSON.parse(localStorage.getItem("user"));

        // Tell the backend to give the driver their seat back
        if (rideId) {
            fetch(`${API_BASE_URL}/leave-ride`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rideId, passengerEmail: userData.email })
            }).catch(err => console.log("Cleanup request failed, but clearing local state anyway."));
        }

        alert("🚪 You have left the trajectory.");
        forceClearPassengerState();
    }
}

// Universal Cleanup Function for the Passenger
function forceClearPassengerState() {
    // 1. Stop all background polling
    if (passengerStatusPoller) {
        clearInterval(passengerStatusPoller);
        passengerStatusPoller = null;
    }

    // 2. Remove the ride lock
    localStorage.removeItem("passengerActiveRide");

    // 3. Reset the UI for next time
    const orb = document.getElementById("ps-status-orb");
    if (orb) orb.className = "pulse-orb pending";
    const text = document.getElementById("ps-status-text");
    if (text) text.innerText = "Awaiting Driver Response...";

    // 4. Send them home
    showPage('home');
}

// ✅ Update requestJoinRide to start the poller
function requestJoinRide(rideId) {
    localStorage.setItem("passengerActiveRide", rideId);
    if (routeSearchPoller) clearInterval(routeSearchPoller);

    const userData = JSON.parse(localStorage.getItem("user"));

    fetch(`${API_BASE_URL}/request-ride`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            rideId: rideId,
            passengerEmail: userData.email,
            passengerName: userData.name
        })
    })
        .then(res => res.json())
        .then(data => {
            alert("✉️ Request sent! Waiting for driver to 'Link' with you.");
            showPage('passenger-mission-status'); // Navigate to the status page
            startPassengerStatusPoller(rideId); // 🕵️‍♂️ Start watching for driver's approval
        });
}

// Scanner for inside-campus quick drops
// Scanner for inside-campus quick drops (Driver Side)
function startQuickRequestScanner() {
    if (quickRequestPoller) clearInterval(quickRequestPoller);

    const userData = JSON.parse(localStorage.getItem("user"));
    const container = document.getElementById("request-container");

    // 1. Create the fetch logic as a standalone function
    const fetchRequests = () => {
        fetch(`${API_BASE_URL}/get-quick-requests?driverEmail=${userData.email}`)
            .then(res => res.json())
            .then(requests => {
                if (!container) return;

                if (requests.length === 0) {
                    container.innerHTML = `<p style="color:#888; font-size:14px;">Scanning for nearby students...</p>`;
                    return;
                }

                container.innerHTML = requests.map(req => `
                    <div class="glass-card" style="margin: 10px 0; padding: 15px; border-left: 4px solid #f1c40f; text-align: left;">
                        <div style="font-weight: bold; color: #222; font-size: 16px;">${req.passengerName}</div>
                        <div style="font-size: 13px; color: #555; margin: 8px 0;">
                            <strong>From:</strong> ${req.pickup} <br>
                            <strong>To:</strong> ${req.drop}
                        </div>
                        <button class="btn-primary" style="background: #2ecc71; width: 100%; padding: 10px; margin-top: 10px;" 
                                onclick="acceptQuickDrop('${req._id}')">
                            Accept Request
                        </button>
                    </div>
                `).join('');
            })
            .catch(err => console.error("Quick scan error:", err));
    };

    // 2. Show an instant loading state
    if (container) {
        container.innerHTML = `<p style="color:#4e69e2; font-size:14px;"><span class="loading-spinner"></span> Initializing radar...</p>`;
    }

    // 3. Run it immediately once, THEN start the 4-second loop
    fetchRequests();
    quickRequestPoller = setInterval(fetchRequests, 4000);
}

// Driver clicks Accept
function acceptQuickDrop(requestId) {
    fetch(`${API_BASE_URL}/accept-quick-drop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId })
    })
        .then(res => res.json())
        .then(data => {
            alert("🤝 Request Accepted! Proceed to the pickup coordinates.");
            // The scanner will automatically remove this from the list on its next tick
        })
        .catch(err => alert("Failed to accept request."));
}

function acceptPassenger(passengerEmail) {
    const userData = JSON.parse(localStorage.getItem("user"));

    fetch(`${API_BASE_URL}/accept-passenger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driverEmail: userData.email, passengerEmail: passengerEmail })
    })
        .then(async res => {
            const data = await res.json();
            // If the backend threw an error (like "No seats available"), trigger the catch block
            if (!res.ok) throw new Error(data.message || "Failed to link");
            return data;
        })
        .then(data => {
            alert("🤝 Mission Linked! Passenger added to your trajectory.");
            document.getElementById("cc-seats").innerText = `${data.bookedSeats}/${data.totalSeats}`;

            // If the car is full, tell the driver and clear the request list!
            if (data.bookedSeats >= data.totalSeats) {
                alert("🚐 Trajectory Full! You have reached maximum capacity.");
                document.getElementById("cc-requests-container").innerHTML = `
                <div style="padding: 20px; background: rgba(46, 204, 113, 0.2); border-radius: 15px; color: #2ecc71; font-weight: bold;">
                    Vehicle is Full. Ready for departure!
                </div>`;
            }
        })
        .catch(err => alert("⚠️ " + err.message));
}


function submitDriverRegistration() {
    const details = {
        license: document.getElementById("reg-license").value,
        model: document.getElementById("reg-vehicle-model").value,
        vNum: document.getElementById("reg-vehicle-num").value,
        agreed: document.getElementById("reg-terms").checked
    };

    if (!details.license || !details.model || !details.vNum || !details.agreed) {
        alert("Please fill all fields and agree to the terms.");
        return;
    }

    const userData = JSON.parse(localStorage.getItem("user"));

    fetch(`${API_BASE_URL}/update-driver-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            email: userData.email,
            ...details
        })
    })
        .then(res => res.json())
        .then(data => {
            userData.isCampusDriver = true;
            localStorage.setItem("user", JSON.stringify(userData));
            alert("Account Verified Successfully!");
            enterDriver();
        })
        .catch(err => alert("Registration failed. Please try again later."));
}

function searchActiveRoutes() {
    const query = document.getElementById("ps-search-destination").value.trim();
    const container = document.getElementById("search-results-container");

    // If they delete their search, stop polling and show message
    if (query.length < 3) {
        if (routeSearchPoller) clearInterval(routeSearchPoller);
        container.innerHTML = `<p style="color: #888; text-align: center; font-size: 14px;">Keep typing...</p>`;
        return;
    }

    // Wrap the fetch in a function so we can loop it
    const fetchRoutes = () => {
        fetch(`${API_BASE_URL}/search-routes?destination=${query}`)
            .then(res => res.json())
            .then(rides => {
                if (rides.length === 0) {
                    container.innerHTML = `<p style="color: #888; text-align: center; font-size: 14px;">No trajectories found for this route.</p>`;
                    return;
                }

                container.innerHTML = rides.map(ride => `
                <div class="glass-card" style="margin: 10px 0; padding: 15px; text-align: left; border: 1px solid rgba(78, 105, 226, 0.3);">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div style="font-weight: bold; color: #222;">${ride.driverName}</div>
                        <div style="color: #4e69e2; font-weight: 800;">₹${ride.fare.toFixed(2)}</div>
                    </div>
                    <div style="font-size: 12px; color: #666; margin: 5px 0;">Time: ${ride.time} | Seats: ${ride.seats} left</div>
                    <button class="btn-primary" style="margin: 10px 0 0 0; padding: 8px;" onclick="requestJoinRide('${ride._id}')">Request to Join</button>
                </div>
                `).join('');
            })
            .catch(err => console.error("Search error:", err));
    };

    // Run it instantly the first time
    fetchRoutes();

    // Start the Live Radar (Refresh every 5 seconds)
    if (routeSearchPoller) clearInterval(routeSearchPoller);
    routeSearchPoller = setInterval(fetchRoutes, 5000);
}

function searchCampusDrivers() {
    // Show a loading state on the results container
    const container = document.getElementById("request-container");
    container.innerHTML = `<span class="loading-spinner"></span> Scanning for active beacons...`;

    fetch(`${API_BASE_URL}/search-campus-drivers`)
        .then(res => res.json())
        .then(drivers => {
            if (drivers.length === 0) {
                container.innerHTML = `<p>No active drivers found. Try again in a moment.</p>`;
                return;
            }
            // Display drivers (we'll build the UI for this next)
            console.log("Active Drivers Found:", drivers);
        });
}


async function toggleShift() {
    const userData = JSON.parse(localStorage.getItem("user"));
    const btn = document.getElementById("toggle-shift-btn");

    const targetStatus = !isOnline;
    const originalText = isOnline ? "End Shift" : "Go Online";

    toggleButtonLoading("toggle-shift-btn", true, originalText);

    try {
        const response = await fetch(`${API_BASE_URL}/toggle-online`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: userData.email, status: targetStatus })
        });

        if (response.ok) {
            isOnline = targetStatus;
            localStorage.setItem("isOnline", isOnline.toString());
            syncDriverUI();

            if (isOnline) {
                startQuickRequestScanner();
            } else {
                if (quickRequestPoller) {
                    clearInterval(quickRequestPoller);
                    quickRequestPoller = null;
                }
                // INSTANTLY reset the UI when going offline
                const container = document.getElementById("request-container");
                if (container) {
                    container.innerHTML = `<p>Go online to see requests.</p>`;
                }
            }
        }
    } catch (err) {
        console.error("Toggle Sync Error:", err);
        alert("Connection Interrupted: Could not reach Command Center.");
    } finally {
        toggleButtonLoading("toggle-shift-btn", false, isOnline ? "End Shift" : "Go Online");
    }
}

async function searchCampusDrivers() {
    const pickup = document.getElementById("qp-pickup").value.trim();
    const drop = document.getElementById("qp-drop").value.trim();
    const resultsContainer = document.getElementById("campus-drivers-results");

    if (!pickup || !drop) return alert("Identify your coordinates (Pickup & Drop) first.");

    // Start Loading State
    toggleButtonLoading("search-campus-btn", true, "Scanning...");
    resultsContainer.innerHTML = `<p style="text-align:center; color:#4e69e2;">📡 Pinging nearby units...</p>`;

    try {
        const response = await fetch(`${API_BASE_URL}/search-campus-drivers`);
        const drivers = await response.json();

        if (drivers.length === 0) {
            resultsContainer.innerHTML = `<p style="text-align:center; font-size:14px; color:#888;">No active units found in your sector.</p>`;
        } else {
            resultsContainer.innerHTML = drivers.map(driver => `
                <div class="glass-card" style="margin: 10px 0; padding: 15px; border-left: 4px solid #2ecc71; text-align:left;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <div style="font-weight:bold; color:#222;">${driver.name}</div>
                            <div style="font-size:12px; color:#666;">${driver.driverDetails.vehicleModel} • ${driver.gender}</div>
                        </div>
                        <button class="btn-primary" style="width:auto; padding:8px 15px; margin:0;" 
                                onclick="initiateQuickRide('${driver.email}', '${driver.name}')">
                            Request
                        </button>
                    </div>
                </div>
            `).join('');
        }
    } catch (err) {
        resultsContainer.innerHTML = `<p style="color:red;">Signal lost. Retry scan.</p>`;
    } finally {
        toggleButtonLoading("search-campus-btn", false, "Scan for Active Beacons");
    }
}

// Logic to "Handshake" with a specific Campus Driver
// Logic to "Handshake" with a specific Campus Driver
function initiateQuickRide(driverEmail, driverName) {
    const userData = JSON.parse(localStorage.getItem("user"));
    const pickup = document.getElementById("qp-pickup").value.trim();
    const drop = document.getElementById("qp-drop").value.trim();

    fetch(`${API_BASE_URL}/request-quick-drop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            passengerEmail: userData.email,
            passengerName: userData.name,
            driverEmail: driverEmail,
            pickup: pickup,
            drop: drop
        })
    })
        .then(res => res.json())
        .then(data => {
            alert(`✉️ Request transmitted to ${driverName}. Awaiting link confirmation...`);
            showPage('passenger-mission-status');
            startQuickDropStatusPoller(data.requestId);
        })
        .catch(err => {
            console.error("TRANSMIT ERROR:", err);
            alert("Failed to transmit. Check the browser console (F12) for details!");
        });
}

// Poller for Passenger to wait for Driver's approval
let quickDropPoller = null;
function startQuickDropStatusPoller(requestId) {
    if (quickDropPoller) clearInterval(quickDropPoller);

    quickDropPoller = setInterval(() => {
        fetch(`${API_BASE_URL}/quick-drop-status?requestId=${requestId}`)
            .then(res => res.json())
            .then(data => {
                if (data.status === 'accepted') {
                    clearInterval(quickDropPoller);
                    const orb = document.getElementById("ps-status-orb");
                    if (orb) orb.className = "pulse-orb accepted";
                    document.getElementById("ps-status-text").innerText = "Mission Confirmed! Meet your Driver.";
                    alert("🤝 Handshake Complete! Your driver is en route.");
                }
            });
    }, 3000); // Check every 3 seconds
}

// Custom Back Function to handle the lock
function exitDriverMode() {
    if (isOnline) {
        alert("⚠️ Active Shift! You must click 'End Shift' before leaving this tab.");
        return;
    }
    showPage('home');
}


function clearAllInputs() {
    // Find every input tag in the document and set its value to empty
    const inputs = document.querySelectorAll('input');
    inputs.forEach(input => {
        input.value = "";
    });
}

// --- UPDATED LOGOUT LOGIC ---
function logout() {
    // Check if the driver is currently online
    if (isOnline || isMissionActive) {
        alert("⚠️ You cannot logout while a shift or mission is Active.");
        return;
    }

    // Show custom modal instead of browser confirm
    document.getElementById("logout-modal").classList.remove("hidden");
}

function closeLogoutModal() {
    document.getElementById("logout-modal").classList.add("hidden");
}

function confirmLogout() {
    localStorage.clear();

    // Force UI Reset
    const menu = document.getElementById("side-menu");
    const overlay = document.getElementById("sidebar-overlay");
    if (menu) menu.classList.remove("active");
    if (overlay) overlay.classList.add("hidden");

    // Clear inputs and reload
    clearAllInputs();
    window.location.reload();
}

function handleEnter(event, buttonId) {
    if (event.key === "Enter") {
        // Prevent the default action (like page refresh)
        event.preventDefault();
        // Trigger the button element with a click
        document.getElementById(buttonId).click();
    }
}

// Attach listeners to your inputs
document.getElementById("signup-password").addEventListener("keypress", function (e) {
    handleEnter(e, "signup-btn");
});

document.getElementById("login-password").addEventListener("keypress", function (e) {
    // Make sure your Login button has an id="login-btn"
    handleEnter(e, "login-btn");
});

// 🚨 THE GHOST PROTOCOL: Fire a beacon when the tab closes
window.addEventListener("beforeunload", function () {
    const userData = JSON.parse(localStorage.getItem("user"));
    const missionActive = localStorage.getItem("isMissionActive") === "true";
    const currentlyOnline = localStorage.getItem("isOnline") === "true";

    // If they are a driver and they close the tab while active or online
    if (userData && (missionActive || currentlyOnline)) {
        const payload = JSON.stringify({ driverEmail: userData.email });

        // sendBeacon doesn't wait for a response, it just fires and forgets
        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon(`${API_BASE_URL}/emergency-cleanup`, blob);
    }
});