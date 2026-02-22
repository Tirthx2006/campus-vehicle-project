const bcrypt = require("bcrypt");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

console.log("=== THE BACKEND FILE IS RUNNING ===");


const app = express();
app.use(cors());
app.use(express.json());

// MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.log(err));

// Schema
const UserSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  gender: String, // Add this line
  isCampusDriver: { type: Boolean, default: false },
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
  // This is the new part: it stores a list of passengers and their status
  requests: [{
    email: String,
    name: String,
    status: { type: String, default: 'pending' } // pending, accepted, or rejected
  }]
});

const Ride = mongoose.model("Ride", RideSchema, "rides");



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

// ADD THIS ENDPOINT
app.post("/publish-route", async (req, res) => {
  const { driverEmail, driverName, destination, seats, time, fare } = req.body;

  try {
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

app.get("/search-routes", async (req, res) => {
  const { destination } = req.query;
  try {
    // Find active rides where destination matches (case-insensitive)
    const rides = await Ride.find({
      destination: { $regex: destination, $options: 'i' },
      status: 'active'
    });
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

app.listen(5000, () => {
  console.log("Backend running on http://localhost:5000");
});
