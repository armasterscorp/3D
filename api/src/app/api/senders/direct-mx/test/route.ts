// apps/api/src/app/api/senders/direct-mx/test/route.ts
import { NextResponse } from 'next/server';
import { SenderRegistry } from '@/lib/senders/registry';
import type { MailMessage } from '@/lib/senders/types';

export async function POST(req: Request) {
  const body = await req.json();
  const { senderId, message } = body as { senderId: string; message: MailMessage };
  if (!senderId) return NextResponse.json({ ok: false, error: 'senderId required' }, { status: 400 });
  if (!message || !message.to) return NextResponse.json({ ok: false, error: 'message.to required' }, { status: 400 });

  const stored = await SenderRegistry.getById(senderId);
  if (!stored) return NextResponse.json({ ok: false, error: 'sender not found' }, { status: 404 });

  const instance = SenderRegistry.createInstance(stored);

  try {
    const res = await instance.send(message);
    return NextResponse.json({ ok: true, result: res });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'send error', name: err?.name, responseCode: err?.responseCode }, { status: 500 });
  }
}
