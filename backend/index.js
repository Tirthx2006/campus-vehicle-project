require('dotenv').config();
const bcrypt = require("bcrypt");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

console.log("=== THE BACKEND FILE IS RUNNING ===");
console.log("DEBUG: Testing MONGO_URI value ->", process.env.MONGO_URI ? "Found ✅" : "NOT FOUND ❌");

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch(err => console.log("❌ Connection Error:", err));

// Schema
const UserSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  gender: String,
  isCampusDriver: { type: Boolean, default: false },
  // NEW FIELDS FOR REAL-TIME TRACKING
  isOnline: { type: Boolean, default: false },
  currentRideID: { type: mongoose.Schema.Types.ObjectId, ref: 'Ride', default: null },
  driverDetails: {
    licenseNumber: String,
    vehicleModel: String,
    vehicleNumber: String,
    agreedToTerms: Boolean
  }
});

const User = mongoose.model("User", UserSchema, "users");


// NEW: Ride Schema for Outside Campus mode

const RideSchema = new mongoose.Schema({
  driverEmail: String,
  driverName: String,
  destination: String,
  seats: Number,
  time: String,
  fare: Number,
  status: { type: String, default: 'active' },
  requests: [{
    email: String,
    name: String,
    status: { type: String, default: 'pending' }
  }],
  // 🚨 ADD THIS LINE:
  createdAt: { type: Date, default: Date.now }
});

const Ride = mongoose.model("Ride", RideSchema, "rides");

// NEW: Schema for Inside Campus Quick Drops
const QuickRequestSchema = new mongoose.Schema({
  passengerEmail: String,
  passengerName: String,
  driverEmail: String,
  pickup: String,
  drop: String,
  status: { type: String, default: 'pending' } // pending, accepted, completed
});
const QuickRequest = mongoose.model("QuickRequest", QuickRequestSchema, "quick_requests");


// ------------------------------------------SIGNUP API----------------------------------------------------------------
app.post("/signup", async (req, res) => {
  const { name, email, password, gender } = req.body;

  // Check if everything is arriving correctly
  if (!name || !email || !password || !gender) {
    return res.status(400).send("All fields are required, including gender");
  }

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(409).send("User already exists");

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = new User({
      name,
      email,
      password: hashedPassword,
      gender, // This stores it in MongoDB
      isCampusDriver: false
    });

    await user.save();
    res.status(201).send("User registered successfully");
  } catch (err) {
    console.error("Signup Error:", err);
    res.status(500).send("Server error during registration");
  }
});


//--------------------------------------------- LOGIN API-------------------------------------------------------
app.post("/login", async (req, res) => {

  console.log("Logged in:", req.body);
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Missing credentials" });
  }

  try {

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // ✅ Compare hashed password
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // ✅ SUCCESS RESPONSE (Matches Frontend Expectation)
    res.json({
      message: "Login successful",
      name: user.name,
      email: user.email,
      gender: user.gender, // 👈 ADD THIS LINE
      isCampusDriver: user.isCampusDriver
    });

  } catch (err) {

    console.log("LOGIN ERROR:", err);
    res.status(500).json({ message: "Login error" });

  }
});

