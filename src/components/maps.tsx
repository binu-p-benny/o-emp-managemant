"use client";

// Leaflet + OpenStreetMap maps (no API key needed). Swap the tile server with
// NEXT_PUBLIC_MAP_TILE_URL (e.g. a Mapbox or MapTiler raster URL) for production traffic.

import { useCallback, useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { Icon } from "@/components/icons";

type L = typeof Leaflet;

const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION =
  process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export const DEFAULT_CENTER: [number, number] = (() => {
  const raw = process.env.NEXT_PUBLIC_MAP_DEFAULT_CENTER; // "lat,lng"
  const parts = raw?.split(",").map(Number);
  return parts && parts.length === 2 && parts.every(Number.isFinite) ? [parts[0], parts[1]] : [10.1076, 76.3516]; // Oranzai Builders HQ, Aluva
})();

function useLeaflet(): L | null {
  const [lib, setLib] = useState<L | null>(null);
  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((m) => {
      if (!cancelled) setLib(((m as unknown as { default?: L }).default ?? m) as L);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return lib;
}

function createMap(L: L, el: HTMLElement, opts: Leaflet.MapOptions = {}) {
  const map = L.map(el, { scrollWheelZoom: false, ...opts });
  L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
  return map;
}

export function pinIcon(L: L, color = "#134332") {
  return L.divIcon({
    className: "map-pin",
    iconSize: [28, 36],
    iconAnchor: [14, 34],
    popupAnchor: [0, -30],
    html: `<svg viewBox="0 0 28 36" width="28" height="36"><path d="M14 1C7 1 2 6.3 2 13c0 9 12 21 12 21s12-12 12-21C26 6.3 21 1 14 1z" fill="${color}" stroke="#fff" stroke-width="2"/><circle cx="14" cy="13" r="4.5" fill="#fff"/></svg>`,
  });
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export type MapMarker = {
  lat: number;
  lng: number;
  color?: string;
  /** Plain-text popup content (escaped). */
  popup?: string;
  kind?: "pin" | "dot";
};
export type MapCircle = { lat: number; lng: number; radius: number; color?: string; dashed?: boolean };

/** Read-only map with pins and radius circles; auto-fits to its content. */
export function StaticMap({
  markers = [],
  circles = [],
  className = "h-72 w-full",
  interactive = true,
}: {
  markers?: MapMarker[];
  circles?: MapCircle[];
  className?: string;
  interactive?: boolean;
}) {
  const L = useLeaflet();
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const layerRef = useRef<Leaflet.LayerGroup | null>(null);

  useEffect(() => {
    if (!L || !el.current) return;
    const map = createMap(L, el.current, interactive ? {} : { dragging: false, zoomControl: false, doubleClickZoom: false, touchZoom: false });
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    map.setView(DEFAULT_CENTER, 12);
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [L, interactive]);

  const dataKey = JSON.stringify([markers, circles]);
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!L || !map || !layer) return;
    layer.clearLayers();
    const bounds = L.latLngBounds([]);
    for (const c of circles) {
      const circle = L.circle([c.lat, c.lng], {
        radius: c.radius,
        color: c.color ?? "#a47a2c",
        weight: 2,
        fillOpacity: 0.12,
        dashArray: c.dashed ? "6 6" : undefined,
      }).addTo(layer);
      bounds.extend(circle.getBounds());
    }
    for (const m of markers) {
      const layerItem =
        m.kind === "dot"
          ? L.circleMarker([m.lat, m.lng], { radius: 7, color: "#fff", weight: 2, fillColor: m.color ?? "#2563eb", fillOpacity: 1 })
          : L.marker([m.lat, m.lng], { icon: pinIcon(L, m.color) });
      if (m.popup) layerItem.bindPopup(escapeHtml(m.popup).replace(/\n/g, "<br/>"));
      layerItem.addTo(layer);
      bounds.extend([m.lat, m.lng]);
    }
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 17, animate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [L, dataKey]);

  return <div ref={el} className={`${className} overflow-hidden rounded-lg bg-stone-200`} />;
}

type SearchResult = { display_name: string; lat: string; lon: string };

/**
 * Click-to-pin / search-and-pin location picker with a draggable marker and a
 * live attendance-radius preview.
 */
export function MapPicker({
  latitude,
  longitude,
  radius,
  address,
  onChange,
}: {
  latitude: number | null;
  longitude: number | null;
  radius: number;
  address?: string;
  onChange: (lat: number, lng: number) => void;
}) {
  const L = useLeaflet();
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const markerRef = useRef<Leaflet.Marker | null>(null);
  const circleRef = useRef<Leaflet.Circle | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const round = (n: number) => Math.round(n * 1e6) / 1e6;

  // Create map once.
  useEffect(() => {
    if (!L || !el.current) return;
    const map = createMap(L, el.current);
    mapRef.current = map;
    map.setView(DEFAULT_CENTER, 12);
    map.on("click", (e: Leaflet.LeafletMouseEvent) => onChangeRef.current(round(e.latlng.lat), round(e.latlng.lng)));
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
    };
  }, [L]);

  // Sync marker + radius circle with props.
  useEffect(() => {
    const map = mapRef.current;
    if (!L || !map) return;
    if (latitude === null || longitude === null) return;
    const pos: [number, number] = [latitude, longitude];
    if (!markerRef.current) {
      markerRef.current = L.marker(pos, { draggable: true, icon: pinIcon(L, "#a47a2c") }).addTo(map);
      markerRef.current.on("dragend", () => {
        const p = markerRef.current!.getLatLng();
        onChangeRef.current(round(p.lat), round(p.lng));
      });
      circleRef.current = L.circle(pos, { radius, color: "#a47a2c", weight: 2, fillOpacity: 0.12 }).addTo(map);
      map.setView(pos, 17);
    } else {
      markerRef.current.setLatLng(pos);
      circleRef.current?.setLatLng(pos);
      if (!map.getBounds().contains(pos)) map.panTo(pos);
    }
    circleRef.current?.setRadius(Math.max(1, radius || 0));
  }, [L, latitude, longitude, radius]);

  const search = useCallback(async (q: string) => {
    const term = q.trim();
    if (term.length < 3) return;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(term)}`, {
        headers: { "Accept-Language": "en" },
      });
      const data = (await res.json()) as SearchResult[];
      setResults(data);
      if (!data.length) setSearchError("No matches. Try a nearby landmark, or click the map to drop the pin.");
    } catch {
      setSearchError("Search is unavailable right now. Click on the map to drop the pin.");
    } finally {
      setSearching(false);
    }
  }, []);

  const choose = (r: SearchResult) => {
    const lat = round(Number(r.lat));
    const lng = round(Number(r.lon));
    onChange(lat, lng);
    mapRef.current?.setView([lat, lng], 17);
    setResults([]);
  };

  const useMyLocation = () => {
    navigator.geolocation?.getCurrentPosition(
      (p) => {
        onChange(round(p.coords.latitude), round(p.coords.longitude));
        mapRef.current?.setView([p.coords.latitude, p.coords.longitude], 17);
      },
      () => setSearchError("Could not read your location."),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <input
            className="input pr-10"
            placeholder="Search address or landmark…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                search(query);
              }
            }}
          />
          <button type="button" onClick={() => search(query)} className="absolute inset-y-0 right-0 px-3 text-stone-500 hover:text-brand-600" aria-label="Search">
            <Icon name="search" />
          </button>
        </div>
        {address && address.trim().length >= 3 && (
          <button type="button" className="btn btn-secondary" onClick={() => { setQuery(address); search(address); }}>
            <Icon name="pin" /> Find project address
          </button>
        )}
        <button type="button" className="btn btn-secondary" onClick={useMyLocation}>
          <Icon name="locate" /> My location
        </button>
      </div>
      {searching && <p className="text-xs text-stone-500">Searching…</p>}
      {searchError && <p className="text-xs text-amber-700">{searchError}</p>}
      {results.length > 0 && (
        <ul className="divide-y divide-stone-100 overflow-hidden rounded-lg border border-stone-200 bg-white text-sm shadow-sm">
          {results.map((r) => (
            <li key={`${r.lat},${r.lon}`}>
              <button type="button" onClick={() => choose(r)} className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-brand-50">
                <Icon name="pin" className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
                <span>{r.display_name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div ref={el} className="h-80 w-full overflow-hidden rounded-lg bg-stone-200 ring-1 ring-stone-200" />
      <p className="text-xs text-stone-500">
        Click the map to drop the pin, then drag it to fine-tune. The shaded circle is the attendance radius.
      </p>
    </div>
  );
}
