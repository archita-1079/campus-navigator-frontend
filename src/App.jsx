import CreateNodeForm from "./components/node/CreateNodeForm";
import CreateEdgeForm from "./components/edge/CreateEdgeForm";
import NodeList from "./components/node/NodeList";
import EdgeList from "./components/edge/EdgeList";
import useToasts from "./hooks/useToasts";
import { useState, useCallback, useEffect } from "react";
import { API_BASE, NODE_TYPES } from "./utils/constants";
import axios from "axios";

export default function App() {
  const [page, setPage] = useState("dashboard");
  const [tab, setTab] = useState("nodes");
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [nodesLoading, setNodesLoading] = useState(false);
  const [edgesLoading, setEdgesLoading] = useState(false);
  const { toasts, error, success } = useToasts();
  const [gpsStatus, setGpsStatus] = useState(false);

  const fetchNodes = useCallback(async () => {
    setNodesLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/nodes`);
      setNodes(res.data.data || []);
    } catch {
      setNodes([]);
    }
    setNodesLoading(false);
  }, []);

  const fetchEdges = useCallback(async () => {
    setEdgesLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/edges`);
      setEdges(res.data.data || []);
    } catch {
      setEdges([]);
    }
    setEdgesLoading(false);
  }, []);

  useEffect(() => {
    fetchNodes();
    fetchEdges();
    if (navigator.geolocation) setGpsStatus(true);
  }, []);

  const navItems = [
    { id: "dashboard", icon: "◈", label: "Dashboard" },
    { id: "nodes", icon: "⬡", label: "Nodes" },
    { id: "edges", icon: "⤢", label: "Edges" },
    { id: "list", icon: "≡", label: "View All" },
  ];

  return (
    <>
      <div className="toast-container">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast ${toast.type} ${toast.exiting ? "exiting" : ""}`}
            onClick={() => remove(toast.id)}
          >
            {toast.msg}
          </div>
        ))}
      </div>
      <div className="app">
        <header className="header">
          <div className="header-logo">
            <div className="header-dot" />
            Campus Navigator
          </div>
          <div className="gps-badge">
            <div className={`gps-dot${gpsStatus ? "" : " inactive"}`} />
            {gpsStatus ? "GPS READY" : "GPS UNAVAILABLE"}
          </div>
        </header>

        <div className="layout">
          <nav className="sidebar">
            <div className="sidebar-section">
              <div className="sidebar-label">Navigation</div>
              {navItems.map((item) => (
                <button
                  key={item.id}
                  className={`nav-item${page === item.id ? " active" : ""}`}
                  onClick={() => setPage(item.id)}
                >
                  <span className="nav-icon">{item.icon}</span> {item.label}
                </button>
              ))}
            </div>
          </nav>

          <main className="main">
            {page === "dashboard" && (
              <>
                <div className="page-header">
                  <div className="page-title">System Dashboard</div>
                  <div className="page-subtitle">
                    Campus navigation graph overview
                  </div>
                </div>
                <div className="stats-row">
                  <div className="stat-card">
                    <div className="stat-val">{nodes.length}</div>
                    <div className="stat-label">Total Nodes</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-val">{edges.length}</div>
                    <div className="stat-label">Total Edges</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-val">
                      {nodes?.filter((n) => n.accessible).length}
                    </div>
                    <div className="stat-label">Accessible Nodes</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-val">
                      {edges?.filter((e) => e.bidirectional).length}
                    </div>
                    <div className="stat-label">Bidirectional Edges</div>
                  </div>
                </div>

                <div className="card">
                  <div className="card-title">◈ Quick Actions</div>
                  <div
                    style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}
                  >
                    <button
                      className="btn btn-primary"
                      onClick={() => setPage("nodes")}
                    >
                      + Create Node
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => setPage("edges")}
                    >
                      + Create Edge
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => {
                        fetchNodes();
                        fetchEdges();
                      }}
                    >
                      ↻ Refresh Data
                    </button>
                  </div>
                </div>

                <div className="card">
                  <div className="card-title">◈ Node Type Distribution</div>
                  <div
                    style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}
                  >
                    {NODE_TYPES.map((t) => {
                      const count = nodes.filter(
                        (n) => n.nodeType === t,
                      ).length;
                      return (
                        <div
                          key={t}
                          style={{
                            background: "var(--bg3)",
                            border: "1px solid var(--border2)",
                            borderRadius: "3px",
                            padding: "10px 16px",
                            minWidth: "100px",
                          }}
                        >
                          <div
                            style={{
                              fontFamily: "var(--mono)",
                              fontSize: "22px",
                              fontWeight: "600",
                              color: "var(--accent)",
                            }}
                          >
                            {count}
                          </div>
                          <div
                            style={{
                              fontFamily: "var(--mono)",
                              fontSize: "10px",
                              color: "var(--text3)",
                              textTransform: "uppercase",
                              marginTop: "2px",
                            }}
                          >
                            {t}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            {page === "nodes" && (
              <>
                <div className="page-header">
                  <div className="page-title">Create Node</div>
                  <div className="page-subtitle">
                    Add a new campus location to the navigation graph
                  </div>
                </div>
                <CreateNodeForm
                  onCreated={fetchNodes}
                  toast={{ error, success }}
                  nodes={nodes}
                />
              </>
            )}

            {page === "edges" && (
              <>
                <div className="page-header">
                  <div className="page-title">Create Edge</div>
                  <div className="page-subtitle">
                    Connect two nodes with a navigable path
                  </div>
                </div>
                <CreateEdgeForm
                  onCreated={fetchEdges}
                  toast={{ error, success }}
                  nodes={nodes}
                />
              </>
            )}

            {page === "list" && (
              <>
                <div className="page-header">
                  <div className="page-title">View All</div>
                  <div className="page-subtitle">
                    Browse the full navigation graph
                  </div>
                </div>
                <div className="section-tabs">
                  <button
                    className={`tab-btn${tab === "nodes" ? " active" : ""}`}
                    onClick={() => setTab("nodes")}
                  >
                    ⬡ Nodes ({nodes.length})
                  </button>
                  <button
                    className={`tab-btn${tab === "edges" ? " active" : ""}`}
                    onClick={() => setTab("edges")}
                  >
                    ⤢ Edges ({edges.length})
                  </button>
                </div>
                {tab === "nodes" && (
                  <NodeList
                    nodes={nodes}
                    loading={nodesLoading}
                    onRefresh={fetchNodes}
                  />
                )}
                {tab === "edges" && (
                  <EdgeList
                    edges={edges}
                    loading={edgesLoading}
                    onRefresh={fetchEdges}
                  />
                )}
              </>
            )}
          </main>
        </div>
      </div>
    </>
  );
}