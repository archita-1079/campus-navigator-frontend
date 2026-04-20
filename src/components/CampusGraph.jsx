import React, { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import sampleData from "../utils/sampleData";
import { NODE_CFG, EDGE_CFG } from "../utils/constants";
import { useGPS } from "../hooks/useGPS";

function CampusGraph() {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const userMarkerRef = useRef(null);

  const [is3D, setIs3D] = useState(true);

  const { coords, acquire } = useGPS();

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
      if (["LIBRARY", "LAB", "ADMIN", "AUDITORIUM"].includes(type))
        return "BUILDING";
      if (["CANTEEN", "SHOP"].includes(type)) return "FACILITY";
      if (["HOSTEL"].includes(type)) return "LANDMARK";
      if (["GATE", "ENTRANCE"].includes(type)) return "ENTRANCE";
      if (["JUNCTION"].includes(type)) return "JUNCTION";
      if (["PARKING"].includes(type)) return "PARKING";
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
          properties: {
            edgeType: normalizeEdgeType(edge.edgeType),
          },
          geometry: {
            type: "LineString",
            coordinates: [
              [source.longitude, source.latitude],
              ...edge.waypoints.map((w) => [w.longitude, w.latitude]),
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
            "ROAD",
            EDGE_CFG.ROAD.color,
            "PATHWAY",
            EDGE_CFG.PATHWAY.color,
            "INDOOR",
            EDGE_CFG.INDOOR.color,
            "ACCESSIBLE",
            EDGE_CFG.ACCESSIBLE.color,
            EDGE_CFG.DEFAULT.color,
          ],
          "line-width": [
            "match",
            ["get", "edgeType"],
            "ROAD",
            EDGE_CFG.ROAD.weight,
            "PATHWAY",
            EDGE_CFG.PATHWAY.weight,
            "INDOOR",
            EDGE_CFG.INDOOR.weight,
            "ACCESSIBLE",
            EDGE_CFG.ACCESSIBLE.weight,
            EDGE_CFG.DEFAULT.weight,
          ],
          "line-opacity": 0.9,
        },
      });

      sampleData.nodes.forEach((node) => {
        const type = normalizeNodeType(node.nodeType);
        const cfg = NODE_CFG[type] || NODE_CFG.DEFAULT;

        const el = document.createElement("div");
        el.style.display = "flex";
        el.style.flexDirection = "column";
        el.style.alignItems = "center";
        el.style.cursor = "pointer";

        // label (name only)
        const label = document.createElement("div");
        label.innerText = node.name;
        label.style.fontSize = "11px";
        label.style.color = "#fff";
        label.style.marginBottom = "4px";

        // pointer icon
        const icon = document.createElement("div");
        icon.innerHTML = cfg.icon;
        icon.style.fontSize = "18px";
        icon.style.color = cfg.color;

        el.appendChild(label);
        el.appendChild(icon);

        el.addEventListener("click", () => {
          new maplibregl.Popup({ offset: 25 })
            .setLngLat([node.longitude, node.latitude])
            .setHTML(
              `
              <div style="
                background:#1e1e1e;
                color:white;
                padding:10px;
                border-radius:10px;
                border:2px solid ${cfg.color};
              ">
                <h4 style="margin:0 0 6px 0">${node.name}</h4>
                <p style="margin:2px 0">Type: ${node.nodeType}</p>
                <p style="margin:2px 0">ID: ${node.id}</p>
              </div>
            `,
            )
            .addTo(map);
        });

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

  useEffect(() => {
    acquire(
      () => {},
      (err) => console.error("GPS error:", err),
    );
  }, []);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !coords) return;

    if (!userMarkerRef.current) {
      const el = document.createElement("div");

      el.style.width = "14px";
      el.style.height = "14px";
      el.style.background = "#2563eb";
      el.style.border = "3px solid white";
      el.style.borderRadius = "50%";
      el.style.boxShadow = "0 0 8px rgba(37,99,235,0.9)";

      userMarkerRef.current = new maplibregl.Marker({
        element: el,
        anchor: "center",
      })
        .setLngLat([coords.lng, coords.lat])
        .addTo(map);

      // center once
      map.flyTo({
        center: [coords.lng, coords.lat],
        zoom: 18,
      });
    } else {
      userMarkerRef.current.setLngLat([coords.lng, coords.lat]);
    }
  }, [coords]);

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
          borderRadius: "50%",
          padding: "8px",
          background: "#89a3e4",
          color: "#fff",
        }}
      >
        {is3D ? "2D" : "3D"}
      </button>

      <div ref={mapRef} style={{ width: "100%", height: "100vh" }} />
    </div>
  );
}

export default CampusGraph;
