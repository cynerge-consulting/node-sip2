'use strict';

const net = require('net');
const parseResponse = require('../lib/parseResponse');

class Connection {

  constructor(host, port) {
    this.host = host;
    this.port = port;
    this.socket = null;
  }

  connect(callback) {
    this.socket = new net.Socket();
    this.socket.setEncoding('utf8');

    this.socket.on('end', () => {
      console.log('Disconnected from SIP2 server');
    });

    this.socket.on('close', () => {
      console.log('SIP2 connection closed');
    });

    this.socket.connect(this.port, this.host, callback);
    return this;
  }

  send(request, callback) {
      if (!this.socket) {
        callback(new Error('No open SIP2 socket connection'));
      }
  
      let buffer = Buffer.alloc(0);
  
      this.socket.on('data', (data) => {
        console.log("data packet:", data);
        buffer = Buffer.concat([buffer, Buffer.from(data)]);
        const delimiter = '\r'; // Assuming '\r' is the delimiter
  
        let delimiterIndex;
        while ((delimiterIndex = buffer.indexOf(delimiter)) !== -1) {
        const message = buffer.subarray(0, delimiterIndex).toString();
        buffer = buffer.subarray(delimiterIndex + delimiter.length);
  
        try {
          callback(null, parseResponse(message));
        } catch (err) {
          // catch "callback already called" error, silently fail
          // console.error('Error in callback:', err);
        }
        }
      });
  
      this.socket.once('error', (err) => {
        if (callback) {
        callback(err);
        callback = null; // Ensure callback is only called once
        }
      });
  
      this.socket.once('error', err => callback(err));
      this.socket.write(request);
    }

  close() {
    if (this.socket) {
      // Add message
      this.socket.end();
    }
  }
}

module.exports = Connection;
