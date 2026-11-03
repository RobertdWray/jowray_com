type SolidHeartProps = {
  size: number;
  fill?: string;
  stitch?: boolean;
  stitchColor?: string;
  label?: string;
};

type StitchedHeartProps = {
  size: number;
  color?: string;
  label?: string;
};

export function SolidHeart({
  size,
  fill = "#c8102e",
  stitch = true,
  stitchColor = "#f6efe3",
  label,
}: SolidHeartProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="flex-none"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : "true"}
    >
      <path
        d="M12 21s-7.2-4.6-9.6-9.1A5.4 5.4 0 0 1 12 6.2a5.4 5.4 0 0 1 9.6 5.7C19.2 16.4 12 21 12 21z"
        fill={fill}
      />
      {stitch && (
        <path
          d="M12 19.2s-5.8-3.9-7.9-7.7A4 4 0 0 1 12 7.6a4 4 0 0 1 7.9 3.9C17.8 15.3 12 19.2 12 19.2z"
          stroke={stitchColor}
          strokeWidth="1.1"
          strokeDasharray="1.6 1.4"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

export function StitchedHeart({
  size,
  color = "#c8102e",
  label,
}: StitchedHeartProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="flex-none"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : "true"}
    >
      <path
        d="M12 21s-7.2-4.6-9.6-9.1A5.4 5.4 0 0 1 12 6.2a5.4 5.4 0 0 1 9.6 5.7C19.2 16.4 12 21 12 21z"
        stroke={color}
        strokeWidth="1.8"
        strokeDasharray="2.4 2"
        strokeLinecap="round"
      />
    </svg>
  );
}
