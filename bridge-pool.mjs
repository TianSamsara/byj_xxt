// Each client handles one operation at a time. Search policies never share a process.
export class ClientPool {
  constructor({ Client, binary, cwd, limit = 2, idleMs = 90000 }) {
    Object.assign(this, { Client, binary, cwd, limit, idleMs });
    this.entries = new Set();
    this.closed = false;
  }
  discard(entry) {
    if (!this.entries.delete(entry)) return;
    clearTimeout(entry.timer);
    entry.client.close();
  }
  acquire(search) {
    if (this.closed) throw new Error('桥接正在关闭');
    for (const entry of this.entries) if (entry.client.dead) this.discard(entry);
    let entry = [...this.entries].find(e => !e.busy && e.search === search);
    if (entry) {
      clearTimeout(entry.timer); entry.busy = true;
      return { entry, reused: true };
    }
    if (this.entries.size >= this.limit) {
      const idle = [...this.entries].find(e => !e.busy);
      if (!idle) throw new Error('本地 Codex 正忙，请稍后重试');
      this.discard(idle);
    }
    const client = new this.Client(this.binary, this.cwd, search);
    entry = { client, search, busy: true };
    this.entries.add(entry);
    // Convert a synchronous initialization failure into an awaited rejection, too.
    entry.ready = Promise.resolve().then(() => client.init());
    return { entry, reused: false };
  }
  release(entry, healthy) {
    if (!this.entries.has(entry)) return;
    if (!healthy || entry.client.dead || this.closed) return this.discard(entry);
    entry.busy = false;
    entry.timer = setTimeout(() => this.discard(entry), this.idleMs);
    entry.timer.unref?.();
  }
  close() {
    this.closed = true;
    for (const entry of this.entries) this.discard(entry);
  }
}
