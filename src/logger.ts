import { writeFileSync, appendFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// MCP server farklı cwd ile çalışabilir, bu yüzden sabit yol kullan
const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, "..", "logs");
const LOG_FILE = join(LOG_DIR, `freeweb_${new Date().toISOString().slice(0, 10)}.log`);
const DEBUG_FILE = join(LOG_DIR, `debug_${new Date().toISOString().slice(0, 10)}.jsonl`);

// Log dizinini oluştur
if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}

export enum LogLevel {
  DEBUG = "DEBUG",
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  tool?: string;
  action: string;
  data?: unknown;
  duration?: number;
  error?: string;
}

let sessionStartTime = Date.now();

function formatLog(entry: LogEntry): string {
  const prefix = `[${entry.timestamp}] [${entry.level}]${entry.tool ? ` [${entry.tool}]` : ""}`;
  let msg = `${prefix} ${entry.action}`;

  if (entry.data !== undefined) {
    const dataStr = typeof entry.data === "string" ? entry.data : JSON.stringify(entry.data, null, 2);
    msg += `\n  Data: ${dataStr.slice(0, 2000)}`;
  }

  if (entry.duration !== undefined) {
    msg += ` (${entry.duration}ms)`;
  }

  if (entry.error) {
    msg += `\n  Error: ${entry.error}`;
  }

  return msg;
}

export class Logger {
  private toolName: string;
  private startTime: number;

  constructor(toolName: string) {
    this.toolName = toolName;
    this.startTime = Date.now();
    this.log(LogLevel.INFO, "Tool started");
  }

  log(level: LogLevel, action: string, data?: unknown): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      tool: this.toolName,
      action,
      data,
      duration: Date.now() - this.startTime,
    };

    const formatted = formatLog(entry);
    console.error(formatted); // stderr'e yaz (stdout MCP için ayrılmış)

    try {
      appendFileSync(LOG_FILE, formatted + "\n\n");
    } catch {
      // Ignore write errors
    }
  }

  debug(action: string, data?: unknown): void {
    this.log(LogLevel.DEBUG, action, data);
  }

  info(action: string, data?: unknown): void {
    this.log(LogLevel.INFO, action, data);
  }

  warn(action: string, data?: unknown): void {
    this.log(LogLevel.WARN, action, data);
  }

  error(action: string, error?: unknown): void {
    const errorStr = error instanceof Error ? error.message : String(error);
    this.log(LogLevel.ERROR, action, { error: errorStr });
  }

  /** Detaylı debug verisi kaydet (JSONL formatında) */
  dumpData(action: string, data: unknown): void {
    const entry = {
      timestamp: new Date().toISOString(),
      tool: this.toolName,
      action,
      data,
    };

    try {
      appendFileSync(DEBUG_FILE, JSON.stringify(entry) + "\n");
    } catch {
      // Ignore write errors
    }
  }

  /** URL ziyaret log */
  logUrlVisit(url: string, status: string): void {
    this.debug("URL Visit", { url, status });
  }

  /** Sayfa içeriği log */
  logPageContent(url: string, content: { title: string; textLength: number; preview: string }): void {
    this.dumpData("Page Content", {
      url,
      title: content.title,
      textLength: content.textLength,
      preview: typeof content.preview === "string" ? content.preview.slice(0, 500) : "",
    });
  }

  /** Arama sonucu log */
  logSearchResults(engine: string, query: string, results: unknown[]): void {
    this.dumpData("Search Results", {
      engine,
      query,
      count: results.length,
      results: results.slice(0, 5),
    });
    this.info(`Search completed: ${engine}`, { query, resultCount: results.length });
  }

  /** Parse hatası log */
  logParseError(pageType: string, html: string): void {
    this.dumpData("Parse Error", {
      pageType,
      htmlPreview: html.slice(0, 2000),
    });
    this.warn(`Failed to parse ${pageType}`);
  }

  finish(result: unknown): void {
    this.info("Tool completed", { totalDuration: Date.now() - this.startTime });
    this.dumpData("Final Result", result);
  }
}

// Global session logger
export function logSession(action: string, data?: unknown): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level: LogLevel.INFO,
    action,
    data,
    duration: Date.now() - sessionStartTime,
  };

  const formatted = formatLog(entry);
  console.error(formatted);

  try {
    appendFileSync(LOG_FILE, formatted + "\n\n");
  } catch {
    // Ignore
  }
}

// Başlangıç log
logSession("Session started", { pid: process.pid, cwd: process.cwd() });
