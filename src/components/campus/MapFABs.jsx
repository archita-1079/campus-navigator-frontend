export default function MapFABs({
  routeReady,
  navigating,
  arrived,
  previewCollapsed,
  showStepsPanel,
  directions,
  onReCenter,
  onResetBearing,
  onToggleSteps,
  mapInstance,
}) {
  const bottomOffset =
    (routeReady || navigating) && !arrived ? (previewCollapsed ? 70 : 180) : 80;

  return (
    <div
      style={{
        position: "absolute",
        right: 12,
        bottom: bottomOffset,
        zIndex: 23,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        transition: "bottom 0.25s ease",
      }}
    >
      <button
        className="cnav-btn"
        onClick={onReCenter}
        style={{
          width: 44,
          height: 44,
          borderRadius: "50%",
          background: "rgba(14,14,14,0.96)",
          border: "1px solid #2a2a2a",
          color: "#4285F4",
          fontSize: 20,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
        }}
      >
        ⊕
      </button>

      {navigating && (
        <button
          className="cnav-btn"
          onClick={() => {
            const m = mapInstance.current;
            if (m) m.easeTo({ bearing: 0, pitch: 0, duration: 600 });
          }}
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            background: "rgba(14,14,14,0.96)",
            border: "1px solid #2a2a2a",
            color: "#ea4335",
            fontSize: 18,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
          }}
        >
          🧭
        </button>
      )}

      {(routeReady || navigating) && directions.length > 0 && !arrived && (
        <button
          className="cnav-btn"
          onClick={onToggleSteps}
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            background: showStepsPanel ? "#4285F4" : "rgba(14,14,14,0.96)",
            border: "1px solid #2a2a2a",
            color: showStepsPanel ? "#fff" : "#4285F4",
            fontSize: 18,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
          }}
        >
          ☰
        </button>
      )}
    </div>
  );
}