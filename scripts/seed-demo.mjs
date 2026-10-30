import { readFileSync } from 'node:fs';

const action = process.argv.includes('--reset') ? 'reset' : 'seed';
const configUrl = new URL('../assets/js/config.js', import.meta.url);
const configSource = readFileSync(configUrl, 'utf8');

const url =
  process.env.SUPABASE_URL ||
  configSource.match(/supabaseUrl:\s*'([^']+)'/)?.[1] ||
  '';
const key =
  process.env.SUPABASE_ANON_KEY ||
  configSource.match(/supabaseKey:\s*'([^']+)'/)?.[1] ||
  '';
const passcode = process.env.ADMIN_PASSCODE || 'pnu-boo-2026!';

if (!url || !key) {
  console.error('Supabase URL 또는 anon key를 찾지 못했습니다. assets/js/config.js를 확인하세요.');
  process.exit(1);
}

const fn = action === 'reset' ? 'admin_reset_demo' : 'admin_seed_demo';

const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
  method: 'POST',
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ p_passcode: passcode }),
});

const text = await res.text();
let data;
try {
  data = text ? JSON.parse(text) : null;
} catch {
  data = text;
}

if (!res.ok) {
  console.error(`[${action}] 실패 (${res.status})`);
  console.error(typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
  process.exit(1);
}

console.log(`[${action}] 완료`);
console.log(JSON.stringify(data, null, 2));
