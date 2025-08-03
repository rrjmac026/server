require('dotenv').config();
const AppConfig = require('./config/app');
const DatabaseConfig = require('./config/database');
const routes = require('./routes');

// Create Express app
const app = AppConfig.createExpressApp();
const port = AppConfig.getPort();

// Mount all routes
app.use(routes);

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('❌ Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        message: `Cannot ${req.method} ${req.originalUrl}`,
        availableEndpoints: [
            'GET /api/health',
            'POST /api/sensor-data',
            'GET /api/sensor-data',
            'GET /api/plants/:plantId/latest-sensor-data',
            'GET /api/reports',
            'GET /api/reports/:plantId',
            'GET /api/audit-logs',
            'POST /api/schedules',
            'GET /api/schedules/:plantId'
        ]
    });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('🔄 SIGTERM received, shutting down gracefully');
    await DatabaseConfig.closeConnection();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🔄 SIGINT received, shutting down gracefully');
    await DatabaseConfig.closeConnection();
    process.exit(0);
});

// Start the server
app.listen(port, async () => {
    try {
        // Test database connection
        await DatabaseConfig.connectToDatabase();
        console.log(`✅ Server started at http://localhost:${port}`);
        console.log(`🌱 Plant Monitoring API is ready!`);
    } catch (error) {
        console.error('❌ Failed to start server:', error.message);
        process.exit(1);
    }
});

module.exports = app;