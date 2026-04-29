import React from "react";
import axios from "axios";
import { API_ADMIN_BASE } from "../../utils/constants";
import { useNavigate } from "react-router-dom";

function EdgeList({ edges, loading, onRefresh }) {
  const navigate = useNavigate();

  return (
    <div className="card">
      <div className="list-header">
        <h3>
          All Edges{" "}
          <span style={{ color: "var(--text3)", fontWeight: 400 }}>
            ({edges?.length})
          </span>
        </h3>
        <button className="refresh-btn" onClick={onRefresh}>
          ↻ Refresh
        </button>
      </div>
      {loading ? (
        <div className="loading">
          <div className="spinner" /> Fetching edges...
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Source</th>
                <th>Target</th>
                <th>Type</th>
                <th>Distance</th>
                <th>Waypoints</th>
                <th>Bidir</th>
                <th>Accessible</th>
                <th>Active</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {edges?.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    style={{
                      textAlign: "center",
                      color: "var(--text3)",
                      padding: "32px",
                    }}
                  >
                    No edges found
                  </td>
                </tr>
              ) : (
                edges?.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <span className="badge badge-edge">#{e.id}</span>
                    </td>
                    <td className="td-name">
                      {e.sourceNodeName || `Node #${e.sourceNodeId}`}
                    </td>
                    <td className="td-name">
                      {e.targetNodeName || `Node #${e.targetNodeId}`}
                    </td>
                    <td>
                      <span className="badge badge-type">{e.edgeType}</span>
                    </td>
                    <td>
                      {e.distance != null ? (
                        `${e.distance.toFixed(1)}m`
                      ) : (
                        <span style={{ color: "var(--text3)" }}>—</span>
                      )}
                    </td>
                    <td>{e.waypointCount ?? 0}</td>
                    <td>
                      <span
                        className={`badge ${e.bidirectional ? "badge-yes" : "badge-no"}`}
                      >
                        {e.bidirectional ? "Y" : "N"}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`badge ${e.accessible ? "badge-yes" : "badge-no"}`}
                      >
                        {e.accessible ? "Y" : "N"}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`badge ${e.active ? "badge-yes" : "badge-no"}`}
                      >
                        {e.active ? "Y" : "N"}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button
                          style={{
                            background: "#4285F4",
                            color: "white",
                            border: "none",
                            padding: "4px 8px",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontSize: "12px",
                          }}
                          onClick={() => navigate(`/edges/edit/${e.id}`)}
                        >
                          Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default EdgeList;
