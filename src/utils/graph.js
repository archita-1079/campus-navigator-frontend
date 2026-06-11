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

export const getDisplayName = (n, nodes) => {
  let buildingName = n.parentNode?.name || n.parentName;
  if (!buildingName && n.parentNodeId) {
    const parent = nodes?.find((node) => node.id === n.parentNodeId);
    if (parent) buildingName = parent.name;
  }
  return buildingName ? `${n.name} (${buildingName})` : n.name;
};

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

export const normalizeNodeType = (type) => {
  if (!type) return "DEFAULT";
  const t = type.toUpperCase();
  if (["LIBRARY", "LAB", "ADMIN", "AUDITORIUM", "BUILDING"].includes(t))
    return "BUILDING";
  if (["CANTEEN", "SHOP"].includes(t)) return "FACILITY";
  if (["HOSTEL"].includes(t)) return "LANDMARK";
  if (["GATE", "ENTRANCE"].includes(t)) return "ENTRANCE";
  return "DEFAULT";
};

export const normalizeEdgeType = (type) => {
  if (type === "WALKWAY") return "PATHWAY";
  if (type === "RAMP") return "ACCESSIBLE";
  return type;
};

export const getBearing = (lat1, lng1, lat2, lng2) => {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const dLng = toRad(lng2 - lng1);
  const phi1 = toRad(lat1),
    phi2 = toRad(lat2);
  const y = Math.sin(dLng) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
};

export const getTurnDirection = (prev, next) => {
  const diff = ((next - prev + 540) % 360) - 180;
  if (Math.abs(diff) < 30) return "straight";   // wider dead-zone → fewer phantom turns
  if (diff >= 30 && diff <= 150) return "right";
  if (diff <= -30 && diff >= -150) return "left";
  return "u-turn"; // only true 180° reversals (|diff| > 150)
};

// ─── Smooth a bearing sequence using a distance-weighted average ──────────────
// Looks ahead up to SMOOTH_DIST metres and returns the weighted mean bearing.
// This kills phantom turns caused by GPS jitter or tight waypoint clusters.
const SMOOTH_DIST = 15; // metres to look ahead when averaging bearing

function smoothedBearing(coords, fromIdx) {
  // Collect upcoming segments up to SMOOTH_DIST m
  let sinSum = 0, cosSum = 0, distSoFar = 0;
  for (let i = fromIdx; i < coords.length - 1; i++) {
    const segDist = getDistanceInMeters(
      coords[i][1], coords[i][0],
      coords[i + 1][1], coords[i + 1][0],
    );
    if (segDist < 0.1) continue; // skip degenerate duplicate points
    const b = getBearing(coords[i][1], coords[i][0], coords[i + 1][1], coords[i + 1][0]);
    const rad = (b * Math.PI) / 180;
    const w = Math.min(segDist, SMOOTH_DIST - distSoFar);
    sinSum += Math.sin(rad) * w;
    cosSum += Math.cos(rad) * w;
    distSoFar += segDist;
    if (distSoFar >= SMOOTH_DIST) break;
  }
  if (sinSum === 0 && cosSum === 0) {
    // fallback: raw bearing of this single segment
    return getBearing(
      coords[fromIdx][1], coords[fromIdx][0],
      coords[fromIdx + 1][1], coords[fromIdx + 1][0],
    );
  }
  return ((Math.atan2(sinSum, cosSum) * 180) / Math.PI + 360) % 360;
}

// ─── buildDirections ─────────────────────────────────────────────────────────
// Rules:
//  • Ignore segments shorter than MIN_STEP_DIST — they are internal waypoints,
//    not real decision points.
//  • Use smoothedBearing so micro-jags don't generate phantom turns.
//  • Never emit a u-turn from graph data — u-turns only appear during live
//    rerouting (the reroute logic in CampusGraph handles that path separately).
//  • Merge consecutive "straight" continuations into the running segment.

const MIN_STEP_DIST = 8; // metres — shorter segments are merged silently

