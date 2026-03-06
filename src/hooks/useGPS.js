import { useState } from "react";

export function useGPS() {
  const [acquiring, setAcquiring] = useState(false);
  const [coords, setCoords] = useState(null);

  const acquire = (onSuccess, onError) => {
    if (!navigator.geolocation) {
      onError?.("GPS not supported");
      return;
    }
    setAcquiring(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setAcquiring(false);
        const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCoords(c);
        onSuccess?.(c);
      },
      (err) => {
        setAcquiring(false);
        onError?.(err.message);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  return { acquiring, coords, acquire };
}