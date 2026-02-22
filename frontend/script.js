const signup = document.getElementById('signup-page');
const login = document.getElementById('login-page');
const home = document.getElementById('home-page');

let isOnline = false; // Track the driver's current state

window.onload = function () {
    const savedUser = localStorage.getItem("user");
    // Reload the online status if it exists
    isOnline = localStorage.getItem("isOnline") === "true";

    if (savedUser) {
        goToHome();
        if (isOnline) showPage('driver'); // Send them back to their post if they were online
    } else {
        goToSignup();
    }
};

document.querySelectorAll(".neumorphic-btn").forEach(btn => {
    btn.addEventListener("keypress", function (e) {
        if (e.key === "Enter") this.click();
    });
});

let isMissionActive = false; // Track the Route Share state

function showPage(pageName) {
    const userData = JSON.parse(localStorage.getItem("user"));

    // 1. Online Lock Check
    if (typeof isOnline !== 'undefined' && isOnline && pageName !== 'driver') {
        alert("⚠️ You must go Offline before switching tabs.");
        return;
    }

    // ✅ Now 'userData' is defined, so this check won't crash
    if (pageName === 'driver-reg' && userData && userData.isCampusDriver) {
        showPage('home');
        return;
    }

    if (isMissionActive && pageName !== 'driver-command-center') {
        alert("⚠️ Active Trajectory! You must 'Abort Mission' before switching tabs.");
        return;
    }

    // ✅ Cleaned up the duplicates in this list
    const pages = [
        "home", "about", "trips", "support", "passenger", "driver", 
        "driver-reg", "profile", "settings", "driver-route-share", 
        "driver-command-center", "passenger-route-search"
    ];

    pages.forEach(p => {
        const el = document.getElementById("page-" + p);
        if (el) el.classList.add("hidden");
    });

    const activePage = document.getElementById("page-" + pageName);
    if (activePage) activePage.classList.remove("hidden");


    // 4. Update the red underline
    document.querySelectorAll(".nav-links a").forEach(link => {
        link.classList.remove("active");
    });
    const currentNav = document.getElementById("nav-" + pageName);
    if (currentNav) currentNav.classList.add("active");

    // 5. If profile, refresh data
    if (pageName === 'profile') {
        const userData = JSON.parse(localStorage.getItem("user"));
        if (userData) {
            document.getElementById("prof-name").innerText = userData.name;
            document.getElementById("prof-email").innerText = userData.email;
            document.getElementById("prof-gender").innerText = userData.gender || "Not Set";
        }
    }
}

function goToLogin() {
    signup.classList.add('hidden');
    login.classList.remove('hidden');
    home.classList.add('hidden');
    document.body.style.backgroundColor = "#4a5585";
}

function goToSignup() {
    login.classList.add('hidden');
    signup.classList.remove('hidden');
    home.classList.add('hidden');
    document.body.style.backgroundColor = "#4a5585";
}

function toggleSidebar() {
    const menu = document.getElementById("side-menu");
    const overlay = document.getElementById("sidebar-overlay");
    menu.classList.toggle("active");
    overlay.classList.toggle("hidden");

    if (menu.classList.contains("active")) {
        const userData = JSON.parse(localStorage.getItem("user"));
        if (userData) {
            document.getElementById("side-name").innerText = userData.name;
            document.getElementById("side-gender-display").innerText = "Gender: " + (userData.gender || "Not Set");
        }
    }
}

