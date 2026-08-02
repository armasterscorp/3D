'use client';
import { useEffect } from 'react';

export default function DirectMxEnablerClient() {
  useEffect(() => {
    let mounted = true;

    async function checkAndEnable() {
      try {
        const res = await fetch('/api/senders/direct-mx');
        const json = await res.json();
        if (!mounted) return;
        if (json?.ok && Array.isArray(json.senders) && json.senders.length > 0) {
          // Enable any buttons that look like a "Start" button.
          const buttons = Array.from(document.querySelectorAll('button'));
          buttons.forEach((b) => {
            try {
              const txt = b.textContent?.trim().toLowerCase() || '';
              if ((txt === 'start' || txt.startsWith('start ')) && b.hasAttribute('disabled')) {
                b.removeAttribute('disabled');
                (b as any).dataset.directmxEnabled = 'true';
              }
            } catch (e) {}
          });
        }
      } catch (err) {
        // non-blocking
        // eslint-disable-next-line no-console
        console.warn('DirectMxEnablerClient error', err);
      }
    }

    void checkAndEnable();

    return () => {
      mounted = false;
    };
  }, []);

  return null;
}
