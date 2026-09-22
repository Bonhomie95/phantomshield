/**
 * Realtime link between this device and the backend.
 *
 * Why this exists: the app previously had NO WebSocket client at all. Remote
 * commands (lock / wipe / alarm / locate) were only ever picked up by an HTTP
 * poll that ran when the app came to the foreground, and queued commands expire
 * after an hour — so "lock my stolen phone from the web" usually did nothing.
 *
 * With this socket open the device:
 *   • receives commands the instant they are issued,
 *   • holds live presence, so the dashboard can show "Online" truthfully,
 *   • answers a `locate` request with its current position.
 *
 * Auth uses the same single-use ticket flow as the dashboard — no long-lived
 * token is ever placed in a URL.
 */
import { AppState, AppStateStatus } from 'react-native';
import { API_URL } from '@/constants/config';
import { getOrCreateDeviceId, requestWsTicket, reportLocation } from '@/services/api';
import { applyCommand } from '@/services/commands';
import { usePhantomStore } from '@/stores/phantom';
import { captureError } from '@/services/monitoring';

/** Derive the ws(s):// origin from the http(s):// API base (which ends in /api). */
function wsUrl(): string {
  const base = API_URL.replace(/\/api\/?$/, '');
  return base.replace(/^http/, 'ws') + '/ws';
}

type Socket = WebSocket & { _psHeartbeat?: ReturnType<typeof setInterval> };

let socket: Socket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let attempt = 0;
let stopped = true;
let appStateSub: { remove: () => void } | null = null;

const clearReconnect = () => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
};

const scheduleReconnect = () => {
  if (stopped || reconnectTimer) return;
  // Exponential backoff capped at 60s: a device with no network must not spin.
  const delay = Math.min(1000 * 2 ** Math.min(attempt, 6), 60_000);
  attempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, delay);
};

async function connect(): Promise<void> {
  if (stopped) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const store = usePhantomStore.getState();
  if (!store.isAuthenticated) return;

  let ticket: string | null = null;
  try {
    ticket = await requestWsTicket();
  } catch (err) {
    captureError(err, { scope: 'realtime.ticket' });
  }
  if (!ticket) {
    scheduleReconnect();
    return;
  }

  const deviceId = await getOrCreateDeviceId();
  const url = `${wsUrl()}?ticket=${encodeURIComponent(ticket)}&deviceId=${encodeURIComponent(deviceId)}`;

  let ws: Socket;
  try {
    ws = new WebSocket(url) as Socket;
  } catch (err) {
    captureError(err, { scope: 'realtime.open' });
    scheduleReconnect();
    return;
  }
  socket = ws;

  ws.onopen = () => {
    attempt = 0;
    // Answer the server's application-level ping so presence keeps its TTL.
    ws._psHeartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'pong', payload: {}, timestamp: Date.now() }));
      }
    }, 25_000);
  };

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(String(e.data)) as {
        type: string;
        payload?: Record<string, unknown>;
      };

      // The handshake frame carries any commands queued while we were offline.
      if (msg.type === 'connected') {
        const queued = (msg.payload?.queuedCommands ?? []) as { command: string; payload: unknown }[];
        for (const c of queued) void applyCommand(c.command, c.payload);
        return;
      }

      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', payload: {}, timestamp: Date.now() }));
        return;
      }

      // A command targeted at THIS device.
      if (msg.type === 'device_locked') {
        const target = msg.payload?.deviceId;
        if (typeof target === 'string' && target !== deviceId) return;
        const action = msg.payload?.action;
        if (action === 'alert') void applyCommand('send_alert', msg.payload);
        else if (action === 'locate') void reportLocation().catch(() => {});
        else if (action === 'lost_mode' || action === 'lost_mode_off') void applyCommand(action, msg.payload);
        else void applyCommand('lock_app', msg.payload);
      }
    } catch {
      /* ignore malformed frames */
    }
  };

  const cleanup = () => {
    if (ws._psHeartbeat) clearInterval(ws._psHeartbeat);
    ws._psHeartbeat = undefined;
    if (socket === ws) socket = null;
    scheduleReconnect();
  };

  ws.onclose = cleanup;
  ws.onerror = () => {
    try {
      ws.close();
    } catch {
      cleanup();
    }
  };
}

function disconnect(): void {
  clearReconnect();
  const ws = socket;
  socket = null;
  if (!ws) return;
  if (ws._psHeartbeat) clearInterval(ws._psHeartbeat);
  ws.onclose = null;
  ws.onerror = null;
  try {
    ws.close();
  } catch {
    /* already gone */
  }
}

/**
 * Start the realtime link and keep it tied to app lifecycle.
 * Returns a teardown function.
 */
export function initRealtime(): () => void {
  stopped = false;
  attempt = 0;
  void connect();

  appStateSub?.remove();
  appStateSub = AppState.addEventListener('change', (next: AppStateStatus) => {
    if (next === 'active') {
      // Sockets are routinely killed while backgrounded; reopen on return.
      attempt = 0;
      void connect();
    }
  });

  return () => {
    stopped = true;
    appStateSub?.remove();
    appStateSub = null;
    disconnect();
  };
}

/** True when the device currently holds a live link to the server. */
export function isRealtimeConnected(): boolean {
  return socket?.readyState === WebSocket.OPEN;
}
