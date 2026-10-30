import { CONFIG } from './config.js';
import { rpc } from './db.js';
import { initAnalytics, track, funnelStep, trackPurchase, getIds } from './analytics.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const nf = new Intl.NumberFormat('ko-KR');

const state = {
  ticket: 'early',
  qty: 1,
  step: 1,
  buyer: { name: '', studentId: '', department: '', phone: '' },
  status: { early_remaining: CONFIG.tickets.earlyTotal, early_price: CONFIG.tickets.earlyPrice, regular_price: CONFIG.tickets.regularPrice },
  submitting: false,
};

let lastFocused = null;

document.addEventListener('DOMContentLoaded', () => {
  initAnalytics();
  initCountdown();
  initNav();
  initReveal();
  initFaq();
  initShare();
  initTicketStatus();
  initBooking();
});

/* ------------------------------------------------------------------ */
/* Countdown                                                           */
/* ------------------------------------------------------------------ */
function initCountdown() {
  const target = new Date(CONFIG.event.startsAt).getTime();
  const label = $('[data-cd-label]');
  if (!$('[data-cd="days"]')) return;

  const pad = (n) => String(n).padStart(2, '0');
  const setAll = (key, value) => $$(`[data-cd="${key}"]`).forEach((el) => (el.textContent = value));

  const tick = () => {
    const diff = target - Date.now();
    if (diff <= 0) {
      ['days', 'hours', 'minutes', 'seconds'].forEach((key) => setAll(key, '00'));
      if (label) label.textContent = '이벤트가 시작되었습니다';
      return;
    }
    const total = Math.floor(diff / 1000);
    setAll('days', pad(Math.floor(total / 86400)));
    setAll('hours', pad(Math.floor((total % 86400) / 3600)));
    setAll('minutes', pad(Math.floor((total % 3600) / 60)));
    setAll('seconds', pad(total % 60));
  };

  tick();
  setInterval(tick, 1000);
}

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/* ------------------------------------------------------------------ */
function initNav() {
  const header = $('.site-header');
  const toggle = $('[data-menu-toggle]');
  const menu = $('[data-mobile-menu]');

  const onScroll = () => {
    if (header) header.classList.toggle('is-scrolled', window.scrollY > 24);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  if (toggle && menu) {
    toggle.addEventListener('click', () => {
      const open = menu.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
      document.body.classList.toggle('menu-open', open);
      track('menu_toggle', { open });
    });
    $$('a', menu).forEach((link) =>
      link.addEventListener('click', () => {
        menu.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        document.body.classList.remove('menu-open');
      }),
    );
  }
}

/* ------------------------------------------------------------------ */
/* Scroll reveal                                                       */
/* ------------------------------------------------------------------ */
function initReveal() {
  const items = $$('.reveal');
  if (!('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('is-visible'));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: '0px 0px -40px 0px' },
  );
  items.forEach((el) => observer.observe(el));
}

/* ------------------------------------------------------------------ */
/* FAQ                                                                 */
/* ------------------------------------------------------------------ */
function initFaq() {
  $$('details.faq-item').forEach((item, index) => {
    item.addEventListener('toggle', () => {
      track('faq_toggle', { index, question: $('summary', item)?.textContent?.trim() || '', open: item.open });
    });
  });
}

/* ------------------------------------------------------------------ */
/* Share                                                               */
/* ------------------------------------------------------------------ */
function initShare() {
  $$('[data-share]').forEach((button) => {
    button.addEventListener('click', async () => {
      const payload = {
        title: `${CONFIG.event.name} · ${CONFIG.event.host}`,
        text: '부산대학교 할로윈 나이트, 10월 31일 대운동장에서 만나요.',
        url: location.href.split('#')[0],
      };
      try {
        if (navigator.share) {
          await navigator.share(payload);
          track('share_success', { method: 'native' });
        } else if (navigator.clipboard) {
          await navigator.clipboard.writeText(payload.url);
          track('share_success', { method: 'clipboard' });
          toast('링크를 복사했어요. 친구에게 보내보세요.');
        } else {
          throw new Error('share unavailable');
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        track('share_failed', { message: err.message });
        toast('공유에 실패했어요. 주소를 직접 복사해 주세요.');
      }
    });
  });
}

/* ------------------------------------------------------------------ */
/* Ticket status                                                       */
/* ------------------------------------------------------------------ */
async function initTicketStatus() {
  await loadTicketStatus();
  setInterval(loadTicketStatus, 60000);
}

async function loadTicketStatus() {
  try {
    const status = await rpc('get_ticket_status');
    if (!status) return;
    state.status = status;
    renderTicketStatus();
  } catch {
    /* keep defaults when offline */
  }
}

function renderTicketStatus() {
  const remaining = Number(state.status.early_remaining ?? CONFIG.tickets.earlyTotal);
  const total = Number(state.status.early_total ?? CONFIG.tickets.earlyTotal);
  const sold = Math.max(0, total - remaining);
  const percent = Math.min(100, Math.round((sold / Math.max(total, 1)) * 100));

  $$('[data-early-remaining]').forEach((el) => (el.textContent = nf.format(remaining)));
  $$('[data-early-progress]').forEach((el) => (el.style.width = `${percent}%`));
  $$('[data-early-sold]').forEach((el) => (el.textContent = nf.format(sold)));

  const soldOut = remaining <= 0;
  $$('[data-early-badge]').forEach((badge) => {
    badge.textContent = soldOut ? 'SOLD OUT' : `${nf.format(remaining)}석 남음`;
  });

  const earlyCard = $('[data-ticket="early"]');
  if (earlyCard) {
    earlyCard.classList.toggle('is-soldout', soldOut);
    earlyCard.setAttribute('aria-disabled', String(soldOut));
    if (soldOut && state.ticket === 'early') selectTicket('regular', { silent: true });
  }

  const ctaEarly = $('[data-early-cta]');
  if (ctaEarly) {
    ctaEarly.disabled = remaining <= 0;
    ctaEarly.textContent = remaining <= 0 ? '얼리버드 마감' : '얼리버드 예매하기';
  }

  $$('[data-status-price="early"]').forEach((el) => (el.textContent = nf.format(state.status.early_price ?? CONFIG.tickets.earlyPrice)));
  $$('[data-status-price="regular"]').forEach((el) => (el.textContent = nf.format(state.status.regular_price ?? CONFIG.tickets.regularPrice)));
}

/* ------------------------------------------------------------------ */
/* Booking modal                                                       */
/* ------------------------------------------------------------------ */
function initBooking() {
  const modal = $('#booking-modal');
  if (!modal) return;

  const infoForm = $('#info-form');
  const confirmForm = $('#confirm-form');

  $$('[data-open-booking]').forEach((button) => {
    button.addEventListener('click', () => {
      const preset = button.dataset.ticketPreset;
      if (preset) selectTicket(preset, { silent: true });
      openBooking(button.dataset.track || button.id || 'unknown');
    });
  });

  $$('[data-close-booking]').forEach((el) => el.addEventListener('click', () => closeBooking()));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.classList.contains('is-open')) closeBooking();
    if (event.key === 'Tab' && modal.classList.contains('is-open')) trapFocus(event, modal);
  });

  $$('[data-ticket]').forEach((card) => {
    card.addEventListener('click', () => {
      if (card.getAttribute('aria-disabled') === 'true') {
        toast('얼리버드 티켓이 마감되었어요. 일반 티켓을 선택해 주세요.');
        return;
      }
      selectTicket(card.dataset.ticket);
    });
  });

  $('[data-qty-minus]')?.addEventListener('click', () => changeQty(-1));
  $('[data-qty-plus]')?.addEventListener('click', () => changeQty(1));

  $('[data-next-step]')?.addEventListener('click', () => {
    if (state.ticket === 'early' && state.status.early_remaining <= 0) {
      toast('얼리버드 티켓이 마감되었어요.');
      loadTicketStatus();
      return;
    }
    funnelStep(4, { ticket_type: state.ticket, quantity: state.qty, section: 'checkout' });
    track('ticket_step_complete', { ticket_type: state.ticket, quantity: state.qty });
    goStep(2);
  });

  $('[data-back-info]')?.addEventListener('click', () => goStep(1));
  $('[data-back-confirm]')?.addEventListener('click', () => goStep(2));

  infoForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const values = collectInfo();
    const errors = validateInfo(values);
    renderErrors(errors);

    if (Object.keys(errors).length > 0) {
      track('form_error', { step: 2, fields: Object.keys(errors) });
      const first = $('.field.has-error input');
      first?.focus();
      return;
    }

    state.buyer = values;
    fillSummary();
    funnelStep(5, { ticket_type: state.ticket, quantity: state.qty, section: 'checkout' });
    track('info_submit', { ticket_type: state.ticket, quantity: state.qty });
    goStep(3);
  });

  confirmForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.submitting) return;

    const agreement = $('#agreement');
    if (!agreement?.checked) {
      toast('예매 유의사항에 동의해 주세요.');
      track('form_error', { step: 3, fields: ['agreement'] });
      agreement?.focus();
      return;
    }

    state.submitting = true;
    const submit = $('[data-submit-order]');
    submit?.classList.add('is-loading');
    if (submit) submit.disabled = true;

    try {
      const { sessionId, visitorId } = getIds();
      const order = await rpc('create_order', {
        p_payload: {
          session_id: sessionId,
          visitor_id: visitorId,
          ticket_type: state.ticket,
          quantity: state.qty,
          buyer_name: state.buyer.name,
          student_id: state.buyer.studentId,
          department: state.buyer.department,
          phone: state.buyer.phone,
        },
      });

      trackPurchase(order);
      track('order_success', {
        order_no: order.order_no,
        amount: order.amount,
        ticket_type: order.ticket_type,
        quantity: order.quantity,
      });
      showSuccess(order);
      loadTicketStatus();
    } catch (err) {
      track('order_failed', { message: String(err.message || 'unknown'), ticket_type: state.ticket });
      toast(friendlyError(err.message));
      if (/sold out/i.test(err.message || '')) loadTicketStatus();
    } finally {
      state.submitting = false;
      submit?.classList.remove('is-loading');
      if (submit) submit.disabled = false;
    }
  });

  $('[data-success-close]')?.addEventListener('click', () => closeBooking());

  updatePriceLabels();
  updateQtyControls();
  renderTicketStatus();
}

