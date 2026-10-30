import { rpc } from './db.js';

const SESSION_KEY = 'pnu_session_v1';
const VISITOR_KEY = 'pnu_visitor_v1';
const QUEUE_KEY = 'pnu_queue_v1';
const STEPS_KEY = 'pnu_steps_v1';
const SESSION_TTL = 30 * 60 * 1000;
const MAX_QUEUE = 200;

const FUNNEL = {
  1: { key: 'landing', label: '랜딩 방문' },
  2: { key: 'content_explore', label: '콘텐츠 탐색' },
  3: { key: 'ticket_cta', label: '예매 CTA 클릭' },
  4: { key: 'apply_start', label: '티켓 선택 완료' },
  5: { key: 'info_submitted', label: '정보 입력 완료' },
  6: { key: 'purchase_complete', label: '예매 완료' },
};

let sessionId = null;
let visitorId = null;
let sessionPayload = null;
let sessionReady = false;
let sessionPromise = null;
let initialized = false;
let queue = [];
let flushing = false;
let flushTimer = null;
let maxScroll = 0;
let startedAt = Date.now();
let rageClicks = [];
let lastRageAt = 0;

function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked */
  }
}

function detectDevice() {
  const w = Math.min(window.screen?.width || window.innerWidth, window.innerWidth);
  if (w < 768) return 'mobile';
  if (w < 1024) return 'tablet';
  return 'desktop';
}

function detectBrowser() {
  const ua = navigator.userAgent || '';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/SamsungBrowser/.test(ua)) return 'Samsung Internet';
  if (/KAKAOTALK/i.test(ua)) return 'KakaoTalk';
  if (/Instagram/i.test(ua)) return 'Instagram';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  if (/Firefox\//.test(ua)) return 'Firefox';
  return 'Other';
}

function detectOs() {
  const ua = navigator.userAgent || '';
  if (/Android/.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS X/.test(ua)) return 'macOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Other';
}

function startSession() {
  const now = Date.now();
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved.id && now - saved.last < SESSION_TTL) {
        saved.last = now;
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(saved));
        return { id: saved.id, fresh: false, meta: saved.meta || {} };
      }
    }
  } catch {
    /* ignore */
  }

  const params = new URLSearchParams(location.search);
  const meta = {
    landing_page: location.pathname + location.search,
    referrer: document.referrer || '',
    utm_source: params.get('utm_source') || '',
    utm_medium: params.get('utm_medium') || '',
    utm_campaign: params.get('utm_campaign') || '',
    utm_content: params.get('utm_content') || '',
    utm_term: params.get('utm_term') || '',
  };
  const id = uid();
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id, last: now, meta }));

  const visitorRaw = localStorage.getItem(VISITOR_KEY);
  visitorId = visitorRaw || uid();
  if (!visitorRaw) localStorage.setItem(VISITOR_KEY, visitorId);

  return { id, fresh: true, meta };
}

function persistSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    saved.last = Date.now();
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(saved));
  } catch {
    /* ignore */
  }
}

function loadSteps() {
  const saved = readJson(STEPS_KEY, null);
  if (!saved || saved.sid !== sessionId) return new Set();
  return new Set(saved.steps || []);
}

function saveSteps(set) {
  writeJson(STEPS_KEY, { sid: sessionId, steps: Array.from(set) });
}

let seenSteps = new Set();

function scheduleFlush(delay = 3000) {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, delay);
}

function persistQueue() {
  writeJson(QUEUE_KEY, queue);
}

function pushEvent(event) {
  queue.push(event);
  if (queue.length > MAX_QUEUE) queue = queue.slice(queue.length - MAX_QUEUE);
  persistQueue();
  scheduleFlush();
}

async function ensureRemote() {
  if (sessionReady) return;
  if (sessionPromise) return sessionPromise;

  sessionPromise = rpc('track_session', { p_payload: sessionPayload })
    .then(() => {
      sessionReady = true;
    })
    .catch(() => {
      sessionReady = false;
    })
    .finally(() => {
      sessionPromise = null;
    });

  return sessionPromise;
}

export async function flush(keepalive = false) {
  if (flushing || queue.length === 0) return;
  flushing = true;

  try {
    await ensureRemote();
    if (!sessionReady) return;

    const batch = queue.slice(0, 20);
    await rpc('track_events', { p_events: batch }, { keepalive });
    queue = queue.slice(batch.length);
    persistQueue();
  } catch {
    /* keep queued for the next attempt */
  } finally {
    flushing = false;
    if (queue.length > 0) scheduleFlush(8000);
  }
}

export function track(eventName, properties = {}, extra = {}) {
  if (!sessionId) return;
  persistSession();

  pushEvent({
    session_id: sessionId,
    visitor_id: visitorId,
    event_name: eventName,
    step_index: extra.step_index ?? null,
    page: extra.page || location.pathname,
    element_id: extra.element_id || null,
    element_text: extra.element_text || null,
    section: extra.section || null,
    properties: properties || {},
  });
}

export function funnelStep(index, properties = {}) {
  if (!FUNNEL[index] || seenSteps.has(index)) return;
  const def = FUNNEL[index];
  seenSteps.add(index);
  saveSteps(seenSteps);
  track('funnel_step', { step_key: def.key, step_label: def.label, ...properties }, {
    step_index: index,
    section: properties.section || null,
  });
}

