require('dotenv').config();
const bcrypt = require("bcrypt");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const http = require("http");
const { Server } = require("socket.io");
const rateLimit = require("express-rate-limit");

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: "Too many attempts from this IP, please try again later." });
const requestLimiter = rateLimit({ windowMs: 1 * 60 * 1000, max: 5, message: "Too many requests from this IP, please try again." });

console.log("=== THE BACKEND FILE IS RUNNING ===");
console.log("DEBUG: Testing MONGO_URI value ->", process.env.MONGO_URI ? "Found ✅" : "NOT FOUND ❌");
console.log("DEBUG: Testing JWT_SECRET value ->", process.env.JWT_SECRET ? "Found ✅" : "NOT FOUND ❌");

const nodemailer = require("nodemailer");

// Initialize the transporter HERE, in the global scope
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));  // Allow base64-encoded QR images

// ─────────────────────────────────────────────────────────
// SOCKET.IO SETUP
// Attach Socket.io to a raw HTTP server (not app.listen)
// ─────────────────────────────────────────────────────────
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error("Authentication error"));

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded; // Now socket.user.email is verified
    next();
  } catch (err) {
    next(new Error("Invalid token"));
  }
});

// ─────────────────────────────────────────────────────────
// DISCONNECT GRACE TIMERS
// If a user disconnects, we wait 30 s before acting.
// If they reconnect within that window the timer is cancelled.
// ─────────────────────────────────────────────────────────
const disconnectTimers = new Map(); // email → NodeJS timer id

io.on("connection", (socket) => {
  // Join room automatically based on verified email from token
  const userEmail = socket.user.email;
  socket.join(userEmail);
  console.log(`Verified Socket: ${userEmail} connected.`);

  // ── Cancel any pending disconnect timer ──────────────────
  if (disconnectTimers.has(userEmail)) {
    clearTimeout(disconnectTimers.get(userEmail));
    disconnectTimers.delete(userEmail);
    console.log(`${userEmail} reconnected — disconnect timer cancelled.`);
    // Notify the other party (driver or passenger) that they're back
    (async () => {
      try {
        // Were they a passenger in a route-share ride?
        const rideAsP = await Ride.findOne({
          "requests.email": userEmail,
          status: { $in: ["active", "in_progress", "payment_pending"] }
        });
        if (rideAsP) io.to(rideAsP.driverEmail).emit("peer_reconnected", { who: "passenger", email: userEmail });

        // Were they a driver?
        const rideAsD = await Ride.findOne({ driverEmail: userEmail, status: { $in: ["active", "in_progress", "payment_pending"] } });
        if (rideAsD) {
          rideAsD.requests.filter(r => ["accepted", "arrived"].includes(r.status)).forEach(r => {
            io.to(r.email).emit("peer_reconnected", { who: "driver", email: userEmail });
          });
        }

        // Quick drop
        const qdAsP = await QuickRequest.findOne({ passengerEmail: userEmail, status: { $in: ["accepted", "arrived", "in_progress", "payment_pending"] } });
        if (qdAsP) io.to(qdAsP.driverEmail).emit("peer_reconnected", { who: "passenger", email: userEmail });

        const qdAsD = await QuickRequest.findOne({ driverEmail: userEmail, status: { $in: ["accepted", "arrived", "in_progress", "payment_pending"] } });
        if (qdAsD) io.to(qdAsD.passengerEmail).emit("peer_reconnected", { who: "driver", email: userEmail });
      } catch (e) { /* silent */ }
    })();
  }

  // Driver reconnecting after a page refresh — send their current pending/active requests
  socket.on("request_current_rides", async ({ driverEmail }) => {
    try {
      const ride = await Ride.findOne({ driverEmail, status: "active" });
      socket.emit("ride_requests_list", ride ? ride.requests : []);
    } catch (err) {
      socket.emit("ride_requests_list", []);
    }
  });

  // Live GPS telemetry forwarding
  socket.on("driver_location_update", async (data) => {
    try {
      // Find active ride share routes
      const rides = await Ride.find({ driverEmail: socket.user.email, status: { $in: ["active", "in_progress"] } });
      rides.forEach(ride => {
        ride.requests.forEach(req => {
          if (req.status === "accepted") {
            io.to(req.email).emit("driver_location", data);
          }
        });
      });

      // Find active quick drop routes
      const quickReqs = await QuickRequest.find({ driverEmail: socket.user.email, status: { $in: ["accepted", "in_progress"] } });
      quickReqs.forEach(qr => {
        io.to(qr.passengerEmail).emit("driver_location", data);
      });
    } catch (err) {
      console.error("GPS Broadcast Error", err);
    }
  });

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", userEmail);

    const GRACE_MS = 30000; // 30-second reconnect window

    const timer = setTimeout(async () => {
      disconnectTimers.delete(userEmail);
      console.log(`${userEmail} confirmed gone after grace period.`);

      try {
        // ── Driver left ──────────────────────────────────────────────────────
        const rideAsDriver = await Ride.findOne({
          driverEmail: userEmail,
          status: { $in: ["active", "in_progress", "payment_pending"] }
        });
        if (rideAsDriver) {
          rideAsDriver.requests
            .filter(r => ["accepted", "arrived", "paid"].includes(r.status))
            .forEach(r => {
              io.to(r.email).emit("ride_cancelled", {
                message: "The driver has disconnected. The trip has been cancelled."
              });
            });
          await Ride.updateMany(
            { driverEmail: userEmail, status: { $in: ["active", "in_progress", "payment_pending"] } },
            { status: "cancelled" }
          );
          await User.findOneAndUpdate({ email: userEmail }, { isOnline: false });
        }

        // ── Passenger left a route-share ride ────────────────────────────────
        const rideAsPassenger = await Ride.findOne({
          "requests.email": userEmail,
          "requests.status": { $in: ["accepted", "arrived"] },
          status: { $in: ["active", "in_progress"] }
        });
        if (rideAsPassenger) {
          io.to(rideAsPassenger.driverEmail).emit("passenger_disconnected", {
            message: `A passenger has disconnected from your trajectory.`,
            passengerEmail: userEmail
          });
        }

        // ── Passenger left a quick drop ──────────────────────────────────────
        const qdAsPassenger = await QuickRequest.findOne({
          passengerEmail: userEmail,
          status: { $in: ["pending", "accepted", "arrived", "in_progress", "payment_pending"] }
        });
        if (qdAsPassenger) {
          io.to(qdAsPassenger.driverEmail).emit("passenger_disconnected", {
            message: `Quick-drop passenger has disconnected.`,
            passengerEmail: userEmail,
            requestId: qdAsPassenger._id
          });
          // Auto-cancel the quick drop after an additional 30 s if passenger never returns
          setTimeout(async () => {
            const still = await QuickRequest.findOne({
              _id: qdAsPassenger._id,
              status: { $in: ["pending", "accepted"] }
            });
            if (still) {
              await QuickRequest.findByIdAndUpdate(qdAsPassenger._id, { status: "cancelled" });
              io.to(qdAsPassenger.driverEmail).emit("quick_drop_completed", {
                message: "Passenger did not return. Drop has been auto-cancelled."
              });
            }
          }, 30000);
        }

        // ── Driver left a quick drop ─────────────────────────────────────────
        const qdAsDriver = await QuickRequest.findOne({
          driverEmail: userEmail,
          status: { $in: ["accepted", "arrived", "in_progress", "payment_pending"] }
        });
        if (qdAsDriver) {
          io.to(qdAsDriver.passengerEmail).emit("ride_cancelled", {
            message: "The driver has disconnected. Your quick drop has been cancelled."
          });
          await QuickRequest.findByIdAndUpdate(qdAsDriver._id, { status: "cancelled" });
        }
      } catch (err) {
        console.error("Disconnect cleanup error:", err);
      }
    }, GRACE_MS);

    disconnectTimers.set(userEmail, timer);
  });
});

