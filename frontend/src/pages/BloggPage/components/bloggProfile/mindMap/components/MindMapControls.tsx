import { useEffect } from "react";
import { useControls } from "react-zoom-pan-pinch";

const MindMapControls = () => {
  const { resetTransform } = useControls();

  useEffect(() => {
    const resetView = () => resetTransform(350, "easeOutQuint");
    window.addEventListener("BLOGG_MINDMAP_RESET_VIEW", resetView);
    return () => window.removeEventListener("BLOGG_MINDMAP_RESET_VIEW", resetView);
  }, [resetTransform]);

  return null;
};

export default MindMapControls;