function openBooking(source) {
  const modal = $('#booking-modal');
  if (!modal) return;
  lastFocused = document.activeElement;
  state.buyer = { name: '', studentId: '', department: '', phone: '' };
  state.qty = 1;
  state.submitting = false;
  $('#info-form')?.reset();
  const qtyValue = $('#qty-value');
  if (qtyValue) qtyValue.textContent = '1';
  const agreement = $('#agreement');
  if (agreement) agreement.checked = false;
  renderErrors({});
  updatePriceLabels();
  updateQtyControls();
  funnelStep(3, { source, ticket_type: state.ticket, section: 'tickets' });
  goStep(1);
  modal.hidden = false;
  requestAnimationFrame(() => modal.classList.add('is-open'));
  document.body.classList.add('modal-open');
  track('booking_open', { source, ticket_type: state.ticket, quantity: state.qty });
  setTimeout(() => $('.modal-close', modal)?.focus(), 80);
}

function closeBooking() {
  const modal = $('#booking-modal');
  if (!modal || !modal.classList.contains('is-open')) return;
  track('booking_close', { step: state.step, ticket_type: state.ticket, quantity: state.qty });
  modal.classList.remove('is-open');
  document.body.classList.remove('modal-open');
  setTimeout(() => {
    modal.hidden = true;
    lastFocused?.focus?.();
  }, 220);
}

