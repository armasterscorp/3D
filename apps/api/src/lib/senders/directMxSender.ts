// apps/api/src/lib/senders/directMxSender.ts
import dns from 'dns';
import nodemailer from 'nodemailer';
import { promisify } from 'util';
import type { MailMessage, DirectMxConfig } from './types';

const resolveMx = promisify(dns.resolveMx);
const resolve4 = promisify(dns.resolve4);
const resolve6 = promisify(dns.resolve6);

export class TemporarySendError extends Error {
  public code?: string;
  public responseCode?: number;
  constructor(message: string, responseCode?: number, code?: string) {
    super(message);
    this.name = 'TemporarySendError';
    this.responseCode = responseCode;
    this.code = code;
  }
}

export class PermanentSendError extends Error {
  public responseCode?: number;
  constructor(message: string, responseCode?: number) {
    super(message);
    this.name = 'PermanentSendError';
    this.responseCode = responseCode;
  }
}

function sortMx(records: { priority: number; exchange: string }[]) {
  const buckets: Record<number, string[]> = {};
  for (const r of records) {
    buckets[r.priority] ??= [];
    buckets[r.priority].push(r.exchange);
  }
  const sortedPriorities = Object.keys(buckets)
    .map((p) => parseInt(p, 10))
    .sort((a, b) => a - b);
  const result: string[] = [];
  for (const p of sortedPriorities) {
    const list = buckets[p];
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    result.push(...list);
  }
  return result;
}

export async function resolveMxHosts(domain: string): Promise<string[]> {
  try {
    const mx = await resolveMx(domain);
    if (mx && mx.length > 0) {
      return sortMx(mx);
    }
  } catch (err) {
    // fall back to A/AAAA
  }

  try {
    const a4 = await resolve4(domain);
    if (a4 && a4.length) return a4;
  } catch (e) {}

  try {
    const a6 = await resolve6(domain);
    if (a6 && a6.length) return a6;
  } catch (e) {}

  throw new Error(`No MX or A/AAAA records found for ${domain}`);
}

export class DirectMxSender {
  private config: DirectMxConfig;

  constructor(config: DirectMxConfig) {
    this.config = config;
  }

  public async send(message: MailMessage): Promise<{ messageId: string; response: any; info: any }> {
    const recipients = Array.isArray(message.to) ? message.to : [message.to];
    if (recipients.length === 0) throw new Error('No recipients specified');
    const firstRecipient = recipients[0];
    const recipientAddress = typeof firstRecipient === 'string' ? firstRecipient : (firstRecipient as any).address;
    if (!recipientAddress) throw new Error('Invalid recipient address');
    const domain = recipientAddress.split('@').slice(-1)[0];
    const mxHosts = await resolveMxHosts(domain);

    let lastErr: any = null;
    for (const host of mxHosts) {
      try {
        const result = await this.attemptDelivery(host, message);
        return result;
      } catch (err: any) {
        lastErr = err;
        const rc = err && (err.responseCode || (err.response && err.response.statusCode));
        if (rc && rc >= 500 && rc < 600) {
          throw new PermanentSendError(`Permanent failure from ${host}: ${err.message}`, rc);
        }
        // otherwise try next MX
      }
    }

    if (lastErr) {
      const rc = lastErr && (lastErr.responseCode || (lastErr.response && lastErr.response.statusCode));
      throw new TemporarySendError(lastErr.message || 'Temporary delivery failure', rc);
    }
    throw new Error('Unknown delivery failure');
  }

  private async attemptDelivery(host: string, message: MailMessage) {
    const transportOptions: any = {
      host,
      port: 25,
      secure: false,
      requireTLS: !!this.config.requireTls,
      localAddress: this.config.bindIp || undefined,
      tls: {
        rejectUnauthorized:
          typeof this.config.tlsRejectUnauthorized === 'boolean'
            ? this.config.tlsRejectUnauthorized
            : true,
      },
      greetingTimeout: 30_000,
      connectionTimeout: 30_000,
    };

    if (this.config.dkim) {
      transportOptions.dkim = {
        domainName: this.config.dkim.domainName,
        keySelector: this.config.dkim.keySelector,
        privateKey: this.config.dkim.privateKey,
      };
    }

    const transporter = nodemailer.createTransport(transportOptions);

    const sendOptions: any = {
      from: message.from,
      to: message.to,
      cc: message.cc,
      bcc: message.bcc,
      subject: message.subject,
      text: message.text,
      html: message.html,
      attachments: message.attachments,
    };

    try {
      const info = await transporter.sendMail(sendOptions);
      return { messageId: info.messageId, response: info.response, info };
    } catch (err: any) {
      const rc = err && (err.responseCode || (err.response && err.response.statusCode));
      if (rc && rc >= 400 && rc < 500) {
        throw new TemporarySendError(err.message || '4xx SMTP temporary error', rc, err.code);
      }
      if (rc && rc >= 500) {
        throw new PermanentSendError(err.message || '5xx SMTP permanent error', rc);
      }
      throw new TemporarySendError(err.message || 'Network/SMTP error', rc);
    } finally {
      try {
        transporter.close();
      } catch (e) {}
    }
  }
}
