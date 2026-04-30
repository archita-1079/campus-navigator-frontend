import React, { useEffect, useRef, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import axios from "axios";
import { NODE_CFG } from "../utils/constants";
import { useGPS } from "../hooks/useGPS";
import { getDisplayName, getDistanceInMeters } from "../utils/graph";

const API_USER_BASE = `${import.meta.env.VITE_API_URL}/api/v1/user`;

const normalizeNodeType = (type) => {
  if (!type) return "DEFAULT";
  const t = type.toUpperCase();
  if (["LIBRARY", "LAB", "ADMIN", "AUDITORIUM", "BUILDING"].includes(t))
    return "BUILDING";
  if (["CANTEEN", "SHOP"].includes(t)) return "FACILITY";
  if (["HOSTEL"].includes(t)) return "LANDMARK";
  if (["GATE", "ENTRANCE"].includes(t)) return "ENTRANCE";
  return "DEFAULT";
};

const normalizeEdgeType = (type) => {
  if (type === "WALKWAY") return "PATHWAY";
  if (type === "RAMP") return "ACCESSIBLE";
  return type;
};

const getBearing = (lat1, lng1, lat2, lng2) => {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const dLng = toRad(lng2 - lng1);
  const phi1 = toRad(lat1),
    phi2 = toRad(lat2);
  const y = Math.sin(dLng) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
};

const getTurnDirection = (prev, next) => {
  const diff = ((next - prev + 540) % 360) - 180;
  if (Math.abs(diff) < 22) return "straight";
  if (diff > 0 && diff <= 135) return "right";
  if (diff < 0 && diff >= -135) return "left";
  return "u-turn";
};

const buildDirections = (coords) => {
  if (coords.length < 2) return [];
  const steps = [];
  let segStart = 0;
  let segBearing = getBearing(
    coords[0][1],
    coords[0][0],
    coords[1][1],
    coords[1][0],
  );
  let segDist = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    segDist += getDistanceInMeters(
      coords[i][1],
      coords[i][0],
      coords[i + 1][1],
      coords[i + 1][0],
    );
    const isLast = i === coords.length - 2;
    if (isLast) {
      steps.push({
        type: "arrive",
        bearing: segBearing,
        distance: Math.round(segDist),
        coordIndex: segStart,
      });
      break;
    }
    const nextBearing = getBearing(
      coords[i + 1][1],
      coords[i + 1][0],
      coords[i + 2][1],
      coords[i + 2][0],
    );
    const turn = getTurnDirection(segBearing, nextBearing);
    if (turn !== "straight") {
      steps.push({
        type: turn,
        bearing: segBearing,
        distance: Math.round(segDist),
        coordIndex: segStart,
      });
      segStart = i + 1;
      segBearing = nextBearing;
      segDist = 0;
    }
  }
  return steps;
};

const buildArrowFeatures = (coordsArray, intervalM = 18) => {
  const features = [];
  let distAccum = 0;
  for (let i = 0; i < coordsArray.length - 1; i++) {
    const [lng1, lat1] = coordsArray[i];
    const [lng2, lat2] = coordsArray[i + 1];
    const segDist = getDistanceInMeters(lat1, lng1, lat2, lng2);
    const bearing = getBearing(lat1, lng1, lat2, lng2);
    let offset = intervalM - (distAccum % intervalM);
    while (offset <= segDist) {
      const frac = offset / segDist;
      features.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [
            lng1 + (lng2 - lng1) * frac,
            lat1 + (lat2 - lat1) * frac,
          ],
        },
        properties: { bearing },
      });
      offset += intervalM;
    }
    distAccum += segDist;
  }
  return features;
};

const DIR = {
  straight: { icon: "↑", label: "Continue straight", color: "#4285F4" },
  right: { icon: "→", label: "Turn right", color: "#FBBC05" },
  left: { icon: "←", label: "Turn left", color: "#FBBC05" },
  "u-turn": { icon: "↩", label: "Make a U-turn", color: "#EA4335" },
  arrive: { icon: "🏁", label: "You have arrived", color: "#34A853" },
};

