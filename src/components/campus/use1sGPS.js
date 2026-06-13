import { useState, useEffect } from "react";
import { useGPS } from "../../hooks/useGPS";

export function use1sGPS() {
  const { coords: sharedCoords, error: gpsError } = useGPS();
  const [coords, setCoords] = useState(null);

  useEffect(() => {
    if (!navigator.geolocation) return;

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          heading: pos.coords.heading,
          speed: pos.coords.speed,
        });
      },
      (err) => console.warn("GPS watch error:", err),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 1000 }
    );

    return () => navigator.geolocation.clearWatch(id);
  }, []);

  return { coords: coords ?? sharedCoords, error: gpsError };
}