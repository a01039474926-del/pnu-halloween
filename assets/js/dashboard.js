import { rpc } from './db.js';

const PASS_KEY = 'pnu_admin_pass_v1';
const REFRESH_MS = 30000;
const nf = new Intl.NumberFormat('ko-KR');
const dateTimeFmt = new Intl.DateTimeFormat('ko-KR', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Seoul',
});

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const el = {
  gate: $('#auth-gate'),
  form: $('#auth-form'),
  passcode: $('#passcode'),
  authError: $('#auth-error'),
  authSubmit: $('#auth-submit'),
  dash: $('#dashboard'),
  rangeTabs: $$('[data-days]'),
  rangeLabel: $('#range-label'),
  lastUpdated: $('#last-updated'),
  refreshBtn: $('#refresh-btn'),
  refreshNote: $('#refresh-note'),
  logout: $('#logout-btn'),
  demoBanner: $('#demo-banner'),
  demoCount: $('#demo-count'),
  seedDemo: $('#seed-demo'),
  resetDemo: $('#reset-demo'),
  errorBox: $('#error-box'),
  errorMessage: $('#error-message'),
  errorRetry: $('#error-retry'),
  liveSessions: $('#live-sessions'),
  earlyRemaining: $('#early-remaining'),
  earlySold: $('#early-sold'),
  earlyFill: $('#early-bar-fill'),
  earlyNote: $('#early-stock-note'),
  totalOrders: $('#total-orders'),
  kpi: {
    sessions: $('#kpi-sessions'),
    visitors: $('#kpi-visitors'),
    pageviews: $('#kpi-pageviews'),
    orders: $('#kpi-orders'),
    revenue: $('#kpi-revenue'),
    aov: $('#kpi-aov'),
    conversion: $('#kpi-conversion'),
    clicks: $('#kpi-clicks'),
    errors: $('#kpi-errors'),
    checkout: $('#kpi-checkout'),
    apply: $('#kpi-apply'),
  },
  funnelList: $('#funnel-list'),
  funnelInsight: $('#funnel-insight'),
  funnelWorst: $('#funnel-worst'),
  insights: $('#insights-list'),
  chart: $('#chart'),
  buttonsBody: $('#buttons-body'),
  buttonsEmpty: $('#buttons-empty'),
  sourcesBody: $('#sources-body'),
  sourcesEmpty: $('#sources-empty'),
  devices: $('#devices-list'),
  ticketMix: $('#ticket-mix'),
  ordersBody: $('#orders-body'),
  ordersEmpty: $('#orders-empty'),
};

let passcode = sessionStorage.getItem(PASS_KEY) || '';
let days = 7;
let loading = false;
let authenticating = false;
let lastLoadedAt = 0;
let refreshTimer = null;

const veil = document.createElement('div');
veil.className = 'loading-veil';
veil.innerHTML = '<div class="loading-ring" role="status" aria-label="불러오는 중"></div>';
document.body.appendChild(veil);

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  updateRangeTabs();
  if (passcode) {
    enterDashboard();
  } else {
    showGate();
  }
});

function bindEvents() {
  el.form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = (el.passcode?.value || '').trim();
    if (!value) {
      setAuthError('비밀번호를 입력해 주세요.');
      return;
    }
    authenticate(value);
  });

  el.rangeTabs.forEach((button) => {
    button.addEventListener('click', () => {
      const next = Number(button.dataset.days);
      if (!next || next === days) return;
      days = next;
      updateRangeTabs();
      loadData();
    });
  });

  el.refreshBtn?.addEventListener('click', () => {
    el.refreshBtn.classList.add('is-spinning');
    loadData().finally(() => {
      setTimeout(() => el.refreshBtn.classList.remove('is-spinning'), 400);
    });
  });

  el.logout?.addEventListener('click', () => {
    sessionStorage.removeItem(PASS_KEY);
    passcode = '';
    showGate();
  });

  el.errorRetry?.addEventListener('click', () => loadData());

  el.seedDemo?.addEventListener('click', () => runAdmin('admin_seed_demo', '데모 데이터를 생성했습니다.'));
  el.resetDemo?.addEventListener('click', () => {
    if (!window.confirm('데모 세션과 주문을 모두 삭제할까요? 실제 데이터는 유지됩니다.')) return;
    runAdmin('admin_reset_demo', '데모 데이터를 삭제했습니다.');
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastLoadedAt > REFRESH_MS) loadData();
  });
}

