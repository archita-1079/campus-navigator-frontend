import { useState, useCallback } from "react";

function useToasts() {
  const [toasts, setToasts] = useState([]);

  const remove = useCallback((id) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)),
    );

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 300);
  }, []);

  const add = useCallback(
    (msg, type = "success") => {
      const id = Math.random().toString(36).substr(2, 9);
      setToasts((prev) => [...prev, { id, msg, type, exiting: false }]);

      setTimeout(() => remove(id), 4000);
    },
    [remove],
  );

  return {
    toasts,
    success: (m) => add(m, "success"),
    error: (m) => add(m, "error"),
    remove,
  };
}

export default useToasts;
