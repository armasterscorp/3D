'use client';

import * as React from 'react';

type InputPayload = Record<string, unknown> & { action: string };

export function AdobeRemoteBrowser({ connected }: { connected: boolean }) {
  const [frameUrl, setFrameUrl] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [active, setActive] = React.useState(false);
  const imageRef = React.useRef<HTMLImageElement | null>(null);
  const frameObjectUrl = React.useRef<string | null>(null);
  const frameBusy = React.useRef(false);
  const inputQueue = React.useRef<Promise<void>>(Promise.resolve());
  const mounted = React.useRef(true);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (frameObjectUrl.current) URL.revokeObjectURL(frameObjectUrl.current);
    };
  }, []);

  const refreshFrame = React.useCallback(async () => {
    if (!connected || frameBusy.current) return;
    frameBusy.current = true;
    try {
      const response = await fetch(`/api/adobe/browser/screenshot?t=${Date.now()}`, {
        cache: 'no-store', credentials: 'include',
      });
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok || !contentType.startsWith('image/')) {
        const body = await response.text();
        throw new Error(`Invalid browser frame (HTTP ${response.status}): ${body.slice(0, 220)}`);
      }
      const blob = await response.blob();
      const nextUrl = URL.createObjectURL(blob);
      const previousUrl = frameObjectUrl.current;
      frameObjectUrl.current = nextUrl;
      if (mounted.current) {
        setFrameUrl(nextUrl);
        setError(null);
      }
      if (previousUrl) URL.revokeObjectURL(previousUrl);
    } catch (frameError) {
      if (mounted.current) setError(frameError instanceof Error ? frameError.message : String(frameError));
    } finally {
      frameBusy.current = false;
    }
  }, [connected]);

  React.useEffect(() => {
    if (!connected) {
      setFrameUrl('');
      setError(null);
      return;
    }
    void refreshFrame();
    const timer = window.setInterval(() => void refreshFrame(), 1000);
    return () => window.clearInterval(timer);
  }, [connected, refreshFrame]);

  function sendInput(payload: InputPayload) {
    inputQueue.current = inputQueue.current.catch(() => undefined).then(async () => {
      const response = await fetch('/api/adobe/browser/input', {
        method: 'POST', credentials: 'include', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const body = await response.text();
        throw new Error(`Invalid JSON from API (HTTP ${response.status}): ${body.slice(0, 220)}`);
      }
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || 'Remote browser input failed');
      if (mounted.current) setError(null);
      window.setTimeout(() => void refreshFrame(), 120);
    }).catch((inputError) => {
      if (mounted.current) setError(inputError instanceof Error ? inputError.message : String(inputError));
    });
  }

  function scaledPoint(event: React.MouseEvent<HTMLImageElement>) {
    const image = imageRef.current;
    if (!image) return { x: 0, y: 0 };
    const rect = image.getBoundingClientRect();
    const sourceWidth = image.naturalWidth || 1280;
    const sourceHeight = image.naturalHeight || 800;
    return {
      x: Math.max(0, Math.min(sourceWidth, ((event.clientX - rect.left) / rect.width) * sourceWidth)),
      y: Math.max(0, Math.min(sourceHeight, ((event.clientY - rect.top) / rect.height) * sourceHeight)),
    };
  }

  const specialKeys: Record<string, string> = {
    Enter: 'Enter', Tab: 'Tab', Escape: 'Escape', Backspace: 'Backspace', Delete: 'Delete',
    ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
    Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  };

  if (!connected) {
    return <div className="rounded border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">Connect Adobe to open the remote browser.</div>;
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {(['back', 'forward', 'reload'] as const).map((action) => (
          <button key={action} type="button" className="rounded border px-3 py-1.5 text-xs capitalize" onClick={() => sendInput({ action })}>{action}</button>
        ))}
        <button type="button" className="rounded border px-3 py-1.5 text-xs" onClick={() => void refreshFrame()}>Refresh image</button>
        <span className="self-center text-xs text-slate-500">Click an Adobe field first, then type or paste.</span>
      </div>
      <div
        tabIndex={0}
        className={`overflow-hidden rounded border bg-slate-900 outline-none ${active ? 'ring-2 ring-[#6C63FF]' : ''}`}
        onFocus={() => setActive(true)} onBlur={() => setActive(false)}
        onKeyDown={(event) => {
          if (event.ctrlKey && event.key.toLowerCase() === 'v') return;
          const special = specialKeys[event.key];
          if (special) {
            event.preventDefault();
            const modifiers: string[] = [];
            if (event.ctrlKey) modifiers.push('Control');
            if (event.altKey) modifiers.push('Alt');
            if (event.shiftKey) modifiers.push('Shift');
            if (event.metaKey) modifiers.push('Meta');
            sendInput({ action: 'press', key: [...modifiers, special].join('+') });
          } else if (!event.ctrlKey && !event.altKey && !event.metaKey && event.key.length === 1) {
            event.preventDefault();
            sendInput({ action: 'type', text: event.key });
          }
        }}
        onPaste={(event) => {
          const text = event.clipboardData.getData('text');
          if (!text) return;
          event.preventDefault();
          sendInput({ action: 'type', text });
        }}
        onWheel={(event) => {
          event.preventDefault();
          sendInput({ action: 'wheel', deltaX: event.deltaX, deltaY: event.deltaY });
        }}
      >
        {frameUrl ? (
          <img
            ref={imageRef} src={frameUrl} alt="Adobe remote browser" draggable={false}
            className="block h-auto w-full select-none cursor-default" onLoad={() => setError(null)}
            onClick={(event) => {
              event.currentTarget.parentElement?.focus();
              sendInput({ action: 'click', ...scaledPoint(event), clickCount: event.detail || 1 });
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.currentTarget.parentElement?.focus();
              sendInput({ action: 'click', ...scaledPoint(event), button: 'right' });
            }}
          />
        ) : <div className="p-10 text-center text-sm text-white">Loading Adobe browser…</div>}
      </div>
      <div className="text-xs text-slate-500">Click, keyboard typing, scrolling, and clipboard paste are supported. Mouse-move requests are disabled to prevent request flooding.</div>
      {error && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
    </div>
  );
}
