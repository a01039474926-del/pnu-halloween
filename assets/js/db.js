import { CONFIG } from './config.js';

export async function rpc(fn, params = {}, options = {}) {
  const res = await fetch(`${CONFIG.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: CONFIG.supabaseKey,
      Authorization: `Bearer ${CONFIG.supabaseKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
    keepalive: Boolean(options.keepalive),
    signal: options.signal,
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const message =
      (data && (data.message || data.error_description || data.hint)) || `API error ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    err.code = data && data.code;
    err.detail = data;
    throw err;
  }

  return data;
}
