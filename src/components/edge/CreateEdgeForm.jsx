import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { EDGE_TYPES, API_ADMIN_BASE } from "../../utils/constants";
import { useGPS } from "../../hooks/useGPS";
import axios from "axios";

function CreateEdgeForm({ onCreated, toast, nodes }) {
  const gps = useGPS();
  const { id } = useParams();
  const navigate = useNavigate();
  const isEditMode = !!id;

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

  // Fetch existing edge data if in edit mode
  useEffect(() => {
    if (isEditMode) {
      const fetchEdge = async () => {
        try {
          const res = await axios.get(`${API_ADMIN_BASE}/edge/${id}`, {
            headers: {
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
          });
          if (res.data.success) {
            const data = res.data.data;
            setForm({
              sourceNodeId: data.sourceNodeId || "",
              destinationNodeId: data.targetNodeId || "", // Depending on your backend response structure
              edgeType: data.edgeType || "WALKWAY",
              isAccessible: data.accessible ?? true,
              isBidirectional: data.bidirectional ?? true,
              active: data.active ?? true,
              description: data.description || "",
            });
            // Ensure waypoints format matches what the form expects
            if (data.waypoints) {
              setWaypoints(
                data.waypoints.map((wp) => ({
                  latitude: wp.latitude,
                  longitude: wp.longitude,
                  altitude: wp.altitude || null,
                })),
              );
            }
          }
        } catch (e) {
          toast.error("Failed to load edge data.");
        }
      };
      fetchEdge();
    }
  }, [id]);

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

      const url = isEditMode
        ? `${API_ADMIN_BASE}/edge/${id}`
        : `${API_ADMIN_BASE}/edge`;
      const method = isEditMode ? "put" : "post";

      const res = await axios[method](url, body, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });

      if (res.data.success) {
        toast.success(
          `Edge ${isEditMode ? "updated" : "created"} — ID: ${res.data.data.id}`,
        );
        onCreated();
        if (isEditMode) {
          navigate("/list"); // Redirect back to list
        } else {
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
        }
      } else
        toast.error(
          res.data.data.message ||
            `Failed to ${isEditMode ? "update" : "create"} edge`,
        );
    } catch (e) {
      toast.error("Network error: " + e.message);
    }
    setLoading(false);
  };

  return (
    <div className="card">
      <div className="card-title">◈ {isEditMode ? "Edit" : "Create"} Edge</div>
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
            if (isEditMode) navigate("/list");
            else {
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
            }
          }}
        >
          {isEditMode ? "Cancel" : "Reset"}
        </button>
        <button className="btn btn-primary" onClick={submit} disabled={loading}>
          {loading ? "Saving..." : isEditMode ? "Update Edge" : "Create Edge"}
        </button>
      </div>
    </div>
  );
}
export default CreateEdgeForm;
