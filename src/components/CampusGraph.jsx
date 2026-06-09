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

export default function CampusGraph() {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const mapLoaded = useRef(false);
  const pendingData = useRef(null);
  const nodeMarkersRef = useRef([]);
  const userMarkerRef = useRef(null);
  const searchPinRef = useRef(null);
  const autoFollowRef = useRef(false);

  const [mapData, setMapData] = useState({ nodes: [], edges: [] });
  const { coords, error: gpsError, isWatching } = useGPS();

  const [sourceQuery, setSourceQuery] = useState("");
  const [destQuery, setDestQuery] = useState("");
  const [sourceResults, setSourceResults] = useState([]);
  const [destResults, setDestResults] = useState([]);
  const [selectedSource, setSelectedSource] = useState(null);
  const [selectedDest, setSelectedDest] = useState(null);

  const [routeCoords, setRouteCoords] = useState([]);
  const [travelledIdx, setTravelledIdx] = useState(0);
  const [routeReady, setRouteReady] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [directions, setDirections] = useState([]);
  const [stepIdx, setStepIdx] = useState(0);
  const [routeInfo, setRouteInfo] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const [arrived, setArrived] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [activeInput, setActiveInput] = useState(null); // 'source' | 'dest'

  useEffect(() => {
    injectStyles();
    // Inject mobile-specific styles
    const style = document.createElement("style");
    style.textContent = `
      * { -webkit-tap-highlight-color: transparent; }
      html, body { overscroll-behavior: none; }
      .cnav-btn { transition: opacity 0.15s, transform 0.1s; }
      .cnav-btn:active { opacity: 0.75; transform: scale(0.97); }
      .bottom-sheet { transition: transform 0.35s cubic-bezier(0.32,0.72,0,1); }
      @keyframes gpsPulse { 0%{transform:scale(1);opacity:1} 70%{transform:scale(2.8);opacity:0} 100%{transform:scale(1);opacity:0} }
      @keyframes arrivalPop { 0%{transform:translate(-50%,-50%) scale(0.85);opacity:0} 100%{transform:translate(-50%,-50%) scale(1);opacity:1} }
      @keyframes dirSlide { 0%{transform:translateX(-50%) translateY(-12px);opacity:0} 100%{transform:translateX(-50%) translateY(0);opacity:1} }
      @keyframes sheetIn { 0%{transform:translateY(100%)} 100%{transform:translateY(0)} }
    `;
    document.head.appendChild(style);
  }, []);

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

    // Only show attribution, no nav control on mobile (use custom re-center)
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    map.on("load", () => {
      // Accuracy circle
      map.addSource("accuracy-src", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "accuracy-fill",
        type: "circle",
        source: "accuracy-src",
        paint: {
          "circle-color": "rgba(66,133,244,0.1)",
          "circle-stroke-color": "rgba(66,133,244,0.4)",
          "circle-stroke-width": 1.5,
          "circle-pitch-alignment": "map",
          "circle-radius": { base: 2, stops: [[0, 0], [20, 400]] },
        },
      });

      // Edges
      map.addSource("edges", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "edges-layer",
        type: "line",
        source: "edges",
        paint: { "line-color": "#666", "line-width": 1.5, "line-opacity": 0.35 },
      });

      // Travelled route (grey)
      map.addSource("route-travelled", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "route-travelled-layer",
        type: "line",
        source: "route-travelled",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#888", "line-width": 7, "line-opacity": 0.6 },
      });

      // Remaining route (blue)
      map.addSource("route-src", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
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

      // Arrows
      map.addSource("arrows-src", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
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

    // Disable auto-follow when user manually pans
    map.on("dragstart", () => { autoFollowRef.current = false; });

    mapInstance.current = map;
  }, []);

  const renderMapData = useCallback((map, data) => {
    if (!map || !data?.nodes?.length) return;

    const edgeFeatures = (data.edges || [])
      .map((edge) => {
        const src = data.nodes.find((n) => n.id === edge.sourceNodeId);
        const tgt = data.nodes.find((n) => n.id === (edge.destinationNodeId ?? edge.targetNodeId));
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
        ["BUILDING", "CANTEEN", "HOSTEL", "LIBRARY", "LAB", "ADMIN", "AUDITORIUM", "CLASSROOM", "LECTURE_HALL", "OTHER"]
          .includes(n.nodeType?.toUpperCase())
      )
      .forEach((node) => {
        const cfg = NODE_CFG[normalizeNodeType(node.nodeType)] || NODE_CFG.DEFAULT;
        const el = document.createElement("div");
        Object.assign(el.style, { display: "flex", flexDirection: "column", alignItems: "center", cursor: "pointer", gap: "2px" });
        const lbl = document.createElement("div");
        lbl.innerText = node.name;
        Object.assign(lbl.style, {
          fontSize: "10px", color: "#fff", background: "rgba(0,0,0,0.6)",
          padding: "1px 5px", borderRadius: "3px", whiteSpace: "nowrap",
          maxWidth: "100px", overflow: "hidden", textOverflow: "ellipsis",
        });
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
            .addTo(map)
        );
      });
  }, []);

  useEffect(() => {
    if (!mapData?.nodes?.length) return;
    if (mapLoaded.current && mapInstance.current) renderMapData(mapInstance.current, mapData);
    else pendingData.current = mapData;
  }, [mapData, renderMapData]);

  useEffect(() => {
    axios
      .get(`${import.meta.env.VITE_API_URL}/api/v1/user/graph`)
      .then((r) => setMapData(r.data?.data ?? { nodes: [], edges: [] }))
      .catch((e) => console.error("Graph fetch failed:", e));
  }, []);

  // Update GPS marker
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !coords) return;

    if (!userMarkerRef.current) {
      const wrap = document.createElement("div");
      wrap.style.cssText = "position:relative;width:22px;height:22px;";
      const pulse = document.createElement("div");
      pulse.style.cssText = "position:absolute;inset:0;background:rgba(66,133,244,0.35);border-radius:50%;animation:gpsPulse 2s ease-out infinite;";
      const dot = document.createElement("div");
      dot.style.cssText = "position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:13px;height:13px;background:#4285F4;border:2.5px solid #fff;border-radius:50%;box-shadow:0 0 12px rgba(66,133,244,0.9);";
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

    // Auto-follow when navigating
    if (navigating && autoFollowRef.current) {
      // handled in navigation effect below
    }
  }, [coords, navigating]);

  // Navigation tracking effect
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !coords || !navigating || !routeCoords.length) return;

    let minD = Infinity, closestIdx = 0;
    routeCoords.forEach(([lng, lat], i) => {
      const d = getDistanceInMeters(coords.lat, coords.lng, lat, lng);
      if (d < minD) { minD = d; closestIdx = i; }
    });

    setTravelledIdx(closestIdx);

    const remaining = [[coords.lng, coords.lat], ...routeCoords.slice(closestIdx)];
    const travelled = [...routeCoords.slice(0, closestIdx + 1), [coords.lng, coords.lat]];

    let remMeters = 0;
    for (let i = 0; i < remaining.length - 1; i++) {
      remMeters += getDistanceInMeters(remaining[i][1], remaining[i][0], remaining[i + 1][1], remaining[i + 1][0]);
    }

    // Update route visuals
    map.getSource("route-src")?.setData({ type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: remaining } }] });
    map.getSource("route-travelled")?.setData({ type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: travelled } }] });
    map.getSource("arrows-src")?.setData({ type: "FeatureCollection", features: buildArrowFeatures(remaining) });

    setRouteInfo({ distance: Math.round(remMeters), time: Math.max(1, Math.ceil(remMeters / 1.4 / 60)) });

    if (remMeters < 12) { setArrived(true); return; }

    // Update step
    if (directions.length > 0) {
      let best = 0, bestD = Infinity;
      directions.forEach((step, i) => {
        const [sLng, sLat] = routeCoords[Math.min(step.coordIndex, routeCoords.length - 1)];
        const d = getDistanceInMeters(coords.lat, coords.lng, sLat, sLng);
        if (d < bestD) { bestD = d; best = i; }
      });
      setStepIdx(best);
    }

    // Auto-follow: rotate & center map on user
    if (remaining.length >= 2) {
      const bearing = getBearing(remaining[0][1], remaining[0][0], remaining[1][1], remaining[1][0]);
      map.easeTo({ center: [coords.lng, coords.lat], bearing, zoom: 18, duration: 900 });
    }
  }, [coords, navigating, routeCoords, directions]);

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
      searchPinRef.current = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([node.longitude, node.latitude]).addTo(map);
    }
    map.flyTo({ center: [node.longitude, node.latitude], zoom: node.parentNodeId != null ? 19 : 18, pitch: 0, bearing: 0, duration: 1600 });
  };

  const handleSearch = async (query, isSource) => {
    if (isSource) setSourceQuery(query);
    else setDestQuery(query);
    if (query.length < 2) { isSource ? setSourceResults([]) : setDestResults([]); return; }
    try {
      const res = await axios.get(`${API_USER_BASE}/node/search?query=${query}`);
      const filtered = (res.data.data || []).filter((n) =>
        ["OTHER", "BUILDING", "CLASSROOM", "LECTURE_HALL"].includes(n.nodeType?.toUpperCase())
      );
      isSource ? setSourceResults(filtered) : setDestResults(filtered);
    } catch (e) { console.error(e); }
  };

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
      const res = await axios.get(`${API_USER_BASE}/graph/shortest-path/${activeSource.id}/${selectedDest.id}`);
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

      setRouteCoords(arr);
      setTravelledIdx(0);
      setDirections(buildDirections(arr));
      setStepIdx(0);
      setRouteInfo({ distance: Math.round(total), time: Math.max(1, Math.ceil(total / 1.4 / 60)) });
      setRouteReady(true);
      setNavigating(false);
      setArrived(false);
      setSheetOpen(false);

      const map = mapInstance.current;
      if (map) {
        map.getSource("route-travelled")?.setData({ type: "FeatureCollection", features: [] });
        map.getSource("route-src").setData({ type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: arr } }] });
        map.getSource("arrows-src").setData({ type: "FeatureCollection", features: buildArrowFeatures(arr) });
        const lngs = arr.map((c) => c[0]), lats = arr.map((c) => c[1]);
        map.fitBounds(
          [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
          { padding: { top: 80, bottom: 200, left: 40, right: 40 }, pitch: 0, bearing: 0, duration: 1800 }
        );
      }
    } catch (e) {
      console.error(e);
      alert("Could not find a route.");
    } finally {
      setIsSearching(false);
    }
  };

  const handleStartNavigation = () => {
    setNavigating(true);
    autoFollowRef.current = true;
    setShowSteps(false);
    setSheetOpen(false);
    const map = mapInstance.current;
    if (map && coords) map.easeTo({ center: [coords.lng, coords.lat], zoom: 18, pitch: 0, duration: 1200 });
  };

  const reCenter = () => {
    autoFollowRef.current = true;
    const map = mapInstance.current;
    if (!map || !coords) return;
    map.easeTo({ center: [coords.lng, coords.lat], zoom: 18, duration: 800 });
  };

  const clearRoute = () => {
    setSelectedSource(null);
    setSelectedDest(null);
    setSourceQuery("");
    setDestQuery("");
    setRouteCoords([]);
    setTravelledIdx(0);
    setRouteReady(false);
    setNavigating(false);
    setDirections([]);
    setStepIdx(0);
    setRouteInfo(null);
    setShowSteps(false);
    setArrived(false);
    autoFollowRef.current = false;
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

  // ─── Layout ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden", background: "#000" }}>

      {/* ── Map fills entire screen ── */}
      <div ref={mapRef} style={{ position: "absolute", inset: 0 }} />

      {/* ── Top search bar (always visible, Google Maps style) ── */}
      {!navigating && (
        <div style={{
          position: "absolute", top: 12, left: 12, right: 12, zIndex: 20,
          display: "flex", gap: 8, alignItems: "center", marginTop: "50px"
        }}>
          <div
            onClick={() => setSheetOpen(true)}
            style={{
              flex: 1, background: "rgba(14,14,14,0.96)", color: destQuery ? "#fff" : "#666",
              padding: "12px 16px", borderRadius: 14, fontSize: 14, fontWeight: 500,
              boxShadow: "0 4px 24px rgba(0,0,0,0.5)", border: "1px solid #2a2a2a",
              backdropFilter: "blur(12px)", cursor: "pointer",
              display: "flex", alignItems: "center", gap: 8,
            }}
          >
            <span style={{ fontSize: 16 }}>🔍</span>
            <span>{destQuery || "Where do you want to go?"}</span>
          </div>
        </div>
      )}

      {/* ── Turn-by-turn banner (during navigation) ── */}
      {navigating && dirInfo && !arrived && (
        <div style={{
          position: "absolute", top: 16, left: 12, right: 12, zIndex: 25,
          animation: "dirSlide 0.3s ease",
          background: "rgba(10,10,10,0.97)",
          border: `2.5px solid ${dirInfo.color}`,
          borderRadius: 18, padding: "13px 16px",
          display: "flex", alignItems: "center", gap: 13,
          boxShadow: `0 6px 28px rgba(0,0,0,0.7)`,
          backdropFilter: "blur(14px)",
          marginTop: "50px"
        }}>
          <div style={{
            width: 50, height: 50, borderRadius: 13,
            background: `${dirInfo.color}18`, border: `2px solid ${dirInfo.color}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 26, flexShrink: 0,
          }}>
            {dirInfo.icon}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: dirInfo.color }}>{dirInfo.label}</div>
            {activeStep?.distance > 0 && (
              <div style={{ fontSize: 12, color: "#888", marginTop: 3 }}>in {activeStep.distance} m</div>
            )}
          </div>
          <div style={{ fontSize: 10, color: "#555" }}>{stepIdx + 1}/{directions.length}</div>
        </div>
      )}

      {/* ── Arrived overlay ── */}
      {arrived && (
        <div style={{
          position: "absolute", top: "50%", left: "50%", zIndex: 30,
          animation: "arrivalPop 0.4s ease",
          background: "rgba(10,10,10,0.97)", border: "2px solid #34a853",
          borderRadius: 20, padding: "28px 40px", textAlign: "center",
          boxShadow: "0 12px 48px rgba(0,0,0,0.8)",
          transform: "translate(-50%,-50%)",
        }}>
          <div style={{ fontSize: 48 }}>🏁</div>
          <div style={{ fontSize: 21, fontWeight: 700, color: "#34a853", marginTop: 8 }}>You have arrived!</div>
          <div style={{ fontSize: 13, color: "#777", marginTop: 4 }}>{selectedDest?.name}</div>
          <button className="cnav-btn" onClick={clearRoute} style={{
            marginTop: 16, padding: "10px 28px", background: "#34a853",
            color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 14,
          }}>Done</button>
        </div>
      )}

      {/* ── Right-side floating buttons ── */}
      <div style={{ position: "absolute", right: 12, bottom: 180, zIndex: 20, display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Re-center */}
        <button className="cnav-btn" onClick={reCenter} style={{
          width: 44, height: 44, borderRadius: "50%",
          background: "rgba(14,14,14,0.96)", border: "1px solid #2a2a2a",
          color: "#4285F4", fontSize: 20, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
        }}>⊕</button>

        {/* Steps toggle during navigation */}
        {navigating && directions.length > 0 && !arrived && (
          <button className="cnav-btn" onClick={() => setShowSteps(v => !v)} style={{
            width: 44, height: 44, borderRadius: "50%",
            background: showSteps ? "#4285F4" : "rgba(14,14,14,0.96)",
            border: "1px solid #2a2a2a", color: showSteps ? "#fff" : "#4285F4",
            fontSize: 18, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
          }}>☰</button>
        )}
      </div>

      {/* ── Steps panel (slide-up during navigation) ── */}
      {navigating && showSteps && directions.length > 0 && !arrived && (
        <div style={{
          position: "absolute", bottom: 170, left: 12, right: 12, zIndex: 20,
          background: "rgba(12,12,12,0.97)", color: "white",
          borderRadius: 16, padding: 14,
          maxHeight: "45vh", overflowY: "auto",
          boxShadow: "0 8px 28px rgba(0,0,0,0.65)", border: "1px solid #222",
          backdropFilter: "blur(10px)",
        }}>
          <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>All Steps</div>
          {directions.map((step, i) => {
            const di = DIR[step.type] || DIR.straight;
            const isActive = i === stepIdx;
            return (
              <div key={i} onClick={() => setStepIdx(i)} style={{
                display: "flex", alignItems: "center", gap: 9,
                padding: "7px 8px", borderRadius: 9, cursor: "pointer",
                background: isActive ? `${di.color}18` : "transparent",
                border: `1px solid ${isActive ? di.color + "44" : "transparent"}`,
                marginBottom: 3,
              }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 7,
                  background: `${di.color}18`, border: `1px solid ${di.color}55`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 15, flexShrink: 0,
                }}>{di.icon}</div>
                <div>
                  <div style={{ fontSize: 12, color: isActive ? di.color : "#ccc", fontWeight: isActive ? 700 : 400 }}>{di.label}</div>
                  {step.distance > 0 && <div style={{ fontSize: 10, color: "#555" }}>{step.distance} m</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Bottom action bar (ETA + Start/End) ── */}
      {(routeReady || navigating) && !arrived && (
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 20,
          background: "rgba(10,10,10,0.97)",
          borderTop: "1px solid #1a1a1a",
          padding: "16px 16px calc(16px + env(safe-area-inset-bottom))",
          backdropFilter: "blur(14px)",
          boxShadow: "0 -8px 32px rgba(0,0,0,0.6)",
        }}>
          {routeInfo && (
            <div style={{ display: "flex", gap: 12, marginBottom: 14, justifyContent: "center" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: navigating ? "#34a853" : "#4285F4", lineHeight: 1 }}>
                  {routeInfo.time}
                </div>
                <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>min walk</div>
              </div>
              <div style={{ width: 1, background: "#2a2a2a" }} />
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 22, fontWeight: 600, color: "#bbb", lineHeight: 1 }}>
                  {routeInfo.distance} m
                </div>
                <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{navigating ? "remaining" : "total"}</div>
              </div>
              {selectedDest && (
                <>
                  <div style={{ width: 1, background: "#2a2a2a" }} />
                  <div style={{ textAlign: "center", flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#ddd", lineHeight: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
                <button className="cnav-btn" onClick={handleStartNavigation} style={{
                  flex: 1, padding: "14px 0", background: "#34a853", color: "#fff",
                  border: "none", borderRadius: 14, cursor: "pointer", fontWeight: 700, fontSize: 16,
                }}>▶ Start Navigation</button>
                <button className="cnav-btn" onClick={clearRoute} style={{
                  padding: "14px 18px", background: "#333", color: "#fff",
                  border: "none", borderRadius: 14, cursor: "pointer", fontWeight: 700, fontSize: 16,
                }}>✕</button>
              </>
            ) : (
              <button className="cnav-btn" onClick={clearRoute} style={{
                flex: 1, padding: "14px 0", background: "#d93025", color: "#fff",
                border: "none", borderRadius: 14, cursor: "pointer", fontWeight: 700, fontSize: 16,
              }}>✕ End Navigation</button>
            )}
          </div>
        </div>
      )}

      {/* ── GPS Status pill (top-left, only when no route) ── */}
      {!routeReady && !navigating && (
        <div style={{
          position: "absolute", bottom: 24, left: 12, zIndex: 20,
          display: "flex", alignItems: "center", gap: 7,
          padding: "6px 12px",
          background: coords ? "rgba(52,168,83,0.12)" : "rgba(234,67,53,0.1)",
          borderRadius: 20, border: `1px solid ${coords ? "#34a85340" : "#ea433540"}`,
          fontSize: 11, color: coords ? "#34a853" : "#ea4335",
          backdropFilter: "blur(8px)",
        }}>
          <div style={{
            width: 7, height: 7, borderRadius: "50%",
            background: coords ? "#34a853" : "#ea4335",
            boxShadow: coords ? "0 0 6px #34a853" : "none",
            animation: coords ? "gpsPulse 2s ease-out infinite" : "none",
          }} />
          {coords ? `GPS · ±${Math.round(coords.accuracy ?? 0)}m` : gpsError ? "GPS off" : "Acquiring…"}
        </div>
      )}

      {/* ── Bottom Sheet (search) ── */}
      {sheetOpen && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => { setSheetOpen(false); setSourceResults([]); setDestResults([]); }}
            style={{ position: "absolute", inset: 0, zIndex: 28, background: "rgba(0,0,0,0.4)" }}
          />
          <div style={{
            position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 29,
            background: "#0e0e0e", borderRadius: "20px 20px 0 0",
            padding: "0 0 calc(16px + env(safe-area-inset-bottom))",
            boxShadow: "0 -8px 40px rgba(0,0,0,0.8)",
            animation: "sheetIn 0.35s cubic-bezier(0.32,0.72,0,1)",
            maxHeight: "85vh", display: "flex", flexDirection: "column",
          }}>
            {/* Drag handle */}
            <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 8px" }}>
              <div style={{ width: 40, height: 4, borderRadius: 2, background: "#333" }} />
            </div>

            <div style={{ padding: "0 16px 16px", overflowY: "auto" }}>
              <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: "#fff" }}>🗺️ Navigate Campus</h3>

              {/* From */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: "0.5px" }}>From</label>
                <div style={{ position: "relative" }}>
                  <input
                    type="text"
                    placeholder="Leave empty to use GPS…"
                    value={sourceQuery}
                    onFocus={() => setActiveInput("source")}
                    onChange={(e) => { handleSearch(e.target.value, true); setSelectedSource(null); }}
                    style={{
                      width: "100%", padding: "10px 12px", marginTop: 5,
                      background: "#1a1a1a", color: "white", border: "1px solid #333",
                      borderRadius: 10, boxSizing: "border-box", fontSize: 14, outline: "none",
                    }}
                  />
                  {sourceResults.length > 0 && !selectedSource && (
                    <ul style={{
                      position: "absolute", top: "100%", left: 0, right: 0,
                      background: "#1a1a1a", listStyle: "none", margin: 0, padding: 0,
                      maxHeight: 160, overflowY: "auto", border: "1px solid #333",
                      borderRadius: "0 0 10px 10px", zIndex: 30,
                    }}>
                      {sourceResults.map((n) => {
                        const name = getDisplayName(n);
                        const meta = [n.parentNodeName, n.floor > 0 ? `Floor ${n.floor}` : null].filter(Boolean).join(" · ");
                        return (
                          <li key={n.id}
                            style={{ padding: "10px 12px", cursor: "pointer", borderBottom: "1px solid #222" }}
                            onTouchStart={(e) => e.currentTarget.style.background = "#2a2a2a"}
                            onTouchEnd={(e) => e.currentTarget.style.background = "transparent"}
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
                  <input
                    type="text"
                    placeholder="Search destination…"
                    value={destQuery}
                    onFocus={() => setActiveInput("dest")}
                    onChange={(e) => { handleSearch(e.target.value, false); setSelectedDest(null); }}
                    style={{
                      width: "100%", padding: "10px 12px", marginTop: 5,
                      background: "#1a1a1a", color: "white", border: "1px solid #333",
                      borderRadius: 10, boxSizing: "border-box", fontSize: 14, outline: "none",
                    }}
                  />
                  {destResults.length > 0 && !selectedDest && (
                    <ul style={{
                      position: "absolute", top: "100%", left: 0, right: 0,
                      background: "#1a1a1a", listStyle: "none", margin: 0, padding: 0,
                      maxHeight: 160, overflowY: "auto", border: "1px solid #333",
                      borderRadius: "0 0 10px 10px", zIndex: 30,
                    }}>
                      {destResults.map((n) => {
                        const name = getDisplayName(n);
                        const meta = [n.parentNodeName, n.floor > 0 ? `Floor ${n.floor}` : null].filter(Boolean).join(" · ");
                        return (
                          <li key={n.id}
                            style={{ padding: "10px 12px", cursor: "pointer", borderBottom: "1px solid #222" }}
                            onTouchStart={(e) => e.currentTarget.style.background = "#2a2a2a"}
                            onTouchEnd={(e) => e.currentTarget.style.background = "transparent"}
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

              {/* Find Route button */}
              <button
                className="cnav-btn"
                onClick={handleFindRoute}
                disabled={isSearching}
                style={{
                  width: "100%", padding: "14px 0",
                  background: isSearching ? "#2a4a8a" : "#4285F4",
                  color: "#fff", border: "none", borderRadius: 14,
                  cursor: isSearching ? "not-allowed" : "pointer",
                  fontWeight: 700, fontSize: 16,
                }}
              >
                {isSearching ? "Calculating…" : "Find Route"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}