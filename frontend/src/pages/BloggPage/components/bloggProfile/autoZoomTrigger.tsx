import { useEffect } from "react";

const AutoZoomTrigger = ({
  targetId,
  zoomToElement,
  onZoomed,
}: {
  targetId: string | null;
  zoomToElement: any;
  onZoomed: () => void;
}) => {
  useEffect(() => {
    if (targetId) {
      setTimeout(() => {
        zoomToElement(targetId, 1, 800, "easeOutExpo");
        onZoomed();
      }, 300);
    }
  }, [targetId, zoomToElement, onZoomed]);
  return null;
};

export default AutoZoomTrigger;
