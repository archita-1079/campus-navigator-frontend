import { useState } from "react";

function useToasts() {
    const [toasts, setToasts] = useState([]);
    const add = (msg, type = "success") => {
        const id = Date.now();
        setToasts(t => [...t, { id, msg, type }]);
        setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
    };
    return { toasts, success: m => add(m, "success"), error: m => add(m, "error") };
}

export default useToasts;