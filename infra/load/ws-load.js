// Realtime load scenario — 300 concurrent Socket.IO clients on the /ws namespace (docs/runbook-load.md,
// task 7.4). k6 has no Socket.IO client, so this speaks the engine.io v4 / socket.io v5 wire protocol
// directly over a raw WebSocket: engine OPEN (0{…}) -> namespace CONNECT (40/ws,) -> hold, answering
// server pings (2 -> 3) and counting namespace-connect errors (44). Auth is the session cookie in the
// upgrade handshake (the gateway authorizes there), captured once per pooled user in setup().
//
// Run: k6 run -e CUKS_URL=... -e CUKS_USER=... -e CUKS_PASS=... infra/load/ws-load.js
import ws from 'k6/ws';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { BASE, rampingStages, authenticatePool } from './config.js';

const nsErrors = new Counter('ws_namespace_errors');

export const options = {
  scenarios: {
    ws: { executor: 'ramping-vus', startVUs: 0, stages: rampingStages(), gracefulRampDown: '20s' },
  },
  thresholds: {
    ws_connecting: ['p(95)<1000'], // time to the WS upgrade
    ws_namespace_errors: ['count<1'], // any /ws CONNECT_ERROR (e.g. auth) fails the run
    checks: ['rate>0.99'], // namespace-connected checks
  },
};

export const setup = authenticatePool;

const WS_URL = `${BASE.replace(/^http/, 'ws')}/socket.io/?EIO=4&transport=websocket`;

export default function (data) {
  const auth = data.auths[(__VU - 1) % data.auths.length];
  const params = { headers: { Cookie: auth.cookieHeader }, tags: { name: 'ws' } };
  const holdMs = Number(__ENV.WS_HOLD_MS || 60000);

  const res = ws.connect(WS_URL, params, (socket) => {
    let connected = false;

    socket.on('message', (msg) => {
      if (msg.startsWith('0{')) {
        // engine.io OPEN -> connect the /ws namespace (session cookie already authorized the handshake).
        socket.send('40/ws,');
      } else if (msg.startsWith('40/ws')) {
        connected = true; // namespace CONNECT ack
      } else if (msg.startsWith('44')) {
        nsErrors.add(1); // namespace CONNECT_ERROR (auth/namespace rejected)
      } else if (msg === '2') {
        socket.send('3'); // engine.io PING -> PONG (EIO4: server pings)
      }
      // 42/ws,[event,data] broadcasts are received but not asserted here.
    });

    // Hold the connection for the configured window, then verify it actually joined /ws and close.
    socket.setTimeout(() => {
      check(connected, { 'ws /ws namespace connected': (c) => c });
      socket.close();
    }, holdMs);
  });

  check(res, { 'ws upgrade 101': (r) => r && r.status === 101 });
}
