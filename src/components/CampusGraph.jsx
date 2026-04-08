import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { NODE_CFG, EDGE_CFG } from "../utils/constants";
import { API_USER_BASE } from "../utils/constants";
import { flattenNodes, validCoord } from "../utils/graph";

const nodeCfg = (t) => NODE_CFG[t] || NODE_CFG.DEFAULT;
const edgeCfg = (t) => EDGE_CFG[t] || EDGE_CFG.DEFAULT;

function makeSvgIcon(L, cfg, isChild) {
  const r = isChild ? 8 : 14;
  const size = r * 2 + 8;

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="${cfg.bg}" stroke="${cfg.color}" stroke-width="2"/>
    <text x="${size / 2}" y="${size / 2 + 4}" text-anchor="middle" font-size="12">${cfg.icon}</text>
  </svg>`;

  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export default function CampusGraph() {
  const mapRef = useRef(null);
  const map = useRef(null);
  const Lref = useRef(null);

  const nodeLayer = useRef(null);
  const edgeLayer = useRef(null);

  const [graph, setGraph] = useState(null);
  const [filterType, setFilterType] = useState("ALL");
  const [showInactive, setShowInactive] = useState(false);
  const [error, setError] = useState(null);

  async function loadLeaflet() {
    if (window.L) return window.L;

    await Promise.all([
      new Promise((res) => {
        const css = document.createElement("link");
        css.rel = "stylesheet";
        css.href =
          "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css";
        css.onload = res;
        document.head.appendChild(css);
      }),
      new Promise((res) => {
        const script = document.createElement("script");
        script.src =
          "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js";
        script.onload = res;
        document.body.appendChild(script);
      }),
    ]);

    return window.L;
  }

  async function initMap() {
    const L = await loadLeaflet();
    Lref.current = L;

    if (map.current) return;

    const m = L.map(mapRef.current, { zoomControl: false });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 22,
    }).addTo(m);

    L.control.zoom({ position: "bottomright" }).addTo(m);

    nodeLayer.current = L.layerGroup().addTo(m);
    edgeLayer.current = L.layerGroup().addTo(m);

    m.setView([20, 78], 4);

    map.current = m;
  }

  useEffect(() => {
    initMap();
    return () => map.current?.remove();
  }, []);

  useEffect(() => {
    axios
      .get(`${API_USER_BASE}/graph`)
      .then((res) => setGraph(res.data.data))
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    const L = Lref.current;
    const m = map.current;

    if (!L || !m || !graph) return;

    nodeLayer.current.clearLayers();
    edgeLayer.current.clearLayers();

    const nodes = flattenNodes(graph.nodes);
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    const bounds = [];

    for (const edge of graph.edges || []) {
      if (!showInactive && !edge.active) continue;

      const src = nodeMap.get(edge.sourceNodeId);
      const tgt = nodeMap.get(edge.targetNodeId);

      if (!src || !tgt) continue;

      if (!validCoord(src.latitude, src.longitude)) continue;
      if (!validCoord(tgt.latitude, tgt.longitude)) continue;

      const pts = [[src.latitude, src.longitude]];

      if (edge.waypoints) {
        for (const w of edge.waypoints) {
          if (validCoord(w.latitude, w.longitude)) {
            pts.push([w.latitude, w.longitude]);
          }
        }
      }

      pts.push([tgt.latitude, tgt.longitude]);

      const cfg = edgeCfg(edge.edgeType);

      const line = L.polyline(pts, {
        color: edge.active ? cfg.color : "#444",
        weight: cfg.weight,
        dashArray: cfg.dash || null,
      });

      line.addTo(edgeLayer.current);

      pts.forEach((p) => bounds.push(p));
    }

    for (const node of nodes) {
      if (!validCoord(node.latitude, node.longitude)) continue;
      if (!showInactive && !node.active) continue;
      if (filterType !== "ALL" && node.nodeType !== filterType) continue;

      const cfg = nodeCfg(node.nodeType);

      const marker = L.marker([node.latitude, node.longitude], {
        icon: makeSvgIcon(L, cfg, !!node.parentNodeId),
      });

      marker.bindPopup(
        `<b>${node.name}</b><br/>${node.nodeType || ""}<br/>${
          node.accessible ? "♿ Accessible" : ""
        }`,
      );

      marker.addTo(nodeLayer.current);

      bounds.push([node.latitude, node.longitude]);
    }

    if (bounds.length) {
      m.fitBounds(bounds, { padding: [40, 40], maxZoom: 19 });
    }
  }, [graph, filterType, showInactive]);

  const nodes = graph ? flattenNodes(graph.nodes) : [];
  const nodeTypes = [
    "ALL",
    ...new Set(nodes.map((n) => n.nodeType).filter(Boolean)),
  ];

  return (
    <div style={{ height: "100vh", background: "#0f172a", color: "white" }}>
      <div style={{ padding: 10 }}>
        {nodeTypes.map((t) => (
          <button key={t} onClick={() => setFilterType(t)}>
            {t}
          </button>
        ))}

        <label style={{ marginLeft: 10 }}>
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          inactive
        </label>
      </div>

      {error && <div>{error}</div>}

      <div ref={mapRef} style={{ height: "90%" }} />
    </div>
  );
}
