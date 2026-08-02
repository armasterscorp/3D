import { NextRequest, NextResponse } from 'next/server';
import {
  LICENSE_COOKIE_NAME,
  logoutLicenseSession,
} from '@/lib/license';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const token = request.cookies.get(LICENSE_COOKIE_NAME)?.value;
  const result = logoutLicenseSession(token);

  console.log('[LICENSE LOGOUT]', {
    released: result.released,
    licenseId: result.licenseId,
    error: result.error,
  });

  const response = NextResponse.json(result, {
    status: result.released ? 200 : 409,
  });

  response.headers.set(
    'Cache-Control',
    'no-store, no-cache, max-age=0, must-revalidate'
  );

  // Only remove the browser token after the matching server-side session
  // has actually been deleted. This prevents a false successful logout.
  if (result.released) {
    response.cookies.set({
      name: LICENSE_COOKIE_NAME,
      value: '',
      httpOnly: true,
      sameSite: 'strict',
      secure: request.nextUrl.protocol === 'https:',
      path: '/',
      expires: new Date(0),
      maxAge: 0,
    });
  }

  return response;
}
