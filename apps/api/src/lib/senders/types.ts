// apps/api/src/lib/senders/types.ts
export type MailAddress = { name?: string; address: string };

export type MailMessage = {
  from: string | MailAddress;
  to: string | MailAddress | Array<string | MailAddress>;
  cc?: string | MailAddress | Array<string | MailAddress>;
  bcc?: string | MailAddress | Array<string | MailAddress>;
  subject?: string;
  text?: string;
  html?: string;
  attachments?: Array<
    | { filename?: string; path?: string; content?: Buffer | string; contentType?: string }
  >;
  campaignId?: string;
  leadId?: string;
};

export type DirectMxConfig = {
  id?: string;
  name: string;
  bindIp?: string | null;
  requireTls?: boolean;
  tlsRejectUnauthorized?: boolean;
  dkim?: { domainName: string; keySelector: string; privateKey: string } | null;
  maxConcurrencyPerDomain?: number;
  retryWindowHours?: number;
};
