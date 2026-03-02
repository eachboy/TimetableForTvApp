import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  // Разрешаем доступ к главной странице (логин)
  if (request.nextUrl.pathname === '/') {
    return NextResponse.next()
  }

  // Для остальных страниц проверка будет на клиенте через AuthGuard
  // Middleware не может проверить localStorage, поэтому полагаемся на клиентскую проверку
  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}

