import { NextRequest, NextResponse } from 'next/server';
import { promises as dns } from 'node:dns';
import { Resolver } from 'node:dns/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';

export const runtime = 'nodejs';

const execFileAsync = promisify(execFile);
const publicResolver = new Resolver();
publicResolver.setServers(['1.1.1.1', '8.8.8.8']);

type Check = { key: string; label: string; ok: boolean; detail: string };
type MxRecord = { priority: number; exchange: string };

function cleanHost(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function isIp(value: string): boolean {
  return net.isIP(value) !== 0;
}

function errorCode(error: unknown): string {
  return String((error as { code?: unknown })?.code || '');
}

function shouldFallback(error: unknown): boolean {
  return ['ECONNREFUSED', 'ETIMEOUT', 'ESERVFAIL', 'EAI_AGAIN', 'ENOTFOUND'].includes(errorCode(error));
}

async function runNslookup(type: 'mx' | 'txt' | 'ptr', name: string): Promise<string> {
  const args = type === 'ptr' ? [name] : [`-type=${type}`, name];
  const { stdout, stderr } = await execFileAsync('nslookup', args, {
    windowsHide: true,
    timeout: 15000,
    maxBuffer: 1024 * 1024,
  });
  return `${stdout || ''}\n${stderr || ''}`;
}

function parseNslookupMx(output: string): MxRecord[] {
  const records: MxRecord[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/mail exchanger\s*=\s*(\d+)\s+([^\s]+)/i);
    if (match) records.push({ priority: Number(match[1]), exchange: match[2].replace(/\.$/, '') });
  }
  return records;
}

function parseNslookupTxt(output: string): string[] {
  const records: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const quoted = [...line.matchAll(/"([^"]*)"/g)].map((match) => match[1]);
    if (quoted.length) records.push(quoted.join(''));
  }
  return [...new Set(records)];
}

function parseNslookupPtr(output: string): string[] {
  const records: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/(?:name|pointer)\s*=\s*([^\s]+)/i);
    if (match) records.push(match[1].replace(/\.$/, '').toLowerCase());
  }
  return [...new Set(records)];
}

async function resolveMxWithFallback(domain: string): Promise<{ records: MxRecord[]; resolver: string }> {
  try {
    return { records: await dns.resolveMx(domain), resolver: 'system DNS' };
  } catch (systemError) {
    if (!shouldFallback(systemError)) throw systemError;
    try {
      return { records: await publicResolver.resolveMx(domain), resolver: 'public DNS fallback' };
    } catch {
      const output = await runNslookup('mx', domain);
      const records = parseNslookupMx(output);
      if (!records.length) throw systemError;
      return { records, resolver: 'Windows nslookup fallback' };
    }
  }
}

async function resolveTxtWithFallback(name: string): Promise<{ records: string[]; resolver: string }> {
  try {
    const records = (await dns.resolveTxt(name)).map((parts) => parts.join(''));
    return { records, resolver: 'system DNS' };
  } catch (systemError) {
    if (!shouldFallback(systemError)) throw systemError;
    try {
      const records = (await publicResolver.resolveTxt(name)).map((parts) => parts.join(''));
      return { records, resolver: 'public DNS fallback' };
    } catch {
      const output = await runNslookup('txt', name);
      const records = parseNslookupTxt(output);
      if (!records.length) throw systemError;
      return { records, resolver: 'Windows nslookup fallback' };
    }
  }
}

