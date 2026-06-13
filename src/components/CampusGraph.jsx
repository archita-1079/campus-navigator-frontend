import React, { useEffect, useRef, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import axios from "axios";

import { use1sGPS } from "./campus/use1sGPS";
import { useCompassHeading } from "./campus/useCompassHeading";
import { initMap, setupMapLayers } from "./campus/mapSetup";
import { renderEdges, renderNodeMarkers, createSearchPin, createUserMarker } from "./campus/mapOverlays";
import { buildHeadingCone, buildAccuracyFeature } from "./campus/headingCone";
import { fetchOSRMRoute, edgesToCoords } from "./campus/routeHelpers";
import { injectCampusStyles } from "./campus/campusStyles";
import { API_USER_BASE, OFF_ROUTE_THRESHOLD_M, REROUTE_COOLDOWN_MS } from "./campus/constants";

import ReroutingBanner from "./campus/ReroutingBanner";
import TurnBanner from "./campus/TurnBanner";
import ArrivalOverlay from "./campus/ArrivalOverlay";
import StepsPanel from "./campus/StepsPanel";
import MapFABs from "./campus/MapFABs";
import BottomBar from "./campus/BottomBar";
import GPSPill from "./campus/GPSPill";
import SearchSheet from "./campus/SearchSheet";

import {
  getDisplayName,
  getDistanceInMeters,
  normalizeNodeType,
  getBearing,
  buildDirections,
  buildArrowFeatures,
  DIR,
  injectStyles,
} from "../utils/graph";
import { NODE_CFG } from "../utils/constants";

export default function CampusGraph() {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const mapLoaded = useRef(false);
  const pendingData = useRef(null);
  const nodeMarkersRef = useRef([]);
  const userMarkerRef = useRef(null);
  const searchPinRef = useRef(null);
  const autoFollowRef = useRef(false);
  const reFollowTimerRef = useRef(null);

  const isReroutingRef = useRef(false);
  const lastRerouteTimeRef = useRef(0);
  const selectedDestRef = useRef(null);
  const mapDataRef = useRef({ nodes: [], edges: [] });
  const routeCoordsRef = useRef([]);
  const directionsRef = useRef([]);
  const stepIdxRef = useRef(0);

  const prevHeadingRef = useRef(null);
  const prevLatRef = useRef(null);
  const prevLngRef = useRef(null);

  const [mapData, setMapData] = useState({ nodes: [], edges: [] });
  const { coords, error: gpsError } = use1sGPS();
  const compassHeading = useCompassHeading();

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
  const [arrived, setArrived] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [isRerouting, setIsRerouting] = useState(false);
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [showStepsPanel, setShowStepsPanel] = useState(false);
  const [distToNextTurn, setDistToNextTurn] = useState(null);
  const [uTurnActive, setUTurnActive] = useState(false);

  useEffect(() => { routeCoordsRef.current = routeCoords; }, [routeCoords]);
  useEffect(() => { directionsRef.current = directions; }, [directions]);
  useEffect(() => { stepIdxRef.current = stepIdx; }, [stepIdx]);
  useEffect(() => { selectedDestRef.current = selectedDest; }, [selectedDest]);
  useEffect(() => { mapDataRef.current = mapData; }, [mapData]);

  const effectiveHeading = useCallback(() => {
    if (coords?.speed != null && coords.speed > 0.5 && coords.heading != null) return coords.heading;
    return compassHeading;
  }, [coords, compassHeading]);

  useEffect(() => {
    injectStyles();
    injectCampusStyles();
  }, []);

  useEffect(() => {
    if (mapInstance.current) return;
    const map = initMap(mapRef.current);

    map.on("load", () => {
      setupMapLayers(map);
      mapLoaded.current = true;
      if (pendingData.current) {
        const d = pendingData.current;
        renderEdges(map, d.nodes, d.edges);
        nodeMarkersRef.current.forEach((m) => m.remove());
        nodeMarkersRef.current = renderNodeMarkers(map, d.nodes, handleNodeMarkerClick);
        pendingData.current = null;
      }
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

  function handleNodeMarkerClick(node, cfg, map) {
    setSelectedDest(node);
    setDestQuery(node.name);
    setSheetOpen(true);
    new maplibregl.Popup({ offset: 25 })
      .setLngLat([node.longitude, node.latitude])
      .setHTML(
        `<div style="background:#1e1e1e;color:white;padding:10px;border-radius:10px;border:2px solid ${cfg.color}">
          <h4 style="margin:0">${node.name}</h4>
          <p style="margin:4px 0 0;font-size:12px;color:#aaa">${node.nodeType}</p>
        </div>`
      )
      .addTo(map);
  }

  const renderMapData = useCallback((map, data) => {
    if (!map || !data?.nodes?.length) return;
    renderEdges(map, data.nodes, data.edges);
    nodeMarkersRef.current.forEach((m) => m.remove());
    nodeMarkersRef.current = renderNodeMarkers(map, data.nodes, handleNodeMarkerClick);
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

  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !coords) return;

    if (!userMarkerRef.current) {
      userMarkerRef.current = createUserMarker(map, coords.lng, coords.lat);
    } else {
      userMarkerRef.current.setLngLat([coords.lng, coords.lat]);
    }

    map.getSource("accuracy-src")?.setData(buildAccuracyFeature(coords.lng, coords.lat));

    const hdg =
      coords.speed != null && coords.speed > 0.5 && coords.heading != null
        ? coords.heading
        : compassHeading;

    const latChanged = Math.abs((prevLatRef.current ?? 0) - coords.lat) > 0.000001;
    const lngChanged = Math.abs((prevLngRef.current ?? 0) - coords.lng) > 0.000001;
    const hdgChanged =
      hdg == null
        ? prevHeadingRef.current != null
        : Math.abs(((hdg - (prevHeadingRef.current ?? hdg) + 540) % 360) - 180) > 2;

    if (latChanged || lngChanged || hdgChanged) {
      map.getSource("heading-src")?.setData(buildHeadingCone(coords.lat, coords.lng, hdg));
      prevLatRef.current = coords.lat;
      prevLngRef.current = coords.lng;
      prevHeadingRef.current = hdg;
    }
  }, [coords, compassHeading]);

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
      const res = await axios.get(`${API_USER_BASE}/graph/shortest-path/${nearestNode.id}/${dest.id}`);
      const edges = res.data.data || [];
      let arr = edgesToCoords(edges, data.nodes);

      if (arr.length === 0) {
        try { arr = await fetchOSRMRoute(nearestNode, dest); }
        catch (e) { console.warn("OSRM fallback failed", e); return; }
      }

      arr.unshift([currentCoords.lng, currentCoords.lat]);
      if (arr.length < 2) return;

      let total = 0;
      for (let i = 0; i < arr.length - 1; i++)
        total += getDistanceInMeters(arr[i][1], arr[i][0], arr[i + 1][1], arr[i + 1][0]);

      const built = buildDirections(arr, true);
      setRouteCoords(arr);
      routeCoordsRef.current = arr;
      setDirections(built);
      directionsRef.current = built;
      setTravelledIdx(0);
      setStepIdx(0);
      stepIdxRef.current = 0;
      setDistToNextTurn(null);
      setRouteInfo({ distance: Math.round(total), time: Math.max(1, Math.ceil(total / 1.4 / 60)) });

      const map = mapInstance.current;
      if (map) {
        map.getSource("route-travelled")?.setData({ type: "FeatureCollection", features: [] });
        map.getSource("route-src")?.setData({ type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: arr } }] });
        map.getSource("arrows-src")?.setData({ type: "FeatureCollection", features: buildArrowFeatures(arr) });
      }
    } catch (e) {
      console.error("Reroute failed:", e);
    } finally {
      isReroutingRef.current = false;
      setIsRerouting(false);
    }
  }, []);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !coords || !navigating) return;
    const rc = routeCoordsRef.current;
    if (!rc.length) return;

    let minD = Infinity, closestIdx = 0;
    rc.forEach(([lng, lat], i) => {
      const d = getDistanceInMeters(coords.lat, coords.lng, lat, lng);
      if (d < minD) { minD = d; closestIdx = i; }
    });
    setTravelledIdx(closestIdx);

    const heading = effectiveHeading();
    const nextPt = rc[Math.min(closestIdx + 1, rc.length - 1)];
    let detectedUTurn = false;
    if (heading != null && nextPt) {
      const toBearing = getBearing(coords.lat, coords.lng, nextPt[1], nextPt[0]);
      const diff = Math.abs(((heading - toBearing + 540) % 360) - 180);
      detectedUTurn = diff > 120;
    }

    setUTurnActive(detectedUTurn);
    map.getSource("uturn-src")?.setData({
      type: "FeatureCollection",
      features: detectedUTurn
        ? [{ type: "Feature", geometry: { type: "Point", coordinates: [coords.lng, coords.lat] }, properties: {} }]
        : [],
    });

    if (minD > OFF_ROUTE_THRESHOLD_M) triggerReroute(coords);

    const remaining = [[coords.lng, coords.lat], ...rc.slice(closestIdx)];
    const travelled = [...rc.slice(0, closestIdx + 1), [coords.lng, coords.lat]];

    let remMeters = 0;
    for (let i = 0; i < remaining.length - 1; i++)
      remMeters += getDistanceInMeters(remaining[i][1], remaining[i][0], remaining[i + 1][1], remaining[i + 1][0]);

    map.getSource("route-src")?.setData({ type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: remaining } }] });
    map.getSource("route-travelled")?.setData({ type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: travelled } }] });
    map.getSource("arrows-src")?.setData({ type: "FeatureCollection", features: buildArrowFeatures(remaining) });
    setRouteInfo({ distance: Math.round(remMeters), time: Math.max(1, Math.ceil(remMeters / 1.4 / 60)) });

    if (remMeters < 12) { setArrived(true); return; }

    const dirs = directionsRef.current;
    if (dirs.length > 0) {
      let ai = 0;
      for (let i = 0; i < dirs.length; i++) {
        if (closestIdx >= dirs[i].coordIndex) ai = i;
        else break;
      }
      if (ai !== stepIdxRef.current) { setStepIdx(ai); stepIdxRef.current = ai; }

      const nextTurnStep = dirs[ai + 1];
      if (nextTurnStep && rc[nextTurnStep.coordIndex]) {
        let d = getDistanceInMeters(coords.lat, coords.lng, rc[closestIdx][1], rc[closestIdx][0]);
        for (let i = closestIdx; i < nextTurnStep.coordIndex && i < rc.length - 1; i++)
          d += getDistanceInMeters(rc[i][1], rc[i][0], rc[i + 1][1], rc[i + 1][0]);
        setDistToNextTurn(Math.round(d));
      } else {
        setDistToNextTurn(null);
      }
    }

    if (remaining.length >= 2 && autoFollowRef.current) {
      const bearing = getBearing(remaining[0][1], remaining[0][0], remaining[1][1], remaining[1][0]);
      map.easeTo({ center: [coords.lng, coords.lat], bearing, zoom: 18.5, pitch: 45, duration: 700 });
    }
  }, [coords, navigating, triggerReroute]);

  const flyToNode = (node) => {
    const map = mapInstance.current;
    if (!map) return;
    if (searchPinRef.current) { searchPinRef.current.remove(); searchPinRef.current = null; }
    if (node.parentNodeId != null) searchPinRef.current = createSearchPin(map, node);
    map.flyTo({
      center: [node.longitude, node.latitude],
      zoom: node.parentNodeId != null ? 19 : 18,
      pitch: 0, bearing: 0, duration: 1600,
    });
  };

  const handleSearch = async (query, isSource) => {
    isSource ? setSourceQuery(query) : setDestQuery(query);
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
    let usingGPS = false;

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
      const res = await axios.get(`${API_USER_BASE}/graph/shortest-path/${activeSource.id}/${selectedDest.id}`);
      const edges = res.data.data || [];
      let arr = edgesToCoords(edges, mapData.nodes);

      if (arr.length === 0) {
        try { arr = await fetchOSRMRoute(activeSource, selectedDest); }
        catch (e) {
          console.warn("OSRM fallback failed", e);
          arr = [[activeSource.longitude, activeSource.latitude], [selectedDest.longitude, selectedDest.latitude]];
        }
      }

      if (usingGPS && coords) arr.unshift([coords.lng, coords.lat]);

      let total = 0;
      for (let i = 0; i < arr.length - 1; i++)
        total += getDistanceInMeters(arr[i][1], arr[i][0], arr[i + 1][1], arr[i + 1][0]);

      const built = buildDirections(arr);
      setRouteCoords(arr);
      routeCoordsRef.current = arr;
      setDirections(built);
      directionsRef.current = built;
      setTravelledIdx(0);
      setStepIdx(0);
      stepIdxRef.current = 0;
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
        map.getSource("route-src")?.setData({ type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: arr } }] });
        map.getSource("arrows-src")?.setData({ type: "FeatureCollection", features: buildArrowFeatures(arr) });
        const lngs = arr.map((c) => c[0]);
        const lats = arr.map((c) => c[1]);
        map.fitBounds(
          [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
          { padding: { top: 80, bottom: 220, left: 40, right: 40 }, pitch: 0, bearing: 0, duration: 1800 }
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
    setSheetOpen(false);
    isReroutingRef.current = false;
    lastRerouteTimeRef.current = 0;
    const map = mapInstance.current;
    if (map && coords) map.easeTo({ center: [coords.lng, coords.lat], zoom: 18.5, pitch: 45, duration: 1200 });
  };

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
    stepIdxRef.current = 0;
    setRouteInfo(null);
    setArrived(false);
    setIsRerouting(false);
    isReroutingRef.current = false;
    lastRerouteTimeRef.current = 0;
    autoFollowRef.current = false;
    setPreviewCollapsed(false);
    setIsPreviewMode(false);
    setShowStepsPanel(false);
    setDistToNextTurn(null);
    setUTurnActive(false);
    mapInstance.current?.getSource("uturn-src")?.setData({ type: "FeatureCollection", features: [] });
    if (searchPinRef.current) { searchPinRef.current.remove(); searchPinRef.current = null; }
    const map = mapInstance.current;
    if (map) {
      ["route-src", "route-travelled", "arrows-src"].forEach((s) =>
        map.getSource(s)?.setData({ type: "FeatureCollection", features: [] })
      );
      map.easeTo({ zoom: 17, pitch: 0, bearing: 0, duration: 800 });
    }
  };

  const activeStep = directions[stepIdx];
  const dirInfo = activeStep ? DIR[activeStep.type] || DIR.straight : null;

  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden", background: "#000" }}>
      <div ref={mapRef} style={{ position: "absolute", inset: 0 }} />

      {!navigating && (
        <div style={{ position: "absolute", top: 12, left: 12, right: 12, zIndex: 20, marginTop: 50 }}>
          <div
            onClick={() => setSheetOpen(true)}
            style={{
              background: "rgba(14,14,14,0.96)",
              color: destQuery ? "#fff" : "#666",
              padding: "12px 16px",
              borderRadius: 14,
              fontSize: 14,
              fontWeight: 500,
              boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
              border: "1px solid #2a2a2a",
              backdropFilter: "blur(12px)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span style={{ fontSize: 16 }}>🔍</span>
            <span>{destQuery || "Where do you want to go?"}</span>
          </div>
        </div>
      )}

      {isRerouting && navigating && <ReroutingBanner />}

      {navigating && !arrived && !isRerouting && (uTurnActive || dirInfo) && (
        <TurnBanner
          uTurnActive={uTurnActive}
          dirInfo={dirInfo}
          distToNextTurn={distToNextTurn}
          stepIdx={stepIdx}
          totalSteps={directions.length}
        />
      )}

      {arrived && <ArrivalOverlay destinationName={selectedDest?.name} onDone={clearRoute} />}

      {showStepsPanel && routeReady && directions.length > 0 && !arrived && (
        <StepsPanel
          directions={directions}
          stepIdx={stepIdx}
          navigating={navigating}
          arrived={arrived}
          selectedSource={selectedSource}
          selectedDest={selectedDest}
          routeInfo={routeInfo}
          isPreviewMode={isPreviewMode}
          previewCollapsed={previewCollapsed}
          onClose={() => setShowStepsPanel(false)}
        />
      )}

      <MapFABs
        routeReady={routeReady}
        navigating={navigating}
        arrived={arrived}
        previewCollapsed={previewCollapsed}
        showStepsPanel={showStepsPanel}
        directions={directions}
        onReCenter={reCenter}
        onResetBearing={() => {
          const m = mapInstance.current;
          if (m) m.easeTo({ bearing: 0, pitch: 0, duration: 600 });
        }}
        onToggleSteps={() => setShowStepsPanel((v) => !v)}
        mapInstance={mapInstance}
      />

      <BottomBar
        routeReady={routeReady}
        navigating={navigating}
        arrived={arrived}
        routeInfo={routeInfo}
        selectedDest={selectedDest}
        isPreviewMode={isPreviewMode}
        showStepsPanel={showStepsPanel}
        previewCollapsed={previewCollapsed}
        onToggleCollapsed={() => setPreviewCollapsed((v) => !v)}
        onStartNavigation={handleStartNavigation}
        onToggleSteps={() => setShowStepsPanel((v) => !v)}
        onClearRoute={clearRoute}
      />

      <GPSPill
        coords={coords}
        gpsError={gpsError}
        routeReady={routeReady}
        navigating={navigating}
      />

      {sheetOpen && (
        <SearchSheet
          sourceQuery={sourceQuery}
          destQuery={destQuery}
          sourceResults={sourceResults}
          destResults={destResults}
          selectedSource={selectedSource}
          selectedDest={selectedDest}
          isSearching={isSearching}
          onSourceChange={(q) => { handleSearch(q, true); setSelectedSource(null); }}
          onDestChange={(q) => { handleSearch(q, false); setSelectedDest(null); }}
          onSelectSource={(n) => { setSelectedSource(n); setSourceQuery(getDisplayName(n)); setSourceResults([]); flyToNode(n); }}
          onSelectDest={(n) => { setSelectedDest(n); setDestQuery(getDisplayName(n)); setDestResults([]); flyToNode(n); }}
          onFindRoute={handleFindRoute}
          onClose={() => { setSheetOpen(false); setSourceResults([]); setDestResults([]); }}
        />
      )}
    </div>
  );
}