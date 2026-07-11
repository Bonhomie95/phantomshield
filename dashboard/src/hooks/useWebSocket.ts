'use client';
import { useEffect, useRef, useCallback, useState } from 'react';
import Cookies from 'js-cookie';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3002/ws';

export type WSEvent =
  | { type: 'activity_event'; payload: Record<string, unknown> }
  | { type: 'intruder_alert'; payload: Record<string, unknown> }
  | { type: 'anomaly_alert'; payload: Record<string, unknown> }
  | { type: 'device_locked'; payload: Record<string, unknown> }
  | { type: 'device_wipe_logs'; payload: Record<string, unknown> }
  | { type: 'connected'; payload: Record<string, unknown> }
  | { type: 'ping'; payload: Record<string, unknown> };

type EventHandler = (event: WSEvent) => void;

export const useWebSocket = (onEvent?: EventHandler) => {
  const wsRef       = useRef<WebSocket | null>(null);
  const handlersRef = useRef<EventHandler[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (onEvent && !handlersRef.current.includes(onEvent)) {
    handlersRef.current.push(onEvent);
  }

  const connect = useCallback(() => {
    const token = Cookies.get('ps_access_token');
    if (!token) return;

    const url = `${WS_URL}?token=${encodeURIComponent(token)}&deviceId=dashboard`;
    const ws  = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as WSEvent;
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', payload: {}, timestamp: Date.now() }));
          return;
        }
        handlersRef.current.forEach(h => h(msg));
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      setIsConnected(false);
      // Reconnect after 5 seconds
      reconnectTimer.current = setTimeout(connect, 5000);
    };

    ws.onerror = () => ws.close();
  }, []);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [connect]);

  return { isConnected };
};
