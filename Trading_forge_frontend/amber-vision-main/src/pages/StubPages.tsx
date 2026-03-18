import { motion } from "framer-motion";

function StubPage({ title, description }: { title: string; description: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="flex flex-col items-center justify-center min-h-[60vh] text-center"
    >
      <div className="forge-card p-12 max-w-md">
        <h1 className="text-xl font-semibold text-foreground mb-2">{title}</h1>
        <p className="text-sm text-text-secondary">{description}</p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <div className="w-2 h-2 rounded-full bg-primary animate-glow-pulse" />
          <span className="text-xs text-text-muted">Coming in Wave 2</span>
        </div>
      </div>
    </motion.div>
  );
}

export const SettingsPage = () => <StubPage title="Settings" description="API keys, alert configuration, data sources, and system preferences." />;
