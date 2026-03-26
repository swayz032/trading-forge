import { motion } from "framer-motion";
import { useEffect, useState } from "react";

interface ForgeScoreRingProps {
  score: number;
  maxScore?: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
}

export function ForgeScoreRing({
  score,
  maxScore = 100,
  size = 120,
  strokeWidth = 8,
  label = "Forge Score",
}: ForgeScoreRingProps) {
  const [animatedScore, setAnimatedScore] = useState(0);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const percentage = score / maxScore;
  const strokeDashoffset = circumference * (1 - percentage);

  useEffect(() => {
    const timer = setTimeout(() => setAnimatedScore(score), 100);
    return () => clearTimeout(timer);
  }, [score]);

  // Determine color based on score percentage
  const getScoreColor = () => {
    if (percentage >= 0.8) return "hsl(var(--profit))";
    if (percentage >= 0.6) return "hsl(var(--primary))";
    if (percentage >= 0.4) return "hsl(var(--amber-600))";
    return "hsl(var(--loss))";
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        {/* Glow behind ring */}
        <div
          className="absolute inset-0 rounded-full opacity-20 blur-xl"
          style={{ backgroundColor: getScoreColor() }}
        />

        <svg width={size} height={size} className="transform -rotate-90">
          {/* Background track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="hsl(var(--surface-3))"
            strokeWidth={strokeWidth}
          />
          {/* Score arc */}
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={getScoreColor()}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset }}
            transition={{ duration: 1.2, ease: "easeOut", delay: 0.3 }}
          />
        </svg>

        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.span
            className="text-xl font-mono font-bold text-foreground"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            {animatedScore}
          </motion.span>
          <span className="text-[10px] text-text-muted">/ {maxScore}</span>
        </div>
      </div>
      <span className="text-xs text-text-secondary font-medium">{label}</span>
    </div>
  );
}
