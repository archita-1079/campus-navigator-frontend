import { useState, useEffect } from "react";

export function useCompassHeading() {
  const [heading, setHeading] = useState(null);

  useEffect(() => {
    const handler = (e) => {
      if (e.webkitCompassHeading != null) setHeading(e.webkitCompassHeading);
      else if (e.alpha != null) setHeading((360 - e.alpha + 360) % 360);
    };
    window.addEventListener("deviceorientationabsolute", handler, true);
    window.addEventListener("deviceorientation", handler, true);
    return () => {
      window.removeEventListener("deviceorientationabsolute", handler, true);
      window.removeEventListener("deviceorientation", handler, true);
    };
  }, []);

  return heading;
}