// ─────────────────────────────────────────────────────────
// MONGODB
// ─────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch(err => console.log("❌ Connection Error:", err));

// ─────────────────────────────────────────────────────────
// SCHEMAS
// ─────────────────────────────────────────────────────────
// Platform fee: 10% of driver earnings per month
const PLATFORM_FEE_PERCENT = 10;
// Fallback fare for quick drop (used in trip history formatting)
const QUICK_DROP_FARE = 30;

const UserSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  gender: String,
  isCampusDriver: { type: Boolean, default: false },
  isOnline: { type: Boolean, default: false },
  currentRideID: { type: mongoose.Schema.Types.ObjectId, ref: "Ride", default: null },
  resetOtp: String,
  resetOtpExpire: Date,
  driverDetails: {
    licenseNumber: String,
    vehicleModel: String,
    vehicleNumber: String,
    agreedToTerms: Boolean,
    upiId: String,
    qrPhoto: String
  }
});

// ── Revenue / Earnings tracking schema ──────────────────────────────────────
// Every time a driver collects a fare (cash or UPI) we append an entry here.
// The platform fee endpoint reads this collection to bill the driver monthly.
const EarningSchema = new mongoose.Schema({
  driverEmail: { type: String, required: true, index: true },
  passengerEmail: String,
  rideType: { type: String, enum: ["route_share", "quick_drop"] },
  fare: { type: Number, default: 0 },
  paymentMethod: { type: String, enum: ["cash", "upi"], default: "cash" },
  rideId: String,           // Ride._id or QuickRequest._id (string for cross-collection)
  createdAt: { type: Date, default: Date.now }
});

const Earning = mongoose.model("Earning", EarningSchema, "earnings");

// ── Fare-negotiation schema for Quick Drop ───────────────────────────────────
// When a driver proposes a fare, passenger can counter or accept before ride starts.
const FareNegotiationSchema = new mongoose.Schema({
  requestId: { type: String, required: true, unique: true },
  driverEmail: String,
  passengerEmail: String,
  proposedFare: Number,
  counterFare: { type: Number, default: null },
  status: { type: String, enum: ["pending_passenger", "countered", "accepted", "rejected"], default: "pending_passenger" },
  createdAt: { type: Date, default: Date.now }
});

const FareNegotiation = mongoose.model("FareNegotiation", FareNegotiationSchema, "fare_negotiations");

const User = mongoose.model("User", UserSchema, "users");

const RideSchema = new mongoose.Schema({
  driverEmail: String,
  driverName: String,
  vehicleModel: String,
  vehicleNumber: String,
  from: { type: String, default: "" },   // departure city / starting point
  fromLat: Number,                        // departure latitude (for passenger map)
  fromLng: Number,                        // departure longitude (for passenger map)
  destination: String,
  destLat: Number,
  destLng: Number,
  seats: Number,
  time: String,
  fare: Number,
  status: { type: String, default: "active" },
  requests: [{
    email: String,
    name: String,
    pickupLocation: String,
    status: { type: String, default: "pending" }
  }],
  createdAt: { type: Date, default: Date.now }
});

const Ride = mongoose.model("Ride", RideSchema, "rides");

const QuickRequestSchema = new mongoose.Schema({
  passengerEmail: String,
  passengerName: String,
  driverEmail: String,
  driverName: String,
  pickup: String,
  drop: String,
  fare: { type: Number, default: 0 },
  status: { type: String, default: "pending" },
  createdAt: { type: Date, default: Date.now }
});

const QuickRequest = mongoose.model("QuickRequest", QuickRequestSchema, "quick_requests");

