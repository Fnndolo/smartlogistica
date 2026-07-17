import type { NextConfig } from 'next';

/**
 * URL del API alcanzable desde el SERVIDOR del web (SSR + el proxy de abajo).
 * En Railway = la URL interna del servicio api (p.ej. http://api.railway.internal:PORT)
 * o su URL publica. En local = el API en :3001.
 *
 * Se normaliza el esquema: si la variable viene sin http(s):// (error comun al
 * pegar solo el dominio de Railway), se asume https:// — si no, Next rechaza el
 * rewrite ("destination does not start with /, http:// or https://").
 */
const rawApiInternal = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';
const apiInternal = /^https?:\/\//.test(rawApiInternal)
  ? rawApiInternal
  : `https://${rawApiInternal}`;

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  transpilePackages: ['@smartlogistica/shared'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
  /**
   * Proxy MISMO-ORIGEN hacia el API. El navegador solo habla con el web
   * (window.location.origin) y Next reenvia /v1/* al API por dentro. Asi la
   * cookie de sesion es de un solo origen (SameSite=Lax funciona) y no hay CORS,
   * aunque web y api esten en dominios distintos de Railway.
   */
  async rewrites() {
    return [{ source: '/v1/:path*', destination: `${apiInternal}/v1/:path*` }];
  },
};

export default nextConfig;
