'use client';
import { useEffect, useRef, useCallback, useState } from 'react';
import { getDeviceId } from '@/lib/deviceId';
import type { WSMessage } from '@phantomshield/shared';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3002/ws';

// Re-export the shared wire type so consumers keep a single source of truth.
export type WSEvent = WSMessage;

type EventHandler = (event: WSEvent) => void;
export type WsStatus = 'connecting' | 'connected' | 'disconnected';

const RECONNECT_MS = 5000;

export const useWebSocket = (onEvent?: EventHandler) => {
  const wsRef = useRef<WebSocket | null>(null);
  const handlerRef = useRef<EventHandler | undefined>(onEvent);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disposedRef = useRef(false);
  const [status, setStatus] = useState<WsStatus>('connecting');

  // Always call the latest handler without re-subscribing the socket.
  useEffect(() => { handlerRef.current = onEvent; }, [onEvent]);

  const scheduleReconnect = useCallback((connect: () => void) => {
    if (disposedRef.current) return;
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    reconnectTimer.current = setTimeout(connect, RECONNECT_MS);
  }, []);

  const connect = useCallback(async () => {
    if (disposedRef.current) return;
    // Don't open a second socket (StrictMode double-mount / overlapping reconnect).
    const existing = wsRef.current;
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
      return;
    }

    setStatus('connecting');
    const deviceId = getDeviceId();
    let ticket: string | undefined;
    try {
      const res = await fetch(`/api/auth/ws-ticket?deviceId=${encodeURIComponent(deviceId)}`, {
        credentials: 'include',
      });
      if (res.ok) ticket = (await res.json()).ticket;
    } catch {
      /* fall through to retry */
    }
    if (disposedRef.current) return;
    if (!ticket) {
      setStatus('disconnected');
      scheduleReconnect(connect);
      return;
    }

    const url = `${WS_URL}?ticket=${encodeURIComponent(ticket)}&deviceId=${encodeURIComponent(deviceId)}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (disposedRef.current) { ws.close(); return; }
      setStatus('connected');
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as WSEvent;
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', payload: {}, timestamp: Date.now() }));
          return;
        }
        handlerRef.current?.(msg);
      } catch { /* ignore malformed */ }
    };

    ws.onclose = () => {
      if (disposedRef.current) return;
      setStatus('disconnected');
      scheduleReconnect(connect);
    };

    ws.onerror = () => ws.close();
  }, [scheduleReconnect]);

  useEffect(() => {
    disposedRef.current = false;
    connect();
    return () => {
      // Tear down for good: block any pending reconnect and detach handlers so a
      // late onclose can't schedule a new connection after unmount.
      disposedRef.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      const ws = wsRef.current;
      if (ws) {
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
        ws.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  return { status, isConnected: status === 'connected' };
};
