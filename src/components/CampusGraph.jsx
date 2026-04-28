import React, { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import axios from "axios";

import sampleData from "../utils/sampleData";
import { NODE_CFG, EDGE_CFG } from "../utils/constants";
import { useGPS } from "../hooks/useGPS";

const API_USER_BASE = "http://localhost:8080/api/v1/user";

// Helper function to calculate accurate physical distance in meters
function getDistanceInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; 
}

function CampusGraph() {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const userMarkerRef = useRef(null);

  const [is3D, setIs3D] = useState(true);
  const { coords, acquire } = useGPS();

  const [sourceQuery, setSourceQuery] = useState("");
  const [destQuery, setDestQuery] = useState("");
  const [sourceResults, setSourceResults] = useState([]);
  const [destResults, setDestResults] = useState([]);
  const [selectedSource, setSelectedSource] = useState(null);
  const [selectedDest, setSelectedDest] = useState(null);
  
  const [fullRouteCoords, setFullRouteCoords] = useState([]);
  const [routeMode, setRouteMode] = useState(null); // 'navigate' or 'preview'
  const [isSearching, setIsSearching] = useState(false);
  const [routeInfo, setRouteInfo] = useState(null);

  // Initialize Map & Layers
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

    const normalizeNodeType = (type) => {
      if (["LIBRARY", "LAB", "ADMIN", "AUDITORIUM"].includes(type)) return "BUILDING";
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

    map.on("load", () => {
      const edgeFeatures = sampleData.edges.map((edge) => {
        const source = sampleData.nodes.find((n) => n.id === edge.sourceNodeId);
        const target = sampleData.nodes.find((n) => n.id === edge.targetNodeId);
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
      });

      map.addSource("edges", {
        type: "geojson",
        data: { type: "FeatureCollection", features: edgeFeatures },
      });

      map.addLayer({
        id: "edges-layer",
        type: "line",
        source: "edges",
        paint: { "line-color": "#555", "line-width": 2, "line-opacity": 0.4 },
      });

      map.addSource("route-source", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: "route-line-casing",
        type: "line",
        source: "route-source",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#114488", "line-width": 10, "line-opacity": 0.8 },
      });

      map.addLayer({
        id: "route-line-inner",
        type: "line",
        source: "route-source",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#4285F4", "line-width": 6, "line-opacity": 1.0 },
      });

      sampleData.nodes.forEach((node) => {
        const type = normalizeNodeType(node.nodeType);
        const cfg = NODE_CFG[type] || NODE_CFG.DEFAULT;

        const el = document.createElement("div");
        el.style.display = "flex"; el.style.flexDirection = "column"; el.style.alignItems = "center"; el.style.cursor = "pointer";
        const label = document.createElement("div"); label.innerText = node.name; label.style.fontSize = "11px"; label.style.color = "#fff";
        const icon = document.createElement("div"); icon.innerHTML = cfg.icon; icon.style.fontSize = "18px"; icon.style.color = cfg.color;
        
        el.appendChild(label); el.appendChild(icon);

        el.addEventListener("click", () => {
            setSelectedDest(node); setDestQuery(node.name);
            new maplibregl.Popup({ offset: 25 })
              .setLngLat([node.longitude, node.latitude])
              .setHTML(`<div style="background:#1e1e1e;color:white;padding:10px;border-radius:10px;border:2px solid ${cfg.color};"><h4 style="margin:0">${node.name}</h4></div>`)
              .addTo(map);
        });

        new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([node.longitude, node.latitude]).addTo(map);
      });
    });

    mapInstance.current = map;
  }, []);

  useEffect(() => {
    acquire(() => {}, (err) => console.error("GPS error:", err));
  }, []);

  // --- Map Update Logic (Handles Real-time Tracking vs Static Preview) ---
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !coords) return;

    // 1. Always update the user's GPS marker
    if (!userMarkerRef.current) {
      const el = document.createElement("div");
      el.innerHTML = `<div style="background: white; width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 4px solid #4285F4; box-shadow: 0 0 15px rgba(66, 133, 244, 0.8); font-size: 18px; line-height: 1;">🚶</div>`;
      userMarkerRef.current = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([coords.lng, coords.lat]).addTo(map);
    } else {
      userMarkerRef.current.setLngLat([coords.lng, coords.lat]);
    }

    if (fullRouteCoords.length === 0 || !routeMode) return;

    // 2. Navigation Mode: Dynamically slice path from user's current location
    if (routeMode === 'navigate') {
      let minDistance = Infinity;
      let closestIdx = 0;

      for (let i = 0; i < fullRouteCoords.length; i++) {
        const d = getDistanceInMeters(coords.lat, coords.lng, fullRouteCoords[i][1], fullRouteCoords[i][0]);
        if (d < minDistance) {
          minDistance = d;
          closestIdx = i;
        }
      }

      const remainingCoords = [[coords.lng, coords.lat], ...fullRouteCoords.slice(closestIdx)];

      let remainingDistanceMeters = 0;
      for (let i = 0; i < remainingCoords.length - 1; i++) {
        remainingDistanceMeters += getDistanceInMeters(
            remainingCoords[i][1], remainingCoords[i][0],
            remainingCoords[i+1][1], remainingCoords[i+1][0]
        );
      }

      if (map.getSource("route-source")) {
        map.getSource("route-source").setData({
          type: "FeatureCollection",
          features: [{ type: "Feature", geometry: { type: "LineString", coordinates: remainingCoords } }]
        });
      }

      const walkTimeMins = Math.ceil(remainingDistanceMeters / 1.4 / 60);
      setRouteInfo({ distance: Math.round(remainingDistanceMeters), time: walkTimeMins < 1 ? "< 1" : walkTimeMins });

      // Follow user smoothly
      map.easeTo({ center: [coords.lng, coords.lat], duration: 1000 });

    } 
    // 3. Preview Mode: Just show the static path from Point A to Point B
    else if (routeMode === 'preview') {
      if (map.getSource("route-source")) {
        map.getSource("route-source").setData({
          type: "FeatureCollection",
          features: [{ type: "Feature", geometry: { type: "LineString", coordinates: fullRouteCoords } }]
        });
      }

      let totalDistanceMeters = 0;
      for (let i = 0; i < fullRouteCoords.length - 1; i++) {
        totalDistanceMeters += getDistanceInMeters(
            fullRouteCoords[i][1], fullRouteCoords[i][0],
            fullRouteCoords[i+1][1], fullRouteCoords[i+1][0]
        );
      }

      const walkTimeMins = Math.ceil(totalDistanceMeters / 1.4 / 60);
      setRouteInfo({ distance: Math.round(totalDistanceMeters), time: walkTimeMins < 1 ? "< 1" : walkTimeMins });
    }

  }, [coords, fullRouteCoords, routeMode]);

  const handleSearch = async (query, isSource) => {
    if (isSource) setSourceQuery(query); else setDestQuery(query);
    if (query.length < 2) { isSource ? setSourceResults([]) : setDestResults([]); return; }

    try {
      const res = await axios.get(`${API_USER_BASE}/node/search?query=${query}`);
      isSource ? setSourceResults(res.data.data || []) : setDestResults(res.data.data || []);
    } catch (err) { console.error("Search failed:", err); }
  };

  const handleCalculateRoute = async () => {
    if (!selectedDest) { alert("Please select a destination!"); return; }

    let activeSource = selectedSource;
    let mode = 'preview';

    // If NO start location selected -> Switch to Live Navigation Mode
    if (!activeSource) {
      if (!coords) { alert("GPS location not available. Please type a start location."); return; }
      
      let minDist = Infinity;
      let nearestNode = null;
      sampleData.nodes.forEach(node => {
        const d = getDistanceInMeters(coords.lat, coords.lng, node.latitude, node.longitude);
        if (d < minDist) { minDist = d; nearestNode = node; }
      });

      if (!nearestNode) { alert("Could not locate a nearby starting node."); return; }

      activeSource = nearestNode;
      mode = 'navigate';
      setSourceQuery(`Current Location (${nearestNode.name})`);
    }

    setIsSearching(true);
    try {
      const res = await axios.get(`${API_USER_BASE}/graph/shortest-path/${activeSource.id}/${selectedDest.id}`);
      const edges = res.data.data || [];
      const coordsArray = [];
      
      edges.forEach((edge) => {
          const source = sampleData.nodes.find((n) => n.id === edge.sourceNodeId);
          const target = sampleData.nodes.find((n) => n.id === edge.targetNodeId);
          
          if (coordsArray.length === 0) coordsArray.push([source.longitude, source.latitude]);
          (edge.waypoints || []).forEach(w => coordsArray.push([w.longitude, w.latitude]));
          coordsArray.push([target.longitude, target.latitude]);
      });

      if (coordsArray.length === 0) coordsArray.push([activeSource.longitude, activeSource.latitude]);

      // If Navigating, make sure the line starts exactly where the user is standing
      if (mode === 'navigate' && coords) {
          coordsArray.unshift([coords.lng, coords.lat]);
      }

      setFullRouteCoords(coordsArray);
      setRouteMode(mode);

      // Camera Flyover based on mode
      if (mapInstance.current && coordsArray.length > 0) {
        if (mode === 'navigate') {
          mapInstance.current.flyTo({ center: coordsArray[0], zoom: 19, pitch: 70, bearing: -30, duration: 2500 });
        } else {
          // Preview mode: Just center over the source without high pitch
          mapInstance.current.flyTo({ center: coordsArray[0], zoom: 18, pitch: 45, duration: 2000 });
        }
      }

    } catch (err) { alert("Could not find a route."); } 
    finally { setIsSearching(false); }
  };

  const clearRoute = () => {
      setSelectedSource(null); setSelectedDest(null); setSourceQuery(""); setDestQuery("");
      setFullRouteCoords([]); setRouteMode(null); setRouteInfo(null);
      if(mapInstance.current?.getSource("route-source")) {
        mapInstance.current.getSource("route-source").setData({type: "FeatureCollection", features: []});
      }
      if (coords && mapInstance.current) {
         mapInstance.current.easeTo({ center: [coords.lng, coords.lat], zoom: 17, pitch: 60, bearing: -20 });
      }
  };

  const toggle3D = () => {
    const map = mapInstance.current;
    map.easeTo({ pitch: is3D ? 0 : 60, bearing: is3D ? 0 : -20, duration: 800 });
    setIs3D(!is3D);
  };

  return (
    <div style={{ position: "relative" }}>
      <button onClick={toggle3D} style={{ position: "absolute", top: 10, left: 10, zIndex: 10, borderRadius: "50%", padding: "8px", background: "#4285F4", color: "#fff", cursor: "pointer", border: "none", boxShadow: "0 2px 5px rgba(0,0,0,0.3)" }}>
        {is3D ? "2D" : "3D"} View
      </button>

      {/* Navigation Panel */}
      <div style={{ position: "absolute", top: 20, right: 20, zIndex: 10, background: "rgba(30, 30, 30, 0.95)", color: "white", padding: "20px", borderRadius: "10px", width: "300px", boxShadow: "0 4px 15px rgba(0,0,0,0.5)", backdropFilter: "blur(5px)" }}>
        <h3 style={{ margin: "0 0 15px 0", borderBottom: "1px solid #444", paddingBottom: "10px" }}>Navigate Campus</h3>
        
        <div style={{ position: "relative", marginBottom: "15px" }}>
          <label style={{ fontSize: "12px", color: "#aaa" }}>Start Location</label>
          <input type="text" placeholder="Leave empty to use Current Location..." value={sourceQuery} onChange={(e) => { handleSearch(e.target.value, true); setSelectedSource(null); }} style={{ width: "100%", padding: "8px", marginTop: "5px", background: "#2a2a2a", color: "white", border: "1px solid #444", borderRadius: "5px", boxSizing: "border-box" }} />
          {sourceResults.length > 0 && !selectedSource && (
            <ul style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#333", listStyle: "none", margin: 0, padding: 0, maxHeight: "150px", overflowY: "auto", border: "1px solid #555", borderRadius: "0 0 5px 5px", zIndex: 20 }}>
              {sourceResults.map((n) => (
                <li key={n.id} style={{ padding: "8px", cursor: "pointer", borderBottom: "1px solid #444", fontSize: "13px" }} onClick={() => { setSelectedSource(n); setSourceQuery(n.name); setSourceResults([]); }}>
                  {n.name}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={{ position: "relative", marginBottom: "15px" }}>
          <label style={{ fontSize: "12px", color: "#aaa" }}>Destination</label>
          <input type="text" placeholder="Search destination..." value={destQuery} onChange={(e) => { handleSearch(e.target.value, false); setSelectedDest(null); }} style={{ width: "100%", padding: "8px", marginTop: "5px", background: "#2a2a2a", color: "white", border: "1px solid #444", borderRadius: "5px", boxSizing: "border-box" }} />
          {destResults.length > 0 && !selectedDest && (
            <ul style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#333", listStyle: "none", margin: 0, padding: 0, maxHeight: "150px", overflowY: "auto", border: "1px solid #555", borderRadius: "0 0 5px 5px", zIndex: 20 }}>
              {destResults.map((n) => (
                <li key={n.id} style={{ padding: "8px", cursor: "pointer", borderBottom: "1px solid #444", fontSize: "13px" }} onClick={() => { setSelectedDest(n); setDestQuery(n.name); setDestResults([]); }}>
                  {n.name}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={{ display: "flex", gap: "10px" }}>
            <button onClick={handleCalculateRoute} disabled={isSearching} style={{ flex: 1, padding: "10px", background: "#4285F4", color: "white", border: "none", borderRadius: "5px", cursor: "pointer", fontWeight: "bold" }}>
              {isSearching ? "Calculating..." : "Find Route"}
            </button>
            {fullRouteCoords.length > 0 && (
                <button onClick={clearRoute} style={{ padding: "10px", background: "#d93025", color: "white", border: "none", borderRadius: "5px", cursor: "pointer" }}>
                  Clear
                </button>
            )}
        </div>
      </div>

      {/* ETA Bottom Widget */}
      {routeInfo && routeMode && (
        <div style={{
          position: "absolute", bottom: 30, left: "50%", transform: "translateX(-50%)", zIndex: 10,
          background: "#1e1e1e", color: "white", padding: "15px 30px",
          borderRadius: "30px", boxShadow: "0 10px 25px rgba(0,0,0,0.8)",
          display: "flex", alignItems: "center", gap: "15px", border: "2px solid #333"
        }}>
          <div style={{ fontSize: "28px", fontWeight: "bold", color: routeMode === 'navigate' ? "#34a853" : "#4285F4" }}>
            {routeInfo.time} min
          </div>
          <div style={{ height: "30px", width: "1px", background: "#555" }}></div>
          <div style={{ fontSize: "16px", color: "#ccc" }}>
            {routeInfo.distance} m <span style={{fontSize:"12px", color:"#888"}}>{routeMode === 'navigate' ? 'remaining' : 'total'}</span>
          </div>
        </div>
      )}

      <div ref={mapRef} style={{ width: "100%", height: "100vh" }} />
    </div>
  );
}

export default CampusGraph;