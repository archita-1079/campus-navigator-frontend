export default function ArrivalOverlay({ destinationName, onDone }) {
  return (
    <div
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        zIndex: 30,
        animation: "arrivalPop 0.4s ease",
        transform: "translate(-50%,-50%)",
        background: "rgba(10,10,10,0.97)",
        border: "2px solid #34a853",
        borderRadius: 20,
        padding: "28px 40px",
        textAlign: "center",
        boxShadow: "0 12px 48px rgba(0,0,0,0.8)",
      }}
    >
      <div style={{ fontSize: 48 }}>🏁</div>
      <div style={{ fontSize: 21, fontWeight: 700, color: "#34a853", marginTop: 8 }}>
        You have arrived!
      </div>
      <div style={{ fontSize: 13, color: "#777", marginTop: 4 }}>{destinationName}</div>
      <button
        className="cnav-btn"
        onClick={onDone}
        style={{
          marginTop: 16,
          padding: "10px 28px",
          background: "#34a853",
          color: "#fff",
          border: "none",
          borderRadius: 10,
          cursor: "pointer",
          fontWeight: 700,
          fontSize: 14,
        }}
      >
        Done
      </button>
    </div>
  );
}