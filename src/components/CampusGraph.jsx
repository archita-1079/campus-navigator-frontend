import React, { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import sampleData from "../utils/sampleData";
import { NODE_CFG, EDGE_CFG } from "../utils/constants";

function Map3D() {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const [is3D, setIs3D] = useState(true);

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

    // -------------------------
    // NORMALIZE TYPES
    // -------------------------
    const normalizeNodeType = (type) => {
      if (["LIBRARY", "LAB", "ADMIN", "AUDITORIUM"].includes(type))
        return "BUILDING";

      if (["CANTEEN", "SHOP"].includes(type))
        return "FACILITY";

      if (["HOSTEL"].includes(type))
        return "LANDMARK";

      if (["GATE", "ENTRANCE"].includes(type))
        return "ENTRANCE";

      if (["JUNCTION"].includes(type))
        return "JUNCTION";

      if (["PARKING"].includes(type))
        return "PARKING";

      return "DEFAULT";
    };

    const normalizeEdgeType = (type) => {
      if (type === "WALKWAY") return "PATHWAY";
      if (type === "RAMP") return "ACCESSIBLE";
      return type;
    };

    map.on("zoom", () => {
  const zoom = map.getZoom();

  document.querySelectorAll(".maplibre-marker").forEach((el) => {
    if (zoom < 16) {
      el.style.display = "none"; // hide labels when zoomed out
    } else {
      el.style.display = "flex";
    }
  });
});

    map.on("load", () => {
      // -------------------------
      // EDGES
      // -------------------------
      const edgeFeatures = sampleData.edges.map((edge) => {
        const source = sampleData.nodes.find(n => n.id === edge.sourceNodeId);
        const target = sampleData.nodes.find(n => n.id === edge.targetNodeId);

        return {
          type: "Feature",
          properties: {
            edgeType: normalizeEdgeType(edge.edgeType),
          },
          geometry: {
            type: "LineString",
            coordinates: [
              [source.longitude, source.latitude],
              ...edge.waypoints.map(w => [w.longitude, w.latitude]),
              [target.longitude, target.latitude],
            ],
          },
        };
      });

      map.addSource("edges", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: edgeFeatures,
        },
      });

      map.addLayer({
        id: "edges-layer",
        type: "line",
        source: "edges",
        paint: {
          "line-color": [
            "match",
            ["get", "edgeType"],
            "ROAD", EDGE_CFG.ROAD.color,
            "PATHWAY", EDGE_CFG.PATHWAY.color,
            "INDOOR", EDGE_CFG.INDOOR.color,
            "ACCESSIBLE", EDGE_CFG.ACCESSIBLE.color,
            EDGE_CFG.DEFAULT.color,
          ],
          "line-width": [
            "match",
            ["get", "edgeType"],
            "ROAD", EDGE_CFG.ROAD.weight,
            "PATHWAY", EDGE_CFG.PATHWAY.weight,
            "INDOOR", EDGE_CFG.INDOOR.weight,
            "ACCESSIBLE", EDGE_CFG.ACCESSIBLE.weight,
            EDGE_CFG.DEFAULT.weight,
          ],
        },
      });

      // -------------------------
      // NODES (VISUAL + ICONS)
      // -------------------------
     sampleData.nodes.forEach((node) => {
  const type = normalizeNodeType(node.nodeType);
  const cfg = NODE_CFG[type] || NODE_CFG.DEFAULT;

  const el = document.createElement("div");

  el.style.display = "flex";
  el.style.alignItems = "center";
  el.style.gap = "6px";

  el.style.background = cfg.bg;
  el.style.color = "#fff";
  el.style.padding = "6px 10px";
  el.style.borderRadius = "10px";
  el.style.border = `2px solid ${cfg.color}`;

  el.style.fontSize = "12px";
  el.style.fontWeight = "500";
  el.style.whiteSpace = "nowrap";

  el.style.boxShadow = "0 2px 6px rgba(0,0,0,0.3)";

  // ICON + NAME (always visible)
  el.innerHTML = `
    <span>${cfg.icon}</span>
    <span>${node.name}</span>
  `;

  new maplibregl.Marker({
    element: el,
    anchor: "bottom",
  })
    .setLngLat([node.longitude, node.latitude])
    .addTo(map);
});
    });

    mapInstance.current = map;
  }, []);

  // -------------------------
  // 2D / 3D SWITCH
  // -------------------------
  const toggle3D = () => {
    const map = mapInstance.current;

    map.easeTo({
      pitch: is3D ? 0 : 60,
      bearing: is3D ? 0 : -20,
      duration: 800,
    });

    setIs3D(!is3D);
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={toggle3D}
        style={{
          position: "absolute",
          top: 10,
          left: 10,
          zIndex: 10,
          padding: "8px",
          background: "#4272eb",
          color: "#fff",
        }}
      >
       {is3D ? "2D" : "3D"}
      </button>

      <div
        ref={mapRef}
        style={{
          width: "100%",
          height: "100vh",
        }}
      />
    </div>
  );
}

export default Map3D;