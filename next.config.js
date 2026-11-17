/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV !== 'production';
// Next's static App Router pages contain inline hydration scripts. A nonce-based
// script policy would require dynamic rendering; keep that migration separate.
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob: https://*.elevenlabs.io https://*.livekit.cloud",
  "connect-src 'self' https://*.elevenlabs.io wss://*.elevenlabs.io https://*.livekit.cloud wss://*.livekit.cloud" + (isDev ? " ws://localhost:* ws://127.0.0.1:*" : ''),
  "worker-src 'self' blob:"
].join('; ');

module.exports = {
  reactStrictMode: true,
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Content-Security-Policy', value: csp },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Frame-Options', value: 'DENY' }
      ]
    }];
  }
};
