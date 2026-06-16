import { useEffect, useState } from "react";

const TOUCH_QUERY = "(hover: none), (pointer: coarse)";

const getIsTouchDevice = () => {
  if (typeof window === "undefined") {
    return false;
  }

  const coarsePointer =
    typeof window.matchMedia === "function" &&
    window.matchMedia(TOUCH_QUERY).matches;
  const maxTouchPoints =
    typeof navigator !== "undefined" ? navigator.maxTouchPoints || 0 : 0;

  return coarsePointer || maxTouchPoints > 0;
};

export default function useIsTouchDevice() {
  const [isTouchDevice, setIsTouchDevice] = useState(getIsTouchDevice);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }

    const mediaQuery = window.matchMedia(TOUCH_QUERY);
    const handleChange = () => {
      setIsTouchDevice(getIsTouchDevice());
    };

    handleChange();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  return isTouchDevice;
}