// ─────────────────────────────────────────────────────────
// JWT AUTH MIDDLEWARE
//
// Usage: add `auth` as the second argument to any route.
// The verified user is available as req.user = { email, name }.
// Routes no longer need email in req.body — they read req.user.
//
// Frontend must send:
//   Authorization: Bearer <token>
// ─────────────────────────────────────────────────────────
const auth = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // "Bearer <token>"

  if (!token) {
    return res.status(401).json({ message: "No token provided. Please log in." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { email, name, iat, exp }
    next();
  } catch (err) {
    return res.status(403).json({ message: "Invalid or expired token. Please log in again." });
  }
};

// ─────────────────────────────────────────────────────────
// EMERGENCY AUTH MIDDLEWARE
//
// sendBeacon (used on tab close) cannot set custom headers,
// so the frontend passes the JWT as a ?token= query param.
// This middleware reads it from there instead.
// Only used on /emergency-cleanup — not a general pattern.
// ─────────────────────────────────────────────────────────
const emergencyAuth = (req, res, next) => {
  const token = req.query.token;

  if (!token) {
    return res.status(401).json({ message: "No token provided." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ message: "Invalid or expired token." });
  }
};

// ─────────────────────────────────────────────────────────
// PUBLIC ROUTES (no auth required)
// ─────────────────────────────────────────────────────────

// SIGNUP
app.post("/signup", authLimiter, async (req, res) => {
  const { name, email, password, gender } = req.body;

  if (!name || !email || !password || !gender) {
    return res.status(400).send("All fields are required, including gender");
  }

  const pwRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#^])[A-Za-z\d@$!%*?&#^]{8,}$/;
  if (!pwRegex.test(password)) {
    return res.status(400).send("Password does not meet security requirements.");
  }

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(409).send("User already exists");

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ name, email, password: hashedPassword, gender, isCampusDriver: false });
    await user.save();
    res.status(201).send("User registered successfully");
  } catch (err) {
    console.error("Signup Error:", err);
    res.status(500).send("Server error during registration");
  }
});

// LOGIN — issues a JWT on success.
// Frontend: store the returned `token` and send it on every subsequent request.
app.post("/login", authLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Missing credentials" });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

    // Sign a token with the user's identity.
    // The secret must be in .env as JWT_SECRET.
    const token = jwt.sign(
      { email: user.email, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      message: "Login successful",
      token,                          // ← store this on the client
      name: user.name,
      email: user.email,
      gender: user.gender,
      isCampusDriver: user.isCampusDriver
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ message: "Login error" });
  }
});

// ─────────────────────────────────────────────────────────
// FORGOT PASSWORD PIPELINE
// ─────────────────────────────────────────────────────────

