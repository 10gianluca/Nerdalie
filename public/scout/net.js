/* Peer-to-peer link between two browsers via PeerJS (WebRTC). The host is authoritative. */
(function (root) {
  'use strict';

  const PEER_PREFIX = 'scout-v1-';
  const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const PING_MS = 4000;
  const TIMEOUT_MS = 13000;

  function makeCode(len = 5) {
    const bytes = crypto.getRandomValues(new Uint8Array(len));
    return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  }

  const normalizeCode = (raw) => (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  function describeError(err) {
    switch (err && err.type) {
      case 'peer-unavailable': return 'Room not found. Check the code, or ask the host to open the game.';
      case 'unavailable-id': return 'That room code is already in use.';
      case 'browser-incompatible': return 'This browser does not support online play.';
      case 'network':
      case 'socket-error':
      case 'socket-closed':
      case 'server-error': return 'Cannot reach the matchmaking server. Check your internet connection.';
      default: return (err && err.message) || 'Connection problem';
    }
  }

  // Wraps one DataConnection with JSON messages and a heartbeat so drops are noticed quickly.
  function watchConnection(conn, { onMessage, onLost }) {
    let lastSeen = Date.now();
    let closed = false;
    const lose = () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      onLost();
    };
    const timer = setInterval(() => {
      if (Date.now() - lastSeen > TIMEOUT_MS) {
        lose();
        try { conn.close(); } catch (_) { /* already gone */ }
      } else if (conn.open) {
        conn.send({ t: 'ping' });
      }
    }, PING_MS);
    conn.on('data', (msg) => {
      lastSeen = Date.now();
      if (msg && msg.t !== 'ping') onMessage(msg);
    });
    conn.on('close', lose);
    conn.on('error', lose);
    return { send: (msg) => conn.open && conn.send(msg), close: () => { lose(); conn.close(); } };
  }

  // Host: owns the room code and accepts one guest at a time.
  function hostRoom(code, { onReady, onGuestMessage, onGuestLost, onError }) {
    const peer = new Peer(PEER_PREFIX + code, { debug: 1 });
    let link = null;

    peer.on('open', () => onReady(code));
    peer.on('connection', (conn) => {
      conn.on('open', () => {
        const next = watchConnection(conn, {
          onMessage: (msg) => onGuestMessage(msg, next),
          onLost: () => {
            if (link === next) {
              link = null;
              onGuestLost();
            }
          },
        });
        // Hand the seat to the newest connection; the app decides whether it is allowed in.
        next.accept = () => {
          if (link && link !== next) link.close();
          link = next;
        };
      });
    });
    peer.on('disconnected', () => {
      if (!peer.destroyed) setTimeout(() => !peer.destroyed && peer.reconnect(), 1500);
    });
    peer.on('error', (err) => onError(err, describeError(err)));

    return {
      send: (msg) => link && link.send(msg),
      destroy: () => peer.destroy(),
    };
  }

  // Guest: connects to a host code and keeps retrying if the link drops.
  function joinRoom(code, { onOpen, onMessage, onLost, onError }) {
    const peer = new Peer({ debug: 1 });
    let link = null;
    let retryTimer = null;
    let stopped = false;

    const connect = () => {
      if (stopped || peer.destroyed) return;
      if (peer.disconnected) peer.reconnect();
      const conn = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
      conn.on('open', () => {
        link = watchConnection(conn, {
          onMessage,
          onLost: () => {
            link = null;
            onLost();
            scheduleRetry();
          },
        });
        onOpen();
      });
    };
    const scheduleRetry = () => {
      clearTimeout(retryTimer);
      if (!stopped) retryTimer = setTimeout(connect, 3000);
    };

    peer.on('open', connect);
    peer.on('disconnected', () => !stopped && setTimeout(() => !peer.destroyed && peer.reconnect(), 1500));
    peer.on('error', (err) => {
      onError(err, describeError(err));
      if (!link && err.type !== 'browser-incompatible') scheduleRetry();
    });

    return {
      send: (msg) => link && link.send(msg),
      destroy: () => {
        stopped = true;
        clearTimeout(retryTimer);
        peer.destroy();
      },
    };
  }

  root.ScoutNet = { makeCode, normalizeCode, hostRoom, joinRoom };
})(window);
