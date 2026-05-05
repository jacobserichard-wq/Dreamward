"use client";

interface SpinnerProps {
  size?: number;
  color?: string;
  thickness?: number;
}

export default function Spinner({
  size = 16,
  color = "currentColor",
  thickness = 2,
}: SpinnerProps) {
  return (
    <svg
      className="fw-spin"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-label="Loading"
      style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0 }}
    >
      <circle cx="12" cy="12" r="10" stroke={color} strokeOpacity="0.2" strokeWidth={thickness} />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke={color}
        strokeWidth={thickness}
        strokeLinecap="round"
      />
    </svg>
  );
}
