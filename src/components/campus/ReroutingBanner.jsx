export default function ReroutingBanner() {
  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        left: 12,
        right: 12,
        zIndex: 26,
        marginTop: 50,
        background: "rgba(10,10,10,0.97)",
        border: "2.5px solid #fbbc04",
        borderRadius: 18,
        padding: "13px 16px",
        display: "flex",
        alignItems: "center",
        gap: 13,
        boxShadow: "0 6px 28px rgba(0,0,0,0.7)",
        backdropFilter: "blur(14px)",
        animation: "reroutePulse 1s ease infinite",
      }}
    >
      <div
        style={{
          width: 50,
          height: 50,
          borderRadius: 13,
          background: "#fbbc0418",
          border: "2px solid #fbbc04",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 26,
          flexShrink: 0,
        }}
      >
        🔄
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#fbbc04" }}>
          Recalculating…
        </div>
        <div style={{ fontSize: 12, color: "#888", marginTop: 3 }}>
          Finding best route
        </div>
      </div>
    </div>
  );
}