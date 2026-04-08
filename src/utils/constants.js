export const API_ADMIN_BASE = `${import.meta.env.VITE_API_URL}/api/v1/admin`;
export const API_USER_BASE = `${import.meta.env.VITE_API_URL}/api/v1/user`;

export const NODE_TYPES = [
  "BUILDING",
  "ENTRANCE",
  "JUNCTION",
  "CANTEEN",
  "WASHROOM",
  "PARKING",
  "LIBRARY",
  "SPORTS",
  "MEDICAL",
  "ATM",
  "GATE",
  "GARDEN",
  "HOSTEL",
  "LAB",
  "AUDITORIUM",
  "ADMIN",
  "SHOP",
  "BUS_STOP",
  "OTHER",
];
export const EDGE_TYPES = [
  "WALKWAY",
  "ROAD",
  "STAIRS",
  "RAMP",
  "INDOOR",
  "BRIDGE",
];

export const NODE_CFG = {
  BUILDING: { color: "#3b82f6", bg: "#1d4ed8", icon: "🏛" },
  ENTRANCE: { color: "#10b981", bg: "#065f46", icon: "🚪" },
  PARKING: { color: "#f59e0b", bg: "#78350f", icon: "🅿" },
  FACILITY: { color: "#a78bfa", bg: "#4c1d95", icon: "⚙" },
  LANDMARK: { color: "#f472b6", bg: "#831843", icon: "📍" },
  JUNCTION: { color: "#94a3b8", bg: "#1e293b", icon: "✦" },
  DEFAULT: { color: "#60a5fa", bg: "#1e3a5f", icon: "●" },
};

export const EDGE_CFG = {
  ROAD: { color: "#64748b", weight: 5 },
  PATHWAY: { color: "#0ea5e9", weight: 3, dash: "8 6" },
  INDOOR: { color: "#8b5cf6", weight: 2, dash: "4 4" },
  ACCESSIBLE: { color: "#10b981", weight: 3 },
  DEFAULT: { color: "#475569", weight: 3 },
};
