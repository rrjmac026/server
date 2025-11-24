require('dotenv').config();
const express = require("express");
const cors = require("cors");

const { connectToDatabase } = require('./config/database');
const middleware = require('./middleware');

// Import routes
const authRoutes = require('./routes/auth.routes');
const sensorRoutes = require('./routes/sensor.routes');
const reportRoutes = require('./routes/report.routes');
const auditRoutes = require('./routes/audit.routes');
const scheduleRoutes = require('./routes/schedule.routes');

const app = express();
const port = process.env.PORT || 3000;

// Apply middleware
middleware(app);

// Default routes
app.get("/", (req, res) => {
  res.send("🚀 Welcome to the Plant Monitoring API! Use the correct endpoints.");
});

app.get("/api/health", (req, res) => {
  res.json({ status: "✅ Server is running" });
});

// API routes
app.use('/api', authRoutes);
app.use('/api', sensorRoutes);
app.use('/api', reportRoutes);
app.use('/api', auditRoutes);
app.use('/api', scheduleRoutes);

// Start server
app.listen(port, async () => {
  try {
    await connectToDatabase();
    console.log(`✅ Server started at http://localhost:${port}`);
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
});