function goToHome() {
    login.classList.add('hidden');
    signup.classList.add('hidden');
    home.classList.remove('hidden');
    document.body.style.backgroundColor = "#b8c1ec";

    // Dynamic Name Update
    const userData = JSON.parse(localStorage.getItem("user"));
    if (userData && userData.name) {
        document.getElementById("nav-user-name").innerText = userData.name.split(' ')[0];
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

//Backend

function signupUser() {

    const name = document.getElementById("signup-name").value.trim();
    const email = document.getElementById("signup-email").value.trim();
    const password = document.getElementById("signup-password").value.trim();
    const gender = document.getElementById("signup-gender").value; // ✅ MUST ADD THIS LINE

    if (!name || !email || !password || !gender) {
        alert("Please fill all details, including gender");
        return;
    }

    // Now send all 4 fields to the backend
    fetch("https://campus-vehicle-project.onrender.com/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, gender })
    })
        .then(res => res.text())
        .then(data => {
            alert(data);
            goToLogin();
        })
        .catch(err => {
            alert("Something went wrong");
            console.log(err);
        })
        .finally(() => {
            btn.innerText = "Sign up";
            btn.disabled = false;
        });
}

function loginUser() {

    const btn = document.getElementById("login-btn");
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value.trim();

    if (!email || !password) {
        alert("Please enter email and password");
        return;
    }

    fetch("https://campus-vehicle-project.onrender.com/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
    })
        .then(res => res.json())
        .then(data => {
            if (data.message === "Login successful") {
                // ✅ This now stores the FULL object including gender
                localStorage.setItem("user", JSON.stringify(data));
                alert("Welcome " + data.name);
                goToHome();
                showPage('home');
            } else {
                alert("Invalid credentials");
            }
        })
        .catch(err => console.log(err));
}

async function updateGenderInDB(newGender) {
    const userData = JSON.parse(localStorage.getItem("user"));
    if (!userData || !userData.email) return;

    try {
        // 1. Update the backend
        const response = await fetch("https://campus-vehicle-project.onrender.com/update-profile", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: userData.email,
                gender: newGender
            })
        });

        if (response.ok) {
            // 2. Update local storage so it stays after refresh
            userData.gender = newGender;
            localStorage.setItem("user", JSON.stringify(userData));

            // 3. Update the sidebar display
            const sideGender = document.getElementById("side-gender-display");
            if (sideGender) sideGender.innerText = "Gender: " + newGender;

            alert("Gender updated successfully!");
        } else {
            alert("Failed to update gender on server.");
        }
    } catch (err) {
        console.error("Update Error:", err);
        alert("Server connection error.");
    }
}

let currentMainMode = ''; // To track if we are in 'passenger' or 'driver'

function enterPassenger() {
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

    // Simple validation
    if (!routeData.destination || !routeData.seats || !routeData.time || !routeData.fare) {
        alert("⚠️ All parameters are required!");
        return;
    }

    fetch("https://campus-vehicle-project.onrender.com/publish-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(routeData)
    })
        .then(res => res.json())
        .then(data => {
            alert("🚀 Trajectory Published!");
            isMissionActive = true; // 🔒 Lock the navigation

            document.getElementById("cc-destination").innerText = document.getElementById("rs-destination").value;
            document.getElementById("cc-seats").innerText = `0/${document.getElementById("rs-seats").value}`;
            document.getElementById("cc-fare").innerText = `$${document.getElementById("rs-fare").value}`;

            showPage('driver-command-center');
        })
}

