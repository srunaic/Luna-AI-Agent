const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');

/**
 * Very small "parts/plugin" manager.
 *
 * Goals:
 * - Heavy features can be shipped/updated as optional parts (plugins) instead of always-on code
 * - Run plugins in a separate Node process to isolate crashes and cap resource usage later
 *
 * Plugin layout:
 *   <pluginsDir>/<pluginId>/
 *     plugin.json   (manifest)
 *     index.js      (entry; runs in child process when enabled)
 */
class PluginManager {
  constructor({ pluginsDir, logger }) {
    this.pluginsDir = pluginsDir;
    this.log = logger || console;
    this.processes = new Map(); // pluginId -> child process
  }

  list() {
    try {
      if (!fs.existsSync(this.pluginsDir)) return [];
      const dirs = fs.readdirSync(this.pluginsDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
      const out = [];
      for (const id of dirs) {
        const manifestPath = path.join(this.pluginsDir, id, 'plugin.json');
        if (!fs.existsSync(manifestPath)) continue;
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
          out.push({
            id,
            name: manifest.name || id,
            version: manifest.version || '0.0.0',
            description: manifest.description || '',
            entry: manifest.entry || 'index.js',
            enabled: this.processes.has(id)
          });
        } catch (e) {
          out.push({ id, name: id, version: '0.0.0', description: 'Invalid manifest', entry: 'index.js', enabled: false, error: String(e?.message || e) });
        }
      }
      return out;
    } catch (e) {
      this.log.warn?.('[plugins] list failed', e);
      return [];
    }
  }

  enable(pluginId, env = {}) {
    if (this.processes.has(pluginId)) return { ok: true, already: true };
    const base = path.join(this.pluginsDir, pluginId);
    const manifestPath = path.join(base, 'plugin.json');
    if (!fs.existsSync(manifestPath)) return { ok: false, error: 'manifest not found' };

    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (e) {
      return { ok: false, error: 'invalid manifest' };
    }

    const entry = path.join(base, String(manifest.entry || 'index.js'));
    if (!fs.existsSync(entry)) return { ok: false, error: 'entry not found' };

    const child = fork(entry, [], {
      cwd: base,
      env: { ...process.env, ...(env || {}) },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });

    child.stdout?.on('data', (d) => this.log.info?.(`[plugin:${pluginId}]`, String(d).trim()));
    child.stderr?.on('data', (d) => this.log.error?.(`[plugin:${pluginId}]`, String(d).trim()));
    child.on('exit', (code) => {
      this.log.warn?.(`[plugin:${pluginId}] exited`, { code });
      this.processes.delete(pluginId);
    });
    child.on('error', (e) => {
      this.log.error?.(`[plugin:${pluginId}] error`, e);
      this.processes.delete(pluginId);
    });

    this.processes.set(pluginId, child);
    return { ok: true };
  }

  disable(pluginId) {
    const child = this.processes.get(pluginId);
    if (!child) return { ok: true, already: true };
    try {
      child.kill();
    } catch (_) {}
    this.processes.delete(pluginId);
    return { ok: true };
  }
}

module.exports = { PluginManager };