async function reverseWithFallback(ip: string): Promise<{ records: string[]; resolver: string }> {
  try {
    return { records: await dns.reverse(ip), resolver: 'system DNS' };
  } catch (systemError) {
    if (!shouldFallback(systemError)) throw systemError;
    try {
      return { records: await publicResolver.reverse(ip), resolver: 'public DNS fallback' };
    } catch {
      const output = await runNslookup('ptr', ip);
      const records = parseNslookupPtr(output);
      if (!records.length) throw systemError;
      return { records, resolver: 'Windows nslookup fallback' };
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const hostname = cleanHost(body.hostname);
    const domain = cleanHost(body.domain);
    const serverIp = String(body.serverIp || '').trim();
    const selector = cleanHost(body.dkimSelector) || 'default';
    const mailFrom = String(body.mailFrom || '').trim().toLowerCase();

    if (!hostname || !domain) {
      return NextResponse.json({ error: 'hostname and domain are required' }, { status: 400 });
    }
    if (serverIp && !isIp(serverIp)) {
      return NextResponse.json({ error: 'serverIp must be a valid IPv4 or IPv6 address' }, { status: 400 });
    }

    const checks: Check[] = [];
    let addresses: string[] = [];
    try {
      const resolved = await dns.lookup(hostname, { all: true });
      addresses = resolved.map((entry) => entry.address);
      checks.push({ key: 'address', label: 'A / AAAA record', ok: addresses.length > 0, detail: addresses.join(', ') || 'No address records found' });
    } catch (error) {
      checks.push({ key: 'address', label: 'A / AAAA record', ok: false, detail: error instanceof Error ? error.message : 'Lookup failed' });
    }

    try {
      const result = await resolveMxWithFallback(domain);
      const mx = result.records;
      checks.push({ key: 'mx', label: 'Domain MX record', ok: mx.length > 0, detail: `${mx.sort((a,b) => a.priority-b.priority).map((entry) => `${entry.priority} ${entry.exchange}`).join(', ') || 'No MX records found'} (${result.resolver})` });
    } catch (error) {
      checks.push({ key: 'mx', label: 'Domain MX record', ok: false, detail: error instanceof Error ? error.message : 'Lookup failed' });
    }

    if (serverIp) {
      try {
        const result = await reverseWithFallback(serverIp);
        const ptr = result.records;
        checks.push({ key: 'ptr', label: 'Reverse DNS (PTR)', ok: ptr.some((name) => name.toLowerCase().replace(/\.$/, '') === hostname), detail: `${ptr.join(', ') || 'No PTR record found'} (${result.resolver})` });
      } catch (error) {
        checks.push({ key: 'ptr', label: 'Reverse DNS (PTR)', ok: false, detail: error instanceof Error ? error.message : 'Reverse lookup failed' });
      }
      checks.push({ key: 'ip-match', label: 'Hostname matches server IP', ok: addresses.includes(serverIp), detail: addresses.includes(serverIp) ? `${hostname} resolves to ${serverIp}` : `${hostname} resolves to ${addresses.join(', ') || 'nothing'}, not ${serverIp}` });
    } else {
      checks.push({ key: 'ptr', label: 'Reverse DNS (PTR)', ok: false, detail: 'Enter the public server IP to verify PTR' });
    }

    async function txtCheck(key: string, label: string, name: string, predicate: (value: string) => boolean) {
      try {
        const result = await resolveTxtWithFallback(name);
        const match = result.records.find(predicate);
        checks.push({ key, label, ok: Boolean(match), detail: `${match || result.records.join(' | ') || `No TXT record at ${name}`} (${result.resolver})` });
      } catch (error) {
        checks.push({ key, label, ok: false, detail: error instanceof Error ? error.message : 'TXT lookup failed' });
      }
    }

    await txtCheck('spf', 'SPF record', domain, (value) => /^v=spf1\b/i.test(value));
    await txtCheck('dkim', 'DKIM public key', `${selector}._domainkey.${domain}`, (value) => /\bv=DKIM1\b/i.test(value) || /\bp=/i.test(value));
    await txtCheck('dmarc', 'DMARC policy', `_dmarc.${domain}`, (value) => /^v=DMARC1\b/i.test(value));

    const mailFromDomain = mailFrom.includes('@') ? mailFrom.split('@').pop() || '' : '';
    checks.push({
      key: 'alignment',
      label: 'Envelope-domain alignment',
      ok: Boolean(mailFromDomain) && (mailFromDomain === domain || mailFromDomain.endsWith(`.${domain}`)),
      detail: mailFromDomain ? `${mailFromDomain} ${mailFromDomain === domain || mailFromDomain.endsWith(`.${domain}`) ? 'aligns with' : 'does not align with'} ${domain}` : 'Enter a valid envelope MAIL FROM address',
    });

    return NextResponse.json({ success: true, hostname, domain, checks });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Verification failed' }, { status: 500 });
  }
}
