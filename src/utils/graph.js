export function flattenNodes(nodes = []) {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    out.push(n);
    (n.childNodes || []).forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}

export function validCoord(lat, lng) {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    !Number.isNaN(lat) &&
    !Number.isNaN(lng)
  );
}

// Helper to format room names with their building
export const getDisplayName = (n, nodes) => {
  let buildingName = n.parentNode?.name || n.parentName; // Handles embedded object
  if (!buildingName && n.parentNodeId) {
    const parent = nodes?.find((node) => node.id === n.parentNodeId);
    if (parent) buildingName = parent.name;
  }
  return buildingName ? `${n.name} (${buildingName})` : n.name;
};

// Helper function to calculate accurate physical distance in meters
export function getDistanceInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
