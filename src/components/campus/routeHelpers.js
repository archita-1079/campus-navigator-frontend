import { OSRM_BASE } from "./constants";

export async function fetchOSRMRoute(srcNode, dstNode) {
  const url = `${OSRM_BASE}/${srcNode.longitude},${srcNode.latitude};${dstNode.longitude},${dstNode.latitude}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const data = await res.json();
  if (data.code !== "Ok" || !data.routes?.length) throw new Error("OSRM: no route");
  return data.routes[0].geometry.coordinates;
}

export function edgesToCoords(edges, nodes) {
  const arr = [];
  edges.forEach((edge) => {
    const src = nodes.find((n) => n.id === edge.sourceNodeId);
    const tgt = nodes.find((n) => n.id === (edge.destinationNodeId ?? edge.targetNodeId));
    if (!src || !tgt) return;
    if (arr.length === 0) arr.push([src.longitude, src.latitude]);
    (edge.waypoints || []).forEach((w) => arr.push([w.longitude, w.latitude]));
    arr.push([tgt.longitude, tgt.latitude]);
  });
  return arr;
}