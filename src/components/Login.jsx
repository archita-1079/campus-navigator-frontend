import axios from "axios";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import useToasts from "../hooks/useToasts";

export default function Login({ setIsAuthenticated }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(
        `${import.meta.env.VITE_API_URL}/api/v1/auth/admin/login`,
        {
          username,
          password,
        },
      );
      if (res.data.success) {
        setIsAuthenticated(true);
        localStorage.setItem("token", res.data?.data?.token);
        navigate("/dashboard");
      } else {
        console.log("work");
        
        setError("Invalid credentials");
        console.log(error);
      }
    } catch (error) {
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
