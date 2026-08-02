// apps/api/src/app/api/senders/direct-mx/route.ts
import { NextResponse } from 'next/server';
import { SenderRegistry } from '@/lib/senders/registry';

export async function GET() {
  const list = await SenderRegistry.list();
  return NextResponse.json({ ok: true, senders: list });
}

export async function POST(req: Request) {
  const body = await req.json();
  if (!body.name) return NextResponse.json({ ok: false, error: 'name required' }, { status: 400 });

  const cfg = {
    id: body.id,
    name: body.name,
    bindIp: body.bindIp || null,
    requireTls: !!body.requireTls,
    tlsRejectUnauthorized: body.tlsRejectUnauthorized ?? true,
    dkim: body.dkim || null,
    maxConcurrencyPerDomain: body.maxConcurrencyPerDomain || 2,
    retryWindowHours: body.retryWindowHours || 48,
  };

  const saved = await SenderRegistry.upsertDirectMx(cfg);
  return NextResponse.json({ ok: true, sender: saved });
}
