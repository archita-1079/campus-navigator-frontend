import { useGPS } from "../../hooks/useGPS";
import { useState } from "react";
import {NODE_TYPES,API_ADMIN_BASE} from "../../utils/constants"
import axios from "axios";

const CreateNodeForm = ({ onCreated, toast, nodes }) => {
    const gps = useGPS();
    const [form, setForm] = useState({
        name: "", nodeType: "BUILDING", latitude: "", longitude: "",
        floor: "", parentNodeId: "", description: "", extraInfo: "",
        isAccessible: false
    });
    const [loading, setLoading] = useState(false);

    const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

    const fillGPS = () => {
        gps.acquire(
            c => { set("latitude", c.lat.toFixed(7)); set("longitude", c.lng.toFixed(7)); toast.success("GPS acquired"); },
            e => toast.error("GPS error: " + e)
        );
    };

    const submit = async () => {
        if (!form.nodeType || !form.latitude || !form.longitude) {
            toast.error("Node type, latitude & longitude are required"); return;
        }
        setLoading(true);
        try {
            const body = {
                name: form.name || undefined,
                nodeType: form.nodeType,
                latitude: parseFloat(form.latitude),
                longitude: parseFloat(form.longitude),
                floor: form.floor ? parseInt(form.floor) : undefined,
                parentNodeId: form.parentNodeId ? parseInt(form.parentNodeId) : undefined,
                description: form.description || undefined,
                extraInfo: form.extraInfo || undefined,
                isAccessible: form.isAccessible
            };
            
            const res = await axios.post(`${API_ADMIN_BASE}/node`, body, {
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            if (res.data.success) {
                toast.success("Node created — ID: " + res.data.data.id);
                onCreated();
                setForm({ name: "", nodeType: "BUILDING", latitude: "", longitude: "", floor: "", parentNodeId: "", description: "", extraInfo: "", isAccessible: false });
            } else {
                toast.error(res.data.data.message || "Failed to create node");
            }
        } catch (e) { toast.error("Network error: " + e.message); }
        setLoading(false);
    };

    return (
        <div className="card">
            <div className="card-title">◈ Create Node</div>
            <div className="form-grid">
                <div className="form-group">
                    <label className="form-label">Name</label>
                    <input className="form-input" placeholder="e.g. Main Building" value={form.name} onChange={e => set("name", e.target.value)} />
                </div>
                <div className="form-group">
                    <label className="form-label">Node Type *</label>
                    <div className="select-wrap">
                        <select className="form-select" value={form.nodeType} onChange={e => set("nodeType", e.target.value)}>
                            {NODE_TYPES.map(t => <option key={t}>{t}</option>)}
                        </select>
                    </div>
                </div>

                <div className="form-group full">
                    <label className="form-label">GPS Coordinates *</label>
                    <div className="gps-row">
                        <input className="form-input" placeholder="Latitude" value={form.latitude} onChange={e => set("latitude", e.target.value)} />
                        <input className="form-input" placeholder="Longitude" value={form.longitude} onChange={e => set("longitude", e.target.value)} />
                        <button className={`btn-gps${gps.acquiring ? " acquiring" : ""}`} onClick={fillGPS} disabled={gps.acquiring}>
                            {gps.acquiring ? "⌖ Acquiring..." : "⌖ Use GPS"}
                        </button>
                    </div>
                    <div className="hint">Click "Use GPS" to auto-fill from your device location</div>
                </div>

                <div className="form-group">
                    <label className="form-label">Floor</label>
                    <input className="form-input" placeholder="0 = ground" type="number" value={form.floor} onChange={e => set("floor", e.target.value)} />
                </div>
                <div className="form-group">
                    <label className="form-label">Parent Node ID</label>
                    <div className="select-wrap">
                        <select className="form-select" value={form.parentNodeId} onChange={e => set("parentNodeId", e.target.value)}>
                            <option value="">— None —</option>
                            {nodes?.map(n => <option key={n.id} value={n.id}>[{n.id}] {n.name || n.nodeType}</option>)}
                        </select>
                    </div>
                </div>

                <div className="form-group">
                    <label className="form-label">Description</label>
                    <textarea className="form-textarea" placeholder="Optional description..." value={form.description} onChange={e => set("description", e.target.value)} />
                </div>
                <div className="form-group">
                    <label className="form-label">Extra Info</label>
                    <textarea className="form-textarea" placeholder="Additional metadata..." value={form.extraInfo} onChange={e => set("extraInfo", e.target.value)} />
                </div>

                <div className="form-group full">
                    <label className="form-label">Options</label>
                    <div className="toggle-row">
                        <label className="toggle-item">
                            <input type="checkbox" checked={form.isAccessible} onChange={e => set("isAccessible", e.target.checked)} />
                            <div className="toggle-box" />
                            <span className="toggle-label">Wheelchair Accessible</span>
                        </label>
                    </div>
                </div>
            </div>
            <div className="btn-row">
                <button className="btn btn-secondary" onClick={() => setForm({ name: "", nodeType: "BUILDING", latitude: "", longitude: "", floor: "", parentNodeId: "", description: "", extraInfo: "", isAccessible: false })}>Reset</button>
                <button className="btn btn-primary" onClick={submit} disabled={loading}>{loading ? "Creating..." : "Create Node"}</button>
            </div>
        </div>
    );
}

export default CreateNodeForm;