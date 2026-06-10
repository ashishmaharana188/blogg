import { useCallback, useEffect, useRef, useState } from "react";

export default function useCanvasInteractionMode(settleDelay = 120) {
    const [isInteracting, setIsInteracting] = useState(false);
    const settleTimerRef = useRef<number | null>(null);

    const clearSettleTimer = useCallback(() => {
        if (settleTimerRef.current !== null) {
            window.clearTimeout(settleTimerRef.current);
            settleTimerRef.current = null;
        }
    }, []);

    const startInteraction = useCallback(() => {
        clearSettleTimer();
        setIsInteracting(true);
    }, [clearSettleTimer]);

    const settleInteraction = useCallback(
        (delay = settleDelay) => {
            clearSettleTimer();
            settleTimerRef.current = window.setTimeout(() => {
                settleTimerRef.current = null;
                setIsInteracting(false);
            }, delay);
        },
        [clearSettleTimer, settleDelay],
    );

    useEffect(() => {
        return () => {
            clearSettleTimer();
        };
    }, [clearSettleTimer]);

    return {
        isInteracting,
        startInteraction,
        settleInteraction,
    };
}
