export const securityHeaders={
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
  'Permissions-Policy':'camera=(self), microphone=(), geolocation=()',
  'X-Frame-Options':'SAMEORIGIN',
  'Content-Security-Policy':"default-src 'self'; script-src 'self' https://unpkg.com https://cdn.jsdelivr.net 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://server.arcgisonline.com https://tile.openstreetmap.org; connect-src 'self' https://server.arcgisonline.com https://tile.openstreetmap.org https://unpkg.com https://cdn.jsdelivr.net https://tessdata.projectnaptha.com; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'",
};
