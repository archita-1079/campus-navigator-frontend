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
  getTurnDirection,
  buildDirections,
  buildArrowFeatures,
  DIR,
  injectStyles,
} from "../utils/graph";

const API_USER_BASE = `${import.meta.env.VITE_API_URL}/api/v1/user`;

// ─── Off-route threshold ──────────────────────────────────────────────────────
// If user is more than this many metres from the nearest route point → reroute
const OFF_ROUTE_THRESHOLD_M = 20;

// ─── Compass heading from DeviceOrientationEvent ──────────────────────────
function useCompassHeading() {
  const [heading, setHeading] = useState(null);

  useEffect(() => {
    let handler;

    if (
      typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function"
    ) {
      handler = (e) => {
        if (e.webkitCompassHeading != null) setHeading(e.webkitCompassHeading);
        else if (e.alpha != null) setHeading((360 - e.alpha + 360) % 360);
      };
      window.addEventListener("deviceorientationabsolute", handler, true);
      window.addEventListener("deviceorientation", handler, true);
    } else {
      handler = (e) => {
        if (e.webkitCompassHeading != null) setHeading(e.webkitCompassHeading);
        else if (e.absolute && e.alpha != null)
          setHeading((360 - e.alpha + 360) % 360);
        else if (e.alpha != null) setHeading((360 - e.alpha + 360) % 360);
      };
      window.addEventListener("deviceorientationabsolute", handler, true);
      window.addEventListener("deviceorientation", handler, true);
    }

    return () => {
      window.removeEventListener("deviceorientationabsolute", handler, true);
      window.removeEventListener("deviceorientation", handler, true);
    };
  }, []);

  return heading;
}

