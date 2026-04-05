import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

function addCorsHeaders(response: NextResponse) {
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Extension-Source');
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Handle CORS preflight for API routes
  if (pathname.startsWith('/api/') && request.method === 'OPTIONS') {
    return addCorsHeaders(new NextResponse(null, { status: 204 }));
  }

  // Allow extension API requests without auth (identified by header)
  if (pathname.startsWith('/api/') && request.headers.get('X-Extension-Source') === 'se-merchant-scraper') {
    return addCorsHeaders(NextResponse.next());
  }

  const token = await getToken({ req: request });

  if (!token) {
    // API routes return 401 instead of redirect
    if (pathname.startsWith('/api/')) {
      return addCorsHeaders(
        NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      );
    }

    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', request.url);
    return NextResponse.redirect(loginUrl);
  }

  const response = NextResponse.next();
  if (pathname.startsWith('/api/')) {
    return addCorsHeaders(response);
  }
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - /login
     * - /api/auth (NextAuth routes)
     * - /_next/static (static files)
     * - /_next/image (image optimization)
     * - /favicon.ico
     */
    '/((?!login|api/auth|_next/static|_next/image|favicon\\.ico).*)',
  ],
};
