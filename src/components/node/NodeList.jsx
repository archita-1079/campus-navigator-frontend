function NodeList({ nodes, loading, onRefresh }) {
    return (
        <div className="card">
            <div className="list-header">
                <h3>All Nodes <span style={{ color: "var(--text3)", fontWeight: 400 }}>({nodes?.length})</span></h3>
                <button className="refresh-btn" onClick={onRefresh}>↻ Refresh</button>
            </div>
            {loading ? <div className="loading"><div className="spinner" /> Fetching nodes...</div> : (
                <div className="table-wrap">
                    <table>
                        <thead><tr>
                            <th>ID</th><th>Name</th><th>Type</th><th>Coordinates</th>
                            <th>Floor</th><th>Parent</th><th>Accessible</th><th>Active</th>
                        </tr></thead>
                        <tbody>
                            {nodes?.length === 0 ? (
                                <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--text3)", padding: "32px" }}>No nodes found</td></tr>
                            ) : nodes?.map(n => (
                                <tr key={n.id}>
                                    <td><span className="badge badge-node">#{n.id}</span></td>
                                    <td className="td-name">{n.name || <span style={{ color: "var(--text3)" }}>—</span>}</td>
                                    <td><span className="badge badge-type">{n.nodeType}</span></td>
                                    <td className="coord">{n.latitude?.toFixed(5)}, {n.longitude?.toFixed(5)}</td>
                                    <td>{n.floor ?? <span style={{ color: "var(--text3)" }}>—</span>}</td>
                                    <td>{n.parentNodeId ? <span style={{ color: "var(--text2)" }}>#{n.parentNodeId}</span> : <span style={{ color: "var(--text3)" }}>—</span>}</td>
                                    <td><span className={`badge ${n.accessible ? "badge-yes" : "badge-no"}`}>{n.accessible ? "YES" : "NO"}</span></td>
                                    <td><span className={`badge ${n.active ? "badge-yes" : "badge-no"}`}>{n.active ? "YES" : "NO"}</span></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

export default NodeList;