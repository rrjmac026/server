require('dotenv').config();
const express = require("express");
const cors = require("cors");

// Import routes
const sensorRoutes = require('./routes/sensor');
const auditRoutes = require('./routes/audit');
// const reportRoutes = require('./routes/reports');
// const scheduleRoutes = require('./routes/schedules');

const app = express();
const port = process.env.PORT || 3000;

// ✅ Middleware Setup
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Default Route
app.get("/", (req, res) => {
  res.send("🚀 Welcome to the Plant Monitoring API! Use the correct endpoints.");
});

// ✅ Health Check
app.get("/api/health", (req, res) => {
  res.json({ status: "✅ Server is running" });
});

// ✅ Mount Routes
app.use('/', sensorRoutes);
app.use('/', auditRoutes);
// app.use('/', reportRoutes);
// app.use('/', scheduleRoutes);

// ✅ Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Internal server error" });
});

// ✅ 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

// ✅ Start Server
app.listen(port, () => {
  console.log(`✅ Server started at http://localhost:${port}`);
});