function acceptPassenger(passengerEmail) {
    const userData = JSON.parse(localStorage.getItem("user"));

    fetch("https://campus-vehicle-project.onrender.com/accept-passenger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            driverEmail: userData.email,
            passengerEmail: passengerEmail
        })
    })
        .then(res => res.json())
        .then(data => {
            alert("🤝 Mission Linked! Passenger added to your trajectory.");
            // Refresh the UI to show one less seat available
            document.getElementById("cc-seats").innerText = `${data.bookedSeats}/${data.totalSeats}`;
        })
        .catch(err => console.error("Link Error:", err));
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

    fetch("https://campus-vehicle-project.onrender.com/update-driver-status", {
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

    if (query.length < 3) {
        container.innerHTML = `<p style="color: #888; text-align: center; font-size: 14px;">Keep typing...</p>`;
        return;
    }

    fetch(`https://campus-vehicle-project.onrender.com/search-routes?destination=${query}`)
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
                    <div style="color: #4e69e2; font-weight: 800;">$${ride.fare.toFixed(2)}</div>
                </div>
                <div style="font-size: 12px; color: #666; margin: 5px 0;">Time: ${ride.time} | Seats: ${ride.seats} left</div>
                <button class="btn-primary" style="margin: 10px 0 0 0; padding: 8px;" onclick="requestJoinRide('${ride._id}')">Request to Join</button>
            </div>
        `).join('');
        });
}

function requestJoinRide(rideId) {
    const userData = JSON.parse(localStorage.getItem("user"));

    fetch("https://campus-vehicle-project.onrender.com/request-ride", {
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
            // We can show a 'Pending' status on the button now
        })
        .catch(err => alert("Error sending request."));
}

function toggleShift() {
    const statusDot = document.getElementById("driver-status-indicator");
    const btn = document.getElementById("toggle-shift-btn");
    const instruction = document.getElementById("driver-instruction");
    const backBtn = document.getElementById("driver-back-btn");
    const card = document.getElementById("driver-card");

    if (!isOnline) {
        // --- GOING ONLINE ---
        isOnline = true;
        localStorage.setItem("isOnline", "true"); // Save state

        statusDot.innerText = "● Online";
        statusDot.style.color = "#2ecc71"; // Green

        btn.innerText = "End Shift";
        btn.style.background = "#f44336"; // Red

        instruction.innerText = "You are visible to passengers. Stay on this page to receive requests.";
        card.style.borderBottom = "4px solid #2ecc71";

        // Lock the Back Button UI
        backBtn.style.opacity = "0.5";
        backBtn.style.cursor = "not-allowed";

        console.log("Driver status: Online. Navigation locked.");
    } else {
        // --- GOING OFFLINE ---
        isOnline = false;
        localStorage.setItem("isOnline", "false"); // Save state

        statusDot.innerText = "● Offline";
        statusDot.style.color = "#f44336"; // Red

        btn.innerText = "Go Online";
        btn.style.background = "#2ecc71"; // Green

        instruction.innerText = "You are currently invisible to passengers.";
        card.style.borderBottom = "none";

        // Unlock the Back Button UI
        backBtn.style.opacity = "1";
        backBtn.style.cursor = "pointer";

        console.log("Driver status: Offline. Navigation unlocked.");
    }
}

function startRequestPoller() {
    const userData = JSON.parse(localStorage.getItem("user"));

    const poller = setInterval(() => {
        if (!isMissionActive) {
            clearInterval(poller);
            return;
        }

        fetch(`https://campus-vehicle-project.onrender.com/get-ride-requests?driverEmail=${userData.email}`)
            .then(res => res.json())
            .then(requests => {
                const container = document.getElementById("cc-requests-container");
                if (requests.length === 0) return;

                container.innerHTML = requests.map(req => `
                <div class="glass-card" style="margin: 10px 0; padding: 12px; display: flex; justify-content: space-between; align-items: center; border-left: 4px solid #4e69e2;">
                    <div>
                        <div style="font-weight: bold; color: #222;">${req.name}</div>
                        <div style="font-size: 11px; color: #666;">Wants to join</div>
                    </div>
                    <button class="btn-primary" style="width: auto; padding: 5px 15px; background: #2ecc71;" onclick="acceptPassenger('${req.email}')">Link</button>
                </div>
            `).join('');
            });
    }, 5000); // Checks every 5 seconds
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

function cancelTrajectory() {
    // Confirmation prevents accidental clicks
    if (confirm("Are you sure you want to abort this trajectory? Passengers will be notified.")) {

        // 🔓 Step 1: Release the lock
        isMissionActive = false;

        // 🧹 Step 2: Clear the UI data for the next mission
        document.getElementById("cc-destination").innerText = "---";
        document.getElementById("cc-seats").innerText = "0/0";
        document.getElementById("cc-fare").innerText = "$0.00";

        alert("Mission Aborted. Navigation Unlocked.");

        // 🏠 Step 3: Go back home
        showPage('home');
    }
}

function logout() {
    // Check if the driver is currently online
    if (isOnline || isMissionActive) {
        alert("⚠️ You cannot logout while a shift or mission is Active.");
        return;
    }

    // 1. Force Sidebar to close on logout
    const menu = document.getElementById("side-menu");
    const overlay = document.getElementById("sidebar-overlay");
    if (menu) menu.classList.remove("active");
    if (overlay) overlay.classList.add("hidden");
    // If not online, proceed with standard logout
    localStorage.removeItem("user");

    // Clear all inputs for the next user
    clearAllInputs();

    // Reset all pages to hidden
    const pages = ["home", "about", "trips", "support", "passenger", "driver", "driver-reg", "profile", "settings"];
    pages.forEach(p => {
        const el = document.getElementById("page-" + p);
        if (el) el.classList.add("hidden");
    });

    goToSignup();
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