async function authenticate(value) {
  if (authenticating) return;
  authenticating = true;
  setAuthError('');
  if (el.authSubmit) {
    el.authSubmit.disabled = true;
    el.authSubmit.textContent = '확인 중';
  }
  try {
    await rpc('admin_metrics', { p_passcode: value, p_days: 1 });
    passcode = value;
    sessionStorage.setItem(PASS_KEY, value);
    enterDashboard();
  } catch (err) {
    setAuthError(isPasscodeError(err) ? '비밀번호가 올바르지 않습니다.' : '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.');
    el.passcode?.focus();
  } finally {
    authenticating = false;
    if (el.authSubmit) {
      el.authSubmit.disabled = false;
      el.authSubmit.textContent = '입장';
    }
  }
}

function enterDashboard() {
  el.gate.hidden = true;
  el.dash.hidden = false;
  el.dash.setAttribute('tabindex', '-1');
  el.dash.focus({ preventScroll: true });
  loadData();
  startAutoRefresh();
}

function showGate() {
  stopAutoRefresh();
  el.dash.hidden = true;
  el.gate.hidden = false;
  setAuthError('');
  el.passcode.value = '';
  setTimeout(() => el.passcode?.focus(), 60);
}

function setAuthError(message) {
  if (!el.authError) return;
  el.authError.textContent = message || '';
}

function updateRangeTabs() {
  el.rangeTabs.forEach((button) => {
    const active = Number(button.dataset.days) === days;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });
  if (el.rangeLabel) el.rangeLabel.textContent = days === 1 ? '오늘' : `최근 ${days}일`;
}

function startAutoRefresh() {
  stopAutoRefresh();
  refreshTimer = setInterval(() => {
    if (document.visibilityState === 'visible') loadData({ silent: true });
  }, REFRESH_MS);
}

function stopAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}

async function loadData(options = {}) {
  if (loading || !passcode) return;
  loading = true;
  if (!options.silent) veil.classList.add('is-visible');
  el.errorBox.hidden = true;

  try {
    const [data, status] = await Promise.all([
      rpc('admin_metrics', { p_passcode: passcode, p_days: days }),
      rpc('get_ticket_status'),
    ]);
    lastLoadedAt = Date.now();
    render(data, status);
  } catch (err) {
    if (isPasscodeError(err)) {
      sessionStorage.removeItem(PASS_KEY);
      passcode = '';
      showGate();
      setAuthError('세션이 만료되었습니다. 다시 로그인해 주세요.');
      return;
    }
    el.errorBox.hidden = false;
    el.errorMessage.textContent = err?.message || '알 수 없는 오류가 발생했습니다.';
  } finally {
    loading = false;
    veil.classList.remove('is-visible');
  }
}

function render(data, status) {
  const kpis = data?.kpis || {};
  const funnel = Array.isArray(data?.funnel) ? data.funnel : [];
  const daily = Array.isArray(data?.daily) ? data.daily : [];
  const buttons = Array.isArray(data?.buttons) ? data.buttons : [];
  const sources = Array.isArray(data?.sources) ? data.sources : [];
  const devices = Array.isArray(data?.devices) ? data.devices : [];
  const tickets = Array.isArray(data?.ticket_mix) ? data.ticket_mix : [];
  const recent = Array.isArray(data?.recent_orders) ? data.recent_orders : [];

  if (el.lastUpdated) {
    el.lastUpdated.textContent = data?.generated_at ? dateTimeFmt.format(new Date(data.generated_at)) : '-';
  }
  if (el.liveSessions) el.liveSessions.textContent = nf.format(kpis.live_sessions || 0);

  renderEarly(status);
  renderKpis(kpis);
  renderDemo(kpis);
  renderFunnel(funnel);
  renderInsights({ kpis, funnel, sources, devices, tickets, status });
  renderChart(daily);
  renderButtons(buttons);
  renderSources(sources);
  renderDevices(devices);
  renderTickets(tickets);
  renderOrders(recent);
}

