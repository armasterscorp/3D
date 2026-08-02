import { NextResponse } from 'next/server';

import { getAdobeBrowserStore } from '@/lib/adobe-browser-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = getAdobeBrowserStore().session;

  if (!session || session.page.isClosed()) {
    return NextResponse.json(
      { success: false, error: 'Adobe browser is not connected.' },
      { status: 409 }
    );
  }

  try {
    const image = await session.page.screenshot({
      type: 'jpeg',
      quality: 72,
      animations: 'disabled',
      caret: 'hide',
    });

    const responseBody = new Uint8Array(image);

    return new NextResponse(responseBody, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        Pragma: 'no-cache',
      },
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
