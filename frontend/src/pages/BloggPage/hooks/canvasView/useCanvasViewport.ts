import { useCallback, useState } from "react";

type CanvasTransformRef = {
    state?: {
        scale?: number;
        positionX?: number;
        positionY?: number;
        x?: number;
        y?: number;
    };
};

type VisibleRect = {
    left: number;
    right: number;
    top: number;
    bottom: number;
};

type CanvasViewportOptions = {
    buffer?: number;
    initialScale?: number;
    initialPositionX?: number;
    initialPositionY?: number;
};

type WorldRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

const DEFAULT_VIEWPORT_WIDTH = 1440;
const DEFAULT_VIEWPORT_HEIGHT = 900;

const getViewportSize = () => ({
    width:
        typeof window !== "undefined"
            ? window.innerWidth
            : DEFAULT_VIEWPORT_WIDTH,
    height:
        typeof window !== "undefined"
            ? window.innerHeight
            : DEFAULT_VIEWPORT_HEIGHT,
});

export default function useCanvasViewport({
    buffer = 1600,
    initialScale = 1,
    initialPositionX = 0,
    initialPositionY = 0,
}: CanvasViewportOptions = {}) {
    const initialViewport = getViewportSize();
    const [canvasScale, setCanvasScale] = useState(initialScale);
    const [visibleRect, setVisibleRect] = useState<VisibleRect>({
        left: -initialPositionX / initialScale - buffer,
        right:
            (-initialPositionX + initialViewport.width) / initialScale + buffer,
        top: -initialPositionY / initialScale - buffer,
        bottom:
            (-initialPositionY + initialViewport.height) / initialScale +
            buffer,
    });

    const syncViewport = useCallback(
        (ref: CanvasTransformRef | null | undefined) => {
            if (!ref?.state) return;

            const scale = ref.state.scale || 1;
            const x = ref.state.positionX ?? ref.state.x ?? initialPositionX;
            const y = ref.state.positionY ?? ref.state.y ?? initialPositionY;
            const viewport = getViewportSize();

            setCanvasScale(scale);
            setVisibleRect({
                left: -x / scale - buffer,
                right: (-x + viewport.width) / scale + buffer,
                top: -y / scale - buffer,
                bottom: (-y + viewport.height) / scale + buffer,
            });
        },
        [buffer, initialPositionX, initialPositionY],
    );

    const isRectVisible = useCallback(
        ({ x, y, width, height }: WorldRect) =>
            x + width >= visibleRect.left &&
            x <= visibleRect.right &&
            y + height >= visibleRect.top &&
            y <= visibleRect.bottom,
        [visibleRect],
    );

    return {
        canvasScale,
        setCanvasScale,
        visibleRect,
        syncViewport,
        isRectVisible,
    };
}