function trapFocus(event, modal) {
  const focusable = $$(
    'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
    modal,
  ).filter((el) => el.offsetParent !== null);
  if (focusable.length === 0) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function goStep(step) {
  state.step = step;
  $$('[data-bstep]').forEach((el) => {
    el.hidden = Number(el.dataset.bstep) !== step;
  });
  $$('[data-step-dot]').forEach((el) => {
    const index = Number(el.dataset.stepDot);
    el.classList.toggle('is-active', index === step);
    el.classList.toggle('is-done', index < step);
  });
  const heading = $(`[data-bstep="${step}"] h3`);
  if (heading) {
    heading.setAttribute('tabindex', '-1');
    setTimeout(() => heading.focus({ preventScroll: true }), 60);
  }
}

function selectTicket(ticket, opts = {}) {
  if (ticket === 'early' && state.status.early_remaining <= 0) return;
  state.ticket = ticket;
  $$('[data-ticket]').forEach((card) => {
    const selected = card.dataset.ticket === ticket;
    card.classList.toggle('is-selected', selected);
    card.setAttribute('aria-pressed', String(selected));
  });
  updatePriceLabels();
  if (!opts.silent) track('ticket_select', { ticket_type: ticket, quantity: state.qty });
}

function changeQty(delta) {
  const next = Math.min(CONFIG.tickets.maxPerOrder, Math.max(1, state.qty + delta));
  if (next === state.qty) return;
  state.qty = next;
  const qtyValue = $('#qty-value');
  if (qtyValue) qtyValue.textContent = state.qty;
  updatePriceLabels();
  updateQtyControls();
  track('quantity_change', { quantity: state.qty, ticket_type: state.ticket });
}

function updateQtyControls() {
  const minus = $('[data-qty-minus]');
  const plus = $('[data-qty-plus]');
  if (minus) minus.disabled = state.qty <= 1;
  if (plus) plus.disabled = state.qty >= CONFIG.tickets.maxPerOrder;
}

function unitPrice() {
  return state.ticket === 'early' ? Number(state.status.early_price || 5000) : Number(state.status.regular_price || 8000);
}

function updatePriceLabels() {
  const unit = unitPrice();
  const total = unit * state.qty;
  $$('[data-total-price]').forEach((el) => (el.textContent = `${nf.format(total)}원`));
  $$('[data-ticket-name]').forEach((el) => (el.textContent = state.ticket === 'early' ? '얼리버드 티켓' : '일반 티켓'));
  $$('[data-summary-qty]').forEach((el) => (el.textContent = `${state.qty}매`));
  const submitLabel = $('[data-submit-label]');
  if (submitLabel) submitLabel.textContent = `${nf.format(total)}원 결제하고 예매 확정`;
}

function collectInfo() {
  return {
    name: ($('#buyer-name')?.value || '').trim(),
    studentId: ($('#student-id')?.value || '').replace(/[^0-9]/g, ''),
    department: ($('#department')?.value || '').trim(),
    phone: ($('#phone')?.value || '').replace(/[^0-9]/g, ''),
  };
}

function validateInfo(values) {
  const errors = {};
  if (values.name.length < 2) errors.name = '이름을 2자 이상 입력해 주세요.';
  if (!/^[0-9]{6,12}$/.test(values.studentId)) errors.studentId = '학번은 6~12자리 숫자로 입력해 주세요.';
  if (values.department.length < 1) errors.department = '학과를 입력해 주세요.';
  if (!/^[0-9]{10,11}$/.test(values.phone)) errors.phone = '전화번호는 10~11자리 숫자로 입력해 주세요.';
  return errors;
}

function renderErrors(errors) {
  $$('.field').forEach((field) => {
    field.classList.remove('has-error');
    const input = $('input', field);
    input?.removeAttribute('aria-invalid');
    const msg = $('.field-error', field);
    if (msg) msg.textContent = '';
  });

  Object.entries(errors).forEach(([name, message]) => {
    const input = $(`[name="${name}"]`);
    const field = input?.closest('.field');
    field?.classList.add('has-error');
    input?.setAttribute('aria-invalid', 'true');
    const msg = field?.querySelector('.field-error');
    if (msg) msg.textContent = message;
  });
}

function fillSummary() {
  const unit = unitPrice();
  const total = unit * state.qty;
  $$('[data-summary-name]').forEach((el) => (el.textContent = maskName(state.buyer.name)));
  $$('[data-summary-dept]').forEach((el) => (el.textContent = state.buyer.department));
  $$('[data-summary-student]').forEach((el) => (el.textContent = maskStudent(state.buyer.studentId)));
  $$('[data-summary-phone]').forEach((el) => (el.textContent = maskPhone(state.buyer.phone)));
  $$('[data-summary-ticket]').forEach((el) => (el.textContent = state.ticket === 'early' ? '얼리버드 티켓' : '일반 티켓'));
  $$('[data-summary-qty]').forEach((el) => (el.textContent = `${state.qty}매`));
  $$('[data-summary-unit]').forEach((el) => (el.textContent = `${nf.format(unit)}원`));
  $$('[data-summary-total]').forEach((el) => (el.textContent = `${nf.format(total)}원`));
  const submitLabel = $('[data-submit-label]');
  if (submitLabel) submitLabel.textContent = `${nf.format(total)}원 결제하고 예매 확정`;
}

function showSuccess(order) {
  funnelStep(6, { order_no: order.order_no, amount: order.amount, ticket_type: order.ticket_type });
  $$('[data-success-order]').forEach((el) => (el.textContent = order.order_no));
  $$('[data-success-ticket]').forEach((el) =>
    (el.textContent = `${order.ticket_type === 'early' ? '얼리버드' : '일반'} · ${order.quantity}매`),
  );
  $$('[data-success-amount]').forEach((el) => (el.textContent = `${nf.format(order.amount)}원`));
  goStep(4);
  confetti();
}

function maskName(name) {
  if (!name) return '-';
  if (name.length <= 1) return name;
  return name[0] + '*'.repeat(name.length - 1);
}

function maskStudent(value) {
  if (!value) return '-';
  return value.slice(0, 2) + '*'.repeat(Math.max(value.length - 4, 1)) + value.slice(-2);
}

function maskPhone(value) {
  if (!value) return '-';
  return `${value.slice(0, 3)}-****-${value.slice(-4)}`;
}

function friendlyError(message = '') {
  const msg = String(message).toLowerCase();
  if (msg.includes('sold out')) return '얼리버드 티켓이 마감되었어요. 일반 티켓으로 진행해 주세요.';
  if (msg.includes('invalid name')) return '이름을 다시 확인해 주세요.';
  if (msg.includes('student')) return '학번을 다시 확인해 주세요.';
  if (msg.includes('phone')) return '전화번호를 다시 확인해 주세요.';
  if (msg.includes('quantity')) return '수량은 1~4매까지 선택할 수 있어요.';
  if (msg.includes('department')) return '학과를 다시 확인해 주세요.';
  return '예매 처리에 실패했어요. 잠시 후 다시 시도해 주세요.';
}

function confetti() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const host = $('[data-confetti]');
  if (!host) return;
  host.innerHTML = '';
  const colors = ['#ff8a3d', '#9b6cff', '#b6ff3d', '#ff4f9a', '#f8f4ff'];
  for (let i = 0; i < 42; i += 1) {
    const piece = document.createElement('span');
    piece.style.setProperty('--x', `${Math.random() * 100}%`);
    piece.style.setProperty('--delay', `${Math.random() * 0.4}s`);
    piece.style.setProperty('--duration', `${1.4 + Math.random() * 1.4}s`);
    piece.style.setProperty('--rotate', `${Math.random() * 720 - 360}deg`);
    piece.style.setProperty('--color', colors[i % colors.length]);
    host.appendChild(piece);
  }
}

/* ------------------------------------------------------------------ */
/* Toast                                                               */
/* ------------------------------------------------------------------ */
let toastTimer = null;
function toast(message, variant = 'default') {
  let el = $('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.dataset.variant = variant;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 3600);
}