export const buildDirections = (coords) => {
  if (coords.length < 2) return [];

  const steps = [];

  // ── Phase 1: collect candidate turn points ────────────────────────────────
  // A candidate is any index where the smoothed bearing changes meaningfully
  // AND the accumulated distance since the last candidate exceeds MIN_STEP_DIST.

  let segStartIdx  = 0;
  let segBearing   = smoothedBearing(coords, 0);
  let segDist      = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const dist = getDistanceInMeters(
      coords[i][1], coords[i][0],
      coords[i + 1][1], coords[i + 1][0],
    );

    // Skip degenerate duplicate coordinates
    if (dist < 0.1) continue;

    segDist += dist;

    const isLast = i === coords.length - 2;

    if (isLast) {
      // Always emit the final "arrive" step
      steps.push({
        type: "arrive",
        bearing: segBearing,
        distance: Math.round(segDist),
        coordIndex: segStartIdx,
      });
      break;
    }

    // Only evaluate a turn if this segment is long enough to matter
    if (segDist < MIN_STEP_DIST) continue;

    const nextBearing = smoothedBearing(coords, i + 1);
    const turn = getTurnDirection(segBearing, nextBearing);

    if (turn === "straight") continue; // keep accumulating

    // ── Suppress u-turns from graph data ─────────────────────────────────
    // A genuine u-turn in a campus graph almost never exists — it's always
    // a data artifact (two overlapping waypoints, a hairpin < 1 m, etc.).
    // U-turns are only valid during live rerouting, which bypasses this
    // function and updates the route directly.
    if (turn === "u-turn") continue;

    steps.push({
      type: turn,
      bearing: segBearing,
      distance: Math.round(segDist),
      coordIndex: segStartIdx,
    });

    segStartIdx = i + 1;
    segBearing  = nextBearing;
    segDist     = 0;
  }

  return steps;
};

export const buildArrowFeatures = (coordsArray, intervalM = 18) => {
  const features = [];
  let distAccum = 0;
  for (let i = 0; i < coordsArray.length - 1; i++) {
    const [lng1, lat1] = coordsArray[i];
    const [lng2, lat2] = coordsArray[i + 1];
    const segDist = getDistanceInMeters(lat1, lng1, lat2, lng2);
    if (segDist < 0.1) continue;
    const bearing = getBearing(lat1, lng1, lat2, lng2);
    let offset = intervalM - (distAccum % intervalM);
    while (offset <= segDist) {
      const frac = offset / segDist;
      features.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [lng1 + (lng2 - lng1) * frac, lat1 + (lat2 - lat1) * frac],
        },
        properties: { bearing },
      });
      offset += intervalM;
    }
    distAccum += segDist;
  }
  return features;
};

export const DIR = {
  straight: { icon: "↑", label: "Continue straight", color: "#4285F4" },
  right:    { icon: "→", label: "Turn right",         color: "#FBBC05" },
  left:     { icon: "←", label: "Turn left",          color: "#FBBC05" },
  "u-turn": { icon: "↩", label: "Make a U-turn",      color: "#EA4335" },
  arrive:   { icon: "🏁", label: "You have arrived",   color: "#34A853" },
};

export const injectStyles = () => {
  if (document.getElementById("campus-nav-styles")) return;
  const s = document.createElement("style");
  s.id = "campus-nav-styles";
  s.textContent = `
    @keyframes gpsPulse {
      0%  { transform:scale(1);  opacity:0.85; }
      70% { transform:scale(3);  opacity:0;    }
      100%{ transform:scale(3);  opacity:0;    }
    }
    @keyframes dirSlide {
      from { opacity:0; transform:translateX(-50%) translateY(-10px); }
      to   { opacity:1; transform:translateX(-50%) translateY(0);     }
    }
    @keyframes arrivalPop {
      0%  { transform:translate(-50%,-50%) scale(0.85); opacity:0; }
      70% { transform:translate(-50%,-50%) scale(1.04); }
      100%{ transform:translate(-50%,-50%) scale(1);    opacity:1; }
    }
    .cnav-btn { transition: filter 0.2s; }
    .cnav-btn:hover { filter: brightness(1.18); }
  `;
  document.head.appendChild(s);
};