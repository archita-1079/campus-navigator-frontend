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
