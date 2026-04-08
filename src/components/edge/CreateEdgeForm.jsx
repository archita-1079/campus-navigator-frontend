import { useState } from "react";
import { EDGE_TYPES,API_ADMIN_BASE } from "../../utils/constants";
import { useGPS } from "../../hooks/useGPS";
import axios from "axios";

function CreateEdgeForm({ onCreated, toast, nodes }) {
  const gps = useGPS();
  const [form, setForm] = useState({
    sourceNodeId: "",
    destinationNodeId: "",
    edgeType: "WALKWAY",
    isAccessible: true,
    isBidirectional: true,
    active: true,
    description: "",
  });
  const [waypoints, setWaypoints] = useState([]);
  const [loading, setLoading] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const addWaypointGPS = () => {
    gps.acquire(
      (c) => {
        setWaypoints((w) => [
          ...w,
          { latitude: c.lat, longitude: c.lng, altitude: null },
        ]);
        toast.success(`Waypoint ${waypoints.length + 1} added`);
      },
      (e) => toast.error("GPS error: " + e),
    );
  };

  const removeWaypoint = (i) =>
    setWaypoints((w) => w.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (!form.sourceNodeId || !form.destinationNodeId) {
      toast.error("Source and destination node IDs are required");
      return;
    }
    setLoading(true);
    try {
      const body = {
        sourceNodeId: parseInt(form.sourceNodeId),
        destinationNodeId: parseInt(form.destinationNodeId),
        edgeType: form.edgeType,
        isAccessible: form.isAccessible,
        isBidirectional: form.isBidirectional,
        active: form.active,
        description: form.description || undefined,
        waypoints: waypoints.length > 0 ? waypoints : undefined,
      };
      const res = await axios.post(`${API_ADMIN_BASE}/edge`, body, {
        headers: {
          'Content-Type': 'application/json'
        }
      })
      if (res.data.success) {
        toast.success("Edge created — ID: " + res.data.data.id);
        onCreated();
        setForm({
          sourceNodeId: "",
          destinationNodeId: "",
          edgeType: "WALKWAY",
          isAccessible: true,
          isBidirectional: true,
          active: true,
          description: "",
        });
        setWaypoints([]);
      } else toast.error(res.data.data.message || "Failed to create edge");
    } catch (e) {
      toast.error("Network error: " + e.message);
    }
    setLoading(false);
  };

  return (
    <div className="card">
      <div className="card-title">◈ Create Edge</div>
      <div className="form-grid">
        <div className="form-group">
          <label className="form-label">Source Node *</label>
          <div className="select-wrap">
            <select
              className="form-select"
              value={form.sourceNodeId}
              onChange={(e) => set("sourceNodeId", e.target.value)}
            >
              <option value="">— Select Source —</option>
              {nodes?.map((n) => (
                <option key={n.id} value={n.id}>
                  [{n.id}] {n.name || n.nodeType}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Destination Node *</label>
          <div className="select-wrap">
            <select
              className="form-select"
              value={form.destinationNodeId}
              onChange={(e) => set("destinationNodeId", e.target.value)}
            >
              <option value="">— Select Destination —</option>
              {nodes?.map((n) => (
                <option key={n.id} value={n.id}>
                  [{n.id}] {n.name || n.nodeType}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Edge Type *</label>
          <div className="select-wrap">
            <select
              className="form-select"
              value={form.edgeType}
              onChange={(e) => set("edgeType", e.target.value)}
            >
              {EDGE_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Description</label>
          <input
            className="form-input"
            placeholder="Optional..."
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </div>

        <div className="form-group full">
          <label className="form-label">Options</label>
          <div className="toggle-row">
            {[
              ["isAccessible", "Accessible"],
              ["isBidirectional", "Bidirectional"],
              ["active", "Active"],
            ].map(([k, l]) => (
              <label key={k} className="toggle-item">
                <input
                  type="checkbox"
                  checked={form[k]}
                  onChange={(e) => set(k, e.target.checked)}
                />
                <div className="toggle-box" />
                <span className="toggle-label">{l}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="form-group full">
          <label className="form-label">
            Path Waypoints{" "}
            <span style={{ color: "var(--text3)" }}>
              — optional GPS points along the route
            </span>
          </label>
          <div className="waypoint-list">
            {waypoints.map((wp, i) => (
              <div key={i} className="waypoint-item">
                <span>
                  WP{i + 1} — {wp.latitude.toFixed(6)},{" "}
                  {wp.longitude.toFixed(6)}
                </span>
                <button
                  className="waypoint-remove"
                  onClick={() => removeWaypoint(i)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            className={`btn-waypoint${gps.acquiring ? " acquiring" : ""}`}
            onClick={addWaypointGPS}
            disabled={gps.acquiring}
          >
            {gps.acquiring
              ? "⌖ Acquiring GPS..."
              : "⌖ Add Waypoint at Current Location"}
          </button>
        </div>
      </div>
      <div className="btn-row">
        <button
          className="btn btn-secondary"
          onClick={() => {
            setForm({
              sourceNodeId: "",
              destinationNodeId: "",
              edgeType: "WALKWAY",
              isAccessible: true,
              isBidirectional: true,
              active: true,
              description: "",
            });
            setWaypoints([]);
          }}
        >
          Reset
        </button>
        <button className="btn btn-primary" onClick={submit} disabled={loading}>
          {loading ? "Creating..." : "Create Edge"}
        </button>
      </div>
    </div>
  );
}
export default CreateEdgeForm;