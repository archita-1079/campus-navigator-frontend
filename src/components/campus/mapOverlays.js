import maplibregl from "maplibre-gl";
import { NODE_CFG } from "../../utils/constants";
import { normalizeEdgeType, normalizeNodeType } from "../../utils/graph";

const VISIBLE_NODE_TYPES = [
  "BUILDING", "CANTEEN", "HOSTEL", "LIBRARY", "LAB",
  "ADMIN", "AUDITORIUM", "CLASSROOM", "LECTURE_HALL", "OTHER",
];

export function renderEdges(map, nodes, edges) {
  const features = (edges || [])
    .map((edge) => {
      const src = nodes.find((n) => n.id === edge.sourceNodeId);
      const tgt = nodes.find((n) => n.id === (edge.destinationNodeId ?? edge.targetNodeId));
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
  map.getSource("edges")?.setData({ type: "FeatureCollection", features });
}

export function renderNodeMarkers(map, nodes, onNodeClick) {
  const markers = [];
  nodes
    .filter((n) => VISIBLE_NODE_TYPES.includes(n.nodeType?.toUpperCase()))
    .forEach((node) => {
      const cfg = NODE_CFG[normalizeNodeType(node.nodeType)] || NODE_CFG.DEFAULT;
      const el = document.createElement("div");
      Object.assign(el.style, {
        display: "flex", flexDirection: "column", alignItems: "center",
        cursor: "pointer", gap: "2px",
      });

      const lbl = document.createElement("div");
      lbl.innerText = node.name;
      Object.assign(lbl.style, {
        fontSize: "10px", color: "#fff", background: "rgba(0,0,0,0.6)",
        padding: "1px 5px", borderRadius: "3px", whiteSpace: "nowrap",
        maxWidth: "100px", overflow: "hidden", textOverflow: "ellipsis",
      });

      const ico = document.createElement("div");
      ico.innerHTML = cfg.icon;
      Object.assign(ico.style, {
        fontSize: "18px", color: cfg.color, lineHeight: 1,
        filter: `drop-shadow(0 0 4px ${cfg.color})`,
      });

      el.appendChild(lbl);
      el.appendChild(ico);
      el.addEventListener("click", () => onNodeClick(node, cfg, map));

      markers.push(
        new maplibregl.Marker({ element: el, anchor: "bottom" })
          .setLngLat([node.longitude, node.latitude])
          .addTo(map)
      );
    });
  return markers;
}

export function createSearchPin(map, node) {
  const cfg = NODE_CFG[normalizeNodeType(node.nodeType)] || NODE_CFG.DEFAULT;
  const el = document.createElement("div");
  Object.assign(el.style, {
    display: "flex", flexDirection: "column", alignItems: "center", gap: "2px",
  });

  const lbl = document.createElement("div");
  lbl.innerText = node.name;
  Object.assign(lbl.style, {
    fontSize: "11px", color: "#fff", background: "rgba(66,133,244,0.9)",
    padding: "2px 6px", borderRadius: "4px", fontWeight: "600",
  });

  const ico = document.createElement("div");
  ico.innerHTML = cfg.icon || "📍";
  Object.assign(ico.style, { fontSize: "22px", filter: "drop-shadow(0 0 6px #4285F4)" });

  el.appendChild(lbl);
  el.appendChild(ico);

  return new maplibregl.Marker({ element: el, anchor: "bottom" })
    .setLngLat([node.longitude, node.latitude])
    .addTo(map);
}

export function createUserMarker(map, lng, lat) {
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:relative;width:22px;height:22px;pointer-events:none;";

  const pulse = document.createElement("div");
  pulse.style.cssText =
    "position:absolute;inset:0;background:rgba(66,133,244,0.35);border-radius:50%;animation:gpsPulse 2s ease-out infinite;";

  const dot = document.createElement("div");
  dot.style.cssText =
    "position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:14px;height:14px;background:#4285F4;border:2.5px solid #fff;border-radius:50%;box-shadow:0 0 12px rgba(66,133,244,0.9);";

  wrap.appendChild(pulse);
  wrap.appendChild(dot);

  return new maplibregl.Marker({ element: wrap, anchor: "center" })
    .setLngLat([lng, lat])
    .addTo(map);
}