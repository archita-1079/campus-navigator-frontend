import heroImage from "../assets/hero.png";

export default function CampusGraph() {
  return (
    <div className="campus-graph-container">
      <div className="page-header">
        <div className="page-title">Campus Graph</div>
        <div className="page-subtitle">Main isometric campus view</div>
      </div>
      <div
        className="card"
        style={{
          display: "flex",
          justifyContent: "center",
          padding: "48px",
          background: "var(--bg2)",
        }}
      >
        <img
          src={heroImage}
          alt="Campus Platform Graph"
          style={{
            maxWidth: "100%",
            height: "auto",
            filter: "drop-shadow(0 10px 20px rgba(0,0,0,0.5))",
          }}
        />
      </div>
    </div>
  );
}
