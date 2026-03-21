import { useEffect, useRef, memo } from "react";

interface TradingViewWidgetProps {
  type: "ticker-tape" | "mini-chart" | "symbol-chart" | "market-overview";
  symbol?: string;
  width?: string | number;
  height?: number;
  colorTheme?: "dark" | "light";
}

const TV_SYMBOLS: Record<string, string> = {
  "ES": "FOREXCOM:SPXUSD",
  "NQ": "FOREXCOM:NSXUSD",
  "CL": "TVC:USOIL",
  "GC": "TVC:GOLD",
  "YM": "TVC:DJI",
  "RTY": "TVC:RUT",
};

function TradingViewWidgetInner({ type, symbol = "FOREXCOM:SPXUSD", width = "100%", height = 400, colorTheme = "dark" }: TradingViewWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scriptRef = useRef<HTMLScriptElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    if (scriptRef.current && scriptRef.current.parentNode) {
      scriptRef.current.parentNode.removeChild(scriptRef.current);
      scriptRef.current = null;
    }

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.async = true;

    if (type === "ticker-tape") {
      script.src = "https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js";
      script.textContent = JSON.stringify({
        symbols: [
          { proName: "FOREXCOM:SPXUSD", title: "ES" },
          { proName: "FOREXCOM:NSXUSD", title: "NQ" },
          { proName: "TVC:USOIL",       title: "CL" },
          { proName: "TVC:GOLD",         title: "GC" },
          { proName: "TVC:DJI",          title: "YM" },
          { proName: "TVC:RUT",          title: "RTY" },
        ],
        showSymbolLogo: true,
        isTransparent: true,
        displayMode: "adaptive",
        colorTheme,
        locale: "en",
      });
    } else if (type === "symbol-chart") {
      // Clean, readable chart — big price, clear line chart, no clutter
      script.src = "https://s3.tradingview.com/external-embedding/embed-widget-symbol-overview.js";
      script.textContent = JSON.stringify({
        symbols: [[symbol, symbol.split(":").pop() || symbol]],
        chartOnly: false,
        width: typeof width === "number" ? width : "100%",
        height,
        locale: "en",
        colorTheme,
        autosize: false,
        showVolume: false,
        showMA: false,
        hideDateRanges: false,
        hideMarketStatus: true,
        hideSymbolLogo: false,
        scalePosition: "right",
        scaleMode: "Normal",
        fontFamily: "-apple-system, BlinkMacSystemFont, Trebuchet MS, Roboto, Ubuntu, sans-serif",
        fontSize: "10",
        noTimeScale: false,
        valuesTracking: "1",
        changeMode: "price-and-percent",
        chartType: "area",
        lineWidth: 2,
        lineType: 0,
        dateRanges: ["1d|1", "1m|30", "3m|60", "12m|1D", "60m|1W", "all|1M"],
        isTransparent: true,
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
        showSymbolLogo: true,
        showFloatingTooltip: false,
        tabs: [
          {
            title: "Futures",
            symbols: [
              { s: "FOREXCOM:SPXUSD", d: "E-mini S&P 500" },
              { s: "FOREXCOM:NSXUSD", d: "E-mini NASDAQ" },
              { s: "TVC:USOIL",       d: "Crude Oil" },
              { s: "TVC:GOLD",         d: "Gold" },
              { s: "TVC:DJI",          d: "E-mini Dow" },
              { s: "TVC:RUT",          d: "E-mini Russell" },
            ],
          },
        ],
      });
    }

    containerRef.current.appendChild(script);
    scriptRef.current = script;

    return () => {
      if (scriptRef.current && scriptRef.current.parentNode) {
        scriptRef.current.parentNode.removeChild(scriptRef.current);
        scriptRef.current = null;
      }
    };
  }, [type, symbol, width, height, colorTheme]);

  return (
    <div className="tradingview-widget-container" ref={containerRef}>
      <div className="tradingview-widget-container__widget" />
    </div>
  );
}

export { TV_SYMBOLS };
export const TradingViewWidget = memo(TradingViewWidgetInner);
