const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:3000');

ws.on('open', () => {
  console.log('Connected to server');
});

ws.on('message', (data) => {
  const sensorData = JSON.parse(data);
  console.log('Real-time sensor data:', sensorData);
});

ws.on('close', () => {
  console.log('Disconnected from server');
});
