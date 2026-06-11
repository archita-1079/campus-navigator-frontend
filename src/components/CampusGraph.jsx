import React, { useEffect, useRef, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import axios from "axios";
import { NODE_CFG } from "../utils/constants";
import { useGPS } from "../hooks/useGPS";
import {
  getDisplayName,
  getDistanceInMeters,
  normalizeEdgeType,
  normalizeNodeType,
  getBearing,
  buildDirections,
  buildArrowFeatures,
  DIR,
  injectStyles,
} from "../utils/graph";

const API_USER_BASE = `${import.meta.env.VITE_API_URL}/api/v1/user`;

// Off-route threshold: if user strays more than this many metres from the
// nearest route point, trigger a reroute.
const OFF_ROUTE_THRESHOLD_M = 10;

// Minimum milliseconds between two consecutive reroute API calls.
// Reduced from 5 000 → 2 000 so the app reacts faster after a wrong turn.
const REROUTE_COOLDOWN_MS = 1000;

// ─── OSRM fallback (only when campus graph returns no edges) ──────────────────
const OSRM_BASE = "https://router.project-osrm.org/route/v1/foot";
async function fetchOSRMRoute(srcNode, dstNode) {
  const url = `${OSRM_BASE}/${srcNode.longitude},${srcNode.latitude};${dstNode.longitude},${dstNode.latitude}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const data = await res.json();
  if (data.code !== "Ok" || !data.routes?.length) throw new Error("OSRM: no route");
  return data.routes[0].geometry.coordinates; // [lng, lat][]
}

// ─── Build coord array from API edge list ─────────────────────────────────────
function edgesToCoords(edges, nodes) {
  const arr = [];
  edges.forEach((edge) => {
    const src = nodes.find((n) => n.id === edge.sourceNodeId);
    const tgt = nodes.find((n) => n.id === (edge.destinationNodeId ?? edge.targetNodeId));
    if (!src || !tgt) return;
    if (arr.length === 0) arr.push([src.longitude, src.latitude]);
    (edge.waypoints || []).forEach((w) => arr.push([w.longitude, w.latitude]));
    arr.push([tgt.longitude, tgt.latitude]);
  });
  return arr;
}

// ─── Compass heading hook ─────────────────────────────────────────────────────
function useCompassHeading() {
  const [heading, setHeading] = useState(null);
  useEffect(() => {
    const handler = (e) => {
      if (e.webkitCompassHeading != null) setHeading(e.webkitCompassHeading);
      else if (e.alpha != null) setHeading((360 - e.alpha + 360) % 360);
    };
    window.addEventListener("deviceorientationabsolute", handler, true);
    window.addEventListener("deviceorientation", handler, true);
    return () => {
      window.removeEventListener("deviceorientationabsolute", handler, true);
      window.removeEventListener("deviceorientation", handler, true);
    };
  }, []);
  return heading;
}

// ─── 1-second GPS hook ────────────────────────────────────────────────────────
// Overrides whatever interval useGPS provides by also running our own
// watchPosition with maximumAge:0 / timeout:1000 so we get ≥1 fix/sec.
// The result is merged with the shared coords from useGPS so the rest of
// the component keeps working unchanged.
function use1sGPS() {
  const { coords: sharedCoords, error: gpsError } = useGPS();
  const [coords, setCoords] = useState(null);

  useEffect(() => {
    if (!navigator.geolocation) return;

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setCoords({
          lat:      pos.coords.latitude,
          lng:      pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          heading:  pos.coords.heading,
          speed:    pos.coords.speed,
        });
      },
      (err) => console.warn("GPS watch error:", err),
      {
        enableHighAccuracy: true,
        maximumAge:         0,    // never use a cached position
        timeout:            1000, // demand a fresh fix within 1 s
      },
    );

    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // Fall back to the shared hook's value while our own watcher hasn't fired yet
  return { coords: coords ?? sharedCoords, error: gpsError };
}

export default function CampusGraph() {
  const mapRef          = useRef(null);
  const mapInstance     = useRef(null);
  const mapLoaded       = useRef(false);
  const pendingData     = useRef(null);
  const nodeMarkersRef  = useRef([]);
  const userMarkerRef   = useRef(null);
  const searchPinRef    = useRef(null);
  const autoFollowRef   = useRef(false);
  const reFollowTimerRef = useRef(null);
  const stepsListRef    = useRef(null);

  // reroute guards
  const isReroutingRef     = useRef(false);
  const lastRerouteTimeRef = useRef(0);
  const selectedDestRef    = useRef(null);
  const mapDataRef         = useRef({ nodes: [], edges: [] });

  const [mapData, setMapData] = useState({ nodes: [], edges: [] });

  // Use our 1-second GPS hook instead of the raw useGPS hook
  const { coords, error: gpsError } = use1sGPS();
  const compassHeading = useCompassHeading();

  const effectiveHeading = useCallback(() => {
    if (coords?.speed != null && coords.speed > 0.5 && coords.heading != null)
      return coords.heading;
    return compassHeading;
  }, [coords, compassHeading]);

  // search
  const [sourceQuery,    setSourceQuery]    = useState("");
  const [destQuery,      setDestQuery]      = useState("");
  const [sourceResults,  setSourceResults]  = useState([]);
  const [destResults,    setDestResults]    = useState([]);
  const [selectedSource, setSelectedSource] = useState(null);
  const [selectedDest,   setSelectedDest]   = useState(null);

  // route
  const [routeCoords,  setRouteCoords]  = useState([]);
  const routeCoordsRef = useRef([]);
  const [travelledIdx, setTravelledIdx] = useState(0);
  const [routeReady,   setRouteReady]   = useState(false);
  const [navigating,   setNavigating]   = useState(false);
  const [directions,   setDirections]   = useState([]);
  const directionsRef  = useRef([]);
  const [stepIdx,      setStepIdx]      = useState(0);
  const stepIdxRef     = useRef(0);
  const [routeInfo,    setRouteInfo]    = useState(null);
  const [isSearching,  setIsSearching]  = useState(false);
  const [arrived,      setArrived]      = useState(false);
  const [sheetOpen,    setSheetOpen]    = useState(false);
  const [isRerouting,  setIsRerouting]  = useState(false);
  const [previewCollapsed, setPreviewCollapsed] = useState(false);

  const [isPreviewMode,   setIsPreviewMode]   = useState(false);
  const [showStepsPanel,  setShowStepsPanel]  = useState(false);
  const [distToNextTurn,  setDistToNextTurn]  = useState(null);

  // keep refs in sync
  useEffect(() => { routeCoordsRef.current = routeCoords;  }, [routeCoords]);
  useEffect(() => { directionsRef.current  = directions;   }, [directions]);
  useEffect(() => { stepIdxRef.current     = stepIdx;      }, [stepIdx]);
  useEffect(() => { selectedDestRef.current = selectedDest; }, [selectedDest]);
  useEffect(() => { mapDataRef.current      = mapData;      }, [mapData]);

  // ── Auto-scroll active step into view ────────────────────────────────────
  useEffect(() => {
    if (!showStepsPanel || !stepsListRef.current) return;
    const active = stepsListRef.current.querySelector("[data-active='true']");
    if (active) active.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [stepIdx, showStepsPanel]);

  // ── Styles ────────────────────────────────────────────────────────────────
  useEffect(() => {
    injectStyles();
    const style = document.createElement("style");
    style.textContent = `
      * { -webkit-tap-highlight-color: transparent; }
      html, body { overscroll-behavior: none; }
      .cnav-btn { transition: opacity 0.15s, transform 0.1s; }
      .cnav-btn:active { opacity: 0.75; transform: scale(0.97); }
      @keyframes gpsPulse {
        0%   { transform: scale(1); opacity: 0.8; }
        70%  { transform: scale(2.8); opacity: 0; }
        100% { transform: scale(1); opacity: 0; }
      }
      @keyframes arrivalPop {
        0%   { transform: translate(-50%,-50%) scale(0.85); opacity: 0; }
        100% { transform: translate(-50%,-50%) scale(1); opacity: 1; }
      }
      @keyframes dirSlide {
        0%   { transform: translateY(-10px); opacity: 0; }
        100% { transform: translateY(0);     opacity: 1; }
      }
      @keyframes sheetIn {
        0%   { transform: translateY(100%); }
        100% { transform: translateY(0); }
      }
      @keyframes reroutePulse {
        0%,100% { opacity: 1; }
        50%     { opacity: 0.4; }
      }
    `;
    document.head.appendChild(style);
  }, []);

  // ── Map init ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (mapInstance.current) return;
    const map = new maplibregl.Map({
      container: mapRef.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [78.0035, 30.269],
      zoom: 17, pitch: 0, bearing: 0,
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    map.on("load", () => {
      const addSrc = (id) =>
        map.addSource(id, { type: "geojson", data: { type: "FeatureCollection", features: [] } });

      addSrc("accuracy-src");
      map.addLayer({ id: "accuracy-fill", type: "circle", source: "accuracy-src",
        paint: { "circle-color": "rgba(66,133,244,0.12)", "circle-stroke-color": "rgba(66,133,244,0.45)",
          "circle-stroke-width": 1.5, "circle-pitch-alignment": "map",
          "circle-radius": { stops: [[14,8],[16,20],[18,80],[20,320]] } } });

      addSrc("heading-src");
      map.addLayer({ id: "heading-cone", type: "fill", source: "heading-src",
        paint: { "fill-color": "rgba(66,133,244,0.25)", "fill-outline-color": "rgba(66,133,244,0.5)" } });

      addSrc("edges");
      map.addLayer({ id: "edges-layer", type: "line", source: "edges",
        paint: { "line-color": "#666", "line-width": 1.5, "line-opacity": 0.35 } });

      addSrc("route-travelled");
      map.addLayer({ id: "route-travelled-layer", type: "line", source: "route-travelled",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#aaaaaa", "line-width": 7, "line-opacity": 0.55, "line-blur": 1 } });

      addSrc("route-src");
      map.addLayer({ id: "route-casing", type: "line", source: "route-src",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#1a56c4", "line-width": 13, "line-opacity": 0.85 } });
      map.addLayer({ id: "route-fill", type: "line", source: "route-src",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#4285F4", "line-width": 7, "line-opacity": 1 } });

      addSrc("arrows-src");
      map.addLayer({ id: "route-arrows", type: "symbol", source: "arrows-src",
        layout: { "text-field": "▶", "text-size": 13, "text-rotate": ["get", "bearing"],
          "text-rotation-alignment": "map", "text-allow-overlap": true, "text-ignore-placement": true },
        paint: { "text-color": "#ffffff", "text-halo-color": "#1a56c4",
          "text-halo-width": 1.5, "text-opacity": 0.9 } });

      mapLoaded.current = true;
      if (pendingData.current) renderMapData(map, pendingData.current);
    });

    map.on("dragstart", () => {
      autoFollowRef.current = false;
      if (reFollowTimerRef.current) clearTimeout(reFollowTimerRef.current);
    });
    map.on("dragend", () => {
      if (reFollowTimerRef.current) clearTimeout(reFollowTimerRef.current);
      reFollowTimerRef.current = setTimeout(() => { autoFollowRef.current = true; }, 4000);
    });
    mapInstance.current = map;
  }, []);

  // ── Render campus graph overlay ───────────────────────────────────────────
  const renderMapData = useCallback((map, data) => {
    if (!map || !data?.nodes?.length) return;
    const edgeFeatures = (data.edges || []).map((edge) => {
      const src = data.nodes.find((n) => n.id === edge.sourceNodeId);
      const tgt = data.nodes.find((n) => n.id === (edge.destinationNodeId ?? edge.targetNodeId));
      if (!src || !tgt) return null;
      return { type: "Feature", properties: { edgeType: normalizeEdgeType(edge.edgeType) },
        geometry: { type: "LineString", coordinates: [
          [src.longitude, src.latitude],
          ...(edge.waypoints || []).map((w) => [w.longitude, w.latitude]),
          [tgt.longitude, tgt.latitude],
        ]} };
    }).filter(Boolean);
    map.getSource("edges")?.setData({ type: "FeatureCollection", features: edgeFeatures });

    nodeMarkersRef.current.forEach((m) => m.remove());
    nodeMarkersRef.current = [];
    data.nodes.filter((n) =>
      ["BUILDING","CANTEEN","HOSTEL","LIBRARY","LAB","ADMIN","AUDITORIUM","CLASSROOM","LECTURE_HALL","OTHER"]
        .includes(n.nodeType?.toUpperCase())
    ).forEach((node) => {
      const cfg = NODE_CFG[normalizeNodeType(node.nodeType)] || NODE_CFG.DEFAULT;
      const el  = document.createElement("div");
      Object.assign(el.style, { display: "flex", flexDirection: "column", alignItems: "center", cursor: "pointer", gap: "2px" });
      const lbl = document.createElement("div");
      lbl.innerText = node.name;
      Object.assign(lbl.style, { fontSize: "10px", color: "#fff", background: "rgba(0,0,0,0.6)",
        padding: "1px 5px", borderRadius: "3px", whiteSpace: "nowrap", maxWidth: "100px",
        overflow: "hidden", textOverflow: "ellipsis" });
      const ico = document.createElement("div");
      ico.innerHTML = cfg.icon;
      Object.assign(ico.style, { fontSize: "18px", color: cfg.color, lineHeight: 1,
        filter: `drop-shadow(0 0 4px ${cfg.color})` });
      el.appendChild(lbl); el.appendChild(ico);
      el.addEventListener("click", () => {
        setSelectedDest(node); setDestQuery(node.name); setSheetOpen(true);
        new maplibregl.Popup({ offset: 25 })
          .setLngLat([node.longitude, node.latitude])
          .setHTML(`<div style="background:#1e1e1e;color:white;padding:10px;border-radius:10px;border:2px solid ${cfg.color}">
            <h4 style="margin:0">${node.name}</h4>
            <p style="margin:4px 0 0;font-size:12px;color:#aaa">${node.nodeType}</p></div>`)
          .addTo(map);
      });
      nodeMarkersRef.current.push(
        new maplibregl.Marker({ element: el, anchor: "bottom" })
          .setLngLat([node.longitude, node.latitude]).addTo(map)
      );
    });
  }, []);

  useEffect(() => {
    if (!mapData?.nodes?.length) return;
    if (mapLoaded.current && mapInstance.current) renderMapData(mapInstance.current, mapData);
    else pendingData.current = mapData;
  }, [mapData, renderMapData]);

  useEffect(() => {
    axios.get(`${import.meta.env.VITE_API_URL}/api/v1/user/graph`)
      .then((r) => setMapData(r.data?.data ?? { nodes: [], edges: [] }))
      .catch((e) => console.error("Graph fetch failed:", e));
  }, []);

  // ── Heading cone ──────────────────────────────────────────────────────────
  const buildHeadingCone = useCallback((lat, lng, h) => {
    if (h == null) return { type: "FeatureCollection", features: [] };
    const R = 0.00015, sp = 30, toR = (d) => (d * Math.PI) / 180;
    return {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {},
        geometry: { type: "Polygon", coordinates: [[[lng, lat],
          [lng + R * Math.sin(toR(h - sp)), lat + R * Math.cos(toR(h - sp))],
          [lng + R * Math.sin(toR(h + sp)), lat + R * Math.cos(toR(h + sp))],
          [lng, lat]]] } }]
    };
  }, []);

  const prevHeadingRef = useRef(null);
  const prevLatRef     = useRef(null);
  const prevLngRef     = useRef(null);

  // ── GPS dot + heading cone ────────────────────────────────────────────────
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !coords) return;

    if (!userMarkerRef.current) {
      const wrap = document.createElement("div");
      wrap.style.cssText = "position:relative;width:22px;height:22px;pointer-events:none;";
      const pulse = document.createElement("div");
      pulse.style.cssText = "position:absolute;inset:0;background:rgba(66,133,244,0.35);border-radius:50%;animation:gpsPulse 2s ease-out infinite;";
      const dot = document.createElement("div");
      dot.style.cssText = "position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:14px;height:14px;background:#4285F4;border:2.5px solid #fff;border-radius:50%;box-shadow:0 0 12px rgba(66,133,244,0.9);";
      wrap.appendChild(pulse); wrap.appendChild(dot);
      userMarkerRef.current = new maplibregl.Marker({ element: wrap, anchor: "center" })
        .setLngLat([coords.lng, coords.lat]).addTo(map);
    } else {
      userMarkerRef.current.setLngLat([coords.lng, coords.lat]);
    }

    map.getSource("accuracy-src")?.setData({ type: "FeatureCollection", features: [{
      type: "Feature", geometry: { type: "Point", coordinates: [coords.lng, coords.lat] }, properties: {}
    }]});

    const hdg = coords.speed != null && coords.speed > 0.5 && coords.heading != null
      ? coords.heading
      : compassHeading;

    const latChanged = Math.abs((prevLatRef.current ?? 0) - coords.lat) > 0.000001;
    const lngChanged = Math.abs((prevLngRef.current ?? 0) - coords.lng) > 0.000001;
    const hdgChanged = hdg == null
      ? prevHeadingRef.current != null
      : Math.abs(((hdg - (prevHeadingRef.current ?? hdg) + 540) % 360) - 180) > 2;

    if (latChanged || lngChanged || hdgChanged) {
      map.getSource("heading-src")?.setData(buildHeadingCone(coords.lat, coords.lng, hdg));
      prevLatRef.current     = coords.lat;
      prevLngRef.current     = coords.lng;
      prevHeadingRef.current = hdg;
    }
  }, [coords, compassHeading, buildHeadingCone]);

  // ── Reroute ───────────────────────────────────────────────────────────────
  // Cooldown is 2 s (down from 5 s) so the app reacts quickly after a wrong turn.
  const triggerReroute = useCallback(async (currentCoords) => {
    if (isReroutingRef.current) return;
    const now = Date.now();
    if (now - lastRerouteTimeRef.current < REROUTE_COOLDOWN_MS) return;
    const dest = selectedDestRef.current;
    if (!dest) return;
    const data = mapDataRef.current;
    if (!data?.nodes?.length) return;

    let minD = Infinity, nearestNode = null;
    data.nodes.forEach((n) => {
      const d = getDistanceInMeters(currentCoords.lat, currentCoords.lng, n.latitude, n.longitude);
      if (d < minD) { minD = d; nearestNode = n; }
    });
    if (!nearestNode) return;

    isReroutingRef.current = true;
    lastRerouteTimeRef.current = now;
    setIsRerouting(true);

    try {
      const res   = await axios.get(`${API_USER_BASE}/graph/shortest-path/${nearestNode.id}/${dest.id}`);
      const edges = res.data.data || [];
      let arr     = edgesToCoords(edges, data.nodes);

      if (arr.length === 0) {
        try { arr = await fetchOSRMRoute(nearestNode, dest); }
        catch (e) { console.warn("OSRM fallback failed", e); return; }
      }

      // Prepend the user's exact live position so the route line starts from them.
      // This also means the very first segment will show a u-turn if they're
      // facing the wrong way — which is the correct instruction.
      arr.unshift([currentCoords.lng, currentCoords.lat]);
      if (arr.length < 2) return;

      let total = 0;
      for (let i = 0; i < arr.length - 1; i++)
        total += getDistanceInMeters(arr[i][1], arr[i][0], arr[i+1][1], arr[i+1][0]);

      // allowUTurn=true because we just prepended the live GPS position,
      // so the new first segment may genuinely require turning around.
      const built = buildDirections(arr, true);
      setRouteCoords(arr);  routeCoordsRef.current = arr;
      setDirections(built); directionsRef.current  = built;
      setTravelledIdx(0); setStepIdx(0); stepIdxRef.current = 0; setDistToNextTurn(null);
      setRouteInfo({ distance: Math.round(total), time: Math.max(1, Math.ceil(total / 1.4 / 60)) });

      const map = mapInstance.current;
      if (map) {
        map.getSource("route-travelled")?.setData({ type: "FeatureCollection", features: [] });
        map.getSource("route-src")?.setData({ type: "FeatureCollection",
          features: [{ type: "Feature", geometry: { type: "LineString", coordinates: arr } }] });
        map.getSource("arrows-src")?.setData({ type: "FeatureCollection", features: buildArrowFeatures(arr) });
      }
    } catch (e) {
      console.error("Reroute failed:", e);
    } finally {
      isReroutingRef.current = false;
      setIsRerouting(false);
    }
  }, []);

  // ── Navigation tracking — runs every GPS tick (≈1 s) ─────────────────────
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !coords || !navigating) return;
    const rc = routeCoordsRef.current;
    if (!rc.length) return;

    // Find the closest point on the route to the user's current position
    let minD = Infinity, closestIdx = 0;
    rc.forEach(([lng, lat], i) => {
      const d = getDistanceInMeters(coords.lat, coords.lng, lat, lng);
      if (d < minD) { minD = d; closestIdx = i; }
    });
    setTravelledIdx(closestIdx);

    // Trigger reroute when user drifts off-route
    if (minD > OFF_ROUTE_THRESHOLD_M) triggerReroute(coords);

    const remaining = [[coords.lng, coords.lat], ...rc.slice(closestIdx)];
    const travelled = [...rc.slice(0, closestIdx + 1), [coords.lng, coords.lat]];

    let remMeters = 0;
    for (let i = 0; i < remaining.length - 1; i++)
      remMeters += getDistanceInMeters(remaining[i][1], remaining[i][0], remaining[i+1][1], remaining[i+1][0]);

    map.getSource("route-src")?.setData({ type: "FeatureCollection",
      features: [{ type: "Feature", geometry: { type: "LineString", coordinates: remaining } }] });
    map.getSource("route-travelled")?.setData({ type: "FeatureCollection",
      features: [{ type: "Feature", geometry: { type: "LineString", coordinates: travelled } }] });
    map.getSource("arrows-src")?.setData({ type: "FeatureCollection", features: buildArrowFeatures(remaining) });
    setRouteInfo({ distance: Math.round(remMeters), time: Math.max(1, Math.ceil(remMeters / 1.4 / 60)) });

    if (remMeters < 12) { setArrived(true); return; }

    // ── Update active step + live distance to next turn ───────────────────
    const dirs = directionsRef.current;
    if (dirs.length > 0) {
      let ai = 0;
      for (let i = 0; i < dirs.length; i++) {
        if (closestIdx >= dirs[i].coordIndex) ai = i; else break;
      }
      if (ai !== stepIdxRef.current) {
        setStepIdx(ai);
        stepIdxRef.current = ai;
      }

      const nextTurnStep = dirs[ai + 1];
      if (nextTurnStep && rc[nextTurnStep.coordIndex]) {
        let d = getDistanceInMeters(
          coords.lat, coords.lng,
          rc[closestIdx][1], rc[closestIdx][0],
        );
        for (let i = closestIdx; i < nextTurnStep.coordIndex && i < rc.length - 1; i++) {
          d += getDistanceInMeters(rc[i][1], rc[i][0], rc[i+1][1], rc[i+1][0]);
        }
        setDistToNextTurn(Math.round(d));
      } else {
        setDistToNextTurn(null);
      }
    }

    // Auto-follow: keep map centred on user with forward bearing
    if (remaining.length >= 2 && autoFollowRef.current) {
      const bearing = getBearing(remaining[0][1], remaining[0][0], remaining[1][1], remaining[1][0]);
      map.easeTo({ center: [coords.lng, coords.lat], bearing, zoom: 18.5, pitch: 45, duration: 700 });
    }
  }, [coords, navigating, triggerReroute]);

  // ── Fly to node ───────────────────────────────────────────────────────────
  const flyToNode = (node) => {
    const map = mapInstance.current;
    if (!map) return;
    if (searchPinRef.current) { searchPinRef.current.remove(); searchPinRef.current = null; }
    if (node.parentNodeId != null) {
      const cfg = NODE_CFG[normalizeNodeType(node.nodeType)] || NODE_CFG.DEFAULT;
      const el  = document.createElement("div");
      Object.assign(el.style, { display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" });
      const lbl = document.createElement("div");
      lbl.innerText = node.name;
      Object.assign(lbl.style, { fontSize: "11px", color: "#fff", background: "rgba(66,133,244,0.9)",
        padding: "2px 6px", borderRadius: "4px", fontWeight: "600" });
      const ico = document.createElement("div");
      ico.innerHTML = cfg.icon || "📍";
      Object.assign(ico.style, { fontSize: "22px", filter: "drop-shadow(0 0 6px #4285F4)" });
      el.appendChild(lbl); el.appendChild(ico);
      searchPinRef.current = new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([node.longitude, node.latitude]).addTo(map);
    }
    map.flyTo({ center: [node.longitude, node.latitude],
      zoom: node.parentNodeId != null ? 19 : 18, pitch: 0, bearing: 0, duration: 1600 });
  };

  // ── Node search ───────────────────────────────────────────────────────────
  const handleSearch = async (query, isSource) => {
    isSource ? setSourceQuery(query) : setDestQuery(query);
    if (query.length < 2) { isSource ? setSourceResults([]) : setDestResults([]); return; }
    try {
      const res = await axios.get(`${API_USER_BASE}/node/search?query=${query}`);
      const filtered = (res.data.data || []).filter((n) =>
        ["OTHER","BUILDING","CLASSROOM","LECTURE_HALL"].includes(n.nodeType?.toUpperCase())
      );
      isSource ? setSourceResults(filtered) : setDestResults(filtered);
    } catch (e) { console.error(e); }
  };

  // ── Find route ────────────────────────────────────────────────────────────
  const handleFindRoute = async () => {
    if (!selectedDest) { alert("Please select a destination!"); return; }

    let activeSource = selectedSource;
    let usingGPS     = false;

    if (!activeSource) {
      if (!coords) { alert("GPS not available. Please type a start location."); return; }
      let minD = Infinity, nearest = null;
      (mapData?.nodes || []).forEach((n) => {
        const d = getDistanceInMeters(coords.lat, coords.lng, n.latitude, n.longitude);
        if (d < minD) { minD = d; nearest = n; }
      });
      if (!nearest) { alert("Cannot find a nearby node."); return; }
      activeSource = nearest;
      setSourceQuery(`Current Location (${nearest.name})`);
      usingGPS = true;
    } else {
      if (coords) {
        let minD = Infinity, nearest = null;
        (mapData?.nodes || []).forEach((n) => {
          const d = getDistanceInMeters(coords.lat, coords.lng, n.latitude, n.longitude);
          if (d < minD) { minD = d; nearest = n; }
        });
        if (nearest && nearest.id === activeSource.id) usingGPS = true;
      }
    }

    setIsSearching(true);
    try {
      const res   = await axios.get(`${API_USER_BASE}/graph/shortest-path/${activeSource.id}/${selectedDest.id}`);
      const edges = res.data.data || [];
      let arr     = edgesToCoords(edges, mapData.nodes);

      if (arr.length === 0) {
        try {
          arr = await fetchOSRMRoute(activeSource, selectedDest);
        } catch (e) {
          console.warn("OSRM fallback failed", e);
          arr = [[activeSource.longitude, activeSource.latitude],
                 [selectedDest.longitude, selectedDest.latitude]];
        }
      }

      if (usingGPS && coords) arr.unshift([coords.lng, coords.lat]);

      let total = 0;
      for (let i = 0; i < arr.length - 1; i++)
        total += getDistanceInMeters(arr[i][1], arr[i][0], arr[i+1][1], arr[i+1][0]);

      const built = buildDirections(arr);
      setRouteCoords(arr);  routeCoordsRef.current = arr;
      setDirections(built); directionsRef.current  = built;
      setTravelledIdx(0); setStepIdx(0); stepIdxRef.current = 0;
      setRouteInfo({ distance: Math.round(total), time: Math.max(1, Math.ceil(total / 1.4 / 60)) });
      setRouteReady(true);
      setNavigating(false);
      setArrived(false);
      setSheetOpen(false);
      setPreviewCollapsed(false);
      setShowStepsPanel(false);
      setIsPreviewMode(!usingGPS);

      const map = mapInstance.current;
      if (map) {
        map.getSource("route-travelled")?.setData({ type: "FeatureCollection", features: [] });
        map.getSource("route-src")?.setData({ type: "FeatureCollection",
          features: [{ type: "Feature", geometry: { type: "LineString", coordinates: arr } }] });
        map.getSource("arrows-src")?.setData({ type: "FeatureCollection", features: buildArrowFeatures(arr) });
        const lngs = arr.map((c) => c[0]);
        const lats  = arr.map((c) => c[1]);
        map.fitBounds(
          [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
          { padding: { top: 80, bottom: 220, left: 40, right: 40 }, pitch: 0, bearing: 0, duration: 1800 }
        );
      }
    } catch (e) {
      console.error(e); alert("Could not find a route.");
    } finally {
      setIsSearching(false);
    }
  };

  // ── Start navigation ──────────────────────────────────────────────────────
  const handleStartNavigation = () => {
    setNavigating(true);
    autoFollowRef.current = true;
    setSheetOpen(false);
    isReroutingRef.current    = false;
    lastRerouteTimeRef.current = 0;
    const map = mapInstance.current;
    if (map && coords)
      map.easeTo({ center: [coords.lng, coords.lat], zoom: 18.5, pitch: 45, duration: 1200 });
  };

  // ── Re-centre ─────────────────────────────────────────────────────────────
  const reCenter = () => {
    autoFollowRef.current = true;
    const map = mapInstance.current;
    if (!map || !coords) return;
    if (navigating) {
      const rc  = routeCoordsRef.current;
      const hdg = rc.length >= 2 ? getBearing(rc[0][1], rc[0][0], rc[1][1], rc[1][0]) : 0;
      map.easeTo({ center: [coords.lng, coords.lat], zoom: 18.5, pitch: 45, bearing: hdg, duration: 800 });
    } else {
      map.easeTo({ center: [coords.lng, coords.lat], zoom: 18, pitch: 0, bearing: 0, duration: 800 });
    }
  };

  // ── Clear ─────────────────────────────────────────────────────────────────
  const clearRoute = () => {
    setSelectedSource(null); setSelectedDest(null);
    setSourceQuery(""); setDestQuery("");
    setRouteCoords([]); routeCoordsRef.current = [];
    setTravelledIdx(0); setRouteReady(false); setNavigating(false);
    setDirections([]); directionsRef.current = [];
    setStepIdx(0); stepIdxRef.current = 0;
    setRouteInfo(null); setArrived(false); setIsRerouting(false);
    isReroutingRef.current = false; lastRerouteTimeRef.current = 0;
    autoFollowRef.current  = false; setPreviewCollapsed(false);
    setIsPreviewMode(false); setShowStepsPanel(false); setDistToNextTurn(null);
    if (searchPinRef.current) { searchPinRef.current.remove(); searchPinRef.current = null; }
    const map = mapInstance.current;
    if (map) {
      ["route-src","route-travelled","arrows-src"].forEach((s) =>
        map.getSource(s)?.setData({ type: "FeatureCollection", features: [] })
      );
      map.easeTo({ zoom: 17, pitch: 0, bearing: 0, duration: 800 });
    }
  };

  const activeStep = directions[stepIdx];
  const dirInfo    = activeStep ? DIR[activeStep.type] || DIR.straight : null;

  // ── Steps panel ───────────────────────────────────────────────────────────
  const StepsPanel = () => (
    <div style={{
      position: "absolute", bottom: previewCollapsed ? 62 : (navigating ? 170 : 160),
      left: 0, right: 0, zIndex: 22,
      background: "rgba(10,10,10,0.98)",
      borderRadius: "20px 20px 0 0",
      boxShadow: "0 -6px 32px rgba(0,0,0,0.75)",
      border: "1px solid #1e1e1e",
      display: "flex", flexDirection: "column",
      maxHeight: navigating ? "52vh" : "60vh",
      transition: "bottom 0.25s ease",
    }}>
      <div style={{ display: "flex", alignItems: "center", padding: "14px 16px 10px",
        borderBottom: "1px solid #1e1e1e", flexShrink: 0 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>
            {navigating ? "Directions" : "Route Preview"}
          </div>
          <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>
            {selectedSource?.name ?? "Current Location"} → {selectedDest?.name}
            {routeInfo && ` · ${routeInfo.time} min · ${routeInfo.distance} m`}
          </div>
        </div>
        <button onClick={() => setShowStepsPanel(false)} className="cnav-btn"
          style={{ width: 30, height: 30, borderRadius: 8, background: "#1e1e1e",
            border: "1px solid #333", color: "#888", fontSize: 16, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
          aria-label="Close directions">✕</button>
      </div>

      <div ref={stepsListRef} style={{ overflowY: "auto", padding: "8px 12px 4px", flex: 1 }}>
        {directions.map((step, i) => {
          const di        = DIR[step.type] || DIR.straight;
          const isActive  = navigating && i === stepIdx;
          const isDone    = navigating && i < stepIdx;
          return (
            <div key={i} data-active={isActive ? "true" : "false"}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px",
                borderRadius: 10, marginBottom: 3,
                background: isActive ? `${di.color}18` : "transparent",
                border: `1px solid ${isActive ? di.color + "55" : "transparent"}`,
                opacity: isDone ? 0.35 : 1,
                transition: "opacity 0.3s, background 0.3s",
              }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                background: isActive ? `${di.color}28` : "#1a1a1a",
                border: `1px solid ${isActive ? di.color + "66" : "#2a2a2a"}`,
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
                transition: "background 0.3s" }}>
                {isDone ? "✓" : di.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: isActive ? 700 : 400,
                  color: isActive ? di.color : isDone ? "#555" : "#ccc",
                  transition: "color 0.3s" }}>
                  {di.label}
                </div>
                {step.distance > 0 && (
                  <div style={{ fontSize: 11, color: isDone ? "#444" : "#555", marginTop: 2 }}>
                    {step.distance} m
                  </div>
                )}
              </div>
              <div style={{ fontSize: 10, color: isActive ? di.color : "#333",
                fontWeight: isActive ? 700 : 400, flexShrink: 0, minWidth: 16, textAlign: "right" }}>
                {i + 1}
              </div>
            </div>
          );
        })}

        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px",
          borderRadius: 10, marginBottom: 8,
          background: arrived ? "rgba(52,168,83,0.15)" : "rgba(52,168,83,0.06)",
          border: `1px solid ${arrived ? "rgba(52,168,83,0.5)" : "rgba(52,168,83,0.2)"}` }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0,
            background: "rgba(52,168,83,0.15)", border: "1px solid rgba(52,168,83,0.4)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>
            🏁
          </div>
          <div style={{ fontSize: 13, color: "#34a853", fontWeight: 600 }}>
            Arrive at {selectedDest?.name}
          </div>
        </div>
      </div>

      {isPreviewMode && !navigating && (
        <div style={{ padding: "10px 14px calc(12px + env(safe-area-inset-bottom))",
          borderTop: "1px solid #1a1a1a", flexShrink: 0 }}>
          <div style={{ background: "rgba(251,188,4,0.08)", border: "1px solid rgba(251,188,4,0.2)",
            borderRadius: 10, padding: "9px 12px", display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ fontSize: 18 }}>🚶</span>
            <div style={{ fontSize: 12, color: "#fbbc04" }}>
              Walk to <strong>{selectedSource?.name}</strong> to begin navigation
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden", background: "#000" }}>
      <div ref={mapRef} style={{ position: "absolute", inset: 0 }} />

      {/* ── Search bar ── */}
      {!navigating && (
        <div style={{ position: "absolute", top: 12, left: 12, right: 12, zIndex: 20, marginTop: 50 }}>
          <div onClick={() => setSheetOpen(true)}
            style={{ background: "rgba(14,14,14,0.96)", color: destQuery ? "#fff" : "#666",
              padding: "12px 16px", borderRadius: 14, fontSize: 14, fontWeight: 500,
              boxShadow: "0 4px 24px rgba(0,0,0,0.5)", border: "1px solid #2a2a2a",
              backdropFilter: "blur(12px)", cursor: "pointer",
              display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>🔍</span>
            <span>{destQuery || "Where do you want to go?"}</span>
          </div>
        </div>
      )}

      {/* ── Rerouting banner ── */}
      {isRerouting && navigating && (
        <div style={{ position: "absolute", top: 16, left: 12, right: 12, zIndex: 26, marginTop: 50,
          background: "rgba(10,10,10,0.97)", border: "2.5px solid #fbbc04", borderRadius: 18,
          padding: "13px 16px", display: "flex", alignItems: "center", gap: 13,
          boxShadow: "0 6px 28px rgba(0,0,0,0.7)", backdropFilter: "blur(14px)",
          animation: "reroutePulse 1s ease infinite" }}>
          <div style={{ width: 50, height: 50, borderRadius: 13, background: "#fbbc0418",
            border: "2px solid #fbbc04", display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: 26, flexShrink: 0 }}>🔄</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#fbbc04" }}>Recalculating…</div>
            <div style={{ fontSize: 12, color: "#888", marginTop: 3 }}>Finding best route</div>
          </div>
        </div>
      )}

      {/* ── Live turn banner ── */}
      {navigating && dirInfo && !arrived && !isRerouting && (
        <div style={{ position: "absolute", top: 16, left: 12, right: 12, zIndex: 25, marginTop: 50,
          animation: "dirSlide 0.3s ease", background: "rgba(10,10,10,0.97)",
          border: `2.5px solid ${dirInfo.color}`, borderRadius: 18, padding: "13px 16px",
          display: "flex", alignItems: "center", gap: 13,
          boxShadow: "0 6px 28px rgba(0,0,0,0.7)", backdropFilter: "blur(14px)" }}>
          <div style={{ width: 50, height: 50, borderRadius: 13, background: `${dirInfo.color}18`,
            border: `2px solid ${dirInfo.color}`, display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: 26, flexShrink: 0 }}>{dirInfo.icon}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: dirInfo.color }}>{dirInfo.label}</div>
            {distToNextTurn != null && distToNextTurn > 0 && (
              <div style={{ fontSize: 12, color: "#888", marginTop: 3 }}>in {distToNextTurn} m</div>
            )}
          </div>
          <div style={{ fontSize: 10, color: "#555" }}>{stepIdx + 1} / {directions.length}</div>
        </div>
      )}

      {/* ── Arrived ── */}
      {arrived && (
        <div style={{ position: "absolute", top: "50%", left: "50%", zIndex: 30,
          animation: "arrivalPop 0.4s ease", transform: "translate(-50%,-50%)",
          background: "rgba(10,10,10,0.97)", border: "2px solid #34a853", borderRadius: 20,
          padding: "28px 40px", textAlign: "center", boxShadow: "0 12px 48px rgba(0,0,0,0.8)" }}>
          <div style={{ fontSize: 48 }}>🏁</div>
          <div style={{ fontSize: 21, fontWeight: 700, color: "#34a853", marginTop: 8 }}>You have arrived!</div>
          <div style={{ fontSize: 13, color: "#777", marginTop: 4 }}>{selectedDest?.name}</div>
          <button className="cnav-btn" onClick={clearRoute}
            style={{ marginTop: 16, padding: "10px 28px", background: "#34a853", color: "#fff",
              border: "none", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
            Done
          </button>
        </div>
      )}

      {/* ── Steps panel ── */}
      {showStepsPanel && routeReady && directions.length > 0 && !arrived && <StepsPanel />}

      {/* ── FABs — reroute button removed ── */}
      <div style={{ position: "absolute", right: 12,
        bottom: (routeReady || navigating) && !arrived ? (previewCollapsed ? 70 : 180) : 80,
        zIndex: 23, display: "flex", flexDirection: "column", gap: 10,
        transition: "bottom 0.25s ease" }}>

        <button className="cnav-btn" onClick={reCenter}
          style={{ width: 44, height: 44, borderRadius: "50%", background: "rgba(14,14,14,0.96)",
            border: "1px solid #2a2a2a", color: "#4285F4", fontSize: 20, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 4px 16px rgba(0,0,0,0.5)" }}>⊕</button>

        {navigating && (
          <button className="cnav-btn"
            onClick={() => { const m = mapInstance.current; if (m) m.easeTo({ bearing: 0, pitch: 0, duration: 600 }); }}
            style={{ width: 44, height: 44, borderRadius: "50%", background: "rgba(14,14,14,0.96)",
              border: "1px solid #2a2a2a", color: "#ea4335", fontSize: 18, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 4px 16px rgba(0,0,0,0.5)" }}>🧭</button>
        )}

        {/* Steps toggle FAB */}
        {(routeReady || navigating) && directions.length > 0 && !arrived && (
          <button className="cnav-btn" onClick={() => setShowStepsPanel((v) => !v)}
            style={{ width: 44, height: 44, borderRadius: "50%",
              background: showStepsPanel ? "#4285F4" : "rgba(14,14,14,0.96)",
              border: "1px solid #2a2a2a", color: showStepsPanel ? "#fff" : "#4285F4",
              fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center",
              justifyContent: "center", boxShadow: "0 4px 16px rgba(0,0,0,0.5)" }}>☰</button>
        )}
      </div>

      {/* ── Bottom bar ── */}
      {(routeReady || navigating) && !arrived && (
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 20,
          background: "rgba(10,10,10,0.97)", borderTop: "1px solid #1a1a1a",
          backdropFilter: "blur(14px)", boxShadow: "0 -8px 32px rgba(0,0,0,0.6)",
          borderRadius: "16px 16px 0 0", overflow: "hidden" }}>

          <div onClick={() => setPreviewCollapsed((v) => !v)}
            style={{ display: "flex", justifyContent: "center", alignItems: "center",
              padding: "10px 0 6px", cursor: "pointer", gap: 6 }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: "#333" }} />
            <span style={{ fontSize: 11, color: "#444", marginLeft: 6, userSelect: "none" }}>
              {previewCollapsed ? "▲" : "▼"}
            </span>
          </div>

          {!previewCollapsed && (
            <div style={{ padding: "0 16px calc(16px + env(safe-area-inset-bottom))" }}>
              {routeInfo && (
                <div style={{ display: "flex", gap: 12, marginBottom: 14, justifyContent: "center" }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1,
                      color: navigating ? "#34a853" : "#4285F4" }}>{routeInfo.time}</div>
                    <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>min walk</div>
                  </div>
                  <div style={{ width: 1, background: "#2a2a2a" }} />
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 600, color: "#bbb", lineHeight: 1 }}>
                      {routeInfo.distance} m
                    </div>
                    <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>
                      {navigating ? "remaining" : "total"}
                    </div>
                  </div>
                  {selectedDest && (
                    <>
                      <div style={{ width: 1, background: "#2a2a2a" }} />
                      <div style={{ textAlign: "center", flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#ddd", lineHeight: 1,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {selectedDest.name}
                        </div>
                        <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>destination</div>
                      </div>
                    </>
                  )}
                </div>
              )}

              <div style={{ display: "flex", gap: 10 }}>
                {!navigating ? (
                  <>
                    {isPreviewMode ? (
                      <button className="cnav-btn"
                        onClick={() => setShowStepsPanel((v) => !v)}
                        style={{ flex: 1, padding: "14px 0",
                          background: showStepsPanel ? "#1a3a6a" : "#4285F4",
                          color: "#fff", border: "none", borderRadius: 14,
                          cursor: "pointer", fontWeight: 700, fontSize: 15 }}>
                        ☰ {showStepsPanel ? "Hide Directions" : "Show Directions"}
                      </button>
                    ) : (
                      <button className="cnav-btn" onClick={handleStartNavigation}
                        style={{ flex: 1, padding: "14px 0", background: "#34a853",
                          color: "#fff", border: "none", borderRadius: 14,
                          cursor: "pointer", fontWeight: 700, fontSize: 16 }}>
                        ▶ Start Navigation
                      </button>
                    )}
                    <button className="cnav-btn" onClick={clearRoute}
                      style={{ padding: "14px 18px", background: "#333", color: "#fff",
                        border: "none", borderRadius: 14, cursor: "pointer",
                        fontWeight: 700, fontSize: 16 }}>✕</button>
                  </>
                ) : (
                  <button className="cnav-btn" onClick={clearRoute}
                    style={{ flex: 1, padding: "14px 0", background: "#d93025", color: "#fff",
                      border: "none", borderRadius: 14, cursor: "pointer",
                      fontWeight: 700, fontSize: 16 }}>✕ End Navigation</button>
                )}
              </div>
            </div>
          )}

          {previewCollapsed && (
            <div style={{ display: "flex", alignItems: "center", gap: 10,
              padding: "0 16px calc(12px + env(safe-area-inset-bottom))" }}>
              {routeInfo && (
                <div style={{ flex: 1, display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 22, fontWeight: 800,
                    color: navigating ? "#34a853" : "#4285F4" }}>
                    {routeInfo.time}
                    <span style={{ fontSize: 11, color: "#555", fontWeight: 400, marginLeft: 3 }}>min</span>
                  </span>
                  <span style={{ fontSize: 14, color: "#666" }}>·</span>
                  <span style={{ fontSize: 16, fontWeight: 600, color: "#999" }}>{routeInfo.distance} m</span>
                  {selectedDest && (
                    <span style={{ fontSize: 12, color: "#555", overflow: "hidden",
                      textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                      → {selectedDest.name}
                    </span>
                  )}
                </div>
              )}
              {navigating ? (
                <button className="cnav-btn" onClick={clearRoute}
                  style={{ padding: "10px 14px", background: "#d93025", color: "#fff",
                    border: "none", borderRadius: 12, cursor: "pointer",
                    fontWeight: 700, fontSize: 13, flexShrink: 0 }}>✕</button>
              ) : isPreviewMode ? (
                <button className="cnav-btn" onClick={() => setShowStepsPanel((v) => !v)}
                  style={{ padding: "10px 14px", background: "#4285F4", color: "#fff",
                    border: "none", borderRadius: 12, cursor: "pointer",
                    fontWeight: 700, fontSize: 13, flexShrink: 0 }}>☰</button>
              ) : (
                <button className="cnav-btn" onClick={handleStartNavigation}
                  style={{ padding: "10px 14px", background: "#34a853", color: "#fff",
                    border: "none", borderRadius: 12, cursor: "pointer",
                    fontWeight: 700, fontSize: 13, flexShrink: 0 }}>▶ Go</button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── GPS pill ── */}
      {!routeReady && !navigating && (
        <div style={{ position: "absolute", bottom: 24, left: 12, zIndex: 20,
          display: "flex", alignItems: "center", gap: 7, padding: "6px 12px",
          background: coords ? "rgba(52,168,83,0.12)" : "rgba(234,67,53,0.1)",
          borderRadius: 20, border: `1px solid ${coords ? "#34a85340" : "#ea433540"}`,
          fontSize: 11, color: coords ? "#34a853" : "#ea4335", backdropFilter: "blur(8px)" }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%",
            background: coords ? "#34a853" : "#ea4335",
            boxShadow: coords ? "0 0 6px #34a853" : "none",
            animation: coords ? "gpsPulse 2s ease-out infinite" : "none" }} />
          {coords ? `GPS · ±${Math.round(coords.accuracy ?? 0)} m` : gpsError ? "GPS off" : "Acquiring…"}
        </div>
      )}

      {/* ── Search bottom sheet ── */}
      {sheetOpen && (
        <>
          <div onClick={() => { setSheetOpen(false); setSourceResults([]); setDestResults([]); }}
            style={{ position: "absolute", inset: 0, zIndex: 28, background: "rgba(0,0,0,0.4)" }} />
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 29,
            background: "#0e0e0e", borderRadius: "20px 20px 0 0",
            padding: "0 0 calc(16px + env(safe-area-inset-bottom))",
            boxShadow: "0 -8px 40px rgba(0,0,0,0.8)",
            animation: "sheetIn 0.35s cubic-bezier(0.32,0.72,0,1)",
            maxHeight: "85vh", display: "flex", flexDirection: "column" }}>

            <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 8px" }}>
              <div style={{ width: 40, height: 4, borderRadius: 2, background: "#333" }} />
            </div>

            <div style={{ padding: "0 16px 16px", overflowY: "auto" }}>
              <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: "#fff" }}>
                🗺️ Navigate Campus
              </h3>

              {/* From */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  From
                </label>
                <div style={{ position: "relative" }}>
                  <input type="text" placeholder="Leave empty to use GPS…" value={sourceQuery}
                    onChange={(e) => { handleSearch(e.target.value, true); setSelectedSource(null); }}
                    style={{ width: "100%", padding: "10px 12px", marginTop: 5, background: "#1a1a1a",
                      color: "white", border: "1px solid #333", borderRadius: 10,
                      boxSizing: "border-box", fontSize: 14, outline: "none" }} />
                  {sourceResults.length > 0 && !selectedSource && (
                    <ul style={{ position: "absolute", top: "100%", left: 0, right: 0,
                      background: "#1a1a1a", listStyle: "none", margin: 0, padding: 0,
                      maxHeight: 160, overflowY: "auto", border: "1px solid #333",
                      borderRadius: "0 0 10px 10px", zIndex: 30 }}>
                      {sourceResults.map((n) => {
                        const name = getDisplayName(n);
                        const meta = [n.parentNodeName, n.floor > 0 ? `Floor ${n.floor}` : null]
                          .filter(Boolean).join(" · ");
                        return (
                          <li key={n.id} style={{ padding: "10px 12px", cursor: "pointer", borderBottom: "1px solid #222" }}
                            onTouchStart={(e) => (e.currentTarget.style.background = "#2a2a2a")}
                            onTouchEnd={(e)   => (e.currentTarget.style.background = "transparent")}
                            onClick={() => { setSelectedSource(n); setSourceQuery(name); setSourceResults([]); flyToNode(n); }}>
                            <div style={{ fontSize: 13, color: "#fff" }}>{name}</div>
                            {meta && <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{meta}</div>}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>

              {/* To */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  To
                </label>
                <div style={{ position: "relative" }}>
                  <input type="text" placeholder="Search destination…" value={destQuery}
                    onChange={(e) => { handleSearch(e.target.value, false); setSelectedDest(null); }}
                    style={{ width: "100%", padding: "10px 12px", marginTop: 5, background: "#1a1a1a",
                      color: "white", border: "1px solid #333", borderRadius: 10,
                      boxSizing: "border-box", fontSize: 14, outline: "none" }} />
                  {destResults.length > 0 && !selectedDest && (
                    <ul style={{ position: "absolute", top: "100%", left: 0, right: 0,
                      background: "#1a1a1a", listStyle: "none", margin: 0, padding: 0,
                      maxHeight: 160, overflowY: "auto", border: "1px solid #333",
                      borderRadius: "0 0 10px 10px", zIndex: 30 }}>
                      {destResults.map((n) => {
                        const name = getDisplayName(n);
                        const meta = [n.parentNodeName, n.floor > 0 ? `Floor ${n.floor}` : null]
                          .filter(Boolean).join(" · ");
                        return (
                          <li key={n.id} style={{ padding: "10px 12px", cursor: "pointer", borderBottom: "1px solid #222" }}
                            onTouchStart={(e) => (e.currentTarget.style.background = "#2a2a2a")}
                            onTouchEnd={(e)   => (e.currentTarget.style.background = "transparent")}
                            onClick={() => { setSelectedDest(n); setDestQuery(name); setDestResults([]); flyToNode(n); }}>
                            <div style={{ fontSize: 13, color: "#fff" }}>{name}</div>
                            {meta && <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{meta}</div>}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>

              <button className="cnav-btn" onClick={handleFindRoute} disabled={isSearching}
                style={{ width: "100%", padding: "14px 0",
                  background: isSearching ? "#2a4a8a" : "#4285F4",
                  color: "#fff", border: "none", borderRadius: 14,
                  cursor: isSearching ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 16 }}>
                {isSearching ? "Calculating…" : "Find Route"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}