// Generate OTP and send email
app.post("/forgot-password", authLimiter, async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "If that email is registered, an OTP will be sent." });

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetOtp = otp;
    user.resetOtpExpire = Date.now() + 10 * 60 * 1000; // 10 minutes expiry
    await user.save();

    await transporter.sendMail({
      from: `"BROSKI Support" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "BROSKI - Password Reset OTP",
      text: `Your password reset OTP is: ${otp}\n\nIt is valid for 10 minutes. Do not share this code with anyone.`
    });

    res.json({ message: "OTP sent to your email." });
  } catch (err) {
    console.error("Forgot Password Error:", err);
    res.status(500).json({ message: "Error sending OTP. Try again later." });
  }
});

// Verify OTP and Reset Password
app.post("/reset-password", authLimiter, async (req, res) => {
  const { email, otp, newPassword } = req.body;

  // Basic security validation
  const pwRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#^])[A-Za-z\d@$!%*?&#^]{8,}$/;
  if (!pwRegex.test(newPassword)) {
    return res.status(400).json({ message: "New password does not meet security requirements." });
  }

  try {
    const user = await User.findOne({
      email,
      resetOtp: otp,
      resetOtpExpire: { $gt: Date.now() } // Ensure it hasn't expired
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired OTP." });
    }

    // Hash new password and clear OTP fields
    user.password = await bcrypt.hash(newPassword, 10);
    user.resetOtp = undefined;
    user.resetOtpExpire = undefined;
    await user.save();

    res.json({ message: "Password reset successful!" });
  } catch (err) {
    res.status(500).json({ message: "Server error during reset." });
  }
});

// Search routes is public — passengers browse without logging in
app.get("/search-routes", async (req, res) => {
  const { destination, lat, lng } = req.query;
  if (!destination && !lat) return res.json([]);

  try {
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const baseFilter = {
      status: "active",
      seats: { $gt: 0 },
      createdAt: { $gte: twelveHoursAgo }
    };

    // ── Coordinate-based search (from map pin) ─────────────────────────────
    // When the passenger picks a point on the map we receive lat/lng.
    // We fetch ALL active rides that have stored coordinates, then filter
    // by haversine distance (≤ 80 km). This correctly surfaces drivers
    // heading through or near the selected point even if the text
    // label doesn't match the driver's stored destination string.
    if (lat && lng) {
      const pLat = parseFloat(lat);
      const pLng = parseFloat(lng);

      const rides = await Ride.find({
        ...baseFilter,
        destLat: { $exists: true, $ne: null },
        destLng: { $exists: true, $ne: null }
      }).sort({ time: 1 });

      // Haversine distance in km
      function haversine(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
          Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
          Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      }

      const RADIUS_KM = 80;
      const nearby = rides.filter(r =>
        haversine(pLat, pLng, r.destLat, r.destLng) <= RADIUS_KM
      );

      return res.json(nearby);
    }

    // ── Text-based search (from autocomplete box) ──────────────────────────
    const rides = await Ride.find({
      ...baseFilter,
      destination: { $regex: destination, $options: "i" }
    }).sort({ time: 1 });

    res.json(rides);
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).send("Search error");
  }
});

// Search campus drivers is public — passengers browse without logging in
app.get("/search-campus-drivers", async (req, res) => {
  try {
    const activeDrivers = await User.find({
      isCampusDriver: true,
      isOnline: true
    }).select("name email gender driverDetails");

    res.json(activeDrivers);
  } catch (err) {
    res.status(500).json({ message: "Radar error" });
  }
});


// ─────────────────────────────────────────────────────────
// PROTECTED ROUTES (require valid JWT via `auth` middleware)
//
// These routes NO LONGER accept email from req.body.
// They read req.user.email and req.user.name instead.
// ─────────────────────────────────────────────────────────

// UPDATE DRIVER STATUS
app.post("/update-driver-status", auth, async (req, res) => {
  const { email } = req.user;                          // ← from verified JWT
  const { license, vehicleModel, vehicleNumber, agreed, upiId, qrPhoto } = req.body;

  try {
    await User.findOneAndUpdate(
      { email },
      {
        isCampusDriver: true,
        driverDetails: { licenseNumber: license, vehicleModel, vehicleNumber, agreedToTerms: agreed, upiId, qrPhoto }
      },
      { new: true }
    );
    res.json({ message: "Driver verified", isCampusDriver: true });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// UPDATE PROFILE
app.post("/update-profile", auth, async (req, res) => {
  const { email } = req.user;
  const { gender } = req.body;

  try {
    const user = await User.findOneAndUpdate({ email }, { gender }, { new: true });
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ message: "Profile updated successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/get-driver-profile", auth, async (req, res) => {
  const { email } = req.user;
  try {
    const user = await User.findOne({ email }).select("driverDetails");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user.driverDetails || {});
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// TOGGLE ONLINE (driver goes on/off duty)
app.post("/toggle-online", auth, async (req, res) => {
  const { email } = req.user;
  const { status } = req.body;

  try {
    const user = await User.findOneAndUpdate({ email }, { isOnline: status }, { new: true });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    console.log(`Driver Status Change: ${email} is now ${status ? "ONLINE" : "OFFLINE"}`);
    res.json({ message: "Sync Successful", isOnline: user.isOnline });
  } catch (err) {
    console.error("Toggle Error details:", err);
    res.status(500).json({ message: "Server error during sync" });
  }
});

// PUBLISH ROUTE
app.post("/publish-route", auth, async (req, res) => {
  const { email: driverEmail, name: driverName } = req.user;
  const { from, destination, destLat, destLng, fromLat, fromLng, seats, time, fare } = req.body;

  if (!destination || parseInt(seats) <= 0 || parseFloat(fare) < 0) {
    return res.status(400).json({ message: "Invalid route details. Seats must be > 0 and fare >= 0." });
  }

  try {
    const driverUser = await User.findOne({ email: driverEmail });
    const vehicleModel = driverUser?.driverDetails?.vehicleModel || "Unknown";
    const vehicleNumber = driverUser?.driverDetails?.vehicleNumber || "Unknown";

    await Ride.updateMany(
      { driverEmail, status: "active" },
      { status: "cancelled" }
    );

    const newRide = new Ride({
      driverEmail,
      driverName,
      vehicleModel,
      vehicleNumber,
      from: from || "",
      fromLat: fromLat ? parseFloat(fromLat) : null,
      fromLng: fromLng ? parseFloat(fromLng) : null,
      destination,
      destLat,
      destLng,
      seats: parseInt(seats),
      time,
      fare: parseFloat(fare),
      status: "active"
    });

    await newRide.save();
    res.json({ message: "Route published successfully", rideId: newRide._id });
  } catch (err) {
    console.error("DB Save Error:", err);
    res.status(500).json({ message: "Error saving route" });
  }
});

// CANCEL ROUTE
// Also notifies all accepted passengers via Socket.io — no polling needed.
app.post("/cancel-route", auth, async (req, res) => {
  const { email: driverEmail } = req.user;

  try {
    const ride = await Ride.findOne({ driverEmail, status: { $in: ["active", "in_progress", "payment_pending"] } });

    if (ride) {
      // Push ride_cancelled to every accepted/arrived/paid passenger before deleting
      ride.requests
        .filter(r => r.status === "accepted" || r.status === "arrived" || r.status === "paid")
        .forEach(r => {
          io.to(r.email).emit("ride_cancelled", { message: "The driver has ended the trip." });
        });

      await Ride.updateMany({ driverEmail, status: { $in: ["active", "in_progress", "payment_pending"] } }, { status: "cancelled" });
    }

    res.json({ message: "Mission aborted and deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Error cancelling route" });
  }
});

// COMPLETE ROUTE
// Notifies accepted/paid passengers that the journey is done.
app.post("/complete-route", auth, async (req, res) => {
  const { email: driverEmail } = req.user;

  try {
    const ride = await Ride.findOne({ driverEmail, status: { $in: ["active", "in_progress", "payment_pending"] } });

    if (ride) {
      ride.requests
        .filter(r => r.status === "accepted" || r.status === "arrived" || r.status === "paid")
        .forEach(r => {
          io.to(r.email).emit("ride_completed", { message: "The driver has completed the journey." });
        });

      await Ride.updateMany({ driverEmail, status: { $in: ["active", "in_progress", "payment_pending"] } }, { status: "completed" });
    }

    res.json({ message: "Journey completed and data cleared" });
  } catch (err) {
    res.status(500).json({ message: "Error completing route" });
  }
});

// START ROUTE
app.post("/start-route", auth, async (req, res) => {
  const { email: driverEmail } = req.user;
  try {
    const ride = await Ride.findOneAndUpdate(
      { driverEmail, status: "active" },
      { status: "in_progress" },
      { new: true }
    );
    if (!ride) return res.status(404).json({ message: "No active trajectory found" });

    ride.requests.filter(r => r.status === "accepted" || r.status === "arrived").forEach(r => {
      io.to(r.email).emit("ride_started", { message: "Trajectory in progress... Enjoy the ride!" });
    });
    res.json({ message: "Trajectory Started" });
  } catch (err) {
    res.status(500).json({ message: "Error starting route" });
  }
});

// ARRIVE PASSENGER (Route Share)
app.post("/arrive-passenger", auth, async (req, res) => {
  const { email: driverEmail } = req.user;
  const { passengerEmail } = req.body;
  try {
    // BUG FIX: also search in_progress rides — driver may have already pressed
    // "Start Trajectory" before marking individual passengers as arrived.
    const ride = await Ride.findOneAndUpdate(
      { driverEmail, status: { $in: ["active", "in_progress"] }, "requests.email": passengerEmail },
      { $set: { "requests.$.status": "arrived" } },
      { new: true }
    );
    if (!ride) return res.status(404).json({ message: "Ride or passenger not found" });

    io.to(passengerEmail).emit("driver_arrived", { message: "Driver has arrived at your pickup location! Please board the vehicle." });

    // Alert driver to refresh their command center UI
    io.to(driverEmail).emit("ride_requests_list", ride.requests);

    const acceptedCount = ride.requests.filter(r => r.status === "accepted" || r.status === "arrived" || r.status === "paid").length;
    res.json({ message: "Arrived", bookedSeats: acceptedCount, totalSeats: ride.seats + acceptedCount });
  } catch (err) {
    res.status(500).json({ message: "Error arriving" });
  }
});

// START QUICK DROP
app.post("/start-quick-drop", auth, async (req, res) => {
  const { requestId } = req.body;
  try {
    const quickReq = await QuickRequest.findByIdAndUpdate(
      requestId,
      { status: "in_progress" },
      { new: true }
    );
    if (!quickReq) return res.status(404).json({ message: "Request not found" });

    io.to(quickReq.passengerEmail).emit("quick_drop_started", {
      message: "Driver has arrived and drop has started."
    });
    res.json({ message: "Started" });
  } catch (err) {
    res.status(500).json({ message: "Error starting drop" });
  }
});

// ARRIVE QUICK DROP
app.post("/arrive-quick-drop", auth, async (req, res) => {
  const { requestId } = req.body;
  try {
    const quickReq = await QuickRequest.findByIdAndUpdate(
      requestId,
      { status: "arrived" },
      { new: true }
    );
    if (!quickReq) return res.status(404).json({ message: "Request not found" });

    io.to(quickReq.passengerEmail).emit("quick_drop_arrived", {
      message: "Driver has arrived at your location! Please board."
    });
    res.json({ message: "Arrived" });
  } catch (err) {
    res.status(500).json({ message: "Error updating drop" });
  }
});

// REQUEST PAYMENT
app.post("/request-payment", auth, async (req, res) => {
  const { email: driverEmail } = req.user;
  try {
    const driver = await User.findOne({ email: driverEmail });
    const upiId = driver?.driverDetails?.upiId;
    const qrPhoto = driver?.driverDetails?.qrPhoto;

    const ride = await Ride.findOneAndUpdate(
      { driverEmail, status: "in_progress" },
      { status: "payment_pending" },
      { new: true }
    );
    if (!ride) return res.status(404).json({ message: "Route not in progress" });

    ride.requests.filter(r => r.status === "accepted" || r.status === "arrived").forEach(r => {
      io.to(r.email).emit("payment_requested", { fare: ride.fare, type: "route_share", upiId, qrPhoto });
    });
    res.json({ message: "Payments requested" });
  } catch (err) {
    res.status(500).json({ message: "Error requesting payment" });
  }
});

// REQUEST QUICK DROP PAYMENT
app.post("/request-quick-payment", auth, async (req, res) => {
  const { email: driverEmail } = req.user;
  const { requestId } = req.body;
  try {
    const driver = await User.findOne({ email: driverEmail });
    const upiId = driver?.driverDetails?.upiId;
    const qrPhoto = driver?.driverDetails?.qrPhoto;

    const quickReq = await QuickRequest.findByIdAndUpdate(
      requestId,
      { status: "payment_pending" },
      { new: true }
    );
    if (!quickReq) return res.status(404).json({ message: "Request not found" });

    io.to(quickReq.passengerEmail).emit("payment_requested", { fare: quickReq.fare || 0, type: "quick_drop", upiId, qrPhoto });
    res.json({ message: "Payment requested" });
  } catch (err) {
    res.status(500).json({ message: "Error requesting payment" });
  }
});

// PASSENGER PAID
app.post("/passenger-paid", auth, async (req, res) => {
  const { email: passengerEmail } = req.user;
  const { type, rideId, paymentMethod = "cash" } = req.body;

  try {
    if (type === "quick_drop") {
      const qReq = await QuickRequest.findById(rideId);
      if (!qReq) return res.status(404).json({ message: "Request not found" });

      // Record the earning for revenue tracking
      await Earning.create({
        driverEmail: qReq.driverEmail,
        passengerEmail,
        rideType: "quick_drop",
        fare: qReq.fare || 0,
        paymentMethod,
        rideId: rideId.toString()
      });

      io.to(qReq.driverEmail).emit("passenger_paid", { passengerEmail, type, requestId: rideId });
      res.json({ message: "Marked paid" });
    } else {
      const ride = await Ride.findOneAndUpdate(
        { _id: rideId, status: "payment_pending", "requests.email": passengerEmail },
        { $set: { "requests.$.status": "paid" } }
      );
      if (!ride) return res.status(404).json({ message: "Ride or request not found" });

      // Record the earning for revenue tracking
      await Earning.create({
        driverEmail: ride.driverEmail,
        passengerEmail,
        rideType: "route_share",
        fare: ride.fare || 0,
        paymentMethod,
        rideId: rideId.toString()
      });

      io.to(ride.driverEmail).emit("passenger_paid", { passengerEmail, type });
      res.json({ message: "Marked paid" });
    }
  } catch (err) {
    console.error("passenger-paid error:", err);
    res.status(500).json({ message: "Error updating payment" });
  }
});

// EMERGENCY CLEANUP (tab close)
// Uses emergencyAuth because sendBeacon cannot set headers — token arrives as ?token=
app.post("/emergency-cleanup", emergencyAuth, async (req, res) => {
  const { email: driverEmail } = req.user;

  try {
    const ride = await Ride.findOne({ driverEmail, status: { $in: ["active", "in_progress", "payment_pending"] } });
    if (ride) {
      ride.requests
        .filter(r => r.status === "accepted" || r.status === "paid")
        .forEach(r => {
          io.to(r.email).emit("ride_cancelled", { message: "The driver has disconnected." });
        });
    }

    await Ride.updateMany({ driverEmail, status: { $in: ["active", "in_progress", "payment_pending"] } }, { status: "cancelled" });
    await User.findOneAndUpdate({ email: driverEmail }, { isOnline: false });

    res.status(200).send("Cleanup successful");
  } catch (err) {
    res.status(500).send("Cleanup failed");
  }
});

// REQUEST RIDE (passenger → driver)
// Emits new_request to the driver's socket room immediately.
// Replaces the need for the driver to poll /get-ride-requests.
app.post("/request-ride", auth, requestLimiter, async (req, res) => {
  const { email: passengerEmail, name: passengerName } = req.user;
  const { rideId, pickupLocation } = req.body;

  try {
    const ride = await Ride.findByIdAndUpdate(
      rideId,
      { $push: { requests: { email: passengerEmail, name: passengerName, pickupLocation, status: "pending" } } },
      { new: true }
    );

    if (!ride) return res.status(404).json({ message: "Ride not found" });

    // Push to driver instantly — they receive this in their socket room
    io.to(ride.driverEmail).emit("new_request", {
      passengerEmail,
      passengerName,
      pickupLocation,
      rideId
    });

    res.json({ message: "Request sent" });
  } catch (err) {
    res.status(500).send("Error");
  }
});

// ACCEPT PASSENGER (driver accepts a pending request)
// Emits ride_accepted to the passenger's socket room immediately.
// Replaces the need for passengers to poll /get-my-request-status.
app.post("/accept-passenger", auth, async (req, res) => {
  const { email: driverEmail, name: driverName } = req.user;
  const { passengerEmail } = req.body;

  try {
    // ATOMIC UPDATE: Prevents race condition if two drivers/requests hit exactly simultaneously
    const ride = await Ride.findOneAndUpdate(
      {
        driverEmail,
        status: { $in: ["active", "in_progress"] },
        seats: { $gt: 0 },
        "requests.email": passengerEmail,
        "requests.status": "pending"
      },
      {
        $inc: { seats: -1 },
        $set: { "requests.$.status": "accepted" }
      },
      { new: true }
    );

    if (!ride) {
      const existingRide = await Ride.findOne({ driverEmail, status: { $in: ["active", "in_progress"] } });
      if (!existingRide) return res.status(404).json({ message: "No active trajectory found" });
      if (existingRide.seats <= 0) return res.status(400).json({ message: "No seats available" });
      return res.status(400).json({ message: "Request already handled or not found" });
    }

    // Push to the passenger instantly — include departure coords so passenger
    // map can draw the full A→B route line, not just a destination dot.
    io.to(passengerEmail).emit("ride_accepted", {
      driverName,
      driverEmail,
      vehicleModel: ride.vehicleModel,
      vehicleNumber: ride.vehicleNumber,
      destination: ride.destination,
      destLat: ride.destLat,
      destLng: ride.destLng,
      fromLat: ride.fromLat,
      fromLng: ride.fromLng,
      message: "Your ride has been accepted!"
    });

    const acceptedCount = ride.requests.filter(r => r.status === "accepted").length;
    res.json({
      message: "Linked",
      bookedSeats: acceptedCount,
      totalSeats: ride.seats + acceptedCount
    });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// REJECT PASSENGER (driver declines a pending request)
// Emits ride_rejected to the passenger's socket room immediately.
// Removes the pending request from the ride so it doesn't clutter the driver's list.
app.post("/reject-passenger", auth, async (req, res) => {
  const { email: driverEmail } = req.user;
  const { passengerEmail } = req.body;

  try {
    const ride = await Ride.findOne({ driverEmail, status: { $in: ["active", "in_progress"] } });
    if (!ride) return res.status(404).json({ message: "No active trajectory found" });

    const requestIndex = ride.requests.findIndex(r => r.email === passengerEmail && r.status === "pending");
    if (requestIndex === -1) {
      return res.status(400).json({ message: "Request not found or already handled" });
    }

    // Remove the pending request from the array
    ride.requests.splice(requestIndex, 1);
    await ride.save();

    // Notify the passenger immediately — they leave the waiting screen
    io.to(passengerEmail).emit("ride_rejected", {
      message: "Your request was declined by the driver. Please try another."
    });

    res.json({ message: "Passenger request declined" });
  } catch (err) {
    console.error("Reject passenger error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// LEAVE RIDE (passenger actively exits)
app.post("/leave-ride", auth, async (req, res) => {
  const { email: passengerEmail } = req.user;
  const { rideId } = req.body;

  try {
    const ride = await Ride.findById(rideId);
    if (!ride) return res.json({ message: "Ride already gone" });

    // Block leaving once the journey is underway — unfair to driver mid-trip
    if (ride.status === 'in_progress' || ride.status === 'payment_pending') {
      return res.status(400).json({ message: "Cannot leave during an active ride. Please settle payment first." });
    }

    const requestIndex = ride.requests.findIndex(r => r.email === passengerEmail);
    if (requestIndex !== -1) {
      if (ride.requests[requestIndex].status === "accepted") {
        ride.seats += 1; // Give the seat back to the driver
      }
      ride.requests.splice(requestIndex, 1);
      await ride.save();
    }

    res.json({ message: "Left successfully" });
  } catch (err) {
    res.status(500).json({ message: "Error leaving ride" });
  }
});

// REQUEST QUICK DROP (inside campus)
// Emits new_quick_request to the driver's socket room immediately.
app.post("/request-quick-drop", auth, async (req, res) => {
  const { email: passengerEmail, name: passengerName } = req.user;
  const { driverEmail, pickup, drop } = req.body;

  try {
    const driverUser = await User.findOne({ email: driverEmail });
    const driverName = driverUser ? driverUser.name : "Driver";

    const newReq = new QuickRequest({ passengerEmail, passengerName, driverEmail, driverName, pickup, drop });
    await newReq.save();

    // Push to the driver instantly — replaces polling /get-quick-requests
    io.to(driverEmail).emit("new_quick_request", {
      requestId: newReq._id,
      passengerEmail,
      passengerName,
      pickup,
      drop
    });

    res.json({ message: "Request sent", requestId: newReq._id });
  } catch (err) {
    res.status(500).json({ message: "Error sending request" });
  }
});

// ACCEPT QUICK DROP (driver accepts)
// Emits quick_drop_accepted to passenger's socket room.
app.post("/accept-quick-drop", auth, async (req, res) => {
  const { email: driverEmail, name: driverName } = req.user;
  const { requestId, fare } = req.body;

  let fareValue = parseFloat(fare);
  if (isNaN(fareValue) || fareValue < 0 || fareValue > 50) {
    return res.status(400).json({ message: "Fare must be between ₹0 and ₹50" });
  }

  try {
    const quickReq = await QuickRequest.findByIdAndUpdate(
      requestId,
      { status: "accepted", fare: fareValue },
      { new: true }
    );

    if (!quickReq) return res.status(404).json({ message: "Request not found" });

    // Push to the passenger instantly - include negotiated fare and vehicle info
    const driverUser = await User.findOne({ email: driverEmail });
    io.to(quickReq.passengerEmail).emit("quick_drop_accepted", {
      driverName,
      driverEmail,
      fare: quickReq.fare,
      vehicleModel: driverUser?.driverDetails?.vehicleModel || "Vehicle",
      vehicleNumber: driverUser?.driverDetails?.vehicleNumber || "Unknown Plate",
      message: "Your quick drop was accepted!"
    });

    res.json({ message: "Accepted" });
  } catch (err) {
    res.status(500).json({ message: "Error accepting" });
  }
});

// GET ACTIVE MISSION (driver)
// Returns the driver's current active ride so the Command Center
// can fully restore after a page refresh (destination, seats, fare, requests).
app.get("/get-active-mission", auth, async (req, res) => {
  const { email: driverEmail } = req.user;
  try {
    const ride = await Ride.findOne({ driverEmail, status: { $in: ["active", "in_progress", "payment_pending"] } });
    if (!ride) return res.json({ active: false });
    res.json({
      active: true,
      status: ride.status,
      destination: ride.destination,
      destLat: ride.destLat,
      destLng: ride.destLng,
      seats: ride.seats,
      fare: ride.fare,
      time: ride.time,
      totalSeats: ride.seats + ride.requests.filter(r => r.status === "accepted" || r.status === "paid").length,
      bookedSeats: ride.requests.filter(r => r.status === "accepted" || r.status === "paid").length,
      requests: ride.requests
    });
  } catch (err) {
    res.status(500).json({ message: "Error fetching mission" });
  }
});

// MY RIDE STATUS (passenger)
// Returns the passenger's current request state for a given ride.
// Used on page refresh so the Mission Status page self-corrects
// without waiting for a socket event that may already have fired.
app.get("/my-ride-status", auth, async (req, res) => {
  const { email: passengerEmail } = req.user;
  const { rideId } = req.query;
  try {
    // ── Try Route Share first ──────────────────────────────────────────────
    const ride = await Ride.findById(rideId).catch(() => null);
    if (ride) {
      const myReq = ride.requests.find(r => r.email === passengerEmail);
      if (!myReq) return res.json({ status: "not_found" });

      // If the ride is in payment_pending but the request is still "accepted" or "arrived"
      // (request-level status only advances to "paid" after passenger confirms),
      // we must surface "payment_pending" so the passenger's reload shows the payment page.
      let effectiveStatus = myReq.status;
      if (ride.status === 'payment_pending' && ['accepted', 'arrived'].includes(myReq.status)) {
        effectiveStatus = 'payment_pending';
      }

      const driver = await User.findOne({ email: ride.driverEmail });
      return res.json({
        status: effectiveStatus,         // "pending" | "accepted" | "arrived" | "paid" | "in_progress" | "payment_pending"
        rideType: "route_share",
        driverName: ride.driverName,
        driverEmail: ride.driverEmail,
        destination: ride.destination,
        destLat: ride.destLat,
        destLng: ride.destLng,
        fromLat: ride.fromLat,
        fromLng: ride.fromLng,
        vehicleModel: ride.vehicleModel,
        vehicleNumber: ride.vehicleNumber,
        fare: ride.fare,
        upiId: driver?.driverDetails?.upiId,
        qrPhoto: driver?.driverDetails?.qrPhoto
      });
    }

    // ── Fallback: check Quick Drop (passengers store a QuickRequest._id) ──
    const quickReq = await QuickRequest.findById(rideId).catch(() => null);
    if (quickReq && quickReq.passengerEmail === passengerEmail) {
      // Map QuickRequest status to the passenger UI expectations
      const terminalStatuses = ["completed", "rejected"];
      if (terminalStatuses.includes(quickReq.status)) {
        return res.json({ status: "driver_ended", rideType: "quick_drop" });
      }
      const driver = await User.findOne({ email: quickReq.driverEmail });
      return res.json({
        status: quickReq.status,   // "pending" | "accepted" | "arrived" | "in_progress" | "payment_pending"
        rideType: "quick_drop",
        driverName: quickReq.driverName || (driver ? driver.name : "Driver"),
        driverEmail: quickReq.driverEmail,
        destination: (quickReq.pickup || "Campus") + " → " + (quickReq.drop || "Campus"),
        fare: quickReq.fare || 0,
        upiId: driver?.driverDetails?.upiId,
        qrPhoto: driver?.driverDetails?.qrPhoto
      });
    }

    // Neither collection has this ID — ride is gone
    return res.json({ status: "driver_ended" });
  } catch (err) {
    res.status(500).json({ message: "Error fetching status" });
  }
});

// COMPLETE QUICK DROP (driver marks the drop as done)
// Emits quick_drop_completed to the passenger so they can exit the status screen.
app.post("/complete-quick-drop", auth, async (req, res) => {
  const { email: driverEmail, name: driverName } = req.user;
  const { requestId } = req.body;
  try {
    const quickReq = await QuickRequest.findByIdAndUpdate(
      requestId,
      { status: "completed" },
      { new: true }
    );
    if (!quickReq) return res.status(404).json({ message: "Request not found" });

    io.to(quickReq.passengerEmail).emit("quick_drop_completed", {
      driverName,
      message: "Your drop has been completed! Thank you for using Campus Vehicle."
    });

    res.json({ message: "Drop completed" });
  } catch (err) {
    res.status(500).json({ message: "Error completing drop" });
  }
});

// REJECT QUICK DROP (driver declines the request before accepting)
// Emits quick_drop_rejected to the passenger so they can try another driver.
app.post("/reject-quick-drop", auth, async (req, res) => {
  const { email: driverEmail } = req.user;
  const { requestId } = req.body;
  try {
    const quickReq = await QuickRequest.findByIdAndUpdate(
      requestId,
      { status: "rejected" },
      { new: true }
    );
    if (!quickReq) return res.status(404).json({ message: "Request not found" });

    io.to(quickReq.passengerEmail).emit("quick_drop_rejected", {
      message: "Your quick drop was declined. Please try another driver."
    });

    res.json({ message: "Request rejected" });
  } catch (err) {
    res.status(500).json({ message: "Error rejecting request" });
  }
});

// ─────────────────────────────────────────────────────────
// NOTE: Legacy polling endpoints removed.
// All real-time updates are delivered via Socket.io events:
//   new_request         → fires when a passenger requests a ride
//   ride_requests_list  → fires on driver reconnect (request_current_rides)
//   new_quick_request   → fires when a quick-drop request is submitted
//   ride_accepted       → fires when driver accepts a passenger
//   ride_rejected       → fires when driver rejects a passenger
//   ride_cancelled      → fires when driver aborts the mission
//   ride_completed      → fires when driver finishes the journey
//   quick_drop_accepted → fires when driver accepts a quick-drop
// ─────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────
// START SERVER
// Use `server.listen` (not `app.listen`) so Socket.io shares the port
// ─────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});

// ─────────────────────────────────────────────────────────
// MY TRIPS — returns the authenticated user's ride history
// Shows rides where they were a driver OR a passenger.
// ─────────────────────────────────────────────────────────
app.get("/my-trips", auth, async (req, res) => {
  const { email } = req.user;
  try {
    // Route Share - Driver
    const driverRides = await Ride.find({ driverEmail: email })
      .select("destination fare time createdAt status")
      .lean();

    // Route Share - Passenger
    const passengerRides = await Ride.find({
      "requests.email": email,
      "requests.status": { $in: ["accepted", "arrived", "paid"] }
    })
      .select("destination fare time driverName createdAt status")
      .lean();

    // Quick Drop - Driver
    const qdDriver = await QuickRequest.find({ driverEmail: email })
      .select("pickup drop createdAt status passengerName fare")
      .lean();

    // Quick Drop - Passenger
    const qdPassenger = await QuickRequest.find({ passengerEmail: email })
      .select("pickup drop createdAt status driverName fare")
      .lean();

    const driverFormatted = driverRides.map(r => ({ ...r, role: "driver" }));
    const passengerFormatted = passengerRides.map(r => ({ ...r, role: "passenger" }));

    // Format Quick Drops to match Route Share UI expectations
    const qdDriverFormatted = qdDriver.map(r => ({
      ...r,
      role: "driver",
      destination: (r.pickup || "Campus") + " → " + (r.drop || "Campus"),
      fare: r.fare || 0,
      time: "Quick Drop"
    }));

    const qdPassengerFormatted = qdPassenger.map(r => ({
      ...r,
      role: "passenger",
      destination: (r.pickup || "Campus") + " → " + (r.drop || "Campus"),
      fare: QUICK_DROP_FARE,
      time: "Quick Drop"
    }));

    // Merge and sort by date descending
    const all = [...driverFormatted, ...passengerFormatted, ...qdDriverFormatted, ...qdPassengerFormatted]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 30);

    res.json(all);
  } catch (err) {
    console.error("My trips error:", err);
    res.status(500).json({ message: "Could not fetch trip history" });
  }
});

// ─────────────────────────────────────────────────────────
// MY EARNINGS — driver's fare history + platform fee summary
// Platform takes PLATFORM_FEE_PERCENT (10%) of monthly gross.
// ─────────────────────────────────────────────────────────
app.get("/my-earnings", auth, async (req, res) => {
  const { email: driverEmail } = req.user;
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const allEarnings = await Earning.find({ driverEmail })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    const monthEarnings = allEarnings.filter(e => new Date(e.createdAt) >= startOfMonth);
    const totalMonthly = monthEarnings.reduce((s, e) => s + (e.fare || 0), 0);
    const platformFee = parseFloat((totalMonthly * PLATFORM_FEE_PERCENT / 100).toFixed(2));
    const netMonthly = parseFloat((totalMonthly - platformFee).toFixed(2));
    const totalAllTime = parseFloat(allEarnings.reduce((s, e) => s + (e.fare || 0), 0).toFixed(2));

    res.json({
      earnings: allEarnings.slice(0, 30),   // last 30 for display
      totalMonthly: parseFloat(totalMonthly.toFixed(2)),
      platformFee,
      netMonthly,
      totalAllTime
    });
  } catch (err) {
    console.error("My earnings error:", err);
    res.status(500).json({ message: "Could not fetch earnings" });
  }
});