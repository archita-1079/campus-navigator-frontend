export function injectCampusStyles() {
  const style = document.createElement("style");
  style.textContent = `
    * { -webkit-tap-highlight-color: transparent; }
    html, body { overscroll-behavior: none; }
    .cnav-btn { transition: opacity 0.15s, transform 0.1s; }
    .cnav-btn:active { opacity: 0.75; transform: scale(0.97); }
    @keyframes gpsPulse {
      0%   { transform: scale(1); opacity: 0.8; }
      70%  { transform: scale(2.8); opacity: 0; }
      100% { transform: scale(1); opacity: 0; }
    }
    @keyframes arrivalPop {
      0%   { transform: translate(-50%,-50%) scale(0.85); opacity: 0; }
      100% { transform: translate(-50%,-50%) scale(1); opacity: 1; }
    }
    @keyframes dirSlide {
      0%   { transform: translateY(-10px); opacity: 0; }
      100% { transform: translateY(0);     opacity: 1; }
    }
    @keyframes sheetIn {
      0%   { transform: translateY(100%); }
      100% { transform: translateY(0); }
    }
    @keyframes reroutePulse {
      0%,100% { opacity: 1; }
      50%     { opacity: 0.4; }
    }
  `;
  document.head.appendChild(style);
}