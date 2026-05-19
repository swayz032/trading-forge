import { useEffect, useRef } from "react";
// @ts-ignore - lightweight-charts types
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  AreaSeries,
} from "lightweight-charts";

interface LightweightChartProps {
  type?: "candlestick" | "line" | "area";
  data: any[];
  height?: number;
  className?: string;
  options?: any;
}

const defaultChartOptions: any = {
  layout: {
    background: { color: "transparent" },
    textColor: "#71717A",
    fontFamily: "JetBrains Mono, monospace",
    fontSize: 11,
  },
  grid: {
    vertLines: { color: "rgba(42, 42, 52, 0.5)" },
    horzLines: { color: "rgba(42, 42, 52, 0.5)" },
  },
  crosshair: {
    vertLine: { color: "rgba(255, 191, 0, 0.3)", width: 1, style: 2, labelBackgroundColor: "#FFBF00" },
    horzLine: { color: "rgba(255, 191, 0, 0.3)", width: 1, style: 2, labelBackgroundColor: "#FFBF00" },
  },
  timeScale: {
    borderColor: "rgba(42, 42, 52, 0.5)",
    timeVisible: true,
  },
  rightPriceScale: {
    borderColor: "rgba(42, 42, 52, 0.5)",
  },
};

export function LightweightChart({
  type = "candlestick",
  data,
  height = 350,
  className,
  options,
}: LightweightChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

    // Wait a tick for the container to have layout dimensions
    const timeout = setTimeout(() => {
      if (!containerRef.current) return;

      const containerWidth = containerRef.current.clientWidth;
      if (containerWidth === 0) return;

      const chart = createChart(containerRef.current, {
        ...defaultChartOptions,
        ...options,
        width: containerWidth,
        height,
      });

      if (type === "candlestick") {
        const series = chart.addSeries(CandlestickSeries, {
          upColor: "#22C55E",
          downColor: "#EF4444",
          borderUpColor: "#22C55E",
          borderDownColor: "#EF4444",
          wickUpColor: "#22C55E",
          wickDownColor: "#EF4444",
        });
        series.setData(data);
      } else if (type === "area") {
        const series = chart.addSeries(AreaSeries, {
          lineColor: "#FFBF00",
          lineWidth: 2,
          topColor: "rgba(255, 191, 0, 0.25)",
          bottomColor: "rgba(255, 191, 0, 0.02)",
          crosshairMarkerBackgroundColor: "#FFBF00",
        });
        series.setData(data);
      } else {
        const series = chart.addSeries(LineSeries, {
          color: "#FFBF00",
          lineWidth: 2,
          crosshairMarkerBackgroundColor: "#FFBF00",
        });
        series.setData(data);
      }

      chart.timeScale().fitContent();
      chartRef.current = chart;

      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const w = entry.contentRect.width;
          if (w > 0) {
            chart.applyOptions({ width: w });
          }
        }
      });
      observer.observe(containerRef.current);

      // Store cleanup refs
      const currentContainer = containerRef.current;
      return () => {
        observer.disconnect();
        chart.remove();
        chartRef.current = null;
      };
    }, 50);

    return () => {
      clearTimeout(timeout);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [type, data, height, options]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: "100%", minHeight: height }}
    />
  );
}
