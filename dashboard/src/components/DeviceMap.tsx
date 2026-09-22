'use client';
import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/**
 * Device location map.
 *
 * Tiles come from CARTO's free dark basemap over OpenStreetMap data — no API
 * key, no account, and no third party that needs to be told who our users are.
 * (Mapbox/Google would each mean a key, a bill, and another processor in the
 * privacy policy for a security product that shouldn't need one.)
 *
 * Rendered client-only: Leaflet touches `window` at import time, so the page
 * imports this through `next/dynamic` with `ssr: false`.
 */

export interface MapPing {
  lat: number;
  lng: number;
  accuracy: number;
  battery?: number;
  recordedAt: string;
  source?: string;
}

// Leaflet's default marker icons resolve to bundler-relative URLs that break
// under Next's asset pipeline. An inline SVG icon avoids the broken-image
// problem entirely and matches the product's palette.
const pin = (color: string, pulse = false) =>
  L.divIcon({
    className: '',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    html: `<span style="
      display:block;width:18px;height:18px;border-radius:50%;
      background:${color};border:3px solid #0A0E1A;
      box-shadow:0 0 0 2px ${color}66${pulse ? ';animation:statusPulse 2s ease-in-out infinite' : ''}
    "></span>`,
  });

const LATEST_ICON = pin('#00D4FF', true);
const TRAIL_ICON = pin('#8899BB');

/** Keep the viewport on the newest position as live updates arrive. */
function Recenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], map.getZoom(), { animate: true });
  }, [lat, lng, map]);
  return null;
}

export function DeviceMap({
  pings,
  height = 420,
}: {
  /** Newest first, as the API returns them. */
  pings: MapPing[];
  height?: number;
}) {
  // Oldest → newest so the polyline draws in travel order.
  const ordered = useMemo(() => [...pings].reverse(), [pings]);
  const latest = pings[0];

  if (!latest) {
    return (
      <div
        className="flex items-center justify-center rounded-2xl border border-phantom-border bg-phantom-surface text-sm text-phantom-muted"
        style={{ height }}
      >
        No location reported yet.
      </div>
    );
  }

  const path: [number, number][] = ordered.map((p) => [p.lat, p.lng]);

  return (
    <div className="overflow-hidden rounded-2xl border border-phantom-border" style={{ height }}>
      <MapContainer
        center={[latest.lat, latest.lng]}
        zoom={15}
        scrollWheelZoom
        style={{ height: '100%', width: '100%', background: '#0A0E1A' }}
      >
        <TileLayer
          // Attribution is a licence requirement for both OSM data and CARTO tiles.
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />

        {/* The trail the device actually travelled. */}
        {path.length > 1 && (
          <Polyline positions={path} pathOptions={{ color: '#00D4FF', weight: 3, opacity: 0.55 }} />
        )}

        {/* Honesty about precision: draw the reported accuracy radius rather
            than implying the pin is exact. */}
        {latest.accuracy > 0 && (
          <Circle
            center={[latest.lat, latest.lng]}
            radius={latest.accuracy}
            pathOptions={{ color: '#00D4FF', fillColor: '#00D4FF', fillOpacity: 0.08, weight: 1 }}
          />
        )}

        {/* Older fixes, so a stationary phone still shows it has been reporting. */}
        {ordered.slice(0, -1).map((p, i) => (
          <Marker key={`${p.recordedAt}-${i}`} position={[p.lat, p.lng]} icon={TRAIL_ICON}>
            <Popup>
              <div style={{ fontSize: 12 }}>
                {new Date(p.recordedAt).toLocaleString()}
                <br />
                ±{Math.round(p.accuracy)}m
              </div>
            </Popup>
          </Marker>
        ))}

        <Marker position={[latest.lat, latest.lng]} icon={LATEST_ICON}>
          <Popup>
            <div style={{ fontSize: 12 }}>
              <strong>Last seen here</strong>
              <br />
              {new Date(latest.recordedAt).toLocaleString()}
              <br />
              ±{Math.round(latest.accuracy)}m
              {typeof latest.battery === 'number' && (
                <>
                  <br />
                  Battery {Math.round(latest.battery * 100)}%
                </>
              )}
            </div>
          </Popup>
        </Marker>

        <Recenter lat={latest.lat} lng={latest.lng} />
      </MapContainer>
    </div>
  );
}

export default DeviceMap;
