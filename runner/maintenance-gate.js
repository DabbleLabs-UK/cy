// Local operator maintenance admission gate. It never aborts admitted work.
import { readFileSync, writeFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

export class MaintenanceGate {
  constructor({ directory = process.env.CY_MAINTENANCE_DIR || '', fs = null, pid = process.pid,
    now = () => new Date().toISOString(), additionalActive = () => 0 } = {}) {
    this.directory = directory;
    this.fs = fs || { readFileSync, writeFileSync, renameSync, statSync };
    this.pid = pid;
    this.now = now;
    this.additionalActive = additionalActive;
    this.active = 0;
    this.timer = null;
    this.blocked = false;
    this.requestId = null;
    this.error = false;
  }

  refresh() {
    if (!this.directory) return { state: 'running', active: this.active };
    this.error = false;
    let directoryReady = false;
    try {
      directoryReady = this.fs.statSync(this.directory).isDirectory();
      if (!directoryReady) throw new Error('maintenance directory unavailable');
      const request = JSON.parse(this.fs.readFileSync(join(this.directory, 'request.json'), 'utf8'));
      if (request.version !== 1 || typeof request.id !== 'string'
          || !/^[A-Za-z0-9_.-]{1,128}$/.test(request.id)) throw new Error('invalid maintenance request');
      this.requestId = request.id;
      this.blocked = true;
    } catch (error) {
      this.requestId = null;
      this.blocked = !directoryReady || error.code !== 'ENOENT';
      this.error = this.blocked;
    }
    let extra = 0;
    try { extra = Math.max(0, Number(this.additionalActive()) || 0); }
    catch { this.error = true; this.blocked = true; }
    const active = this.active + extra;
    const status = { version: 1, pid: this.pid, requestId: this.requestId,
      state: this.error ? 'error' : this.blocked ? active ? 'draining' : 'held' : 'running',
      active, updatedAt: this.now() };
    try {
      const path = join(this.directory, 'cy-status.json');
      const temporary = `${path}.${this.pid}.tmp`;
      this.fs.writeFileSync(temporary, JSON.stringify(status) + '\n', { mode: 0o600 });
      this.fs.renameSync(temporary, path);
    } catch {
      // A stale status must never authorize admission or count as fresh held evidence.
      this.error = true;
      this.blocked = true;
      status.state = 'error';
    }
    return status;
  }

  enter({ drainExisting = false } = {}) {
    this.refresh();
    if (this.error || (this.blocked && !drainExisting)) return null;
    this.active++;
    this.refresh();
    if (this.error) {
      this.active--;
      return null;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.refresh();
    };
  }

  start() {
    this.refresh();
    if (this.directory && !this.timer) {
      this.timer = setInterval(() => this.refresh(), 500);
      this.timer.unref();
    }
  }

  stop() { clearInterval(this.timer); this.timer = null; }
}
