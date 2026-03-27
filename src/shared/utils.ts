
/**
 * Robustly parse JSON output from Python scripts.
 * Handles cases where scripts emit logs/warnings to stdout before the final JSON result.
 */
export function parsePythonJson<T = unknown>(stdout: string): T {
  const trimmed = stdout.trim();
  
  // 1. Try strict parsing first (fastest, most common)
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    // 2. Fallback: Try to find the last line that looks like JSON
    // Useful when Python scripts emit logs/warnings before the final JSON output
    const lines = trimmed.split('\n');
    if (lines.length > 1) {
       try {
         return JSON.parse(lines[lines.length - 1]);
       } catch (e2) {
         // Fallback continued...
       }
    }
    
    // 3. Fallback: Regex for last JSON object
    // Matches the last occurrence of {...} possibly across multiple lines
    // Note: This is a simple heuristic and won't handle nested braces perfectly if broken by newlines
    // but works for standard "logs then json" pattern.
    const lastOpen = trimmed.lastIndexOf('{');
    const lastClose = trimmed.lastIndexOf('}');
    if (lastOpen !== -1 && lastClose !== -1 && lastClose > lastOpen) {
      try {
        return JSON.parse(trimmed.slice(lastOpen, lastClose + 1));
      } catch (e3) {
         // ignore
      }
    }
    
    throw new Error(`Failed to parse Python JSON output. \nError: ${e instanceof Error ? e.message : String(e)}\nOutput snippet: ${trimmed.slice(-200)}`);
  }
}
