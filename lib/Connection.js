'use strict';

const net = require('net');
const parseResponse = require('../lib/parseResponse');

const DEFAULT_OPTIONS = {
  // Maximum time the socket may sit idle (no data) before it is destroyed.
  // Also applies during the initial connect handshake.
  idleTimeoutMs: 30000,
  // Enable TCP keepalive so the kernel detects dead peers on long-lived sockets.
  keepAlive: true,
  // Initial delay before the first TCP keepalive probe is sent.
  keepAliveInitialDelayMs: 30000,
  // After close() is called the socket is gracefully ended; if the peer has
  // not sent its FIN within this grace period, the socket is forcibly
  // destroyed to prevent it from lingering in FIN-WAIT-2.
  closeGraceMs: 2000,
};

class Connection {

  constructor(host, port, options) {
    this.host = host;
    this.port = port;
    this.socket = null;

    const opts = Object.assign({}, DEFAULT_OPTIONS, options || {});
    this.idleTimeoutMs = opts.idleTimeoutMs;
    this.keepAlive = opts.keepAlive;
    this.keepAliveInitialDelayMs = opts.keepAliveInitialDelayMs;
    this.closeGraceMs = opts.closeGraceMs;

    this._closed = false;
    this._closeTimer = null;
    this._currentCallback = null;
    this._buffer = Buffer.alloc(0);
  }

  _invokeCurrent(err, value) {
    const cb = this._currentCallback;
    if (!cb) return;
    this._currentCallback = null;
    try {
      cb(err, value);
    } catch (e) {
      // Swallow "callback already called" style errors thrown by upstream
      // flow-control libraries (e.g. async.waterfall). Matches prior behavior.
    }
  }

  connect(callback) {
    this._closed = false;
    this._closeTimer = null;
    this._currentCallback = null;
    this._buffer = Buffer.alloc(0);

    this.socket = new net.Socket();
    this.socket.setEncoding('utf8');

    if (this.keepAlive) {
      this.socket.setKeepAlive(true, this.keepAliveInitialDelayMs);
    }
    if (this.idleTimeoutMs > 0) {
      this.socket.setTimeout(this.idleTimeoutMs);
    }

    this.socket.on('data', (data) => {
      this._buffer = Buffer.concat([this._buffer, Buffer.from(data)]);
      const delimiter = '\r';

      let delimiterIndex;
      while ((delimiterIndex = this._buffer.indexOf(delimiter)) !== -1) {
        // Tolerate ILS servers that terminate responses with <CR><LF>.
        const message = this._buffer
          .subarray(0, delimiterIndex)
          .toString()
        this._buffer = this._buffer.subarray(delimiterIndex + delimiter.length);

        if (!message) {
          continue;
        }

        let parsed;
        try {
          parsed = parseResponse(message);
        } catch (parseErr) {
          this._invokeCurrent(parseErr);
          continue;
        }
        this._invokeCurrent(null, parsed);
      }
    });

    this.socket.on('error', (err) => {
      this._invokeCurrent(err);
    });

    this.socket.on('timeout', () => {
      console.log('SIP2 socket idle timeout, destroying');
      const timeoutErr = new Error('SIP2 socket idle timeout');
      timeoutErr.code = 'ETIMEDOUT';
      this._invokeCurrent(timeoutErr);
      if (this.socket && !this.socket.destroyed) {
        this.socket.destroy(timeoutErr);
      }
    });

    this.socket.on('end', () => {
      console.log('Disconnected from SIP2 server');
    });

    this.socket.on('close', () => {
      console.log('SIP2 connection closed');
      if (this._closeTimer) {
        clearTimeout(this._closeTimer);
        this._closeTimer = null;
      }
    });

    this.socket.connect(this.port, this.host, callback);
    return this;
  }

  send(request, callback) {
    if (!this.socket || this._closed) {
      callback(new Error('No open SIP2 socket connection'));
      return;
    }
    this._currentCallback = callback;
    this.socket.write(request);
  }

  close() {
    if (!this.socket || this._closed) return;
    this._closed = true;

    try {
      this.socket.end();
    } catch (_) {
      // ignore errors ending an already-broken socket
    }

    this._closeTimer = setTimeout(() => {
      if (this.socket && !this.socket.destroyed) {
        this.socket.destroy();
      }
    }, this.closeGraceMs);
    if (typeof this._closeTimer.unref === 'function') {
      this._closeTimer.unref();
    }
  }

  destroy() {
    if (!this.socket) return;
    this._closed = true;
    if (this._closeTimer) {
      clearTimeout(this._closeTimer);
      this._closeTimer = null;
    }
    try {
      this.socket.destroy();
    } catch (_) {
      // ignore
    }
  }
}

module.exports = Connection;
