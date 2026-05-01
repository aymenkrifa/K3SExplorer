import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Terminal, X } from 'lucide-react';
import { openLogStream } from '../api';

export interface LogTab {
  id: string;
  podName: string;
  namespace: string;
  container: string;
  deploymentName: string;
}

function ansiToHtml(text: string): string {
  const colors: Record<number, string> = {
    30: '#000000', 31: '#ef4444', 32: '#22c55e', 33: '#eab308',
    34: '#3b82f6', 35: '#a855f7', 36: '#06b6d4', 37: '#e5e7eb',
    90: '#4b5563', 91: '#fca5a5', 92: '#86efac', 93: '#fde047',
    94: '#93c5fd', 95: '#d8b4fe', 96: '#67e8f9', 97: '#ffffff',
  };
  let html = '';
  let currentStyle = '';
  const pattern = /\x1b\[(\d+(?:;\d+)*)m/g;
  let lastIndex = 0;
  let m;
  while ((m = pattern.exec(text)) !== null) {
    html += escapeHtml(text.slice(lastIndex, m.index));
    const codes = m[1].split(';').map(Number);
    let styles: string[] = [];
    let bold = false;
    for (const code of codes) {
      if (code === 0) {
        styles = [];
        bold = false;
      } else if (code === 1) {
        bold = true;
      } else if (code >= 30 && code <= 37 || code >= 90 && code <= 97) {
        styles.push(`color:${colors[code]}`);
      } else if (code >= 40 && code <= 47) {
        const bg = colors[code - 10];
        if (bg) styles.push(`background:${bg}`);
      }
    }
    if (bold) styles.push('font-weight:bold');
    currentStyle = styles.join(';');
    lastIndex = pattern.lastIndex;
    if (currentStyle) {
      html += `<span style="${escapeHtml(currentStyle)}">`;
    } else {
      html += '</span>';
    }
  }
  html += escapeHtml(text.slice(lastIndex));
  // Close any open spans
  return html;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function colorLine(line: string): string {
  const l = line.toLowerCase();
  if (/\b(error|fatal|exception|traceback|panic)\b/.test(l)) return 'text-red-400';
  if (/\b(warn|warning)\b/.test(l)) return 'text-yellow-300';
  if (/\b(info|information)\b/.test(l)) return 'text-sky-400';
  if (/\b(debug|trace)\b/.test(l)) return 'text-gray-500';
  return 'text-gray-300';
}

function parseLine(raw: string): { ts: string | null; body: string } {
  const m = raw.match(/^(\d{4}-\d{2}-\d{2}T[\d:.+Z-]+)\s+(.*)$/s);
  if (m) return { ts: m[1].replace('T', ' ').slice(0, 19), body: m[2] };
  return { ts: null, body: raw };
}

function LogPane({ tab, tail }: { tab: LogTab; tail?: number }) {
  const [lines, setLines] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLines([]);
    setConnected(false);
    wsRef.current?.close();

    const ws = openLogStream(
      tab.podName,
      tab.namespace,
      tab.container,
      (line) => {
        setLines((prev) => [...prev.slice(-5000), line]);
        setConnected(true);
      },
      () => {
        setLines((prev) => [...prev, '--- stream closed ---']);
        setConnected(false);
      },
      tail
    );
    wsRef.current = ws;
    return () => ws.close();
  }, [tab.id, tail]);

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'instant' });
    }
  }, [lines, autoScroll]);

  const filtered = search
    ? lines.filter((l) => l.toLowerCase().includes(search.toLowerCase()))
    : lines;

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-950">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-200 dark:border-gray-800 shrink-0">
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            connected ? 'bg-emerald-400 animate-pulse' : 'bg-gray-600'
          }`}
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter lines…"
          className="flex-1 bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-2 py-0.5 text-[11px] text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-sky-600"
        />
        <button
          onClick={() => setAutoScroll((v) => !v)}
          className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
            autoScroll
              ? 'border-sky-600 dark:border-sky-700 bg-sky-100/40 dark:bg-sky-900/40 text-sky-600 dark:text-sky-300'
              : 'border-gray-300 dark:border-gray-700 text-gray-500 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-400'
          }`}
        >
          Auto-scroll
        </button>
        <button
          onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'instant' })}
          className="text-[10px] px-2 py-0.5 rounded border border-gray-300 dark:border-gray-700 text-gray-500 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-400 transition-colors"
          title="Scroll to bottom"
        >
          Scroll to bottom
        </button>
        <span className="text-[10px] text-gray-500 dark:text-gray-700 shrink-0">{filtered.length} lines</span>
      </div>

      {/* Log content */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-5 select-text"
      >
        {filtered.length === 0 && (
          <p className="text-gray-400 dark:text-gray-600">
            {connected ? 'No output yet…' : 'Connecting…'}
          </p>
        )}
        {filtered.map((raw, i) => {
          const { ts, body } = parseLine(raw);
          const color = colorLine(raw);
          return (
            <div key={i} className={`flex gap-3 min-w-0 ${color}`}>
              {ts && (
                <span className="text-gray-400 dark:text-gray-700 shrink-0 select-none tabular-nums">{ts}</span>
              )}
              <span
                className="break-all whitespace-pre-wrap min-w-0"
                dangerouslySetInnerHTML={{ __html: ansiToHtml(body) }}
              />
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

interface Props {
  tabs: LogTab[];
  onClose: (id: string) => void;
  onCloseAll: () => void;
  tail?: number;
}

const MIN_HEIGHT = 160;
const DEFAULT_HEIGHT = 320;

export function LogDock({ tabs, onClose, onCloseAll, tail }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startH = useRef(0);
  const prevLengthRef = useRef(tabs.length);

  useEffect(() => {
    if (tabs.length === 0) {
      setActiveId(null);
      prevLengthRef.current = 0;
      return;
    }
    if (tabs.length > prevLengthRef.current) {
      // New tab opened — switch to it
      setActiveId(tabs[tabs.length - 1].id);
      setCollapsed(false);
    } else if (!activeId || !tabs.find((t) => t.id === activeId)) {
      setActiveId(tabs[tabs.length - 1].id);
      setCollapsed(false);
    }
    prevLengthRef.current = tabs.length;
  }, [tabs]);

  function onResizeStart(e: React.MouseEvent) {
    dragging.current = true;
    startY.current = e.clientY;
    startH.current = height;
    e.preventDefault();

    function onMove(ev: MouseEvent) {
      if (!dragging.current) return;
      const delta = startY.current - ev.clientY;
      setHeight(Math.max(MIN_HEIGHT, Math.min(window.innerHeight * 0.85, startH.current + delta)));
    }
    function onUp() {
      dragging.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  if (tabs.length === 0) return null;

  const activeTab = tabs.find((t) => t.id === activeId) ?? null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 border-t-2 border-gray-300 dark:border-gray-700 flex flex-col z-50 shadow-2xl"
      style={{ height: collapsed ? 'auto' : height }}
    >
      {/* Resize handle */}
      {!collapsed && (
        <div
          onMouseDown={onResizeStart}
          className="h-1.5 cursor-row-resize bg-gray-300 dark:bg-gray-800 hover:bg-sky-600 transition-colors shrink-0"
        />
      )}

      {/* Tab bar */}
      <div className="flex items-center bg-gray-100 dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 shrink-0 overflow-x-auto">
        <div className="flex items-center gap-1.5 px-3 text-gray-400 dark:text-gray-600 shrink-0">
          <Terminal size={12} />
        </div>

        <div className="flex flex-1 overflow-x-auto min-w-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveId(tab.id);
                setCollapsed(false);
              }}
              className={`flex items-center gap-2 px-3 py-2 text-[11px] border-r border-gray-200 dark:border-gray-800 shrink-0 transition-colors ${
                activeId === tab.id && !collapsed
                  ? 'bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 border-t-2 border-t-sky-500 -mt-px'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-200/60 dark:hover:bg-gray-800/60'
              }`}
            >
              <span className="max-w-[160px] truncate font-mono">{tab.podName}</span>
              {tab.container && (
                <span className="text-gray-500 dark:text-gray-600 text-[10px]">/{tab.container}</span>
              )}
              <span
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
                className="text-gray-700 hover:text-red-400 transition-colors ml-0.5"
              >
                <X size={10} />
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-0.5 px-2 shrink-0">
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="text-gray-500 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-300 p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          <button
            onClick={onCloseAll}
            className="text-gray-500 dark:text-gray-600 hover:text-red-400 p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
            title="Close all terminals"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Panes — all mounted, only active is visible (preserves scroll/ws) */}
      {!collapsed && (
        <div className="flex-1 min-h-0">
          {tabs.map((tab) => (
            <div key={tab.id} className={`h-full ${tab.id === activeId ? 'block' : 'hidden'}`}>
              <LogPane tab={tab} tail={tail} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
