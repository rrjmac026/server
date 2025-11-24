const auditService = require('./audit.service');
const sensorService = require('./sensor.service');

async function sendCommand(plantId, command) {
  try {
    const sensorData = await sensorService.getLatestReading(plantId);
    if (!sensorData.isConnected) {
      throw new Error('ESP32 device is offline');
    }

    // TODO: Implement actual ESP32 communication (MQTT, HTTP, etc.)
    console.log(`Sending command to ESP32 for plant ${plantId}:`, command);
    
    // Log command sent
    await auditService.createAuditLog({
      plantId: plantId,
      type: 'device',
      action: 'command',
      status: 'sent',
      details: `Sent ${command.command} command to device`,
      command: command
    });

    return true;
  } catch (error) {
    console.error(`Failed to send command to ESP32: ${error.message}`);
    throw error;
  }
}

module.exports = {
  sendCommand
};