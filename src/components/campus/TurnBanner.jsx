import { DIR } from "../../utils/graph";

export default function TurnBanner({ uTurnActive, dirInfo, distToNextTurn, stepIdx, totalSteps }) {
  const bannerInfo = uTurnActive ? DIR["u-turn"] : dirInfo;
  if (!bannerInfo) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        left: 12,
        right: 12,
        zIndex: 25,
        marginTop: 50,
        animation: "dirSlide 0.3s ease",
        background: "rgba(10,10,10,0.97)",
        border: `2.5px solid ${bannerInfo.color}`,
        borderRadius: 18,
        padding: "13px 16px",
        display: "flex",
        alignItems: "center",
        gap: 13,
        boxShadow: "0 6px 28px rgba(0,0,0,0.7)",
        backdropFilter: "blur(14px)",
      }}
    >
      <div
        style={{
          width: 50,
          height: 50,
          borderRadius: 13,
          background: `${bannerInfo.color}18`,
          border: `2px solid ${bannerInfo.color}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 26,
          flexShrink: 0,
        }}
      >
        {bannerInfo.icon}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: bannerInfo.color }}>
          {bannerInfo.label}
        </div>
        {distToNextTurn != null && distToNextTurn > 0 && (
          <div style={{ fontSize: 12, color: "#888", marginTop: 3 }}>
            in {distToNextTurn} m
          </div>
        )}
      </div>
      <div style={{ fontSize: 10, color: "#555" }}>
        {stepIdx + 1} / {totalSteps}
      </div>
    </div>
  );
}