export default function CampusGraph() {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const mapLoaded = useRef(false);
  const pendingData = useRef(null);
  const nodeMarkersRef = useRef([]);
  const userMarkerRef = useRef(null);
  const headingArrowRef = useRef(null);
  const searchPinRef = useRef(null);
  const autoFollowRef = useRef(false);

  // ── NEW: rerouting state refs ──────────────────────────────────────────────
  const isReroutingRef = useRef(false);          // prevents concurrent reroute calls
  const lastRerouteTimeRef = useRef(0);          // debounce: only reroute every 5 s max
  const selectedDestRef = useRef(null);          // mirror of selectedDest for use inside effects
  const mapDataRef = useRef({ nodes: [], edges: [] }); // mirror of mapData for use inside effects

  const [mapData, setMapData] = useState({ nodes: [], edges: [] });
  const { coords, error: gpsError, isWatching } = useGPS();
  const compassHeading = useCompassHeading();

  const effectiveHeading = useCallback(() => {
    if (coords?.speed != null && coords.speed > 0.5 && coords.heading != null)
      return coords.heading;
    return compassHeading;
  }, [coords, compassHeading]);

  const [sourceQuery, setSourceQuery] = useState("");
  const [destQuery, setDestQuery] = useState("");
  const [sourceResults, setSourceResults] = useState([]);
  const [destResults, setDestResults] = useState([]);
  const [selectedSource, setSelectedSource] = useState(null);
  const [selectedDest, setSelectedDest] = useState(null);

  const [routeCoords, setRouteCoords] = useState([]);
  const routeCoordsRef = useRef([]);
  const [travelledIdx, setTravelledIdx] = useState(0);
  const [routeReady, setRouteReady] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [directions, setDirections] = useState([]);
  const directionsRef = useRef([]);
  const [stepIdx, setStepIdx] = useState(0);
  const [routeInfo, setRouteInfo] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const [arrived, setArrived] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  // ── NEW: rerouting UI state ────────────────────────────────────────────────
  const [isRerouting, setIsRerouting] = useState(false);

  // ── Preview bar collapsed state + re-auto-follow timer ────────────────────
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const reFollowTimerRef = useRef(null); // re-enables auto-follow 4 s after manual pan

  // Keep refs in sync
  useEffect(() => { routeCoordsRef.current = routeCoords; }, [routeCoords]);
  useEffect(() => { directionsRef.current = directions; }, [directions]);
  useEffect(() => { selectedDestRef.current = selectedDest; }, [selectedDest]);
  useEffect(() => { mapDataRef.current = mapData; }, [mapData]);

  // ── Inject styles ──────────────────────────────────────────────────────────
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
        0%   { transform: translateX(-50%) translateY(-12px); opacity: 0; }
        100% { transform: translateX(-50%) translateY(0); opacity: 1; }
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

  // ── Map initialisation ─────────────────────────────────────────────────────
  useEffect(() => {
    if (mapInstance.current) return;

    const map = new maplibregl.Map({
      container: mapRef.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [78.0035, 30.269],
      zoom: 17,
      pitch: 0,
      bearing: 0,
    });

    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right",
    );

    map.on("load", () => {
      map.addSource("accuracy-src", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "accuracy-fill",
        type: "circle",
        source: "accuracy-src",
        paint: {
          "circle-color": "rgba(66,133,244,0.12)",
          "circle-stroke-color": "rgba(66,133,244,0.45)",
          "circle-stroke-width": 1.5,
          "circle-pitch-alignment": "map",
          "circle-radius": { stops: [[14, 8], [16, 20], [18, 80], [20, 320]] },
        },
      });

      map.addSource("heading-src", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "heading-cone",
        type: "fill",
        source: "heading-src",
        paint: {
          "fill-color": "rgba(66,133,244,0.25)",
          "fill-outline-color": "rgba(66,133,244,0.5)",
        },
      });

      map.addSource("edges", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "edges-layer",
        type: "line",
        source: "edges",
        paint: { "line-color": "#666", "line-width": 1.5, "line-opacity": 0.35 },
      });

      map.addSource("route-travelled", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "route-travelled-layer",
        type: "line",
        source: "route-travelled",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#888", "line-width": 7, "line-opacity": 0.6 },
      });

      map.addSource("route-src", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "route-src",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#1a56c4", "line-width": 13, "line-opacity": 0.85 },
      });
      map.addLayer({
        id: "route-fill",
        type: "line",
        source: "route-src",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#4285F4", "line-width": 7, "line-opacity": 1 },
      });

      map.addSource("arrows-src", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "route-arrows",
        type: "symbol",
        source: "arrows-src",
        layout: {
          "text-field": "▶",
          "text-size": 13,
          "text-rotate": ["get", "bearing"],
          "text-rotation-alignment": "map",
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "#1a56c4",
          "text-halo-width": 1.5,
          "text-opacity": 0.9,
        },
      });

      mapLoaded.current = true;
      if (pendingData.current) renderMapData(map, pendingData.current);
    });

    // Disable auto-follow on manual pan; re-enable 4 s after the user lifts finger
    map.on("dragstart", () => {
      autoFollowRef.current = false;
      if (reFollowTimerRef.current) clearTimeout(reFollowTimerRef.current);
    });
    map.on("dragend", () => {
      if (reFollowTimerRef.current) clearTimeout(reFollowTimerRef.current);
      reFollowTimerRef.current = setTimeout(() => {
        autoFollowRef.current = true;
      }, 4000);
    });
    mapInstance.current = map;
  }, []);

  // ── Render campus graph data ───────────────────────────────────────────────
  const renderMapData = useCallback((map, data) => {
    if (!map || !data?.nodes?.length) return;

    const edgeFeatures = (data.edges || [])
      .map((edge) => {
        const src = data.nodes.find((n) => n.id === edge.sourceNodeId);
        const tgt = data.nodes.find(
          (n) => n.id === (edge.destinationNodeId ?? edge.targetNodeId),
        );
        if (!src || !tgt) return null;
        return {
          type: "Feature",
          properties: { edgeType: normalizeEdgeType(edge.edgeType) },
          geometry: {
            type: "LineString",
            coordinates: [
              [src.longitude, src.latitude],
              ...(edge.waypoints || []).map((w) => [w.longitude, w.latitude]),
              [tgt.longitude, tgt.latitude],
            ],
          },
        };
      })
      .filter(Boolean);
    map.getSource("edges")?.setData({ type: "FeatureCollection", features: edgeFeatures });

    nodeMarkersRef.current.forEach((m) => m.remove());
    nodeMarkersRef.current = [];

    data.nodes
      .filter((n) =>
        ["BUILDING", "CANTEEN", "HOSTEL", "LIBRARY", "LAB", "ADMIN",
          "AUDITORIUM", "CLASSROOM", "LECTURE_HALL", "OTHER",
        ].includes(n.nodeType?.toUpperCase()),
      )
      .forEach((node) => {
        const cfg = NODE_CFG[normalizeNodeType(node.nodeType)] || NODE_CFG.DEFAULT;
        const el = document.createElement("div");
        Object.assign(el.style, { display: "flex", flexDirection: "column", alignItems: "center", cursor: "pointer", gap: "2px" });
        const lbl = document.createElement("div");
        lbl.innerText = node.name;
        Object.assign(lbl.style, { fontSize: "10px", color: "#fff", background: "rgba(0,0,0,0.6)", padding: "1px 5px", borderRadius: "3px", whiteSpace: "nowrap", maxWidth: "100px", overflow: "hidden", textOverflow: "ellipsis" });
        const ico = document.createElement("div");
        ico.innerHTML = cfg.icon;
        Object.assign(ico.style, { fontSize: "18px", color: cfg.color, lineHeight: 1, filter: `drop-shadow(0 0 4px ${cfg.color})` });
        el.appendChild(lbl);
        el.appendChild(ico);
        el.addEventListener("click", () => {
          setSelectedDest(node);
          setDestQuery(node.name);
          setSheetOpen(true);
          new maplibregl.Popup({ offset: 25 })
            .setLngLat([node.longitude, node.latitude])
            .setHTML(`<div style="background:#1e1e1e;color:white;padding:10px;border-radius:10px;border:2px solid ${cfg.color}"><h4 style="margin:0">${node.name}</h4><p style="margin:4px 0 0;font-size:12px;color:#aaa">${node.nodeType}</p></div>`)
            .addTo(map);
        });
        nodeMarkersRef.current.push(
          new maplibregl.Marker({ element: el, anchor: "bottom" })
            .setLngLat([node.longitude, node.latitude])
            .addTo(map),
        );
      });
  }, []);

  useEffect(() => {
    if (!mapData?.nodes?.length) return;
    if (mapLoaded.current && mapInstance.current)
      renderMapData(mapInstance.current, mapData);
    else pendingData.current = mapData;
  }, [mapData, renderMapData]);

  useEffect(() => {
    axios
      .get(`${import.meta.env.VITE_API_URL}/api/v1/user/graph`)
      .then((r) => setMapData(r.data?.data ?? { nodes: [], edges: [] }))
      .catch((e) => console.error("Graph fetch failed:", e));
  }, []);

  // ── Build heading-cone GeoJSON triangle ───────────────────────────────────
  const buildHeadingCone = useCallback((lat, lng, headingDeg) => {
    if (headingDeg == null) return { type: "FeatureCollection", features: [] };
    const R = 0.00015;
    const spread = 30;
    const toRad = (d) => (d * Math.PI) / 180;
    const left = headingDeg - spread;
    const right = headingDeg + spread;
    const tip = [lng, lat];
    const lx = lng + R * Math.sin(toRad(left));
    const ly = lat + R * Math.cos(toRad(left));
    const rx = lng + R * Math.sin(toRad(right));
    const ry = lat + R * Math.cos(toRad(right));
    return {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [[[tip[0], tip[1]], [lx, ly], [rx, ry], [tip[0], tip[1]]]] },
        properties: {},
      }],
    };
  }, []);

  // ── Update user GPS marker + heading cone ─────────────────────────────────
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
      wrap.appendChild(pulse);
      wrap.appendChild(dot);
      userMarkerRef.current = new maplibregl.Marker({ element: wrap, anchor: "center" })
        .setLngLat([coords.lng, coords.lat])
        .addTo(map);
    } else {
      userMarkerRef.current.setLngLat([coords.lng, coords.lat]);
    }

    if (map.getSource("accuracy-src")) {
      map.getSource("accuracy-src").setData({
        type: "FeatureCollection",
        features: [{ type: "Feature", geometry: { type: "Point", coordinates: [coords.lng, coords.lat] }, properties: { acc: coords.accuracy ?? 20 } }],
      });
    }

    const hdg = effectiveHeading();
    if (map.getSource("heading-src")) {
      map.getSource("heading-src").setData(buildHeadingCone(coords.lat, coords.lng, hdg));
    }
  }, [coords, compassHeading, effectiveHeading, buildHeadingCone]);

  // ── NEW: Reroute helper ────────────────────────────────────────────────────
  // Called when the user goes off-route. Finds nearest graph node to current
  // GPS position and requests a fresh shortest-path to the destination.
  const triggerReroute = useCallback(async (currentCoords) => {
    if (isReroutingRef.current) return;                    // already in progress
    const now = Date.now();
    if (now - lastRerouteTimeRef.current < 5000) return;  // debounce 5 s
    const dest = selectedDestRef.current;
    if (!dest) return;

    const data = mapDataRef.current;
    if (!data?.nodes?.length) return;

    // Find nearest graph node to user's current position
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
      const res = await axios.get(
        `${API_USER_BASE}/graph/shortest-path/${nearestNode.id}/${dest.id}`,
      );
      const edges = res.data.data || [];

      const arr = [];
      edges.forEach((edge) => {
        const src = data.nodes.find((n) => n.id === edge.sourceNodeId);
        const tgt = data.nodes.find((n) => n.id === (edge.destinationNodeId ?? edge.targetNodeId));
        if (!src || !tgt) return;
        if (arr.length === 0) arr.push([src.longitude, src.latitude]);
        (edge.waypoints || []).forEach((w) => arr.push([w.longitude, w.latitude]));
        arr.push([tgt.longitude, tgt.latitude]);
      });

      // Prepend live GPS position so the line starts from the user
      arr.unshift([currentCoords.lng, currentCoords.lat]);

      if (arr.length < 2) return;

      let total = 0;
      for (let i = 0; i < arr.length - 1; i++)
        total += getDistanceInMeters(arr[i][1], arr[i][0], arr[i + 1][1], arr[i + 1][0]);

      const builtDirections = buildDirections(arr);

      setRouteCoords(arr);
      routeCoordsRef.current = arr;
      setTravelledIdx(0);
      setDirections(builtDirections);
      directionsRef.current = builtDirections;
      setStepIdx(0);
      setShowSteps(false); // dismiss stale steps list; user can reopen via ☰
      setRouteInfo({
        distance: Math.round(total),
        time: Math.max(1, Math.ceil(total / 1.4 / 60)),
      });

      const map = mapInstance.current;
      if (map) {
        map.getSource("route-travelled")?.setData({ type: "FeatureCollection", features: [] });
        map.getSource("route-src")?.setData({
          type: "FeatureCollection",
          features: [{ type: "Feature", geometry: { type: "LineString", coordinates: arr } }],
        });
        map.getSource("arrows-src")?.setData({
          type: "FeatureCollection",
          features: buildArrowFeatures(arr),
        });
      }
    } catch (e) {
      console.error("Reroute failed:", e);
    } finally {
      isReroutingRef.current = false;
      setIsRerouting(false);
    }
  }, []);

  // ── Navigation tracking (runs every second via GPS coords update) ──────────
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !coords || !navigating) return;

    const rc = routeCoordsRef.current;
    if (!rc.length) return;

    // 1. Find closest point on route to current position
    let minD = Infinity;
    let closestIdx = 0;
    rc.forEach(([lng, lat], i) => {
      const d = getDistanceInMeters(coords.lat, coords.lng, lat, lng);
      if (d < minD) { minD = d; closestIdx = i; }
    });

    setTravelledIdx(closestIdx);

    // ── NEW: Off-route / U-turn detection ─────────────────────────────────
    // If the user's closest point on the route is farther than the threshold,
    // they've gone off-route — trigger a reroute automatically.
    if (minD > OFF_ROUTE_THRESHOLD_M) {
      triggerReroute(coords);
      // Still continue rendering with the old route until reroute completes
    }

    // 2. Build remaining + travelled polylines
    const remaining = [[coords.lng, coords.lat], ...rc.slice(closestIdx)];
    const travelled = [...rc.slice(0, closestIdx + 1), [coords.lng, coords.lat]];

    // 3. Remaining distance
    let remMeters = 0;
    for (let i = 0; i < remaining.length - 1; i++)
      remMeters += getDistanceInMeters(remaining[i][1], remaining[i][0], remaining[i + 1][1], remaining[i + 1][0]);

    // 4. Update route visuals
    map.getSource("route-src")?.setData({
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: { type: "LineString", coordinates: remaining } }],
    });
    map.getSource("route-travelled")?.setData({
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: { type: "LineString", coordinates: travelled } }],
    });
    map.getSource("arrows-src")?.setData({
      type: "FeatureCollection",
      features: buildArrowFeatures(remaining),
    });

    setRouteInfo({
      distance: Math.round(remMeters),
      time: Math.max(1, Math.ceil(remMeters / 1.4 / 60)),
    });

    // 5. Arrived check
    if (remMeters < 12) {
      setArrived(true);
      return;
    }

    // 6. Update current direction step
    const dirs = directionsRef.current;
    if (dirs.length > 0) {
      let activeIdx = 0;
      for (let i = 0; i < dirs.length; i++) {
        if (closestIdx >= dirs[i].coordIndex) activeIdx = i;
        else break;
      }
      setStepIdx(activeIdx);
    }

    // 7. Auto-follow: always keep user centred while navigating
    // autoFollowRef can be briefly false after a manual pan (re-enables in 4 s)
    if (remaining.length >= 2) {
      const travelBearing = getBearing(
        remaining[0][1], remaining[0][0],
        remaining[1][1], remaining[1][0],
      );
      if (autoFollowRef.current) {
        map.easeTo({
          center: [coords.lng, coords.lat],
          bearing: travelBearing,
          zoom: 18.5,
          pitch: 45,
          duration: 700,
        });
      }
    }
  }, [coords, navigating, triggerReroute]); // coords changes ~every second from GPS

  // ── Campus node click → fly to ─────────────────────────────────────────────
  const flyToNode = (node) => {
    const map = mapInstance.current;
    if (!map) return;
    if (searchPinRef.current) { searchPinRef.current.remove(); searchPinRef.current = null; }
    if (node.parentNodeId != null) {
      const cfg = NODE_CFG[normalizeNodeType(node.nodeType)] || NODE_CFG.DEFAULT;
      const el = document.createElement("div");
      Object.assign(el.style, { display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" });
      const lbl = document.createElement("div");
      lbl.innerText = node.name;
      Object.assign(lbl.style, { fontSize: "11px", color: "#fff", background: "rgba(66,133,244,0.9)", padding: "2px 6px", borderRadius: "4px", fontWeight: "600" });
      const ico = document.createElement("div");
      ico.innerHTML = cfg.icon || "📍";
      Object.assign(ico.style, { fontSize: "22px", filter: "drop-shadow(0 0 6px #4285F4)" });
      el.appendChild(lbl);
      el.appendChild(ico);
      searchPinRef.current = new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([node.longitude, node.latitude])
        .addTo(map);
    }
    map.flyTo({
      center: [node.longitude, node.latitude],
      zoom: node.parentNodeId != null ? 19 : 18,
      pitch: 0, bearing: 0, duration: 1600,
    });
  };

  // ── Node search ────────────────────────────────────────────────────────────
  const handleSearch = async (query, isSource) => {
    if (isSource) setSourceQuery(query);
    else setDestQuery(query);
    if (query.length < 2) {
      isSource ? setSourceResults([]) : setDestResults([]);
      return;
    }
    try {
      const res = await axios.get(`${API_USER_BASE}/node/search?query=${query}`);
      const filtered = (res.data.data || []).filter((n) =>
        ["OTHER", "BUILDING", "CLASSROOM", "LECTURE_HALL"].includes(n.nodeType?.toUpperCase()),
      );
      isSource ? setSourceResults(filtered) : setDestResults(filtered);
    } catch (e) {
      console.error(e);
    }
  };

  // ── Find route ─────────────────────────────────────────────────────────────
  const handleFindRoute = async () => {
    if (!selectedDest) { alert("Please select a destination!"); return; }
    let activeSource = selectedSource;
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
    }

    setIsSearching(true);
    try {
      const res = await axios.get(
        `${API_USER_BASE}/graph/shortest-path/${activeSource.id}/${selectedDest.id}`,
      );
      const edges = res.data.data || [];
      const arr = [];
      edges.forEach((edge) => {
        const src = mapData.nodes.find((n) => n.id === edge.sourceNodeId);
        const tgt = mapData.nodes.find((n) => n.id === (edge.destinationNodeId ?? edge.targetNodeId));
        if (!src || !tgt) return;
        if (arr.length === 0) arr.push([src.longitude, src.latitude]);
        (edge.waypoints || []).forEach((w) => arr.push([w.longitude, w.latitude]));
        arr.push([tgt.longitude, tgt.latitude]);
      });
      if (arr.length === 0) arr.push([activeSource.longitude, activeSource.latitude]);
      if (coords && !selectedSource) arr.unshift([coords.lng, coords.lat]);

      let total = 0;
      for (let i = 0; i < arr.length - 1; i++)
        total += getDistanceInMeters(arr[i][1], arr[i][0], arr[i + 1][1], arr[i + 1][0]);

      const builtDirections = buildDirections(arr);

      setRouteCoords(arr);
      routeCoordsRef.current = arr;
      setTravelledIdx(0);
      setDirections(builtDirections);
      directionsRef.current = builtDirections;
      setStepIdx(0);
      setRouteInfo({ distance: Math.round(total), time: Math.max(1, Math.ceil(total / 1.4 / 60)) });
      setRouteReady(true);
      setNavigating(false);
      setArrived(false);
      setSheetOpen(false);
      setPreviewCollapsed(false);

      const map = mapInstance.current;
      if (map) {
        map.getSource("route-travelled")?.setData({ type: "FeatureCollection", features: [] });
        map.getSource("route-src")?.setData({
          type: "FeatureCollection",
          features: [{ type: "Feature", geometry: { type: "LineString", coordinates: arr } }],
        });
        map.getSource("arrows-src")?.setData({
          type: "FeatureCollection",
          features: buildArrowFeatures(arr),
        });
        const lngs = arr.map((c) => c[0]);
        const lats = arr.map((c) => c[1]);
        map.fitBounds(
          [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
          { padding: { top: 80, bottom: 200, left: 40, right: 40 }, pitch: 0, bearing: 0, duration: 1800 },
        );
      }
    } catch (e) {
      console.error(e);
      alert("Could not find a route.");
    } finally {
      setIsSearching(false);
    }
  };

  // ── Start navigation ───────────────────────────────────────────────────────
  const handleStartNavigation = () => {
    setNavigating(true);
    autoFollowRef.current = true;
    setShowSteps(false);
    setSheetOpen(false);
    isReroutingRef.current = false;
    lastRerouteTimeRef.current = 0;
    const map = mapInstance.current;
    if (map && coords) {
      map.easeTo({ center: [coords.lng, coords.lat], zoom: 18.5, pitch: 45, duration: 1200 });
    }
  };

  // ── Re-centre on user ──────────────────────────────────────────────────────
  const reCenter = () => {
    autoFollowRef.current = true;
    const map = mapInstance.current;
    if (!map || !coords) return;
    if (navigating) {
      const rc = routeCoordsRef.current;
      const hdg = rc.length >= 2 ? getBearing(rc[0][1], rc[0][0], rc[1][1], rc[1][0]) : 0;
      map.easeTo({ center: [coords.lng, coords.lat], zoom: 18.5, pitch: 45, bearing: hdg, duration: 800 });
    } else {
      map.easeTo({ center: [coords.lng, coords.lat], zoom: 18, pitch: 0, bearing: 0, duration: 800 });
    }
  };

  // ── Clear everything ───────────────────────────────────────────────────────
  const clearRoute = () => {
    setSelectedSource(null);
    setSelectedDest(null);
    setSourceQuery("");
    setDestQuery("");
    setRouteCoords([]);
    routeCoordsRef.current = [];
    setTravelledIdx(0);
    setRouteReady(false);
    setNavigating(false);
    setDirections([]);
    directionsRef.current = [];
    setStepIdx(0);
    setRouteInfo(null);
    setShowSteps(false);
    setArrived(false);
    setIsRerouting(false);
    isReroutingRef.current = false;
    lastRerouteTimeRef.current = 0;
    autoFollowRef.current = false;
    setPreviewCollapsed(false);
    if (searchPinRef.current) { searchPinRef.current.remove(); searchPinRef.current = null; }
    const map = mapInstance.current;
    if (map) {
      map.getSource("route-src")?.setData({ type: "FeatureCollection", features: [] });
      map.getSource("route-travelled")?.setData({ type: "FeatureCollection", features: [] });
      map.getSource("arrows-src")?.setData({ type: "FeatureCollection", features: [] });
      map.easeTo({ zoom: 17, pitch: 0, bearing: 0, duration: 800 });
    }
  };

  const activeStep = directions[stepIdx];
  const dirInfo = activeStep ? DIR[activeStep.type] || DIR.straight : null;

  // ── Layout ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden", background: "#000" }}>
      {/* Map canvas */}
      <div ref={mapRef} style={{ position: "absolute", inset: 0 }} />

      {/* ── Top search bar (not navigating) ── */}
      {!navigating && (
        <div style={{ position: "absolute", top: 12, left: 12, right: 12, zIndex: 20, display: "flex", gap: 8, alignItems: "center", marginTop: "50px" }}>
          <div
            onClick={() => setSheetOpen(true)}
            style={{ flex: 1, background: "rgba(14,14,14,0.96)", color: destQuery ? "#fff" : "#666", padding: "12px 16px", borderRadius: 14, fontSize: 14, fontWeight: 500, boxShadow: "0 4px 24px rgba(0,0,0,0.5)", border: "1px solid #2a2a2a", backdropFilter: "blur(12px)", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
          >
            <span style={{ fontSize: 16 }}>🔍</span>
            <span>{destQuery || "Where do you want to go?"}</span>
          </div>
        </div>
      )}

      {/* ── Rerouting banner ── */}
      {isRerouting && navigating && (
        <div style={{
          position: "absolute",
          top: 16,
          left: 12,
          right: 12,
          zIndex: 26,
          background: "rgba(10,10,10,0.97)",
          border: "2.5px solid #fbbc04",
          borderRadius: 18,
          padding: "13px 16px",
          display: "flex",
          alignItems: "center",
          gap: 13,
          boxShadow: "0 6px 28px rgba(0,0,0,0.7)",
          backdropFilter: "blur(14px)",
          marginTop: "50px",
          animation: "reroutePulse 1s ease infinite",
        }}>
          <div style={{ width: 50, height: 50, borderRadius: 13, background: "#fbbc0418", border: "2px solid #fbbc04", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, flexShrink: 0 }}>
            🔄
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#fbbc04" }}>Recalculating…</div>
            <div style={{ fontSize: 12, color: "#888", marginTop: 3 }}>Finding best route</div>
          </div>
        </div>
      )}

      {/* ── Turn-by-turn banner (navigating) ── */}
      {navigating && dirInfo && !arrived && !isRerouting && (
        <div style={{ position: "absolute", top: 16, left: 12, right: 12, zIndex: 25, animation: "dirSlide 0.3s ease", background: "rgba(10,10,10,0.97)", border: `2.5px solid ${dirInfo.color}`, borderRadius: 18, padding: "13px 16px", display: "flex", alignItems: "center", gap: 13, boxShadow: "0 6px 28px rgba(0,0,0,0.7)", backdropFilter: "blur(14px)", marginTop: "50px" }}>
          <div style={{ width: 50, height: 50, borderRadius: 13, background: `${dirInfo.color}18`, border: `2px solid ${dirInfo.color}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, flexShrink: 0 }}>
            {dirInfo.icon}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: dirInfo.color }}>{dirInfo.label}</div>
            {activeStep?.distance > 0 && (
              <div style={{ fontSize: 12, color: "#888", marginTop: 3 }}>in {activeStep.distance} m</div>
            )}
          </div>
          <div style={{ fontSize: 10, color: "#555" }}>{stepIdx + 1} / {directions.length}</div>
        </div>
      )}

      {/* ── Arrived overlay ── */}
      {arrived && (
        <div style={{ position: "absolute", top: "50%", left: "50%", zIndex: 30, animation: "arrivalPop 0.4s ease", background: "rgba(10,10,10,0.97)", border: "2px solid #34a853", borderRadius: 20, padding: "28px 40px", textAlign: "center", boxShadow: "0 12px 48px rgba(0,0,0,0.8)", transform: "translate(-50%,-50%)" }}>
          <div style={{ fontSize: 48 }}>🏁</div>
          <div style={{ fontSize: 21, fontWeight: 700, color: "#34a853", marginTop: 8 }}>You have arrived!</div>
          <div style={{ fontSize: 13, color: "#777", marginTop: 4 }}>{selectedDest?.name}</div>
          <button className="cnav-btn" onClick={clearRoute} style={{ marginTop: 16, padding: "10px 28px", background: "#34a853", color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
            Done
          </button>
        </div>
      )}

      {/* ── Floating action buttons (right side) ── */}
      <div style={{ position: "absolute", right: 12, bottom: (routeReady || navigating) && !arrived ? (previewCollapsed ? 70 : 180) : 80, zIndex: 20, display: "flex", flexDirection: "column", gap: 10, transition: "bottom 0.25s ease" }}>
        <button className="cnav-btn" onClick={reCenter} style={{ width: 44, height: 44, borderRadius: "50%", background: "rgba(14,14,14,0.96)", border: "1px solid #2a2a2a", color: "#4285F4", fontSize: 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 16px rgba(0,0,0,0.5)" }}>
          ⊕
        </button>

        {navigating && (
          <button className="cnav-btn" onClick={() => { const map = mapInstance.current; if (map) map.easeTo({ bearing: 0, pitch: 0, duration: 600 }); }} style={{ width: 44, height: 44, borderRadius: "50%", background: "rgba(14,14,14,0.96)", border: "1px solid #2a2a2a", color: "#ea4335", fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 16px rgba(0,0,0,0.5)" }}>
            🧭
          </button>
        )}

        {/* ── NEW: Manual reroute button ── */}
        {navigating && !arrived && (
          <button
            className="cnav-btn"
            onClick={() => coords && triggerReroute(coords)}
            disabled={isRerouting}
            title="Reroute from here"
            style={{ width: 44, height: 44, borderRadius: "50%", background: isRerouting ? "#2a2a2a" : "rgba(14,14,14,0.96)", border: "1px solid #2a2a2a", color: isRerouting ? "#555" : "#fbbc04", fontSize: 18, cursor: isRerouting ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 16px rgba(0,0,0,0.5)" }}
          >
            🔄
          </button>
        )}

        {navigating && directions.length > 0 && !arrived && (
          <button className="cnav-btn" onClick={() => setShowSteps((v) => !v)} style={{ width: 44, height: 44, borderRadius: "50%", background: showSteps ? "#4285F4" : "rgba(14,14,14,0.96)", border: "1px solid #2a2a2a", color: showSteps ? "#fff" : "#4285F4", fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 16px rgba(0,0,0,0.5)" }}>
            ☰
          </button>
        )}
      </div>

      {/* ── Steps panel ── */}
      {navigating && showSteps && directions.length > 0 && !arrived && (
        <div style={{ position: "absolute", bottom: previewCollapsed ? 70 : 170, left: 12, right: 12, zIndex: 20, background: "rgba(12,12,12,0.97)", color: "white", borderRadius: 16, padding: 14, maxHeight: "45vh", overflowY: "auto", boxShadow: "0 8px 28px rgba(0,0,0,0.65)", border: "1px solid #222", backdropFilter: "blur(10px)", transition: "bottom 0.25s ease" }}>

          {/* Header row: title + close button */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              All Steps
            </div>
            <button
              onClick={() => setShowSteps(false)}
              style={{ background: "none", border: "none", color: "#555", fontSize: 18, cursor: "pointer", lineHeight: 1, padding: "2px 4px", borderRadius: 6 }}
              aria-label="Close steps"
            >
              ✕
            </button>
          </div>

          {directions.map((step, i) => {
            const di = DIR[step.type] || DIR.straight;
            const isActive = i === stepIdx;
            return (
              <div key={i} onClick={() => setStepIdx(i)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 8px", borderRadius: 9, cursor: "pointer", background: isActive ? `${di.color}18` : "transparent", border: `1px solid ${isActive ? di.color + "44" : "transparent"}`, marginBottom: 3 }}>
                <div style={{ width: 28, height: 28, borderRadius: 7, background: `${di.color}18`, border: `1px solid ${di.color}55`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>{di.icon}</div>
                <div>
                  <div style={{ fontSize: 12, color: isActive ? di.color : "#ccc", fontWeight: isActive ? 700 : 400 }}>{di.label}</div>
                  {step.distance > 0 && <div style={{ fontSize: 10, color: "#555" }}>{step.distance} m</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Bottom bar (ETA + actions) ── */}
      {(routeReady || navigating) && !arrived && (
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 20, background: "rgba(10,10,10,0.97)", borderTop: "1px solid #1a1a1a", backdropFilter: "blur(14px)", boxShadow: "0 -8px 32px rgba(0,0,0,0.6)", borderRadius: "16px 16px 0 0", overflow: "hidden" }}>

          {/* Drag handle + collapse toggle */}
          <div
            onClick={() => setPreviewCollapsed(v => !v)}
            style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: "10px 0 6px", cursor: "pointer", gap: 6 }}
          >
            <div style={{ width: 36, height: 4, borderRadius: 2, background: "#333" }} />
            <span style={{ fontSize: 11, color: "#444", marginLeft: 6, userSelect: "none" }}>
              {previewCollapsed ? "▲" : "▼"}
            </span>
          </div>

          {/* Collapsible content */}
          {!previewCollapsed && (
            <div style={{ padding: "0 16px calc(16px + env(safe-area-inset-bottom))" }}>
              {routeInfo && (
                <div style={{ display: "flex", gap: 12, marginBottom: 14, justifyContent: "center" }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 28, fontWeight: 800, color: navigating ? "#34a853" : "#4285F4", lineHeight: 1 }}>{routeInfo.time}</div>
                    <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>min walk</div>
                  </div>
                  <div style={{ width: 1, background: "#2a2a2a" }} />
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 600, color: "#bbb", lineHeight: 1 }}>{routeInfo.distance} m</div>
                    <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{navigating ? "remaining" : "total"}</div>
                  </div>
                  {selectedDest && (
                    <>
                      <div style={{ width: 1, background: "#2a2a2a" }} />
                      <div style={{ textAlign: "center", flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#ddd", lineHeight: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedDest.name}</div>
                        <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>destination</div>
                      </div>
                    </>
                  )}
                </div>
              )}

              <div style={{ display: "flex", gap: 10 }}>
                {!navigating ? (
                  <>
                    <button className="cnav-btn" onClick={handleStartNavigation} style={{ flex: 1, padding: "14px 0", background: "#34a853", color: "#fff", border: "none", borderRadius: 14, cursor: "pointer", fontWeight: 700, fontSize: 16 }}>
                      ▶ Start Navigation
                    </button>
                    <button className="cnav-btn" onClick={clearRoute} style={{ padding: "14px 18px", background: "#333", color: "#fff", border: "none", borderRadius: 14, cursor: "pointer", fontWeight: 700, fontSize: 16 }}>
                      ✕
                    </button>
                  </>
                ) : (
                  <button className="cnav-btn" onClick={clearRoute} style={{ flex: 1, padding: "14px 0", background: "#d93025", color: "#fff", border: "none", borderRadius: 14, cursor: "pointer", fontWeight: 700, fontSize: 16 }}>
                    ✕ End Navigation
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Collapsed mini-bar: just show ETA + end button */}
          {previewCollapsed && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 16px calc(12px + env(safe-area-inset-bottom))" }}>
              {routeInfo && (
                <div style={{ flex: 1, display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 22, fontWeight: 800, color: navigating ? "#34a853" : "#4285F4" }}>{routeInfo.time}<span style={{ fontSize: 11, color: "#555", fontWeight: 400, marginLeft: 3 }}>min</span></span>
                  <span style={{ fontSize: 14, color: "#666" }}>·</span>
                  <span style={{ fontSize: 16, fontWeight: 600, color: "#999" }}>{routeInfo.distance} m</span>
                  {selectedDest && <span style={{ fontSize: 12, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>→ {selectedDest.name}</span>}
                </div>
              )}
              {navigating ? (
                <button className="cnav-btn" onClick={clearRoute} style={{ padding: "10px 14px", background: "#d93025", color: "#fff", border: "none", borderRadius: 12, cursor: "pointer", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                  ✕
                </button>
              ) : (
                <button className="cnav-btn" onClick={handleStartNavigation} style={{ padding: "10px 14px", background: "#34a853", color: "#fff", border: "none", borderRadius: 12, cursor: "pointer", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                  ▶ Go
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── GPS status pill ── */}
      {!routeReady && !navigating && (
        <div style={{ position: "absolute", bottom: 24, left: 12, zIndex: 20, display: "flex", alignItems: "center", gap: 7, padding: "6px 12px", background: coords ? "rgba(52,168,83,0.12)" : "rgba(234,67,53,0.1)", borderRadius: 20, border: `1px solid ${coords ? "#34a85340" : "#ea433540"}`, fontSize: 11, color: coords ? "#34a853" : "#ea4335", backdropFilter: "blur(8px)" }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: coords ? "#34a853" : "#ea4335", boxShadow: coords ? "0 0 6px #34a853" : "none", animation: coords ? "gpsPulse 2s ease-out infinite" : "none" }} />
          {coords ? `GPS · ±${Math.round(coords.accuracy ?? 0)} m` : gpsError ? "GPS off" : "Acquiring…"}
        </div>
      )}

      {/* ── Bottom sheet (search) ── */}
      {sheetOpen && (
        <>
          <div onClick={() => { setSheetOpen(false); setSourceResults([]); setDestResults([]); }} style={{ position: "absolute", inset: 0, zIndex: 28, background: "rgba(0,0,0,0.4)" }} />
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 29, background: "#0e0e0e", borderRadius: "20px 20px 0 0", padding: "0 0 calc(16px + env(safe-area-inset-bottom))", boxShadow: "0 -8px 40px rgba(0,0,0,0.8)", animation: "sheetIn 0.35s cubic-bezier(0.32,0.72,0,1)", maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 8px" }}>
              <div style={{ width: 40, height: 4, borderRadius: 2, background: "#333" }} />
            </div>

            <div style={{ padding: "0 16px 16px", overflowY: "auto" }}>
              <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: "#fff" }}>🗺️ Navigate Campus</h3>

              {/* From */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: "0.5px" }}>From</label>
                <div style={{ position: "relative" }}>
                  <input type="text" placeholder="Leave empty to use GPS…" value={sourceQuery}
                    onChange={(e) => { handleSearch(e.target.value, true); setSelectedSource(null); }}
                    style={{ width: "100%", padding: "10px 12px", marginTop: 5, background: "#1a1a1a", color: "white", border: "1px solid #333", borderRadius: 10, boxSizing: "border-box", fontSize: 14, outline: "none" }}
                  />
                  {sourceResults.length > 0 && !selectedSource && (
                    <ul style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#1a1a1a", listStyle: "none", margin: 0, padding: 0, maxHeight: 160, overflowY: "auto", border: "1px solid #333", borderRadius: "0 0 10px 10px", zIndex: 30 }}>
                      {sourceResults.map((n) => {
                        const name = getDisplayName(n);
                        const meta = [n.parentNodeName, n.floor > 0 ? `Floor ${n.floor}` : null].filter(Boolean).join(" · ");
                        return (
                          <li key={n.id} style={{ padding: "10px 12px", cursor: "pointer", borderBottom: "1px solid #222" }}
                            onTouchStart={(e) => (e.currentTarget.style.background = "#2a2a2a")}
                            onTouchEnd={(e) => (e.currentTarget.style.background = "transparent")}
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
                <label style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: "0.5px" }}>To</label>
                <div style={{ position: "relative" }}>
                  <input type="text" placeholder="Search destination…" value={destQuery}
                    onChange={(e) => { handleSearch(e.target.value, false); setSelectedDest(null); }}
                    style={{ width: "100%", padding: "10px 12px", marginTop: 5, background: "#1a1a1a", color: "white", border: "1px solid #333", borderRadius: 10, boxSizing: "border-box", fontSize: 14, outline: "none" }}
                  />
                  {destResults.length > 0 && !selectedDest && (
                    <ul style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#1a1a1a", listStyle: "none", margin: 0, padding: 0, maxHeight: 160, overflowY: "auto", border: "1px solid #333", borderRadius: "0 0 10px 10px", zIndex: 30 }}>
                      {destResults.map((n) => {
                        const name = getDisplayName(n);
                        const meta = [n.parentNodeName, n.floor > 0 ? `Floor ${n.floor}` : null].filter(Boolean).join(" · ");
                        return (
                          <li key={n.id} style={{ padding: "10px 12px", cursor: "pointer", borderBottom: "1px solid #222" }}
                            onTouchStart={(e) => (e.currentTarget.style.background = "#2a2a2a")}
                            onTouchEnd={(e) => (e.currentTarget.style.background = "transparent")}
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
                style={{ width: "100%", padding: "14px 0", background: isSearching ? "#2a4a8a" : "#4285F4", color: "#fff", border: "none", borderRadius: 14, cursor: isSearching ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 16 }}>
                {isSearching ? "Calculating…" : "Find Route"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}