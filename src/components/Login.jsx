import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function Login({ setIsAuthenticated }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleLogin = (e) => {
    e.preventDefault();
    // In future change to real API call
    if (username === "admin" && password === "admin") {
      setIsAuthenticated(true);
      navigate("/dashboard");
    } else {
      setError("Invalid credentials");
    }
  };

  return (
    <div
      className="page-header"
      style={{ maxWidth: "400px", margin: "40px auto" }}
    >
      <div className="page-title">Admin Access</div>
      <div className="page-subtitle">Login to manage the campus graph</div>
      <div className="card" style={{ marginTop: "20px" }}>
        {error && (
          <div
            style={{
              color: "var(--accent)",
              marginBottom: "15px",
              fontFamily: "var(--mono)",
            }}
          >
            {error}
          </div>
        )}
        <form
          onSubmit={handleLogin}
          style={{ display: "flex", flexDirection: "column", gap: "15px" }}
        >
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={{
              padding: "10px",
              background: "var(--bg3)",
              border: "1px solid var(--border2)",
              color: "var(--text1)",
            }}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{
              padding: "10px",
              background: "var(--bg3)",
              border: "1px solid var(--border2)",
              color: "var(--text1)",
            }}
            required
          />
          <button type="submit" className="btn btn-primary">
            Authenticate
          </button>
        </form>
      </div>
    </div>
  );
}
