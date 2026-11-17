/** @type {import('next').NextConfig} */

const isDev = process.env.NODE_ENV !== "production";

// Browser origins used by the studio: Google Fonts in globals.css, and the
// ElevenLabs voice SDK (api + LiveKit RTC, including residency hosts).
// OpenAI calls stay server-side, so they are not needed in the CSP.
const connectSrc = [
  "'self'",
  "https://api.elevenlabs.io",
  "https://*.elevenlabs.io",
  "wss://api.elevenlabs.io",
  "wss://*.elevenlabs.io",
  "https://*.livekit.cloud",
  "wss://*.livekit.cloud"
];
if (isDev) {
  connectSrc.push("http://localhost:*", "ws://localhost:*", "wss://localhost:*");
} else {
  // Vercel preview toolbar / comments, if present on a deployment.
  connectSrc.push("https://vercel.live", "wss://*.pusher.com", "https://*.pusher.com");
}

// AudioWorklet.addModule is governed by script-src (not worker-src) in Chromium.
// The @elevenlabs/client SDK loads rawAudioProcessor / audioConcatProcessor by
// URL.createObjectURL(blob) and, if that fails, a data:application/javascript URL.
// Without blob: and data: here, Start Coaching fails with
// "Failed to load the rawAudioProcessor worklet module".
const scriptSrc = isDev
  ? ["'self'", "'unsafe-inline'", "'unsafe-eval'", "blob:", "data:"]
  : ["'self'", "'unsafe-inline'", "blob:", "data:", "https://vercel.live"];

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src ${scriptSrc.join(" ")}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "worker-src 'self' blob: data:",
  `connect-src ${connectSrc.join(" ")}`,
  "frame-src 'self' https://vercel.live",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests"
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" }
];

const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders
      }
    ];
  }
};

module.exports = nextConfig;