function renderEarly(status) {
  if (!status) return;
  const total = Number(status.early_total || 100);
  const sold = Number(status.early_sold || 0);
  const remaining = Number(status.early_remaining ?? total);
  const percent = Math.min(100, Math.round((sold / Math.max(total, 1)) * 100));

  if (el.earlyRemaining) el.earlyRemaining.textContent = nf.format(remaining);
  if (el.earlySold) el.earlySold.textContent = nf.format(sold);
  if (el.totalOrders) el.totalOrders.textContent = nf.format(status.total_orders || 0);
  if (el.earlyFill) el.earlyFill.style.width = `${percent}%`;
  if (el.earlyNote) el.earlyNote.textContent = `얼리버드 ${percent}% 판매 · 데모 제외`;
}

function renderKpis(kpis) {
  setText(el.kpi.sessions, nf.format(kpis.sessions || 0));
  setText(el.kpi.visitors, nf.format(kpis.visitors || 0));
  setText(el.kpi.pageviews, nf.format(kpis.page_views || 0));
  setText(el.kpi.orders, nf.format(kpis.orders || 0));
  setText(el.kpi.revenue, `${nf.format(kpis.revenue || 0)}원`);
  setText(el.kpi.aov, `${nf.format(kpis.aov || 0)}원`);
  setText(el.kpi.conversion, `${Number(kpis.conversion_rate || 0).toFixed(2)}%`);
  setText(el.kpi.clicks, nf.format(kpis.total_clicks || 0));
  setText(el.kpi.errors, nf.format(kpis.form_errors || 0));
  setText(el.kpi.checkout, nf.format(kpis.checkout_reach || 0));
  setText(el.kpi.apply, nf.format(kpis.apply_reach || 0));
}

function renderDemo(kpis) {
  const sessions = Number(kpis.demo_sessions || 0);
  const orders = Number(kpis.demo_orders || 0);
  const hasDemo = sessions > 0 || orders > 0;
  el.demoBanner.hidden = !hasDemo;
  if (hasDemo) {
    el.demoCount.textContent = `데모 세션 ${nf.format(sessions)}개 · 데모 주문 ${nf.format(orders)}건은 실제 지표와 분리해 해석하세요.`;
  }
}

function renderFunnel(funnel) {
  el.funnelList.innerHTML = '';
  if (!funnel.length) {
    el.funnelInsight.textContent = '아직 퍼널 데이터가 없습니다.';
    setText(el.funnelWorst, '-');
    return;
  }

  const first = Math.max(Number(funnel[0]?.sessions || 0), 1);
  const worst = funnel.reduce(
    (acc, step, index, list) => {
      if (index === list.length - 1 || !step.sessions) return acc;
      const rate = Number(step.dropoff_rate || 0);
      return rate > acc.rate ? { rate, step, next: list[index + 1], index } : acc;
    },
    { rate: 0, step: null, next: null, index: -1 },
  );

  funnel.forEach((step, index) => {
    const sessions = Number(step.sessions || 0);
    const width = sessions > 0 ? Math.max(2, (sessions / first) * 100) : 0;
    const dropRate = Number(step.dropoff_rate || 0);
    const isDrop = index === worst.index;

    const row = document.createElement('li');
    row.className = `funnel-row${isDrop ? ' is-drop' : ''}`;
    row.innerHTML = `
      <span class="funnel-name"><span class="funnel-step-no">${esc(String(step.step_index))}</span>${esc(step.step_label || step.step_key || '')}</span>
      <span class="funnel-bar-wrap">
        <span class="funnel-bar" style="width: ${width.toFixed(1)}%">
          <span class="funnel-count">${nf.format(sessions)}</span>
        </span>
      </span>
      <span class="funnel-meta">
        <strong>${Number(step.step_rate || 0).toFixed(1)}%</strong>
        ${
          index === 0
            ? '시작'
            : index === funnel.length - 1
              ? '최종'
              : `<span class="${dropRate > 0 ? 'drop' : ''}">-${dropRate.toFixed(1)}%</span>`
        }
      </span>
    `;
    el.funnelList.appendChild(row);
  });

  if (worst) {
    el.funnelInsight.innerHTML = `<strong>${esc(worst.step.step_label)} → ${esc(worst.next.step_label)}</strong> 구간에서 <strong>${worst.rate.toFixed(1)}%</strong>가 이탈했습니다. ${esc(suggestionFor(worst.step.step_key))}`;
    setText(el.funnelWorst, `${worst.step.step_label} → ${worst.next.step_label} · ${worst.rate.toFixed(1)}%`);
  } else {
    el.funnelInsight.textContent = '아직 뚜렷한 이탈 구간이 없습니다. 데이터가 쌓이면 자동으로 분석합니다.';
    setText(el.funnelWorst, '없음');
  }
}

