# 🚗 BROSKI - Campus Ride Sharing Platform ( WEB APP )

BROSKI is a real-time ride-sharing and carpooling platform designed specifically for university campuses. It connects verified student drivers with student passengers for secure, affordable, and convenient transportation.

## ✨ Highlights

- Real-time ride tracking with Socket.io
- Interactive maps using Leaflet & OpenStreetMap
- Quick campus rides and long-distance carpooling
- Fare negotiation system
- UPI & Cash payment support
- Driver earnings dashboard
- JWT Authentication & Role-Based Access
- OTP Email Verification
- Disconnect Recovery & Session Restoration

---

## 🛠 Tech Stack

### Frontend
- HTML5
- CSS3
- JavaScript (ES6)

### Backend
- Node.js
- Express.js
- Socket.io

### Database
- MongoDB Atlas
- Mongoose

### Maps & Routing
- Leaflet.js
- OpenStreetMap
- OSRM API
- Nominatim API

### Security
- JWT Authentication
- Bcrypt Password Hashing
- Rate Limiting

---

## 🏗 Architecture

```mermaid
graph LR
A[Passenger] --> B[Node.js Backend]
C[Driver] --> B
B --> D[(MongoDB)]
B --> E[Socket.io]
E --> A
E --> C
