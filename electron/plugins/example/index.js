// Example plugin entry (runs in a child Node process via PluginManager)

console.log('example plugin started');

setInterval(() => {
  console.log('example plugin heartbeat');
}, 10_000);

process.on('message', (msg) => {
  // IPC placeholder for future commands (start/stop/config)
  if (msg && msg.type === 'ping') {
    try {
      process.send?.({ type: 'pong', ts: Date.now() });
    } catch (_) {}
  }
});















