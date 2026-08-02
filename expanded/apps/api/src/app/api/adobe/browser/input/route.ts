import { NextRequest, NextResponse } from 'next/server';

import { getAdobeBrowserStore } from '@/lib/adobe-browser-store';

export const dynamic = 'force-dynamic';

type BrowserInput =
  | { action: 'click'; x: number; y: number; button?: 'left' | 'middle' | 'right'; clickCount?: number }
  | { action: 'move'; x: number; y: number }
  | { action: 'wheel'; deltaX?: number; deltaY?: number }
  | { action: 'type'; text: string }
  | { action: 'press'; key: string }
  | { action: 'back' | 'forward' | 'reload' };

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export async function POST(request: NextRequest) {
  const session = getAdobeBrowserStore().session;

  if (!session || session.page.isClosed()) {
    return NextResponse.json(
      { success: false, error: 'Adobe browser is not connected.' },
      { status: 409 }
    );
  }

  try {
    const input = (await request.json()) as BrowserInput;
    const page = session.page;

    switch (input.action) {
      case 'click':
        await page.mouse.click(
          finiteNumber(input.x),
          finiteNumber(input.y),
          {
            button: input.button || 'left',
            clickCount: Math.max(1, Math.min(3, finiteNumber(input.clickCount, 1))),
          }
        );
        break;
      case 'move':
        await page.mouse.move(finiteNumber(input.x), finiteNumber(input.y));
        break;
      case 'wheel':
        await page.mouse.wheel(
          finiteNumber(input.deltaX),
          finiteNumber(input.deltaY)
        );
        break;
      case 'type':
        await page.keyboard.insertText(String(input.text || ''));
        break;
      case 'press':
        await page.keyboard.press(String(input.key || ''));
        break;
      case 'back':
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
        break;
      case 'forward':
        await page.goForward({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
        break;
      case 'reload':
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
        break;
      default:
        return NextResponse.json(
          { success: false, error: 'Unsupported browser input action.' },
          { status: 400 }
        );
    }

    return NextResponse.json({
      success: true,
      currentUrl: page.url(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
