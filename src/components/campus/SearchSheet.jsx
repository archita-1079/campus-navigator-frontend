import { getDisplayName } from "../../utils/graph";

function ResultsList({ results, onSelect }) {
  if (!results.length) return null;
  return (
    <ul
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        right: 0,
        background: "#1a1a1a",
        listStyle: "none",
        margin: 0,
        padding: 0,
        maxHeight: 160,
        overflowY: "auto",
        border: "1px solid #333",
        borderRadius: "0 0 10px 10px",
        zIndex: 30,
      }}
    >
      {results.map((n) => {
        const name = getDisplayName(n);
        const meta = [n.parentNodeName, n.floor > 0 ? `Floor ${n.floor}` : null]
          .filter(Boolean)
          .join(" · ");
        return (
          <li
            key={n.id}
            style={{ padding: "10px 12px", cursor: "pointer", borderBottom: "1px solid #222" }}
            onTouchStart={(e) => (e.currentTarget.style.background = "#2a2a2a")}
            onTouchEnd={(e) => (e.currentTarget.style.background = "transparent")}
            onClick={() => onSelect(n)}
          >
            <div style={{ fontSize: 13, color: "#fff" }}>{name}</div>
            {meta && <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{meta}</div>}
          </li>
        );
      })}
    </ul>
  );
}

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  marginTop: 5,
  background: "#1a1a1a",
  color: "white",
  border: "1px solid #333",
  borderRadius: 10,
  boxSizing: "border-box",
  fontSize: 14,
  outline: "none",
};

const labelStyle = {
  fontSize: 10,
  color: "#666",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};

export default function SearchSheet({
  sourceQuery,
  destQuery,
  sourceResults,
  destResults,
  selectedSource,
  selectedDest,
  isSearching,
  onSourceChange,
  onDestChange,
  onSelectSource,
  onSelectDest,
  onFindRoute,
  onClose,
}) {
  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 28,
          background: "rgba(0,0,0,0.4)",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 29,
          background: "#0e0e0e",
          borderRadius: "20px 20px 0 0",
          padding: "0 0 calc(16px + env(safe-area-inset-bottom))",
          boxShadow: "0 -8px 40px rgba(0,0,0,0.8)",
          animation: "sheetIn 0.35s cubic-bezier(0.32,0.72,0,1)",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 8px" }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: "#333" }} />
        </div>

        <div style={{ padding: "0 16px 16px", overflowY: "auto" }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: "#fff" }}>
            🗺️ Navigate Campus
          </h3>

          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>From</label>
            <div style={{ position: "relative" }}>
              <input
                type="text"
                placeholder="Leave empty to use GPS…"
                value={sourceQuery}
                onChange={(e) => onSourceChange(e.target.value)}
                style={inputStyle}
              />
              {sourceResults.length > 0 && !selectedSource && (
                <ResultsList results={sourceResults} onSelect={onSelectSource} />
              )}
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>To</label>
            <div style={{ position: "relative" }}>
              <input
                type="text"
                placeholder="Search destination…"
                value={destQuery}
                onChange={(e) => onDestChange(e.target.value)}
                style={inputStyle}
              />
              {destResults.length > 0 && !selectedDest && (
                <ResultsList results={destResults} onSelect={onSelectDest} />
              )}
            </div>
          </div>

          <button
            className="cnav-btn"
            onClick={onFindRoute}
            disabled={isSearching}
            style={{
              width: "100%",
              padding: "14px 0",
              background: isSearching ? "#2a4a8a" : "#4285F4",
              color: "#fff",
              border: "none",
              borderRadius: 14,
              cursor: isSearching ? "not-allowed" : "pointer",
              fontWeight: 700,
              fontSize: 16,
            }}
          >
            {isSearching ? "Calculating…" : "Find Route"}
          </button>
        </div>
      </div>
    </>
  );
}