function suggestionFor(key) {
  const map = {
    landing: '첫 화면의 헤드라인과 CTA를 더 명확하게 테스트해 보세요.',
    content_explore: '스크롤 초반에 핵심 혜택과 티켓 가격을 먼저 노출해 보세요.',
    ticket_cta: '티켓 섹션의 잔여석과 가격을 더 눈에 띄게 배치해 보세요.',
    apply_start: '모달 1단계의 선택지를 줄이고 기본값을 명확히 보여 주세요.',
    info_submitted: '입력 필드를 줄이거나 자동완성을 제공해 이탈을 줄여 보세요.',
    purchase_complete: '결제 직전 신뢰 문구와 오류 처리를 점검해 보세요.',
  };
  return map[key] || '해당 구간의 메시지와 UI를 A/B 테스트해 보세요.';
}

function renderInsights({ kpis, funnel, sources, devices, tickets, status }) {
  const items = [];

  const worst = funnel.reduce(
    (acc, step, index, list) => {
      if (index === list.length - 1 || !step.sessions) return acc;
      const rate = Number(step.dropoff_rate || 0);
      return rate > acc.rate ? { rate, step, next: list[index + 1] } : acc;
    },
    { rate: 0, step: null, next: null },
  );

  if (worst.step) {
    items.push({
      tone: 'warn',
      tag: 'DROP',
      title: `${worst.step.step_label}에서 ${worst.rate.toFixed(1)}% 이탈`,
      body: suggestionFor(worst.step.step_key),
    });
  }

  const bestSource = [...sources]
    .filter((s) => Number(s.sessions || 0) >= 5)
    .sort((a, b) => Number(b.conversion_rate || 0) - Number(a.conversion_rate || 0))[0];
  if (bestSource) {
    items.push({
      tone: 'good',
      tag: 'SRC',
      title: `${bestSource.source} 전환율 ${Number(bestSource.conversion_rate || 0).toFixed(1)}%`,
      body: `세션 ${nf.format(bestSource.sessions)} · 예매 ${nf.format(bestSource.orders)} · 매출 ${nf.format(bestSource.revenue)}원`,
    });
  }

  const bestDevice = [...devices]
    .filter((d) => Number(d.sessions || 0) >= 5)
    .sort((a, b) => Number(b.conversion_rate || 0) - Number(a.conversion_rate || 0))[0];
  if (bestDevice) {
    items.push({
      tone: 'default',
      tag: 'DEV',
      title: `${bestDevice.device_type} 전환율 ${Number(bestDevice.conversion_rate || 0).toFixed(1)}%`,
      body: `세션 ${nf.format(bestDevice.sessions)} · 예매 ${nf.format(bestDevice.orders)}`,
    });
  }

  const ticketTotal = tickets.reduce((sum, t) => sum + Number(t.revenue || 0), 0);
  const early = tickets.find((t) => t.ticket_type === 'early');
  if (early && ticketTotal > 0) {
    const share = Math.round((Number(early.revenue || 0) / ticketTotal) * 100);
    items.push({
      tone: 'good',
      tag: 'MIX',
      title: `얼리버드 매출 비중 ${share}%`,
      body: `얼리버드 주문 ${nf.format(early.orders)}건 · 실제 잔여 ${nf.format(status?.early_remaining ?? 0)}석`,
    });
  }

  if (Number(kpis.form_errors || 0) > 0) {
    items.push({
      tone: 'warn',
      tag: 'FORM',
      title: `폼 오류 ${nf.format(kpis.form_errors)}건`,
      body: '입력 검증 메시지와 모바일 키보드 타입을 점검해 보세요.',
    });
  } else {
    items.push({
      tone: 'good',
      tag: 'FORM',
      title: '폼 오류 0건',
      body: '현재까지 입력 단계에서 발생한 검증 오류가 없습니다.',
    });
  }

  el.insights.innerHTML = items
    .map(
      (item) => `
      <li class="insight-item ${item.tone}">
        <span class="insight-icon">${esc(item.tag)}</span>
        <div><strong>${esc(item.title)}</strong><p>${esc(item.body)}</p></div>
      </li>
    `,
    )
    .join('');
}