export function trackPurchase(order) {
  funnelStep(6, {
    order_no: order.order_no,
    amount: order.amount,
    ticket_type: order.ticket_type,
    quantity: order.quantity,
    section: 'checkout',
  });
}

export function getIds() {
  return { sessionId, visitorId };
}

function setupScrollTracking() {
  const onScroll = () => {
    const doc = document.documentElement;
    const total = Math.max(doc.scrollHeight - window.innerHeight, 1);
    const depth = Math.min(100, Math.round((window.scrollY / total) * 100));
    if (depth > maxScroll) maxScroll = depth;

    [25, 50, 75, 100].forEach((mark) => {
      if (maxScroll >= mark && !seenSteps.has(`scroll-${mark}`)) {
        seenSteps.add(`scroll-${mark}`);
        track('scroll_depth', { depth: mark });
        if (mark === 50) funnelStep(2, { trigger: 'scroll_50' });
      }
    });
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

function setupClickTracking() {
  document.addEventListener(
    'click',
    (event) => {
      const el = event.target.closest('[data-track]');
      const now = Date.now();

      rageClicks = rageClicks.filter(
        (c) => now - c.t < 1000 && Math.abs(c.x - event.clientX) < 40 && Math.abs(c.y - event.clientY) < 40,
      );
      rageClicks.push({ t: now, x: event.clientX, y: event.clientY });
      if (rageClicks.length >= 3 && now - lastRageAt > 3000) {
        lastRageAt = now;
        track('rage_click', {
          count: rageClicks.length,
          target: el ? el.dataset.track : event.target.tagName,
        });
        rageClicks = [];
      }

      if (!el) return;
      const sectionEl = el.closest('[data-section]');
      track(
        'button_click',
        {
          href: el.getAttribute('href') || null,
          tag: el.tagName.toLowerCase(),
          text: (el.dataset.trackLabel || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        },
        {
          element_id: el.dataset.track,
          element_text: (el.dataset.trackLabel || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
          section: sectionEl ? sectionEl.dataset.section : el.dataset.section || 'unknown',
        },
      );
    },
    { capture: true },
  );
}

function setupSectionTracking() {
  if (!('IntersectionObserver' in window)) return;
  const seen = new Set();
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting || entry.intersectionRatio < 0.4) return;
        const name = entry.target.dataset.section;
        if (!name || seen.has(name)) return;
        seen.add(name);
        track('section_view', { section: name });
      });
    },
    { threshold: [0.4, 0.75] },
  );

  document.querySelectorAll('[data-section]').forEach((el) => observer.observe(el));
}

function setupEngagement() {
  [15, 45, 120].forEach((seconds) => {
    setTimeout(() => {
      if (document.visibilityState === 'visible') {
        track('engaged_time', { seconds });
      }
    }, seconds * 1000);
  });

  setInterval(() => {
    if (document.visibilityState === 'visible') {
      track('heartbeat', { time_on_page: Math.round((Date.now() - startedAt) / 1000) });
    }
  }, 90000);
}

function setupErrorTracking() {
  let errors = 0;
  const report = (message, source) => {
    if (errors >= 3) return;
    errors += 1;
    track('client_error', {
      message: String(message || '').slice(0, 200),
      source: String(source || '').slice(0, 120),
    });
  };

  window.addEventListener('error', (event) => {
    report(event.message, event.filename);
  });
  window.addEventListener('unhandledrejection', (event) => {
    report(event.reason?.message || event.reason, 'unhandledrejection');
  });
}

function setupExitTracking() {
  const finish = () => {
    track('page_leave', {
      time_on_page: Math.round((Date.now() - startedAt) / 1000),
      max_scroll: maxScroll,
    });
    flush(true);
  };

  window.addEventListener('pagehide', finish);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true);
  });
}

export function initAnalytics() {
  if (initialized) return;
  initialized = true;

  const session = startSession();
  sessionId = session.id;
  if (!visitorId) {
    visitorId = localStorage.getItem(VISITOR_KEY) || uid();
    localStorage.setItem(VISITOR_KEY, visitorId);
  }

  queue = readJson(QUEUE_KEY, []);
  if (!Array.isArray(queue)) queue = [];
  seenSteps = loadSteps();

  sessionPayload = {
    session_id: sessionId,
    visitor_id: visitorId,
    landing_page: session.meta.landing_page || location.pathname,
    referrer: session.meta.referrer || document.referrer || '',
    utm_source: session.meta.utm_source || '',
    utm_medium: session.meta.utm_medium || '',
    utm_campaign: session.meta.utm_campaign || '',
    utm_content: session.meta.utm_content || '',
    utm_term: session.meta.utm_term || '',
    device_type: detectDevice(),
    browser: detectBrowser(),
    os: detectOs(),
    screen_width: window.screen?.width || window.innerWidth,
    language: navigator.language || 'ko-KR',
  };

  setupScrollTracking();
  setupClickTracking();
  setupSectionTracking();
  setupEngagement();
  setupErrorTracking();
  setupExitTracking();

  ensureRemote().then(() => {
    track('page_view', {
      title: document.title,
      referrer: document.referrer || '',
      viewport: `${window.innerWidth}x${window.innerHeight}`,
    });
    funnelStep(1, { trigger: 'page_load' });
    flush();
  });
}
