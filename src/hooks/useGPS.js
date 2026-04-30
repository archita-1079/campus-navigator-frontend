import { useState, useEffect, useRef, useCallback } from "react";

export function useGPS() {
  const [coords, setCoords] = useState(null);
  const [error, setError] = useState(null);
  const [isWatching, setIsWatching] = useState(false);
  const watchIdRef = useRef(null);

  const stopWatching = useCallback(() => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsWatching(false);
  }, []);

  const startWatching = useCallback(() => {
    if (!navigator.geolocation) {
      setError("GPS not supported on this device");
      return;
    }
    if (watchIdRef.current != null) return;

    setError(null);
    setIsWatching(true);

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          heading: pos.coords.heading,
          speed: pos.coords.speed,
        });
        setError(null);
      },
      (err) => {
        setError(err.message);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 2000, 
        timeout: 15000,
      }
    );
  }, []);

  const acquire = useCallback((onSuccess, onError) => {
    if (!navigator.geolocation) {
      onError?.("GPS not supported");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          heading: pos.coords.heading,
          speed: pos.coords.speed,
        };
        setCoords(c);
        onSuccess?.(c);
      },
      (err) => {
        setError(err.message);
        onError?.(err.message);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  useEffect(() => {
    startWatching();
    return () => stopWatching();
  }, [startWatching, stopWatching]);

  return { coords, error, isWatching, acquire, startWatching, stopWatching };
}