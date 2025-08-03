const express = require("express");
const cors = require("cors");
require("dotenv").config();

class AppConfig {
    static createExpressApp() {
        const app = express();
        
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

        return app;
    }

    static getPort() {
        return process.env.PORT || 3000;
    }
}

module.exports = AppConfig;