// NEW: UPDATE DRIVER STATUS API
app.post("/update-driver-status", async (req, res) => {
  const { email, license, vehicleModel, vehicleNumber, agreed } = req.body;
  try {
    const user = await User.findOneAndUpdate(
      { email: email },
      {
        isCampusDriver: true,
        driverDetails: {
          licenseNumber: license,
          vehicleModel: vehicleModel,
          vehicleNumber: vehicleNumber,
          agreedToTerms: agreed
        }
      },
      { new: true }
    );
    res.json({ message: "Driver verified", isCampusDriver: true });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// Driver aborts the Route Share mission
app.post("/cancel-route", async (req, res) => {
  const { driverEmail } = req.body;
  try {
    // 🔥 PERMANENTLY DELETE the active ride
    await Ride.deleteMany({ driverEmail: driverEmail, status: 'active' });
    res.json({ message: "Mission aborted and deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Error cancelling route" });
  }
});

// Driver completes the trajectory
app.post("/complete-route", async (req, res) => {
  const { driverEmail } = req.body;
  try {
    // 🔥 PERMANENTLY DELETE the active ride
    await Ride.deleteMany({ driverEmail: driverEmail, status: 'active' });
    res.json({ message: "Journey Completed and data cleared" });
  } catch (err) {
    res.status(500).json({ message: "Error completing route" });
  }
});

// 🚨 EMERGENCY CLEANUP: Triggered when the browser tab is closed
app.post("/emergency-cleanup", async (req, res) => {
  const { driverEmail } = req.body;
  try {
    // Delete any active rides they left behind
    await Ride.deleteMany({ driverEmail: driverEmail, status: 'active' });

    // Also set them to offline just in case!
    await User.findOneAndUpdate({ email: driverEmail }, { isOnline: false });

    res.status(200).send("Cleanup successful");
  } catch (err) {
    res.status(500).send("Cleanup failed");
  }
});

// ADD THIS ENDPOINT
app.post("/publish-route", async (req, res) => {
  const { driverEmail, driverName, destination, seats, time, fare } = req.body;

  try {
    // 🚨 ANTI-CLASH FIX: Cancel any existing active rides for this driver across all devices
    await Ride.updateMany(
      { driverEmail: driverEmail, status: 'active' },
      { status: 'cancelled' }
    );

    // Now safely create the fresh trajectory
    const newRide = new Ride({
      driverEmail,
      driverName,
      destination,
      seats: parseInt(seats),
      time,
      fare: parseFloat(fare),
      status: 'active'
    });

    await newRide.save();
    res.json({ message: "Route published successfully", rideId: newRide._id });
  } catch (err) {
    console.error("DB Save Error:", err);
    res.status(500).json({ message: "Error saving route" });
  }
});

// NEW: API to update user profile info
app.post("/update-profile", async (req, res) => {
  const { email, gender } = req.body;
  try {
    const user = await User.findOneAndUpdate(
      { email: email },
      { gender: gender },
      { new: true }
    );
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ message: "Profile updated successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// ✅ ENSURE THIS IS IN index.js
app.post("/toggle-online", async (req, res) => {
  const { email, status } = req.body;
  try {
    // We use { new: true } to get the updated document back
    const user = await User.findOneAndUpdate(
      { email: email },
      { isOnline: status },
      { new: true }
    );

    if (!user) {
      console.log("Sync Error: User not found ->", email);
      return res.status(404).json({ message: "User not found" });
    }

    console.log(`Driver Status Change: ${email} is now ${status ? 'ONLINE' : 'OFFLINE'}`);
    res.json({ message: "Sync Successful", isOnline: user.isOnline });
  } catch (err) {
    console.error("Toggle Error details:", err);
    res.status(500).json({ message: "Server error during sync" });
  }
});

// 1. Passenger sends a Quick Drop request
app.post("/request-quick-drop", async (req, res) => {
  const { passengerEmail, passengerName, driverEmail, pickup, drop } = req.body;
  try {
    const newReq = new QuickRequest({ passengerEmail, passengerName, driverEmail, pickup, drop });
    await newReq.save();
    res.json({ message: "Request sent", requestId: newReq._id });
  } catch (err) {
    res.status(500).json({ message: "Error sending request" });
  }
});

// 2. Driver fetches pending requests targeted at them
app.get("/get-quick-requests", async (req, res) => {
  try {
    const { driverEmail } = req.query;
    const requests = await QuickRequest.find({ driverEmail: driverEmail, status: 'pending' });
    res.json(requests);
  } catch (err) {
    res.status(500).json({ message: "Scanner error" });
  }
});

// 3. Driver accepts the request
app.post("/accept-quick-drop", async (req, res) => {
  const { requestId } = req.body;
  try {
    await QuickRequest.findByIdAndUpdate(requestId, { status: 'accepted' });
    res.json({ message: "Accepted" });
  } catch (err) {
    res.status(500).json({ message: "Error accepting" });
  }
});

// 4. Passenger polls to see if the driver accepted
app.get("/quick-drop-status", async (req, res) => {
  const { requestId } = req.query;
  try {
    const reqData = await QuickRequest.findById(requestId);
    res.json({ status: reqData ? reqData.status : 'not_found' });
  } catch (err) {
    res.status(500).json({ message: "Error checking status" });
  }
});

// API for Passenger to find nearby Campus Drivers
app.get("/search-campus-drivers", async (req, res) => {
  try {
    const activeDrivers = await User.find({
      isCampusDriver: true,
      isOnline: true
    }).select("name email gender driverDetails"); // Only send necessary info

    res.json(activeDrivers);
  } catch (err) {
    res.status(500).json({ message: "Radar error" });
  }
});

app.post("/accept-passenger", async (req, res) => {
  const { driverEmail, passengerEmail } = req.body;
  try {
    const ride = await Ride.findOne({ driverEmail, status: 'active' });

    if (!ride) return res.status(404).json({ message: "No active trajectory found" });
    if (ride.seats <= 0) return res.status(400).json({ message: "No seats available" });

    const request = ride.requests.find(r => r.email === passengerEmail);
    if (request && request.status === 'pending') {
      request.status = 'accepted';
      ride.seats -= 1;
      await ride.save();

      const acceptedCount = ride.requests.filter(r => r.status === 'accepted').length;
      res.json({
        message: "Linked",
        bookedSeats: acceptedCount,
        totalSeats: ride.seats + acceptedCount
      });
    } else {
      res.status(400).json({ message: "Request already handled or not found" });
    }
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});


// Polish: Search Routes (Better sorting and Anti-Ghosting)
app.get("/search-routes", async (req, res) => {
  const { destination } = req.query;
  if (!destination) return res.json([]);

  try {
    // 🚨 ANTI-GHOST FIX: Only find rides created within the last 12 hours
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);

    const rides = await Ride.find({
      destination: { $regex: destination, $options: 'i' },
      status: 'active',
      seats: { $gt: 0 },
      createdAt: { $gte: twelveHoursAgo } // Ignore old rides!
    }).sort({ time: 1 }); // Sort by soonest departure

    res.json(rides);
  } catch (err) {
    res.status(500).send("Search error");
  }
});

// 1. Passenger sends the request
app.post("/request-ride", async (req, res) => {
  const { rideId, passengerEmail, passengerName } = req.body;
  try {
    await Ride.findByIdAndUpdate(rideId, {
      $push: { requests: { email: passengerEmail, name: passengerName, status: 'pending' } }
    });
    res.json({ message: "Request sent" });
  } catch (err) { res.status(500).send("Error"); }
});

// 2. Driver fetches requests for their active ride
app.get("/get-ride-requests", async (req, res) => {
  const { driverEmail } = req.query;
  try {
    const ride = await Ride.findOne({ driverEmail, status: 'active' });
    res.json(ride ? ride.requests : []);
  } catch (err) { res.status(500).send("Error"); }
});


// Check Passenger Status (Updated to detect Driver Abort/Complete)
app.get("/get-my-request-status", async (req, res) => {
  const { rideId, email } = req.query;
  try {
    const ride = await Ride.findById(rideId);

    // 🚨 If the ride doesn't exist anymore, the driver ended it!
    if (!ride) return res.json({ status: 'driver_ended' });

    const myRequest = ride.requests.find(r => r.email === email);
    res.json({ status: myRequest ? myRequest.status : 'kicked' });
  } catch (err) {
    res.status(500).send("Error");
  }
});

// NEW: Passenger actively leaves the ride
app.post("/leave-ride", async (req, res) => {
  const { rideId, passengerEmail } = req.body;
  try {
    const ride = await Ride.findById(rideId);
    if (!ride) return res.json({ message: "Ride already gone" });

    const requestIndex = ride.requests.findIndex(r => r.email === passengerEmail);
    if (requestIndex !== -1) {
      // If they were already accepted, give the driver their seat back!
      if (ride.requests[requestIndex].status === 'accepted') {
        ride.seats += 1;
      }
      // Remove passenger from the list
      ride.requests.splice(requestIndex, 1);
      await ride.save();
    }
    res.json({ message: "Left successfully" });
  } catch (err) {
    res.status(500).json({ message: "Error leaving ride" });
  }
});

// 🧹 TEMPORARY: Database Cleanup Endpoint
app.get("/nuke-ghosts", async (req, res) => {
  try {
    // This deletes ALL active rides currently stuck in the database
    const result = await Ride.deleteMany({ status: 'active' });
    res.send(`💥 BOOM! Database flushed. Deleted ${result.deletedCount} ghost rides.`);
  } catch (err) {
    res.status(500).send("Error nuking ghosts.");
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});