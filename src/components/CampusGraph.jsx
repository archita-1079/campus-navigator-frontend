import React, { useEffect, useRef, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import axios from "axios";
import { NODE_CFG, EDGE_CFG } from "../utils/constants";
import { useGPS } from "../hooks/useGPS";
import { getDisplayName, getDistanceInMeters } from "../utils/graph";

const API_USER_BASE = `${import.meta.env.VITE_API_URL}/api/v1/user`;

// ─── Helpers ────────────────────────────────────────────────────────────────

const normalizeNodeType = (type) => {
  if (["LIBRARY", "LAB", "ADMIN", "AUDITORIUM"].includes(type))
    return "BUILDING";
  if (["CANTEEN", "SHOP"].includes(type)) return "FACILITY";
  if (["HOSTEL"].includes(type)) return "LANDMARK";
  if (["GATE", "ENTRANCE"].includes(type)) return "ENTRANCE";
  return "DEFAULT";
};

const normalizeEdgeType = (type) => {
  if (type === "WALKWAY") return "PATHWAY";
  if (type === "RAMP") return "ACCESSIBLE";
  return type;
};

// ─── Component ───────────────────────────────────────────────────────────────

function CampusGraph() {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const mapLoaded = useRef(false); // ✅ Track map readiness
  const userMarkerRef = useRef(null);
  const nodeMarkersRef = useRef([]); // ✅ Track markers for cleanup

  const [mapData, setMapData] = useState({ nodes: [], edges: [] });
  const [is3D, setIs3D] = useState(true);
  const { coords, acquire } = useGPS();

  const [sourceQuery, setSourceQuery] = useState("");
  const [destQuery, setDestQuery] = useState("");
  const [sourceResults, setSourceResults] = useState([]);
  const [destResults, setDestResults] = useState([]);
  const [selectedSource, setSelectedSource] = useState(null);
  const [selectedDest, setSelectedDest] = useState(null);

  const [fullRouteCoords, setFullRouteCoords] = useState([]);
  const [routeMode, setRouteMode] = useState(null); // 'navigate' | 'preview'
  const [isSearching, setIsSearching] = useState(false);
  const [routeInfo, setRouteInfo] = useState(null);

  // Temporary pin shown when user selects a child node (CR, LT, etc.) from search
  const searchPinRef = useRef(null);

  // ─── Render nodes + edges onto the map (called after BOTH map & data ready) ──

  const renderMapData = useCallback((map, data) => {
    if (!map || !data?.nodes?.length) return;

    // ── Edges ──────────────────────────────────────────────────────────────
    const edgeFeatures = (data.edges || [])
      .map((edge) => {
        const source = data.nodes.find((n) => n.id === edge.sourceNodeId);
        const target = data.nodes.find((n) => n.id === edge.targetNodeId);
        if (!source || !target) return null;
        return {
          type: "Feature",
          properties: { edgeType: normalizeEdgeType(edge.edgeType) },
          geometry: {
            type: "LineString",
            coordinates: [
              [source.longitude, source.latitude],
              ...(edge.waypoints || []).map((w) => [w.longitude, w.latitude]),
              [target.longitude, target.latitude],
            ],
          },
        };
      })
      .filter(Boolean);

    // ✅ Source guaranteed to exist here (called after map load)
    map.getSource("edges").setData({
      type: "FeatureCollection",
      features: edgeFeatures,
    });

    // ── Node Markers ────────────────────────────────────────────────────────

    // ✅ Remove previous markers properly via stored refs
    nodeMarkersRef.current.forEach((m) => m.remove());
    nodeMarkersRef.current = [];

    // Only show top-level nodes (no parent) and exclude JUNCTION nodes from map
    const rootNodes = data.nodes.filter(
      (n) =>
        (n.parentNodeId === null || n.parentNodeId === undefined) &&
        n.nodeType !== "JUNCTION",
    );

    rootNodes.forEach((node) => {
      const type = normalizeNodeType(node.nodeType);
      const cfg = NODE_CFG[type] || NODE_CFG.DEFAULT;

      const el = document.createElement("div");
      el.className = "campus-node-marker";
      Object.assign(el.style, {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        cursor: "pointer",
        gap: "2px",
      });

      const label = document.createElement("div");
      label.innerText = node.name;
      Object.assign(label.style, {
        fontSize: "10px",
        color: "#fff",
        background: "rgba(0,0,0,0.55)",
        padding: "1px 4px",
        borderRadius: "3px",
        whiteSpace: "nowrap",
        maxWidth: "120px",
        overflow: "hidden",
        textOverflow: "ellipsis",
      });

      const icon = document.createElement("div");
      icon.innerHTML = cfg.icon;
      Object.assign(icon.style, {
        fontSize: "20px",
        color: cfg.color,
        lineHeight: "1",
        filter: `drop-shadow(0 0 4px ${cfg.color})`,
      });

      el.appendChild(label);
      el.appendChild(icon);

      el.addEventListener("click", () => {
        setSelectedDest(node);
        setDestQuery(node.name);

        new maplibregl.Popup({ offset: 25 })
          .setLngLat([node.longitude, node.latitude])
          .setHTML(
            `<div style="background:#1e1e1e;color:white;padding:10px;border-radius:10px;border:2px solid ${cfg.color};">
              <h4 style="margin:0">${node.name}</h4>
              ${node.nodeType ? `<p style="margin:4px 0 0;font-size:12px;color:#aaa">${node.nodeType}</p>` : ""}
            </div>`,
          )
          .addTo(map);
      });

      const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([node.longitude, node.latitude])
        .addTo(map);

      nodeMarkersRef.current.push(marker); // ✅ Track for future cleanup
    });
  }, []);

  // ─── Init Map ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (mapInstance.current) return;

    const map = new maplibregl.Map({
      container: mapRef.current,
      style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
      center: [78.0035, 30.269],
      zoom: 17,
      pitch: 60,
      bearing: -20,
    });

    map.addControl(new maplibregl.NavigationControl());

    map.on("load", () => {
      // ── Static graph edges source ──────────────────────────────────────
      map.addSource("edges", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: "edges-layer",
        type: "line",
        source: "edges",
        paint: {
          "line-color": "#555",
          "line-width": 2,
          "line-opacity": 0.4,
        },
      });

      // ── Route source ──────────────────────────────────────────────────
      map.addSource("route-source", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: "route-line-casing",
        type: "line",
        source: "route-source",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#114488",
          "line-width": 10,
          "line-opacity": 0.8,
        },
      });

      map.addLayer({
        id: "route-line-inner",
        type: "line",
        source: "route-source",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#4285F4", "line-width": 6, "line-opacity": 1 },
      });

      mapLoaded.current = true; // ✅ Signal map is ready

      // ✅ If data already arrived before map loaded, render it now
      // We read mapData via a ref trick — see below
      if (pendingMapData.current) {
        renderMapData(map, pendingMapData.current);
      }
    });

    mapInstance.current = map;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ✅ Ref to hold data that arrives before the map finishes loading
  const pendingMapData = useRef(null);

  // ─── Render when mapData changes ─────────────────────────────────────────

  useEffect(() => {
    if (!mapData?.nodes?.length) return;

    if (mapLoaded.current && mapInstance.current) {
      // Map already ready → render immediately
      renderMapData(mapInstance.current, mapData);
    } else {
      // Map not ready yet → store for deferred render inside map.on("load")
      pendingMapData.current = mapData;
    }
  }, [mapData, renderMapData]);

  // ─── Fetch data + acquire GPS on mount ───────────────────────────────────

  useEffect(() => {
    acquire(
      () => {},
      (err) => console.error("GPS error:", err),
    );

    const fetchGraph = async () => {
      try {
        const res = await axios.get(
          `${import.meta.env.VITE_API_URL}/api/v1/user/graph`,
        );
        setMapData(res.data?.data ?? { nodes: [], edges: [] });
      } catch (err) {
        console.error("Failed to fetch graph:", err);
      }
    };

    fetchGraph();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── GPS / Route tracking ─────────────────────────────────────────────────

  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !coords) return;

    // Update / create user marker
    if (!userMarkerRef.current) {
      const el = document.createElement("div");
      el.innerHTML = `<div style="background:white;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:4px solid #4285F4;box-shadow:0 0 15px rgba(66,133,244,0.8);font-size:18px;line-height:1;">🚶</div>`;
      userMarkerRef.current = new maplibregl.Marker({
        element: el,
        anchor: "center",
      })
        .setLngLat([coords.lng, coords.lat])
        .addTo(map);
    } else {
      userMarkerRef.current.setLngLat([coords.lng, coords.lat]);
    }

    if (!fullRouteCoords.length || !routeMode) return;

    // ✅ Guard: route source must exist before updating
    if (!map.getSource("route-source")) return;

    if (routeMode === "navigate") {
      // Slice path from nearest point
      let minDistance = Infinity;
      let closestIdx = 0;
      fullRouteCoords.forEach((coord, i) => {
        const d = getDistanceInMeters(
          coords.lat,
          coords.lng,
          coord[1],
          coord[0],
        );
        if (d < minDistance) {
          minDistance = d;
          closestIdx = i;
        }
      });

      const remaining = [
        [coords.lng, coords.lat],
        ...fullRouteCoords.slice(closestIdx),
      ];

      let remainingMeters = 0;
      for (let i = 0; i < remaining.length - 1; i++) {
        remainingMeters += getDistanceInMeters(
          remaining[i][1],
          remaining[i][0],
          remaining[i + 1][1],
          remaining[i + 1][0],
        );
      }

      map.getSource("route-source").setData({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "LineString", coordinates: remaining },
          },
        ],
      });

      const walkMins = Math.ceil(remainingMeters / 1.4 / 60);
      setRouteInfo({
        distance: Math.round(remainingMeters),
        time: walkMins < 1 ? "< 1" : walkMins,
      });

      map.easeTo({ center: [coords.lng, coords.lat], duration: 1000 });
    } else if (routeMode === "preview") {
      map.getSource("route-source").setData({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "LineString", coordinates: fullRouteCoords },
          },
        ],
      });

      let totalMeters = 0;
      for (let i = 0; i < fullRouteCoords.length - 1; i++) {
        totalMeters += getDistanceInMeters(
          fullRouteCoords[i][1],
          fullRouteCoords[i][0],
          fullRouteCoords[i + 1][1],
          fullRouteCoords[i + 1][0],
        );
      }

      const walkMins = Math.ceil(totalMeters / 1.4 / 60);
      setRouteInfo({
        distance: Math.round(totalMeters),
        time: walkMins < 1 ? "< 1" : walkMins,
      });
    }
  }, [coords, fullRouteCoords, routeMode]);

  // ─── Fly to node + temporary pin for child nodes ────────────────────────────

  const flyToNode = (node) => {
    const map = mapInstance.current;
    if (!map) return;

    // Remove any existing search pin
    if (searchPinRef.current) {
      searchPinRef.current.remove();
      searchPinRef.current = null;
    }

    // If it's a child node (CR, LT, etc.) — drop a visible temporary pin
    const isChildNode =
      node.parentNodeId !== null && node.parentNodeId !== undefined;
    if (isChildNode) {
      const cfg =
        NODE_CFG[normalizeNodeType(node.nodeType)] || NODE_CFG.DEFAULT;

      const el = document.createElement("div");
      Object.assign(el.style, {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "2px",
        animation: "pinDrop 0.3s ease",
      });

      const label = document.createElement("div");
      label.innerText = node.name;
      Object.assign(label.style, {
        fontSize: "11px",
        color: "#fff",
        background: "rgba(66,133,244,0.85)",
        padding: "2px 6px",
        borderRadius: "4px",
        whiteSpace: "nowrap",
        maxWidth: "160px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        fontWeight: "600",
        boxShadow: "0 2px 6px rgba(0,0,0,0.5)",
      });

      const dot = document.createElement("div");
      dot.innerHTML = cfg.icon || "📍";
      Object.assign(dot.style, {
        fontSize: "22px",
        filter: "drop-shadow(0 0 6px #4285F4)",
      });

      el.appendChild(label);
      el.appendChild(dot);

      searchPinRef.current = new maplibregl.Marker({
        element: el,
        anchor: "bottom",
      })
        .setLngLat([node.longitude, node.latitude])
        .addTo(map);
    }

    // Always fly to the node
    map.flyTo({
      center: [node.longitude, node.latitude],
      zoom: isChildNode ? 19 : 18,
      pitch: 55,
      bearing: -15,
      duration: 1800,
    });
  };

  // ─── Search ───────────────────────────────────────────────────────────────

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
      isSource
        ? setSourceResults(res.data.data || [])
        : setDestResults(res.data.data || []);
    } catch (err) {
      console.error("Search failed:", err);
    }
  };

  // ─── Route Calculation ────────────────────────────────────────────────────

  const handleCalculateRoute = async () => {
    if (!selectedDest) {
      alert("Please select a destination!");
      return;
    }

    let activeSource = selectedSource;
    let mode = "preview";

    if (!activeSource) {
      if (!coords) {
        alert("GPS location not available. Please type a start location.");
        return;
      }

      let minDist = Infinity;
      let nearestNode = null;
      (mapData?.nodes || []).forEach((node) => {
        const d = getDistanceInMeters(
          coords.lat,
          coords.lng,
          node.latitude,
          node.longitude,
        );
        if (d < minDist) {
          minDist = d;
          nearestNode = node;
        }
      });

      if (!nearestNode) {
        alert("Could not locate a nearby starting node.");
        return;
      }

      activeSource = nearestNode;
      mode = "navigate";
      setSourceQuery(`Current Location (${nearestNode.name})`);
    }

    setIsSearching(true);
    try {
      const res = await axios.get(
        `${API_USER_BASE}/graph/shortest-path/${activeSource.id}/${selectedDest.id}`,
      );
      const edges = res.data.data || [];
      const coordsArray = [];

      edges.forEach((edge) => {
        const src = mapData?.nodes?.find((n) => n.id === edge.sourceNodeId);
        const tgt = mapData?.nodes?.find((n) => n.id === edge.targetNodeId);
        if (!src || !tgt) return;

        if (coordsArray.length === 0)
          coordsArray.push([src.longitude, src.latitude]);
        (edge.waypoints || []).forEach((w) =>
          coordsArray.push([w.longitude, w.latitude]),
        );
        coordsArray.push([tgt.longitude, tgt.latitude]);
      });

      if (coordsArray.length === 0) {
        coordsArray.push([activeSource.longitude, activeSource.latitude]);
      }

      if (mode === "navigate" && coords) {
        coordsArray.unshift([coords.lng, coords.lat]);
      }

      setFullRouteCoords(coordsArray);
      setRouteMode(mode);

      if (mapInstance.current && coordsArray.length > 0) {
        mapInstance.current.flyTo(
          mode === "navigate"
            ? {
                center: coordsArray[0],
                zoom: 19,
                pitch: 70,
                bearing: -30,
                duration: 2500,
              }
            : { center: coordsArray[0], zoom: 18, pitch: 45, duration: 2000 },
        );
      }
    } catch {
      alert("Could not find a route.");
    } finally {
      setIsSearching(false);
    }
  };

  // ─── Clear Route ──────────────────────────────────────────────────────────

  const clearRoute = () => {
    setSelectedSource(null);
    setSelectedDest(null);
    setSourceQuery("");
    setDestQuery("");
    setFullRouteCoords([]);
    setRouteMode(null);
    setRouteInfo(null);

    // Remove any temporary search pin
    if (searchPinRef.current) {
      searchPinRef.current.remove();
      searchPinRef.current = null;
    }

    const src = mapInstance.current?.getSource("route-source");
    if (src) src.setData({ type: "FeatureCollection", features: [] });

    if (coords && mapInstance.current) {
      mapInstance.current.easeTo({
        center: [coords.lng, coords.lat],
        zoom: 17,
        pitch: 60,
        bearing: -20,
      });
    }
  };

  // ─── 3D Toggle ────────────────────────────────────────────────────────────

  const toggle3D = () => {
    mapInstance.current?.easeTo({
      pitch: is3D ? 0 : 60,
      bearing: is3D ? 0 : -20,
      duration: 800,
    });
    setIs3D((v) => !v);
  };

  // ─── Shared input style ───────────────────────────────────────────────────

  const inputStyle = {
    width: "100%",
    padding: "8px 10px",
    marginTop: "5px",
    background: "#2a2a2a",
    color: "white",
    border: "1px solid #444",
    borderRadius: "6px",
    boxSizing: "border-box",
    fontSize: "13px",
    outline: "none",
  };

  const dropdownStyle = {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    background: "#2a2a2a",
    listStyle: "none",
    margin: 0,
    padding: 0,
    maxHeight: "150px",
    overflowY: "auto",
    border: "1px solid #555",
    borderRadius: "0 0 6px 6px",
    zIndex: 20,
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ position: "relative" }}>
      {/* 3D/2D Toggle */}
      <button
        onClick={toggle3D}
        style={{
          position: "absolute",
          top: 10,
          left: 10,
          zIndex: 10,
          borderRadius: "8px",
          padding: "8px 14px",
          background: "#4285F4",
          color: "#fff",
          cursor: "pointer",
          border: "none",
          boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
          fontWeight: "bold",
          fontSize: "13px",
        }}
      >
        {is3D ? "2D" : "3D"} View
      </button>

      {/* Navigation Panel */}
      <div
        style={{
          position: "absolute",
          top: 20,
          right: 20,
          zIndex: 10,
          background: "rgba(18, 18, 18, 0.96)",
          color: "white",
          padding: "20px",
          borderRadius: "14px",
          width: "300px",
          boxShadow: "0 8px 30px rgba(0,0,0,0.6)",
          backdropFilter: "blur(8px)",
          border: "1px solid #333",
        }}
      >
        <h3
          style={{
            margin: "0 0 16px 0",
            borderBottom: "1px solid #333",
            paddingBottom: "12px",
            fontSize: "16px",
            letterSpacing: "0.3px",
          }}
        >
          🗺️ Navigate Campus
        </h3>

        {/* Start Location */}
        <div style={{ position: "relative", marginBottom: "14px" }}>
          <label
            style={{
              fontSize: "11px",
              color: "#888",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Start Location
          </label>
          <input
            type="text"
            placeholder="Leave empty to use GPS..."
            value={sourceQuery}
            onChange={(e) => {
              handleSearch(e.target.value, true);
              setSelectedSource(null);
            }}
            style={inputStyle}
          />
          {sourceResults.length > 0 && !selectedSource && (
            <ul style={dropdownStyle}>
              {sourceResults.map((n) => {
                const displayName = getDisplayName(n);
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
                      borderBottom: "1px solid #3a3a3a",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "#3a3a3a")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                    onClick={() => {
                      setSelectedSource(n);
                      setSourceQuery(displayName);
                      setSourceResults([]);
                      flyToNode(n);
                    }}
                  >
                    <div style={{ fontSize: "13px", color: "#fff" }}>
                      {displayName}
                    </div>
                    {meta && (
                      <div
                        style={{
                          fontSize: "11px",
                          color: "#888",
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

        {/* Destination */}
        <div style={{ position: "relative", marginBottom: "16px" }}>
          <label
            style={{
              fontSize: "11px",
              color: "#888",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Destination
          </label>
          <input
            type="text"
            placeholder="Search destination..."
            value={destQuery}
            onChange={(e) => {
              handleSearch(e.target.value, false);
              setSelectedDest(null);
            }}
            style={inputStyle}
          />
          {destResults.length > 0 && !selectedDest && (
            <ul style={dropdownStyle}>
              {destResults.map((n) => {
                const displayName = getDisplayName(n);
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
                      borderBottom: "1px solid #3a3a3a",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "#3a3a3a")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                    onClick={() => {
                      setSelectedDest(n);
                      setDestQuery(displayName);
                      setDestResults([]);
                      flyToNode(n);
                    }}
                  >
                    <div style={{ fontSize: "13px", color: "#fff" }}>
                      {displayName}
                    </div>
                    {meta && (
                      <div
                        style={{
                          fontSize: "11px",
                          color: "#888",
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

        {/* Buttons */}
        <div style={{ display: "flex", gap: "10px" }}>
          <button
            onClick={handleCalculateRoute}
            disabled={isSearching}
            style={{
              flex: 1,
              padding: "10px",
              background: isSearching ? "#2a4a8a" : "#4285F4",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: isSearching ? "not-allowed" : "pointer",
              fontWeight: "bold",
              fontSize: "14px",
              transition: "background 0.2s",
            }}
          >
            {isSearching ? "Calculating…" : "Find Route"}
          </button>
          {fullRouteCoords.length > 0 && (
            <button
              onClick={clearRoute}
              style={{
                padding: "10px 14px",
                background: "#d93025",
                color: "white",
                border: "none",
                borderRadius: "8px",
                cursor: "pointer",
                fontWeight: "bold",
              }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Mode badge */}
        {routeMode && (
          <div style={{ marginTop: "12px", textAlign: "center" }}>
            <span
              style={{
                fontSize: "11px",
                padding: "3px 10px",
                borderRadius: "20px",
                background:
                  routeMode === "navigate"
                    ? "rgba(52,168,83,0.2)"
                    : "rgba(66,133,244,0.2)",
                color: routeMode === "navigate" ? "#34a853" : "#4285F4",
                border: `1px solid ${routeMode === "navigate" ? "#34a853" : "#4285F4"}`,
              }}
            >
              {routeMode === "navigate"
                ? "🔴 Live Navigation"
                : "👁️ Preview Mode"}
            </span>
          </div>
        )}
      </div>

      {/* ETA Bottom Widget */}
      {routeInfo && routeMode && (
        <div
          style={{
            position: "absolute",
            bottom: 30,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10,
            background: "rgba(18, 18, 18, 0.96)",
            color: "white",
            padding: "14px 28px",
            borderRadius: "30px",
            boxShadow: "0 10px 30px rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            gap: "18px",
            border: "1px solid #333",
            backdropFilter: "blur(8px)",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontSize: "26px",
                fontWeight: "bold",
                color: routeMode === "navigate" ? "#34a853" : "#4285F4",
                lineHeight: 1,
              }}
            >
              {routeInfo.time}
            </div>
            <div style={{ fontSize: "10px", color: "#888", marginTop: "2px" }}>
              min walk
            </div>
          </div>
          <div style={{ height: "32px", width: "1px", background: "#444" }} />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "18px", fontWeight: "600", color: "#ccc" }}>
              {routeInfo.distance} m
            </div>
            <div style={{ fontSize: "10px", color: "#888", marginTop: "2px" }}>
              {routeMode === "navigate" ? "remaining" : "total"}
            </div>
          </div>
        </div>
      )}

      {/* Map Container */}
      <div ref={mapRef} style={{ width: "100%", height: "100vh" }} />
    </div>
  );
}

export default CampusGraph;
