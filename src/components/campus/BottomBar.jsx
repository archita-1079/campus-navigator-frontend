export default function BottomBar({
  routeReady,
  navigating,
  arrived,
  routeInfo,
  selectedDest,
  isPreviewMode,
  showStepsPanel,
  previewCollapsed,
  onToggleCollapsed,
  onStartNavigation,
  onToggleSteps,
  onClearRoute,
}) {
  if ((!routeReady && !navigating) || arrived) return null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 20,
        background: "rgba(10,10,10,0.97)",
        borderTop: "1px solid #1a1a1a",
        backdropFilter: "blur(14px)",
        boxShadow: "0 -8px 32px rgba(0,0,0,0.6)",
        borderRadius: "16px 16px 0 0",
        overflow: "hidden",
      }}
    >
      <div
        onClick={onToggleCollapsed}
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          padding: "10px 0 6px",
          cursor: "pointer",
          gap: 6,
        }}
      >
        <div style={{ width: 36, height: 4, borderRadius: 2, background: "#333" }} />
        <span style={{ fontSize: 11, color: "#444", marginLeft: 6, userSelect: "none" }}>
          {previewCollapsed ? "▲" : "▼"}
        </span>
      </div>

      {!previewCollapsed && (
        <div style={{ padding: "0 16px calc(16px + env(safe-area-inset-bottom))" }}>
          {routeInfo && (
            <div
              style={{
                display: "flex",
                gap: 12,
                marginBottom: 14,
                justifyContent: "center",
              }}
            >
              <div style={{ textAlign: "center" }}>
                <div
                  style={{
                    fontSize: 28,
                    fontWeight: 800,
                    lineHeight: 1,
                    color: navigating ? "#34a853" : "#4285F4",
                  }}
                >
                  {routeInfo.time}
                </div>
                <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>min walk</div>
              </div>
              <div style={{ width: 1, background: "#2a2a2a" }} />
              <div style={{ textAlign: "center" }}>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 600,
                    color: "#bbb",
                    lineHeight: 1,
                  }}
                >
                  {routeInfo.distance} m
                </div>
                <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>
                  {navigating ? "remaining" : "total"}
                </div>
              </div>
              {selectedDest && (
                <>
                  <div style={{ width: 1, background: "#2a2a2a" }} />
                  <div style={{ textAlign: "center", flex: 1 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#ddd",
                        lineHeight: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {selectedDest.name}
                    </div>
                    <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>destination</div>
                  </div>
                </>
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            {!navigating ? (
              <>
                {isPreviewMode ? (
                  <button
                    className="cnav-btn"
                    onClick={onToggleSteps}
                    style={{
                      flex: 1,
                      padding: "14px 0",
                      background: showStepsPanel ? "#1a3a6a" : "#4285F4",
                      color: "#fff",
                      border: "none",
                      borderRadius: 14,
                      cursor: "pointer",
                      fontWeight: 700,
                      fontSize: 15,
                    }}
                  >
                    ☰ {showStepsPanel ? "Hide Directions" : "Show Directions"}
                  </button>
                ) : (
                  <button
                    className="cnav-btn"
                    onClick={onStartNavigation}
                    style={{
                      flex: 1,
                      padding: "14px 0",
                      background: "#34a853",
                      color: "#fff",
                      border: "none",
                      borderRadius: 14,
                      cursor: "pointer",
                      fontWeight: 700,
                      fontSize: 16,
                    }}
                  >
                    ▶ Start Navigation
                  </button>
                )}
                <button
                  className="cnav-btn"
                  onClick={onClearRoute}
                  style={{
                    padding: "14px 18px",
                    background: "#333",
                    color: "#fff",
                    border: "none",
                    borderRadius: 14,
                    cursor: "pointer",
                    fontWeight: 700,
                    fontSize: 16,
                  }}
                >
                  ✕
                </button>
              </>
            ) : (
              <button
                className="cnav-btn"
                onClick={onClearRoute}
                style={{
                  flex: 1,
                  padding: "14px 0",
                  background: "#d93025",
                  color: "#fff",
                  border: "none",
                  borderRadius: 14,
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: 16,
                }}
              >
                ✕ End Navigation
              </button>
            )}
          </div>
        </div>
      )}

      {previewCollapsed && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0 16px calc(12px + env(safe-area-inset-bottom))",
          }}
        >
          {routeInfo && (
            <div style={{ flex: 1, display: "flex", gap: 8, alignItems: "center" }}>
              <span
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: navigating ? "#34a853" : "#4285F4",
                }}
              >
                {routeInfo.time}
                <span
                  style={{
                    fontSize: 11,
                    color: "#555",
                    fontWeight: 400,
                    marginLeft: 3,
                  }}
                >
                  min
                </span>
              </span>
              <span style={{ fontSize: 14, color: "#666" }}>·</span>
              <span style={{ fontSize: 16, fontWeight: 600, color: "#999" }}>
                {routeInfo.distance} m
              </span>
              {selectedDest && (
                <span
                  style={{
                    fontSize: 12,
                    color: "#555",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                  }}
                >
                  → {selectedDest.name}
                </span>
              )}
            </div>
          )}
          {navigating ? (
            <button
              className="cnav-btn"
              onClick={onClearRoute}
              style={{
                padding: "10px 14px",
                background: "#d93025",
                color: "#fff",
                border: "none",
                borderRadius: 12,
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 13,
                flexShrink: 0,
              }}
            >
              ✕
            </button>
          ) : isPreviewMode ? (
            <button
              className="cnav-btn"
              onClick={onToggleSteps}
              style={{
                padding: "10px 14px",
                background: "#4285F4",
                color: "#fff",
                border: "none",
                borderRadius: 12,
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 13,
                flexShrink: 0,
              }}
            >
              ☰
            </button>
          ) : (
            <button
              className="cnav-btn"
              onClick={onStartNavigation}
              style={{
                padding: "10px 14px",
                background: "#34a853",
                color: "#fff",
                border: "none",
                borderRadius: 12,
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 13,
                flexShrink: 0,
              }}
            >
              ▶ Go
            </button>
          )}
        </div>
      )}
    </div>
  );
}