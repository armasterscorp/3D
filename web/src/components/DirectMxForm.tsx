// apps/web/src/components/DirectMxForm.tsx
import React, { useState, useEffect } from 'react';

type Props = {
  initial?: any;
  onSaved?: (sender: any) => void;
};

export default function DirectMxForm({ initial = {}, onSaved }: Props) {
  const [name, setName] = useState(initial.name || 'Direct MX');
  const [bindIp, setBindIp] = useState(initial.bindIp || '');
  const [requireTls, setRequireTls] = useState(!!initial.requireTls);
  const [dkimDomain, setDkimDomain] = useState(initial.dkim?.domainName || '');
  const [dkimSelector, setDkimSelector] = useState(initial.dkim?.keySelector || '');
  const [dkimPrivateKey, setDkimPrivateKey] = useState(initial.dkim?.privateKey || '');
  const [saving, setSaving] = useState(false);
  const [savedSender, setSavedSender] = useState<any>(initial);
  const [testTo, setTestTo] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => setSavedSender(initial), [initial]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setTestResult(null);
    const body = {
      id: initial.id,
      name,
      bindIp: bindIp || null,
      requireTls,
      dkim:
        dkimDomain && dkimSelector && dkimPrivateKey
          ? { domainName: dkimDomain, keySelector: dkimSelector, privateKey: dkimPrivateKey }
          : null,
    };
    try {
      const res = await fetch('/api/senders/direct-mx', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || 'save failed');
      setSavedSender(j.sender);
      if (onSaved) onSaved(j.sender);
    } catch (err: any) {
      setTestResult('Save error: ' + (err.message || err.toString()));
    } finally {
      setSaving(false);
    }
  }

  async function handleTestSend(e: React.FormEvent) {
    e.preventDefault();
    setTestResult(null);
    if (!savedSender?.id) {
      setTestResult('Save the sender first.');
      return;
    }
    if (!testTo) {
      setTestResult('Enter a "to" email for test.');
      return;
    }

    const message = {
      from: 'noreply@local.test',
      to: testTo,
      subject: 'Direct‑MX test',
      text: 'This is a test from Direct‑MX',
    };

    try {
      const res = await fetch('/api/senders/direct-mx/test', { method: 'POST', body: JSON.stringify({ senderId: savedSender.id, message }), headers: { 'Content-Type': 'application/json' } });
      const j = await res.json();
      if (j.ok) {
        setTestResult('Test send OK: ' + JSON.stringify(j.result?.response || j.result));
      } else {
        setTestResult('Test send failed: ' + (j.error || JSON.stringify(j)));
      }
    } catch (err: any) {
      setTestResult('Test send error: ' + (err.message || err.toString()));
    }
  }

  return (
    <div>
      <form onSubmit={handleSave}>
        <div>
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label>Bind outbound IP (optional)</label>
          <input value={bindIp} onChange={(e) => setBindIp(e.target.value)} placeholder="leave empty to auto-bind" />
        </div>
        <div>
          <label><input type="checkbox" checked={requireTls} onChange={(e) => setRequireTls(e.target.checked)} /> Require TLS (STARTTLS)</label>
        </div>

        <fieldset>
          <legend>Optional DKIM</legend>
          <div><label>DKIM Domain</label><input value={dkimDomain} onChange={(e) => setDkimDomain(e.target.value)} /></div>
          <div><label>DKIM Selector</label><input value={dkimSelector} onChange={(e) => setDkimSelector(e.target.value)} /></div>
          <div><label>DKIM Private Key</label><textarea value={dkimPrivateKey} onChange={(e) => setDkimPrivateKey(e.target.value)} /></div>
        </fieldset>

        <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Direct‑MX Sender'}</button>
      </form>

      <hr />

      <form onSubmit={handleTestSend}>
        <h4>Test send</h4>
        <div>
          <label>To</label>
          <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="recipient@example.com" />
        </div>
        <button type="submit">Send Test</button>
      </form>

      {testResult && <div style={{ marginTop: 12 }}><strong>Result:</strong> <pre>{testResult}</pre></div>}
    </div>
  );
}
