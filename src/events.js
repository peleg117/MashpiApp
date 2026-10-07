// Server-Sent Events hub: every connected browser receives live updates.
export class EventHub {
  #clients = new Set();

  connect(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    this.#clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      this.#clients.delete(res);
    });
  }

  publish(type, data) {
    const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.#clients) res.write(payload);
  }

  get size() {
    return this.#clients.size;
  }
}