function renderChart(daily) {
  if (!daily.length) {
    el.chart.innerHTML = '<div class="chart-empty">아직 일별 데이터가 없습니다.</div>';
    return;
  }

  const W = 760;
  const H = 280;
  const pad = { top: 18, right: 14, bottom: 34, left: 44 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const maxSessions = Math.max(...daily.map((d) => Number(d.sessions || 0)), 1);
  const maxOrders = Math.max(...daily.map((d) => Number(d.orders || 0)), 1);
  const n = daily.length;
  const x = (i) => (n === 1 ? pad.left + innerW / 2 : pad.left + (i / (n - 1)) * innerW);
  const ySession = (v) => pad.top + innerH - (Number(v || 0) / maxSessions) * innerH;
  const barMaxH = innerH * 0.42;
  const barH = (v) => (Number(v || 0) / maxOrders) * barMaxH;
  const baseline = pad.top + innerH;
  const barW = Math.max(4, Math.min(18, (innerW / n) * 0.34));

  const points = daily.map((d, i) => `${x(i).toFixed(1)},${ySession(d.sessions).toFixed(1)}`);
  const line = `M ${points.join(' L ')}`;
  const area = `M ${x(0).toFixed(1)},${baseline.toFixed(1)} L ${points.join(' L ')} L ${x(n - 1).toFixed(1)},${baseline.toFixed(1)} Z`;

  const grid = [0, 1, 2, 3, 4]
    .map((i) => {
      const gy = pad.top + (innerH / 4) * i;
      const value = Math.round(maxSessions * (1 - i / 4));
      return `
        <line x1="${pad.left}" y1="${gy}" x2="${W - pad.right}" y2="${gy}" stroke="rgba(255,255,255,0.07)" stroke-width="1" />
        <text x="${pad.left - 10}" y="${gy + 4}" text-anchor="end" fill="#82739c" font-size="10" font-family="Space Grotesk, sans-serif">${value}</text>
      `;
    })
    .join('');

  const labelEvery = Math.max(1, Math.ceil(n / 7));
  const xLabels = daily
    .map((d, i) => {
      if (i % labelEvery !== 0 && i !== n - 1) return '';
      return `<text x="${x(i)}" y="${H - 10}" text-anchor="middle" fill="#82739c" font-size="10" font-family="Space Grotesk, sans-serif">${esc(String(d.date || '').slice(5))}</text>`;
    })
    .join('');

  const bars = daily
    .map((d, i) => {
      const h = barH(d.orders);
      return `<rect x="${(x(i) - barW / 2).toFixed(1)}" y="${(baseline - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="rgba(255,138,61,0.55)">
        <title>${esc(String(d.date))} · 예매 ${Number(d.orders || 0)}건</title>
      </rect>`;
    })
    .join('');

  const dots = daily
    .map(
      (d, i) => `
      <circle cx="${x(i).toFixed(1)}" cy="${ySession(d.sessions).toFixed(1)}" r="2.6" fill="#c9b3ff" stroke="#07040d" stroke-width="1">
        <title>${esc(String(d.date))} · 세션 ${Number(d.sessions || 0)} · 예매 ${Number(d.orders || 0)} · 매출 ${nf.format(Number(d.revenue || 0))}원</title>
      </circle>`,
    )
    .join('');

  el.chart.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="일별 세션과 예매 추이">
      <defs>
        <linearGradient id="sessionArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(155,108,255,0.34)" />
          <stop offset="100%" stop-color="rgba(155,108,255,0)" />
        </linearGradient>
      </defs>
      ${grid}
      ${bars}
      <path d="${area}" fill="url(#sessionArea)" />
      <path d="${line}" fill="none" stroke="#9b6cff" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" />
      ${dots}
      ${xLabels}
    </svg>
  `;
}

function renderButtons(buttons) {
  if (!buttons.length) {
    el.buttonsBody.innerHTML = '';
    el.buttonsEmpty.hidden = false;
    return;
  }
  el.buttonsEmpty.hidden = true;
  const maxCtr = Math.max(...buttons.map((b) => Number(b.ctr || 0)), 1);

  el.buttonsBody.innerHTML = buttons
    .map((button) => {
      const ctr = Number(button.ctr || 0);
      const width = Math.min(100, (ctr / maxCtr) * 100);
      const label = button.element_text || button.element_id || 'unknown';
      return `
        <tr>
          <td><span class="cell-main">${esc(label)}</span><span class="cell-sub">${esc(button.element_id || '-')}</span></td>
          <td>${esc(button.section || '-')}</td>
          <td class="num strong">${nf.format(button.clicks || 0)}</td>
          <td class="num">
            <span class="bar-cell">
              <span class="mini-bar"><span style="width: ${width.toFixed(1)}%"></span></span>
              <span class="strong">${ctr.toFixed(1)}%</span>
            </span>
          </td>
        </tr>
      `;
    })
    .join('');
}

function renderSources(sources) {
  if (!sources.length) {
    el.sourcesBody.innerHTML = '';
    el.sourcesEmpty.hidden = false;
    return;
  }
  el.sourcesEmpty.hidden = true;
  const maxConv = Math.max(...sources.map((s) => Number(s.conversion_rate || 0)), 1);

  el.sourcesBody.innerHTML = sources
    .map((source) => {
      const conv = Number(source.conversion_rate || 0);
      const width = Math.min(100, (conv / maxConv) * 100);
      return `
        <tr>
          <td><span class="cell-main">${esc(source.source || 'unknown')}</span><span class="cell-sub">${nf.format(source.revenue || 0)}원</span></td>
          <td class="num">${nf.format(source.sessions || 0)}</td>
          <td class="num strong">${nf.format(source.orders || 0)}</td>
          <td class="num">
            <span class="bar-cell">
              <span class="mini-bar orange"><span style="width: ${width.toFixed(1)}%"></span></span>
              <span class="strong">${conv.toFixed(1)}%</span>
            </span>
          </td>
        </tr>
      `;
    })
    .join('');
}

function renderDevices(devices) {
  if (!devices.length) {
    el.devices.innerHTML = '<p class="empty-note">디바이스 데이터가 없습니다.</p>';
    return;
  }
  const max = Math.max(...devices.map((d) => Number(d.sessions || 0)), 1);
  el.devices.innerHTML = devices
    .map((device) => {
      const width = Math.min(100, (Number(device.sessions || 0) / max) * 100);
      return `
        <div class="device-row">
          <span>${esc(device.device_type || 'unknown')}</span>
          <span class="range-bar"><span style="width: ${width.toFixed(1)}%"></span></span>
          <span>${nf.format(device.sessions || 0)} · ${Number(device.conversion_rate || 0).toFixed(1)}%</span>
        </div>
      `;
    })
    .join('');
}

function renderTickets(tickets) {
  const totalRevenue = tickets.reduce((sum, t) => sum + Number(t.revenue || 0), 0);
  const types = [
    { key: 'early', name: '얼리버드 티켓', className: 'early' },
    { key: 'regular', name: '일반 티켓', className: 'regular' },
  ];

  el.ticketMix.innerHTML = types
    .map((type) => {
      const row = tickets.find((t) => t.ticket_type === type.key) || {};
      const revenue = Number(row.revenue || 0);
      const share = totalRevenue > 0 ? Math.round((revenue / totalRevenue) * 100) : 0;
      return `
        <div class="ticket-row">
          <div class="ticket-row-head">
            <strong>${type.name}</strong>
            <span class="tag ${type.className}">${share}%</span>
          </div>
          <div class="range-bar"><span style="width: ${share}%"></span></div>
          <div class="ticket-stats">
            <span>주문 <strong>${nf.format(row.orders || 0)}</strong></span>
            <span>수량 <strong>${nf.format(row.quantity || 0)}</strong></span>
            <span>매출 <strong>${nf.format(revenue)}원</strong></span>
          </div>
        </div>
      `;
    })
    .join('');

  if (totalRevenue === 0) {
    el.ticketMix.insertAdjacentHTML('beforeend', '<p class="empty-note">아직 티켓 판매 데이터가 없습니다.</p>');
  }
}

function renderOrders(recent) {
  if (!recent.length) {
    el.ordersBody.innerHTML = '';
    el.ordersEmpty.hidden = false;
    return;
  }
  el.ordersEmpty.hidden = true;
  el.ordersBody.innerHTML = recent
    .map((order) => {
      const type = order.ticket_type === 'early' ? 'early' : 'regular';
      const typeLabel = order.ticket_type === 'early' ? '얼리버드' : '일반';
      const time = order.created_at ? dateTimeFmt.format(new Date(order.created_at)) : '-';
      return `
        <tr>
          <td><span class="order-no">${esc(order.order_no || '-')}</span></td>
          <td><span class="cell-main">${esc(order.buyer || '-')}</span><span class="cell-sub">${esc(order.department || '-')}</span></td>
          <td><span class="tag ${type}">${typeLabel} ${Number(order.quantity || 1)}매</span></td>
          <td class="num strong">${nf.format(order.amount || 0)}원</td>
          <td class="num">${esc(time)}</td>
        </tr>
      `;
    })
    .join('');
}

async function runAdmin(fn, successMessage) {
  if (loading || !passcode) return;
  const isSeed = fn === 'admin_seed_demo';
  const button = isSeed ? el.seedDemo : el.resetDemo;
  if (button) button.disabled = true;
  try {
    await rpc(fn, { p_passcode: passcode });
    toast(successMessage);
    await loadData({ silent: true });
  } catch (err) {
    if (isPasscodeError(err)) {
      sessionStorage.removeItem(PASS_KEY);
      passcode = '';
      showGate();
      setAuthError('세션이 만료되었습니다. 다시 로그인해 주세요.');
      return;
    }
    toast(err?.message || '처리에 실패했습니다.', 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

function setText(node, value) {
  if (node) node.textContent = value;
}

function isPasscodeError(err) {
  return /invalid passcode|passcode|jwt/i.test(String(err?.message || ''));
}

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let toastTimer = null;
function toast(message, variant = 'default') {
  let node = $('.toast');
  if (!node) {
    node = document.createElement('div');
    node.className = 'toast';
    node.setAttribute('role', 'status');
    document.body.appendChild(node);
  }
  node.textContent = message;
  node.dataset.variant = variant;
  node.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('is-visible'), 3600);
}
