import React from "react";

const NEGATIVE_MARGIN = "-35px";

const GroupDivider: React.FC<{ char: string; zIndex: number }> = ({
  char,
  zIndex,
}) => (
  <div
    className="relative flex justify-center pointer-events-none"
    style={{
      width: "100%",
      height: 50,
      marginBottom: NEGATIVE_MARGIN,
      zIndex: zIndex,
    }}
  >
    <svg viewBox="0 0 600 70" className="w-[600px] h-[50px] overflow-visible">
      <path
        d="M50 50 L50 20 Q50 10, 60 10 L160 10 Q170 10, 180 20 L190 50 Z"
        fill="#111827"
        stroke="#F3F4F6"
        strokeWidth="2"
      />
      <text x="70" y="35" fill="white" className="font-bold text-xl font-sans">
        {char}
      </text>
      <line x1="0" y1="50" x2="600" y2="50" stroke="#9CA3AF" strokeWidth="1" />
    </svg>
  </div>
);

export default GroupDivider;
