import { useRef, useEffect } from "react";
import { DIR } from "../../utils/graph";

export default function StepsPanel({
  directions,
  stepIdx,
  navigating,
  arrived,
  selectedSource,
  selectedDest,
  routeInfo,
  isPreviewMode,
  previewCollapsed,
  onClose,
}) {
  const stepsListRef = useRef(null);

  useEffect(() => {
    if (!stepsListRef.current) return;
    const active = stepsListRef.current.querySelector("[data-active='true']");
    if (active) active.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [stepIdx]);

  return (
    <div
      style={{
        position: "absolute",
        bottom: previewCollapsed ? 62 : navigating ? 170 : 160,
        left: 0,
        right: 0,
        zIndex: 22,
        background: "rgba(10,10,10,0.98)",
        borderRadius: "20px 20px 0 0",
        boxShadow: "0 -6px 32px rgba(0,0,0,0.75)",
        border: "1px solid #1e1e1e",
        display: "flex",
        flexDirection: "column",
        maxHeight: navigating ? "52vh" : "60vh",
        transition: "bottom 0.25s ease",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "14px 16px 10px",
          borderBottom: "1px solid #1e1e1e",
          flexShrink: 0,
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>
            {navigating ? "Directions" : "Route Preview"}
          </div>
          <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>
            {selectedSource?.name ?? "Current Location"} → {selectedDest?.name}
            {routeInfo && ` · ${routeInfo.time} min · ${routeInfo.distance} m`}
          </div>
        </div>
        <button
          onClick={onClose}
          className="cnav-btn"
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: "#1e1e1e",
            border: "1px solid #333",
            color: "#888",
            fontSize: 16,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
          aria-label="Close directions"
        >
          ✕
        </button>
      </div>

      <div ref={stepsListRef} style={{ overflowY: "auto", padding: "8px 12px 4px", flex: 1 }}>
        {directions.map((step, i) => {
          const di = DIR[step.type] || DIR.straight;
          const isActive = navigating && i === stepIdx;
          const isDone = navigating && i < stepIdx;
          return (
            <div
              key={i}
              data-active={isActive ? "true" : "false"}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 10px",
                borderRadius: 10,
                marginBottom: 3,
                background: isActive ? `${di.color}18` : "transparent",
                border: `1px solid ${isActive ? di.color + "55" : "transparent"}`,
                opacity: isDone ? 0.35 : 1,
                transition: "opacity 0.3s, background 0.3s",
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  flexShrink: 0,
                  background: isActive ? `${di.color}28` : "#1a1a1a",
                  border: `1px solid ${isActive ? di.color + "66" : "#2a2a2a"}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 16,
                  transition: "background 0.3s",
                }}
              >
                {isDone ? "✓" : di.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: isActive ? 700 : 400,
                    color: isActive ? di.color : isDone ? "#555" : "#ccc",
                    transition: "color 0.3s",
                  }}
                >
                  {di.label}
                </div>
                {step.distance > 0 && (
                  <div style={{ fontSize: 11, color: isDone ? "#444" : "#555", marginTop: 2 }}>
                    {step.distance} m
                  </div>
                )}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: isActive ? di.color : "#333",
                  fontWeight: isActive ? 700 : 400,
                  flexShrink: 0,
                  minWidth: 16,
                  textAlign: "right",
                }}
              >
                {i + 1}
              </div>
            </div>
          );
        })}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "9px 10px",
            borderRadius: 10,
            marginBottom: 8,
            background: arrived ? "rgba(52,168,83,0.15)" : "rgba(52,168,83,0.06)",
            border: `1px solid ${arrived ? "rgba(52,168,83,0.5)" : "rgba(52,168,83,0.2)"}`,
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              flexShrink: 0,
              background: "rgba(52,168,83,0.15)",
              border: "1px solid rgba(52,168,83,0.4)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
            }}
          >
            🏁
          </div>
          <div style={{ fontSize: 13, color: "#34a853", fontWeight: 600 }}>
            Arrive at {selectedDest?.name}
          </div>
        </div>
      </div>

      {isPreviewMode && !navigating && (
        <div
          style={{
            padding: "10px 14px calc(12px + env(safe-area-inset-bottom))",
            borderTop: "1px solid #1a1a1a",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              background: "rgba(251,188,4,0.08)",
              border: "1px solid rgba(251,188,4,0.2)",
              borderRadius: 10,
              padding: "9px 12px",
              display: "flex",
              alignItems: "center",
              gap: 9,
            }}
          >
            <span style={{ fontSize: 18 }}>🚶</span>
            <div style={{ fontSize: 12, color: "#fbbc04" }}>
              Walk to <strong>{selectedSource?.name}</strong> to begin navigation
            </div>
          </div>
        </div>
      )}
    </div>
  );
}