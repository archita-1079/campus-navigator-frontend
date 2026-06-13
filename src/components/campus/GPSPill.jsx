export default function GPSPill({ coords, gpsError, routeReady, navigating }) {
  if (routeReady || navigating) return null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 24,
        left: 12,
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "6px 12px",
        background: coords ? "rgba(52,168,83,0.12)" : "rgba(234,67,53,0.1)",
        borderRadius: 20,
        border: `1px solid ${coords ? "#34a85340" : "#ea433540"}`,
        fontSize: 11,
        color: coords ? "#34a853" : "#ea4335",
        backdropFilter: "blur(8px)",
      }}
    >
      <div
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: coords ? "#34a853" : "#ea4335",
          boxShadow: coords ? "0 0 6px #34a853" : "none",
          animation: coords ? "gpsPulse 2s ease-out infinite" : "none",
        }}
      />
      {coords
        ? `GPS · ±${Math.round(coords.accuracy ?? 0)} m`
        : gpsError
          ? "GPS off"
          : "Acquiring…"}
    </div>
  );
}