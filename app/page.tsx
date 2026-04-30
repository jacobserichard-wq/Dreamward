export default function Home() {
  return (
    <main style={{
      minHeight: "100vh",
      background: "#0e0e0e",
      color: "#e8e8e8",
      fontFamily: "sans-serif",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
    }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⚡</div>
        <h1 style={{ fontSize: 36, fontWeight: 800, marginBottom: 8 }}>
          FlowWork
        </h1>
        <p style={{ color: "#666", fontSize: 16 }}>
          Office automation platform — coming soon
        </p>
        <div style={{
          marginTop: 32, display: "flex", gap: 16, justifyContent: "center"
        }}>
          {["Invoice Entry", "Weekly Reports", "AR Follow-Ups"].map(a => (
            <div key={a} style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 10, padding: "12px 20px",
              fontSize: 13, color: "#00ff88"
            }}>{a}</div>
          ))}
        </div>
      </div>
    </main>
  );
}