const injectStyles = () => {
  if (document.getElementById("campus-nav-styles")) return;
  const s = document.createElement("style");
  s.id = "campus-nav-styles";
  s.textContent = `
    @keyframes gpsPulse {
      0%  { transform:scale(1);  opacity:0.85; }
      70% { transform:scale(3);  opacity:0;    }
      100%{ transform:scale(3);  opacity:0;    }
    }
    @keyframes dirSlide {
      from { opacity:0; transform:translateX(-50%) translateY(-10px); }
      to   { opacity:1; transform:translateX(-50%) translateY(0);     }
    }
    @keyframes arrivalPop {
      0%  { transform:translate(-50%,-50%) scale(0.85); opacity:0; }
      70% { transform:translate(-50%,-50%) scale(1.04); }
      100%{ transform:translate(-50%,-50%) scale(1);    opacity:1; }
    }
    .cnav-btn { transition: filter 0.2s; }
    .cnav-btn:hover { filter: brightness(1.18); }
  `;
  document.head.appendChild(s);
};

export default function CampusGraph() {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const mapLoaded = useRef(false);
  const pendingData = useRef(null);
  const nodeMarkersRef = useRef([]);
  const userMarkerRef = useRef(null);
  const searchPinRef = useRef(null);

  const [mapData, setMapData] = useState({ nodes: [], edges: [] });
  const { coords, error: gpsError, isWatching } = useGPS();

  const [sourceQuery, setSourceQuery] = useState("");
  const [destQuery, setDestQuery] = useState("");
  const [sourceResults, setSourceResults] = useState([]);
  const [destResults, setDestResults] = useState([]);
  const [selectedSource, setSelectedSource] = useState(null);
  const [selectedDest, setSelectedDest] = useState(null);

  const [routeCoords, setRouteCoords] = useState([]);
  const [routeReady, setRouteReady] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [directions, setDirections] = useState([]);
  const [stepIdx, setStepIdx] = useState(0);
  const [routeInfo, setRouteInfo] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const [arrived, setArrived] = useState(false);

  useEffect(() => {
    injectStyles();
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
    map.addControl(new maplibregl.NavigationControl(), "bottom-right");

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
          "circle-radius": {
            base: 2,
            stops: [
              [0, 0],
              [20, 400],
            ],
          },
        },
      });

      // Edges
      map.addSource("edges", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "edges-layer",
        type: "line",
        source: "edges",
        paint: {
          "line-color": "#666",
          "line-width": 1.5,
          "line-opacity": 0.35,
        },
      });

      // Route
      map.addSource("route-src", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "route-src",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#1a56c4",
          "line-width": 13,
          "line-opacity": 0.85,
        },
      });
      map.addLayer({
        id: "route-fill",
        type: "line",
        source: "route-src",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#4285F4", "line-width": 7, "line-opacity": 1 },
      });

      // Arrow symbols
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
    mapInstance.current = map;
  }, []);

  // ── Render graph data ─────────────────────────────────────────────────────
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
    map
      .getSource("edges")
      .setData({ type: "FeatureCollection", features: edgeFeatures });

    nodeMarkersRef.current.forEach((m) => m.remove());
    nodeMarkersRef.current = [];

    data.nodes
      .filter((n) =>
        [
          "BUILDING",
          "CANTEEN",
          "HOSTEL",
          "LIBRARY",
          "LAB",
          "ADMIN",
          "AUDITORIUM",
          "CLASSROOM",
          "LECTURE_HALL",
          "OTHER"
        ].includes(n.nodeType?.toUpperCase()),
      )
      .forEach((node) => {
        const cfg =
          NODE_CFG[normalizeNodeType(node.nodeType)] || NODE_CFG.DEFAULT;
        const el = document.createElement("div");
        Object.assign(el.style, {
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          cursor: "pointer",
          gap: "2px",
        });
        const lbl = document.createElement("div");
        lbl.innerText = node.name;
        Object.assign(lbl.style, {
          fontSize: "10px",
          color: "#fff",
          background: "rgba(0,0,0,0.6)",
          padding: "1px 5px",
          borderRadius: "3px",
          whiteSpace: "nowrap",
          maxWidth: "130px",
          overflow: "hidden",
          textOverflow: "ellipsis",
        });
        const ico = document.createElement("div");
        ico.innerHTML = cfg.icon;
        Object.assign(ico.style, {
          fontSize: "20px",
          color: cfg.color,
          lineHeight: 1,
          filter: `drop-shadow(0 0 4px ${cfg.color})`,
        });
        el.appendChild(lbl);
        el.appendChild(ico);
        el.addEventListener("click", () => {
          setSelectedDest(node);
          setDestQuery(node.name);
          new maplibregl.Popup({ offset: 25 })
            .setLngLat([node.longitude, node.latitude])
            .setHTML(
              `<div style="background:#1e1e1e;color:white;padding:10px;border-radius:10px;border:2px solid ${cfg.color}"><h4 style="margin:0">${node.name}</h4><p style="margin:4px 0 0;font-size:12px;color:#aaa">${node.nodeType}</p></div>`,
            )
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

  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !coords) return;

    if (!userMarkerRef.current) {
      const wrap = document.createElement("div");
      wrap.style.cssText = "position:relative;width:22px;height:22px;";

      const pulse = document.createElement("div");
      pulse.style.cssText =
        "position:absolute;inset:0;background:rgba(66,133,244,0.35);border-radius:50%;animation:gpsPulse 2s ease-out infinite;";

      const dot = document.createElement("div");
      dot.style.cssText =
        "position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:13px;height:13px;background:#4285F4;border:2.5px solid #fff;border-radius:50%;box-shadow:0 0 12px rgba(66,133,244,0.9);";

      wrap.appendChild(pulse);
      wrap.appendChild(dot);
      userMarkerRef.current = new maplibregl.Marker({
        element: wrap,
        anchor: "center",
      })
        .setLngLat([coords.lng, coords.lat])
        .addTo(map);
    } else {
      userMarkerRef.current.setLngLat([coords.lng, coords.lat]);
    }

    // Accuracy halo
    if (map.getSource("accuracy-src")) {
      map.getSource("accuracy-src").setData({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [coords.lng, coords.lat] },
            properties: { acc: coords.accuracy ?? 20 },
          },
        ],
      });
    }
  }, [coords]);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !coords || !navigating || !routeCoords.length) return;

    let minD = Infinity,
      closestIdx = 0;
    routeCoords.forEach(([lng, lat], i) => {
      const d = getDistanceInMeters(coords.lat, coords.lng, lat, lng);
      if (d < minD) {
        minD = d;
        closestIdx = i;
      }
    });

    const remaining = [
      [coords.lng, coords.lat],
      ...routeCoords.slice(closestIdx),
    ];
    let remMeters = 0;
    for (let i = 0; i < remaining.length - 1; i++) {
      remMeters += getDistanceInMeters(
        remaining[i][1],
        remaining[i][0],
        remaining[i + 1][1],
        remaining[i + 1][0],
      );
    }

    map.getSource("route-src")?.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates: remaining },
        },
      ],
    });
    map.getSource("arrows-src")?.setData({
      type: "FeatureCollection",
      features: buildArrowFeatures(remaining),
    });

    setRouteInfo({
      distance: Math.round(remMeters),
      time: Math.max(1, Math.ceil(remMeters / 1.4 / 60)),
    });

    if (remMeters < 12) {
      setArrived(true);
      return;
    }

    // Update active step
    if (directions.length > 0) {
      let best = 0,
        bestD = Infinity;
      directions.forEach((step, i) => {
        const [sLng, sLat] =
          routeCoords[Math.min(step.coordIndex, routeCoords.length - 1)];
        const d = getDistanceInMeters(coords.lat, coords.lng, sLat, sLng);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      setStepIdx(best);
    }

    // Rotate map toward direction of travel
    if (remaining.length >= 2) {
      const bearing = getBearing(
        remaining[0][1],
        remaining[0][0],
        remaining[1][1],
        remaining[1][0],
      );
      map.easeTo({
        center: [coords.lng, coords.lat],
        bearing,
        zoom: 18,
        duration: 900,
      });
    }
  }, [coords, navigating, routeCoords, directions]);

  const flyToNode = (node) => {
    const map = mapInstance.current;
    if (!map) return;
    if (searchPinRef.current) {
      searchPinRef.current.remove();
      searchPinRef.current = null;
    }
    if (node.parentNodeId != null) {
      const cfg =
        NODE_CFG[normalizeNodeType(node.nodeType)] || NODE_CFG.DEFAULT;
      const el = document.createElement("div");
      Object.assign(el.style, {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "2px",
      });
      const lbl = document.createElement("div");
      lbl.innerText = node.name;
      Object.assign(lbl.style, {
        fontSize: "11px",
        color: "#fff",
        background: "rgba(66,133,244,0.9)",
        padding: "2px 6px",
        borderRadius: "4px",
        fontWeight: "600",
      });
      const ico = document.createElement("div");
      ico.innerHTML = cfg.icon || "📍";
      Object.assign(ico.style, {
        fontSize: "22px",
        filter: "drop-shadow(0 0 6px #4285F4)",
      });
      el.appendChild(lbl);
      el.appendChild(ico);
      searchPinRef.current = new maplibregl.Marker({
        element: el,
        anchor: "bottom",
      })
        .setLngLat([node.longitude, node.latitude])
        .addTo(map);
    }
    map.flyTo({
      center: [node.longitude, node.latitude],
      zoom: node.parentNodeId != null ? 19 : 18,
      pitch: 0,
      bearing: 0,
      duration: 1600,
    });
  };

  const handleSearch = async (query, isSource) => {
    if (isSource) setSourceQuery(query);
    else setDestQuery(query);
    if (query.length < 2) {
      isSource ? setSourceResults([]) : setDestResults([]);
      return;
    }
    try {
      const res = await axios.get(
        `${API_USER_BASE}/node/search?query=${query}`,
      );
      const filtered = (res.data.data || []).filter((n) =>
        ["OTHER", "BUILDING", "CLASSROOM", "LECTURE_HALL"].includes(
          n.nodeType?.toUpperCase(),
        ),
      );
      isSource ? setSourceResults(filtered) : setDestResults(filtered);
    } catch (e) {
      console.error(e);
    }
  };

  const handleFindRoute = async () => {
    if (!selectedDest) {
      alert("Please select a destination!");
      return;
    }
    let activeSource = selectedSource;
    if (!activeSource) {
      if (!coords) {
        alert("GPS not available. Please type a start location.");
        return;
      }
      let minD = Infinity,
        nearest = null;
      (mapData?.nodes || []).forEach((n) => {
        const d = getDistanceInMeters(
          coords.lat,
          coords.lng,
          n.latitude,
          n.longitude,
        );
        if (d < minD) {
          minD = d;
          nearest = n;
        }
      });
      if (!nearest) {
        alert("Cannot find a nearby node.");
        return;
      }
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
        const tgt = mapData.nodes.find(
          (n) => n.id === (edge.destinationNodeId ?? edge.targetNodeId),
        );
        if (!src || !tgt) return;
        if (arr.length === 0) arr.push([src.longitude, src.latitude]);
        (edge.waypoints || []).forEach((w) =>
          arr.push([w.longitude, w.latitude]),
        );
        arr.push([tgt.longitude, tgt.latitude]);
      });
      if (arr.length === 0)
        arr.push([activeSource.longitude, activeSource.latitude]);
      if (coords && !selectedSource) arr.unshift([coords.lng, coords.lat]);

      let total = 0;
      for (let i = 0; i < arr.length - 1; i++)
        total += getDistanceInMeters(
          arr[i][1],
          arr[i][0],
          arr[i + 1][1],
          arr[i + 1][0],
        );

      setRouteCoords(arr);
      setDirections(buildDirections(arr));
      setStepIdx(0);
      setRouteInfo({
        distance: Math.round(total),
        time: Math.max(1, Math.ceil(total / 1.4 / 60)),
      });
      setRouteReady(true);
      setNavigating(false);
      setArrived(false);

      const map = mapInstance.current;
      if (map) {
        map.getSource("route-src").setData({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: { type: "LineString", coordinates: arr },
            },
          ],
        });
        map.getSource("arrows-src").setData({
          type: "FeatureCollection",
          features: buildArrowFeatures(arr),
        });
        const lngs = arr.map((c) => c[0]),
          lats = arr.map((c) => c[1]);
        map.fitBounds(
          [
            [Math.min(...lngs), Math.min(...lats)],
            [Math.max(...lngs), Math.max(...lats)],
          ],
          {
            padding: { top: 100, bottom: 140, left: 50, right: 320 },
            pitch: 0,
            bearing: 0,
            duration: 1800,
          },
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
    setShowSteps(true);
    const map = mapInstance.current;
    if (map && coords)
      map.easeTo({
        center: [coords.lng, coords.lat],
        zoom: 18,
        pitch: 0,
        duration: 1200,
      });
  };

  const clearRoute = () => {
    setSelectedSource(null);
    setSelectedDest(null);
    setSourceQuery("");
    setDestQuery("");
    setRouteCoords([]);
    setRouteReady(false);
    setNavigating(false);
    setDirections([]);
    setStepIdx(0);
    setRouteInfo(null);
    setShowSteps(false);
    setArrived(false);
    if (searchPinRef.current) {
      searchPinRef.current.remove();
      searchPinRef.current = null;
    }
    const map = mapInstance.current;
    if (map) {
      map
        .getSource("route-src")
        ?.setData({ type: "FeatureCollection", features: [] });
      map
        .getSource("arrows-src")
        ?.setData({ type: "FeatureCollection", features: [] });
      map.easeTo({ zoom: 17, pitch: 0, bearing: 0, duration: 800 });
    }
  };

  const activeStep = directions[stepIdx];
  const dirInfo = activeStep ? DIR[activeStep.type] || DIR.straight : null;

  const inputStyle = {
    width: "100%",
    padding: "8px 10px",
    marginTop: "5px",
    background: "#252525",
    color: "white",
    border: "1px solid #444",
    borderRadius: "7px",
    boxSizing: "border-box",
    fontSize: "13px",
    outline: "none",
  };
  const dropStyle = {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    background: "#252525",
    listStyle: "none",
    margin: 0,
    padding: 0,
    maxHeight: "150px",
    overflowY: "auto",
    border: "1px solid #555",
    borderRadius: "0 0 8px 8px",
    zIndex: 30,
  };

  return (
    <div style={{ position: "relative" }}>
      {/* Search / Route panel */}
      <div
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          zIndex: 20,
          background: "rgba(14,14,14,0.97)",
          color: "white",
          padding: "18px",
          borderRadius: "16px",
          width: "288px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.65)",
          backdropFilter: "blur(12px)",
          border: "1px solid #2a2a2a",
        }}
      >
        <h3 style={{ margin: "0 0 12px", fontSize: "15px", fontWeight: 700 }}>
          🗺️ Navigate Campus
        </h3>

        {/* GPS pill */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "7px",
            marginBottom: "12px",
            padding: "6px 10px",
            background: coords ? "rgba(52,168,83,0.12)" : "rgba(234,67,53,0.1)",
            borderRadius: "8px",
            border: `1px solid ${coords ? "#34a85340" : "#ea433540"}`,
            fontSize: "11px",
            color: coords ? "#34a853" : "#ea4335",
          }}
        >
          <div
            style={{
              width: "7px",
              height: "7px",
              borderRadius: "50%",
              background: coords ? "#34a853" : "#ea4335",
              boxShadow: coords ? "0 0 6px #34a853" : "none",
              animation: coords ? "gpsPulse 2s ease-out infinite" : "none",
              flexShrink: 0,
            }}
          />
          {coords
            ? `GPS Active · ±${Math.round(coords.accuracy ?? 0)} m`
            : gpsError
              ? "GPS unavailable"
              : "Acquiring GPS…"}
        </div>

        {/* From */}
        <div style={{ position: "relative", marginBottom: "10px" }}>
          <label
            style={{
              fontSize: "10px",
              color: "#666",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            From
          </label>
          <input
            type="text"
            placeholder="Leave empty to use GPS…"
            value={sourceQuery}
            onChange={(e) => {
              handleSearch(e.target.value, true);
              setSelectedSource(null);
            }}
            style={inputStyle}
          />
          {sourceResults.length > 0 && !selectedSource && (
            <ul style={dropStyle}>
              {sourceResults.map((n) => {
                const name = getDisplayName(n);
                const meta = [
                  n.parentNodeName,
                  n.floor > 0 ? `Floor ${n.floor}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <li
                    key={n.id}
                    style={{
                      padding: "8px 10px",
                      cursor: "pointer",
                      borderBottom: "1px solid #333",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "#333")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                    onClick={() => {
                      setSelectedSource(n);
                      setSourceQuery(name);
                      setSourceResults([]);
                      flyToNode(n);
                    }}
                  >
                    <div style={{ fontSize: "13px" }}>{name}</div>
                    {meta && (
                      <div
                        style={{
                          fontSize: "11px",
                          color: "#777",
                          marginTop: "2px",
                        }}
                      >
                        {meta}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* To */}
        <div style={{ position: "relative", marginBottom: "14px" }}>
          <label
            style={{
              fontSize: "10px",
              color: "#666",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            To
          </label>
          <input
            type="text"
            placeholder="Search destination…"
            value={destQuery}
            onChange={(e) => {
              handleSearch(e.target.value, false);
              setSelectedDest(null);
            }}
            style={inputStyle}
          />
          {destResults.length > 0 && !selectedDest && (
            <ul style={dropStyle}>
              {destResults.map((n) => {
                const name = getDisplayName(n);
                const meta = [
                  n.parentNodeName,
                  n.floor > 0 ? `Floor ${n.floor}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <li
                    key={n.id}
                    style={{
                      padding: "8px 10px",
                      cursor: "pointer",
                      borderBottom: "1px solid #333",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "#333")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                    onClick={() => {
                      setSelectedDest(n);
                      setDestQuery(name);
                      setDestResults([]);
                      flyToNode(n);
                    }}
                  >
                    <div style={{ fontSize: "13px" }}>{name}</div>
                    {meta && (
                      <div
                        style={{
                          fontSize: "11px",
                          color: "#777",
                          marginTop: "2px",
                        }}
                      >
                        {meta}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: "8px" }}>
          {!routeReady ? (
            <button
              className="cnav-btn"
              onClick={handleFindRoute}
              disabled={isSearching}
              style={{
                flex: 1,
                padding: "10px",
                background: isSearching ? "#2a4a8a" : "#4285F4",
                color: "#fff",
                border: "none",
                borderRadius: "9px",
                cursor: isSearching ? "not-allowed" : "pointer",
                fontWeight: 700,
                fontSize: "14px",
              }}
            >
              {isSearching ? "Calculating…" : "Find Route"}
            </button>
          ) : !navigating ? (
            <>
              <button
                className="cnav-btn"
                onClick={handleStartNavigation}
                style={{
                  flex: 1,
                  padding: "10px",
                  background: "#34a853",
                  color: "#fff",
                  border: "none",
                  borderRadius: "9px",
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: "14px",
                }}
              >
                ▶ Start Navigation
              </button>
              <button
                className="cnav-btn"
                onClick={clearRoute}
                style={{
                  padding: "10px 13px",
                  background: "#d93025",
                  color: "#fff",
                  border: "none",
                  borderRadius: "9px",
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                ✕
              </button>
            </>
          ) : (
            <button
              className="cnav-btn"
              onClick={clearRoute}
              style={{
                flex: 1,
                padding: "10px",
                background: "#d93025",
                color: "#fff",
                border: "none",
                borderRadius: "9px",
                cursor: "pointer",
                fontWeight: 700,
                fontSize: "14px",
              }}
            >
              ✕ End Navigation
            </button>
          )}
        </div>

        {/* ETA */}
        {routeInfo && (
          <div
            style={{
              marginTop: "12px",
              display: "flex",
              background: "#181818",
              borderRadius: "10px",
              overflow: "hidden",
              border: "1px solid #2a2a2a",
            }}
          >
            <div style={{ flex: 1, textAlign: "center", padding: "10px 0" }}>
              <div
                style={{
                  fontSize: "22px",
                  fontWeight: 700,
                  color: navigating ? "#34a853" : "#4285F4",
                  lineHeight: 1,
                }}
              >
                {routeInfo.time}
              </div>
              <div
                style={{ fontSize: "10px", color: "#555", marginTop: "2px" }}
              >
                min walk
              </div>
            </div>
            <div style={{ width: "1px", background: "#2a2a2a" }} />
            <div style={{ flex: 1, textAlign: "center", padding: "10px 0" }}>
              <div
                style={{
                  fontSize: "18px",
                  fontWeight: 600,
                  color: "#bbb",
                  lineHeight: 1,
                }}
              >
                {routeInfo.distance} m
              </div>
              <div
                style={{ fontSize: "10px", color: "#555", marginTop: "2px" }}
              >
                {navigating ? "remaining" : "total"}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Turn-by-turn banner */}
      {navigating && dirInfo && !arrived && (
        <div
          style={{
            position: "absolute",
            top: 16,
            left: "50%",
            zIndex: 25,
            animation: "dirSlide 0.3s ease",
            background: "rgba(10,10,10,0.97)",
            border: `2.5px solid ${dirInfo.color}`,
            borderRadius: "18px",
            padding: "13px 20px",
            display: "flex",
            alignItems: "center",
            gap: "13px",
            boxShadow: `0 6px 28px rgba(0,0,0,0.7)`,
            backdropFilter: "blur(14px)",
            minWidth: "230px",
          }}
        >
          <div
            style={{
              width: "50px",
              height: "50px",
              borderRadius: "13px",
              background: `${dirInfo.color}18`,
              border: `2px solid ${dirInfo.color}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "26px",
              flexShrink: 0,
            }}
          >
            {dirInfo.icon}
          </div>
          <div>
            <div
              style={{
                fontSize: "16px",
                fontWeight: 700,
                color: dirInfo.color,
              }}
            >
              {dirInfo.label}
            </div>
            {activeStep?.distance > 0 && (
              <div
                style={{ fontSize: "12px", color: "#888", marginTop: "3px" }}
              >
                in {activeStep.distance} m
              </div>
            )}
          </div>
          <div
            style={{
              marginLeft: "auto",
              fontSize: "10px",
              color: "#444",
              flexShrink: 0,
            }}
          >
            {stepIdx + 1}/{directions.length}
          </div>
        </div>
      )}

      {/* Arrived */}
      {arrived && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            zIndex: 30,
            animation: "arrivalPop 0.4s ease",
            background: "rgba(10,10,10,0.97)",
            border: "2px solid #34a853",
            borderRadius: "20px",
            padding: "28px 40px",
            textAlign: "center",
            boxShadow: "0 12px 48px rgba(0,0,0,0.8)",
            transform: "translate(-50%,-50%)",
          }}
        >
          <div style={{ fontSize: "48px" }}>🏁</div>
          <div
            style={{
              fontSize: "21px",
              fontWeight: 700,
              color: "#34a853",
              marginTop: "8px",
            }}
          >
            You have arrived!
          </div>
          <div style={{ fontSize: "13px", color: "#777", marginTop: "4px" }}>
            {selectedDest?.name}
          </div>
          <button
            className="cnav-btn"
            onClick={clearRoute}
            style={{
              marginTop: "16px",
              padding: "10px 28px",
              background: "#34a853",
              color: "#fff",
              border: "none",
              borderRadius: "10px",
              cursor: "pointer",
              fontWeight: 700,
              fontSize: "14px",
            }}
          >
            Done
          </button>
        </div>
      )}

      {/* Steps list toggle */}
      {navigating && directions.length > 0 && !arrived && (
        <>
          <button
            className="cnav-btn"
            onClick={() => setShowSteps((v) => !v)}
            style={{
              position: "absolute",
              bottom: 110,
              left: 16,
              zIndex: 20,
              background: "rgba(14,14,14,0.95)",
              color: "#4285F4",
              border: "1px solid #4285F430",
              borderRadius: "10px",
              padding: "7px 13px",
              cursor: "pointer",
              fontSize: "12px",
              fontWeight: 600,
              backdropFilter: "blur(8px)",
            }}
          >
            {showSteps ? "▲ Hide steps" : "▼ Show steps"}
          </button>
          {showSteps && (
            <div
              style={{
                position: "absolute",
                bottom: 150,
                left: 16,
                zIndex: 20,
                background: "rgba(12,12,12,0.97)",
                color: "white",
                borderRadius: "14px",
                padding: "12px",
                width: "226px",
                maxHeight: "280px",
                overflowY: "auto",
                boxShadow: "0 8px 28px rgba(0,0,0,0.65)",
                border: "1px solid #222",
                backdropFilter: "blur(10px)",
              }}
            >
              <div
                style={{
                  fontSize: "10px",
                  color: "#444",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  marginBottom: "8px",
                }}
              >
                All Steps
              </div>
              {directions.map((step, i) => {
                const di = DIR[step.type] || DIR.straight;
                const isActive = i === stepIdx;
                return (
                  <div
                    key={i}
                    onClick={() => setStepIdx(i)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "9px",
                      padding: "7px 8px",
                      borderRadius: "9px",
                      cursor: "pointer",
                      background: isActive ? `${di.color}18` : "transparent",
                      border: `1px solid ${isActive ? di.color + "44" : "transparent"}`,
                      marginBottom: "3px",
                      transition: "all 0.15s",
                    }}
                  >
                    <div
                      style={{
                        width: "28px",
                        height: "28px",
                        borderRadius: "7px",
                        background: `${di.color}18`,
                        border: `1px solid ${di.color}55`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "15px",
                        flexShrink: 0,
                      }}
                    >
                      {di.icon}
                    </div>
                    <div>
                      <div
                        style={{
                          fontSize: "12px",
                          color: isActive ? di.color : "#ccc",
                          fontWeight: isActive ? 700 : 400,
                        }}
                      >
                        {di.label}
                      </div>
                      {step.distance > 0 && (
                        <div style={{ fontSize: "10px", color: "#555" }}>
                          {step.distance} m
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Map */}
      <div ref={mapRef} style={{ width: "100%", height: "100vh" }} />
    </div>
  );
}
