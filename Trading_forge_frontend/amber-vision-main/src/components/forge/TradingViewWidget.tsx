import { useEffect, useRef, memo } from "react";

interface TradingViewWidgetProps {
  type: "ticker-tape" | "mini-chart" | "market-overview";
  symbol?: string;
  width?: string | number;
  height?: number;
  colorTheme?: "dark" | "light";
}

function TradingViewWidgetInner({ type, symbol = "CME_MINI:ES1!", width = "100%", height = 400, colorTheme = "dark" }: TradingViewWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = "";

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.async = true;

    if (type === "ticker-tape") {
      script.src = "https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js";
      script.textContent = JSON.stringify({
        symbols: [
          { proName: "CME_MINI:ES1!", title: "ES" },
          { proName: "CME_MINI:NQ1!", title: "NQ" },
          { proName: "NYMEX:CL1!", title: "CL" },
          { proName: "COMEX:GC1!", title: "GC" },
          { proName: "CBOT:YM1!", title: "YM" },
          { proName: "CME_MINI:RTY1!", title: "RTY" },
        ],
        showSymbolLogo: false,
        isTransparent: true,
        displayMode: "adaptive",
        colorTheme,
        locale: "en",
      });
    } else if (type === "mini-chart") {
      script.src = "https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js";
      script.textContent = JSON.stringify({
        symbol,
        width: typeof width === "number" ? width : "100%",
        height,
        locale: "en",
        dateRange: "1M",
        colorTheme,
        isTransparent: true,
        autosize: false,
        largeChartUrl: "",
      });
    } else if (type === "market-overview") {
      script.src = "https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js";
      script.textContent = JSON.stringify({
        colorTheme,
        dateRange: "1D",
        showChart: true,
        locale: "en",
        width: "100%",
        height,
        largeChartUrl: "",
        isTransparent: true,
        showSymbolLogo: false,
        showFloatingTooltip: false,
        tabs: [
          {
            title: "Futures",
            symbols: [
              { s: "CME_MINI:ES1!", d: "E-mini S&P 500" },
              { s: "CME_MINI:NQ1!", d: "E-mini NASDAQ" },
              { s: "NYMEX:CL1!", d: "Crude Oil" },
              { s: "COMEX:GC1!", d: "Gold" },
              { s: "CBOT:YM1!", d: "E-mini Dow" },
              { s: "CME_MINI:RTY1!", d: "E-mini Russell" },
            ],
          },
        ],
      });
    }

    containerRef.current.appendChild(script);
  }, [type, symbol, width, height, colorTheme]);

  return (
    <div className="tradingview-widget-container" ref={containerRef}>
      <div className="tradingview-widget-container__widget" />
    </div>
  );
}

export const TradingViewWidget = memo(TradingViewWidgetInner);
