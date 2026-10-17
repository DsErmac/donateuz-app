/* =========================================================
   DonateUZ frontend
   Talks to the Express/Neon/Stripe backend in this same repo.
   All money amounts in this file are in CENTS unless noted "Dollars".
   ========================================================= */

const API = '/api';

/* ---------- Motion & delight helpers ---------- */
// Added before anything else: gates the scroll-reveal CSS so content is never
// hidden if JS fails to load.
document.body.classList.add('js-anim');

const prefersReducedMotion = () =>
  document.body.classList.contains('reduce-motion') ||
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Count a number up when it first appears.
function animateValue(el, to, format = v => String(Math.round(v)), duration = 900) {
  if (!el) return;
  if (prefersReducedMotion() || !Number.isFinite(to) || to === 0) { el.textContent = format(to); return; }
  cancelAnimationFrame(el._countFrame);
  const start = performance.now();
  const tick = now => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = format(to * eased);
    if (t < 1) el._countFrame = requestAnimationFrame(tick);
  };
  el._countFrame = requestAnimationFrame(tick);
}

// Scroll-reveal: sections rise in once as they enter the viewport.
const revealObserver = ('IntersectionObserver' in window)
  ? new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('in'); revealObserver.unobserve(e.target); }
      });
    }, { threshold: .12, rootMargin: '0px 0px -36px 0px' })
  : null;
function observeReveals(root = document) {
  if (window.FX) FX.stagger(root);
  if (!revealObserver) {
    root.querySelectorAll('.reveal:not(.in)').forEach(el => el.classList.add('in'));
    return;
  }
  root.querySelectorAll('.reveal:not(.in)').forEach(el => revealObserver.observe(el));
}

// A small burst of hearts when a donation is confirmed.
function celebrateHearts() {
  const sheet = document.querySelector('#receipt-sheet .sheet');
  if (!sheet || prefersReducedMotion()) return;
  const colors = [getComputedStyle(document.body).getPropertyValue('--terra').trim() || '#C4572F',
                  getComputedStyle(document.body).getPropertyValue('--primary').trim() || '#1D6FA3',
                  getComputedStyle(document.body).getPropertyValue('--teal').trim() || '#0F9E96'];
  for (let i = 0; i < 10; i++) {
    const h = document.createElement('span');
    h.className = 'burst-heart';
    h.style.setProperty('--dx', (Math.random() * 180 - 90) + 'px');
    h.style.setProperty('--rot', (Math.random() * 50 - 25) + 'deg');
    h.style.setProperty('--dur', (0.9 + Math.random() * 0.9) + 's');
    h.style.animationDelay = (Math.random() * 0.35) + 's';
    h.style.background = colors[i % colors.length];
    h.style.width = h.style.height = (11 + Math.random() * 9) + 'px';
    sheet.appendChild(h);
  }
  setTimeout(() => sheet.querySelectorAll('.burst-heart').forEach(h => h.remove()), 2400);
}

// Story video card: press play to start (motion answers a person's action).
function initStoryVideo() {
  const card = document.getElementById('story-video-card');
  const video = document.getElementById('story-video');
  if (!card || !video) return;
  const play = card.querySelector('.story-play');
  const toggle = () => {
    if (video.paused) {
      video.play().then(() => card.classList.add('is-playing')).catch(() => {});
    } else {
      video.pause();
      card.classList.remove('is-playing');
    }
  };
  if (play) play.addEventListener('click', toggle);
  video.addEventListener('click', toggle);
  video.addEventListener('ended', () => card.classList.remove('is-playing'));
}

// Hero video: fade in when ready, respect reduced motion, pause when hidden.
function initHeroVideo() {
  const video = document.getElementById('hero-video');
  if (!video) return;
  const update = () => {
    if (prefersReducedMotion()) { video.pause(); video.classList.remove('is-ready'); }
    else { video.play().then(() => video.classList.add('is-ready')).catch(() => {}); }
  };
  video.addEventListener('canplay', () => { if (!prefersReducedMotion()) video.classList.add('is-ready'); });
  video.addEventListener('error', () => video.classList.remove('is-ready'));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) video.pause(); else update();
  });
  update();
  window._updateHeroVideo = update; // re-called when the reduce-motion setting changes
}

/* ---------- Small fetch helper ---------- */
async function api(path, options = {}) {
  const res = await fetch(API + path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  let body = null;
  try { body = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) {
    const message = (body && body.error) || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body;
}

/* ---------- HTML escaping (everything user-supplied that goes through innerHTML must pass through this) ---------- */
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

/* ---------- Photos (campaign images come from Neon; we just render a real photo per seed) ---------- */
function photoURL(seed, w = 800, h = 500) {
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/${w}/${h}`;
}
const STATIC_PHOTOS = {
  hero: 'https://images.unsplash.com/photo-1593113598332-cd288d649433?auto=format&fit=crop&w=900&q=80',
  impactOne: 'https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=500&q=80',
  impactTwo: 'https://images.unsplash.com/photo-1577896851231-70ef18881754?auto=format&fit=crop&w=500&q=80'
};

function setImage(id, src, alt) {
  const el = document.getElementById(id);
  if (!el) return;
  el.alt = alt;
  el.src = src;
}

/* ---------- Money formatting (cents -> display string) ---------- */
function money(cents, currency = (window.APP_CURRENCY || 'usd')) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format((cents || 0) / 100);
}

/* ---------- Global state ---------- */
let currentUser = null;          // { id, name, email } | null
let campaigns = {};              // keyed by campaign id, from the API
let campaignOrder = [];          // ids sorted by urgency
let activeFilter = 'All', sortMode = 'urgent';
let currentCampaign = null;
let selectedAmountCents = 2500;
let isAnonymous = false, isRecurring = false;
let lastDonation = null;
let historyRecords = [];
let adminRecords = [];
let recentDonations = []; // feeds the saved-campaign notifications
const saved = new Set(JSON.parse(localStorage.getItem('donateuz-saved') || '[]'));

// Admin dashboard state
let adminStats = null;
let adminCampaigns = [];
let adminUsers = [];
let adminDonations = [];
let adminSupportRequests = [];

// Admin dashboard UI state
let currentAdminTab = 'stats';
let adminFilters = {
  campaigns: { search: '', status: '' },
  donations: { search: '', status: '', recurring: '' },
  users: { search: '', role: '' },
  requests: { search: '', status: '' }
};
let adminPagination = {
  campaigns: { page: 1, pageSize: 10 },
  donations: { page: 1, pageSize: 15 },
  users: { page: 1, pageSize: 15 },
  requests: { page: 1, pageSize: 15 }
};

function showToast(message, type = 'default') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = message;
  t.classList.remove('show', 'error-toast');
  if (type === 'error') { t.classList.add('error-toast'); Sound.play('error'); }
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3200);
}

/* ================= Navigation ================= */
// Every view is reachable by URL: #home, #donate, #request, #profile, #settings,
// and campaign details by #campaign/<id> — so any cause can be shared as a link.
const ROUTABLE_VIEWS = ['home', 'donate', 'request', 'profile', 'settings', 'admin-dashboard'];
let activeViewName = 'home';

async function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById(name + '-view');
  if (target) target.classList.add('active');
  activeViewName = name;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.nav === name));
  if (ROUTABLE_VIEWS.includes(name) && location.hash !== '#' + name) {
    history.replaceState(null, '', '#' + name);
  }
  document.querySelector('.main-content').scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  observeReveals(target);
  // Navigation is a real action: a soft pluck and a tick under the thumb.
  Sound.play('nav');
  FX.haptic(8);
  if (name === 'profile') renderProfile();
  if (name === 'settings') renderAccentSwatches();
  if (name === 'admin-dashboard') await loadAdminDashboard();
}

// Handles the hash on first load, manual hash edits, and back/forward.
function applyHashRoute() {
  const hash = location.hash.replace(/^#/, '');
  if (!hash) return;
  const [route, param] = hash.split('/');
  if (route === 'reset' && param) {
    // Password-reset links put the one-time token in the fragment so it never
    // reaches server logs; swap it for a clean home URL immediately.
    pendingResetToken = param;
    history.replaceState(null, '', location.pathname);
    setAuthMode('reset');
    document.getElementById('auth-error').classList.add('hidden');
    openSheet('auth-sheet');
  } else if (route === 'campaign' && param && campaigns[param]) {
    if (!document.querySelector('.view.active')) showView('home');
    openCampaign(param);
  } else if (ROUTABLE_VIEWS.includes(route)) {
    showView(route);
  }
}
window.addEventListener('hashchange', applyHashRoute);

function navigateToDonateWithCategory(category) {
  showView('donate');
  const chip = document.querySelector(`.chip[data-filter="${category}"]`);
  if (chip) setFilter(chip);
}

function openSheet(id) {
  document.getElementById(id).classList.add('open');
  if (id !== 'palette-overlay') Sound.play('whooshUp');
  if (id === 'admin-sheet') loadAdminRequests();
  if (id === 'notifications-sheet') renderNotifications();
}
function closeSheet(id) {
  document.getElementById(id).classList.remove('open');
  Sound.play('whooshDown');
  // A shared campaign link (#campaign/x) should return to the page's own URL when closed.
  if (id === 'campaign-sheet' && location.hash.startsWith('#campaign/')) {
    history.replaceState(null, '', '#' + activeViewName);
  }
}
function clearNotifBadge() {
  localStorage.setItem('donateuz-notif-seen', String(Date.now()));
  const badge = document.getElementById('notif-badge');
  if (badge) badge.classList.add('hidden');
  showToast('Notifications marked as read');
}

async function handleAccountClick() {
  if (currentUser) {
    if (currentUser.role === 'admin') {
      await showView('admin-dashboard');
    } else {
      showView('profile');
    }
  } else {
    openAuthSheet('login');
  }
}

/* ================= Auth ================= */
function openAuthSheet(mode) {
  setAuthMode(mode || 'login');
  document.getElementById('auth-error').classList.add('hidden');
  openSheet('auth-sheet');
}

function setAuthMode(mode) {
  const isLogin = mode === 'login';
  const isRegister = mode === 'register';
  const isForgot = mode === 'forgot';
  const isReset = mode === 'reset';
  document.getElementById('auth-tab-login').classList.toggle('active', isLogin);
  document.getElementById('auth-tab-register').classList.toggle('active', isRegister);
  document.getElementById('login-form').classList.toggle('hidden', !isLogin);
  document.getElementById('register-form').classList.toggle('hidden', !isRegister);
  document.getElementById('forgot-form').classList.toggle('hidden', !isForgot);
  document.getElementById('reset-form').classList.toggle('hidden', !isReset);
}

function showAuthError(message) {
  const el = document.getElementById('auth-error');
  el.textContent = message;
  el.classList.remove('hidden');
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  try {
    const { user } = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    onAuthSuccess(user, 'Welcome back!');
  } catch (err) {
    showAuthError(err.message);
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const name = document.getElementById('register-name').value.trim();
  const email = document.getElementById('register-email').value.trim();
  const password = document.getElementById('register-password').value;
  try {
    const { user } = await api('/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password }) });
    onAuthSuccess(user, 'Account created — welcome to DonateUZ!');
  } catch (err) {
    showAuthError(err.message);
  }
}

function onAuthSuccess(user, message) {
  currentUser = user;
  closeSheet('auth-sheet');
  syncAccountUI();
  showToast(message);
  renderProfile();
  syncSavedFromServer();
}

let pendingResetToken = null;

async function handleForgotPassword(e) {
  e.preventDefault();
  const btn = document.getElementById('forgot-submit');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    await api('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: document.getElementById('forgot-email').value.trim() })
    });
    showAuthError('If that email has an account, a reset link is on its way. Check your inbox (and spam folder).');
  } catch (err) {
    showAuthError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send reset link';
  }
}

async function handleResetPassword(e) {
  e.preventDefault();
  if (!pendingResetToken) { showAuthError('This reset link is invalid. Request a new one.'); return; }
  try {
    await api('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token: pendingResetToken, password: document.getElementById('reset-password').value })
    });
    pendingResetToken = null;
    const { user } = await api('/auth/me');
    if (user) onAuthSuccess(user, 'Password updated — welcome back!');
    else { showAuthError('Password updated. You can sign in now.'); setAuthMode('login'); }
  } catch (err) {
    showAuthError(err.message);
  }
}

async function handleSignOut() {
  if (!window.confirm('Are you sure you want to sign out?')) return;
  try { await api('/auth/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
  currentUser = null;
  historyRecords = [];
  adminStats = null;
  adminCampaigns = [];
  adminUsers = [];
  adminDonations = [];
  adminSupportRequests = [];
  syncAccountUI();
  showToast('Signed out');
  showView('home');
}

function syncAccountUI() {
  const emailLabel = document.getElementById('settings-account-email');
  const authAction = document.getElementById('settings-auth-action');
  const adminNav = document.getElementById('nav-admin');
  if (currentUser) {
    if (emailLabel) emailLabel.textContent = currentUser.email;
    if (authAction) authAction.innerHTML = '<i data-lucide="log-out"></i><span><strong>Sign out</strong><small>End your DonateUZ session</small></span>';
    if (authAction) authAction.onclick = handleSignOut;
  } else {
    if (emailLabel) emailLabel.textContent = 'Not signed in';
    if (authAction) authAction.innerHTML = '<i data-lucide="log-in"></i><span><strong>Sign in / Create account</strong><small>Access your donation history across devices</small></span><i data-lucide="chevron-right"></i>';
    if (authAction) authAction.onclick = () => openAuthSheet('login');
  }
  // Show admin nav button for admin users
  if (adminNav) {
    adminNav.style.display = (currentUser && currentUser.role === 'admin') ? 'flex' : 'none';
  }
  lucide.createIcons();
}

async function loadCurrentUser() {
  try {
    const { user } = await api('/auth/me');
    currentUser = user;
  } catch (e) {
    currentUser = null;
  }
  syncAccountUI();
  if (currentUser) syncSavedFromServer();
}

/* ================= Campaigns ================= */
async function loadCampaigns() {
  try {
    const { campaigns: list } = await api('/campaigns');
    campaigns = {};
    list.forEach(c => { campaigns[c.id] = c; });
    campaignOrder = list.map(c => c.id); // already sorted by urgency from the API
    animateValue(document.getElementById('home-campaign-count'), list.length, v => String(Math.round(v)), 800);
    renderCampaignGrid();
    renderHomeSpotlight();
  } catch (err) {
    console.error(err);
    const list = document.getElementById('campaign-list');
    const loading = document.getElementById('campaign-loading');
    if (list) list.innerHTML = ''; // remove the skeleton placeholders
    if (loading) {
      loading.classList.remove('hidden');
      loading.textContent = 'Could not load campaigns. Is the server running?';
    }
  }
}

/* ---------- Public platform stats + live activity feed (home page) ---------- */
async function loadPublicStats() {
  try {
    const s = await api('/stats');
    const donors = document.getElementById('home-donor-count');
    const raised = document.getElementById('home-raised-total');
    if (donors) {
      if (s.donorCount > 0) animateValue(donors, s.donorCount, v => Math.round(v).toLocaleString(), 1000);
      else donors.textContent = '—';
    }
    if (raised) {
      if (s.totalRaisedCents > 0) animateValue(raised, s.totalRaisedCents, v => money(Math.round(v)), 1100);
      else raised.textContent = money(0);
    }
  } catch (err) {
    console.warn('[stats] could not load public stats', err.message);
  }
}

async function loadRecentActivity() {
  const feed = document.getElementById('activity-feed');
  if (!feed) return;
  try {
    const { donations } = await api('/donations/recent');
    const firstKey = donations[0] ? donations[0].id : null;
    const isNew = window._lastFeedKey !== undefined && firstKey && firstKey !== window._lastFeedKey;
    window._lastFeedKey = firstKey;
    recentDonations = donations;
    if (!donations.length) {
      feed.innerHTML = `
        <div class="activity-item" style="border-color:var(--border)">
          <div class="activity-avatar"><i data-lucide="heart" style="width:15px;color:var(--primary)"></i></div>
          <div>
            <span class="font-bold">Be the first donor</span><br>
            <span class="text-xs" style="color:var(--subtext)">Completed gifts will appear here live.</span>
          </div>
        </div>`;
      lucide.createIcons();
      return;
    }
    feed.innerHTML = donations.map((d, i) => `
      <div class="activity-item ${isNew && i === 0 ? 'fresh' : ''}" style="border-color:var(--border)">
        <div class="activity-avatar"><i data-lucide="heart" style="width:15px;color:var(--primary)"></i></div>
        <div>
          <span class="font-bold">${esc(d.donorName)}</span> gave to <span class="font-bold">${esc(d.campaignTitle)}</span><br>
          <span class="text-xs" style="color:var(--subtext)">${money(d.amountCents, d.currency)} · ${timeAgo(d.createdAt)}</span>
        </div>
      </div>`).join('');
    lucide.createIcons();
    if (isNew) Sound.play('notify');
  } catch (err) {
    console.warn('[activity] could not load recent donations', err.message);
  }
}

function timeAgo(iso) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 0 || seconds < 90) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/* ---------- Notifications: real updates on saved campaigns ----------
   Sources: goal-reached milestones (campaigns.goalReachedAt) and recent
   completed donations to saved causes. The bell dot shows anything newer
   than the last "mark all as read" timestamp in localStorage. */
function notifSeenTimestamp() { return Number(localStorage.getItem('donateuz-notif-seen') || 0); }

function buildNotifications() {
  const items = [];
  Object.values(campaigns).forEach(c => {
    if (saved.has(c.id) && c.goalReachedAt) {
      items.push({ type: 'goal', title: c.title, at: c.goalReachedAt });
    }
  });
  recentDonations.forEach(d => {
    if (d.campaignId && saved.has(d.campaignId)) {
      items.push({ type: 'donation', campaignTitle: d.campaignTitle, donorName: d.donorName, amountCents: d.amountCents, currency: d.currency, at: d.createdAt });
    }
  });
  return items.sort((a, b) => new Date(b.at) - new Date(a.at));
}

function updateNotifBadge() {
  const hasNew = buildNotifications().some(i => new Date(i.at).getTime() > notifSeenTimestamp());
  const badge = document.getElementById('notif-badge');
  if (badge) badge.classList.toggle('hidden', !hasNew);
}

function renderNotifications() {
  const list = document.getElementById('notifications-list');
  if (!list) return;
  updateNotifBadge();
  const items = buildNotifications();
  if (!saved.size) {
    list.innerHTML = '<div class="empty">Save causes you care about — new donations and goal milestones for them will appear here.</div>';
  } else if (!items.length) {
    list.innerHTML = '<div class="empty">No updates yet for your saved causes. You will hear when people give or a goal is reached.</div>';
  } else {
    list.innerHTML = items.map(i => i.type === 'goal'
      ? `<div class="notification-item"><div class="activity-avatar"><i data-lucide="trophy" style="width:15px"></i></div><div><span class="font-bold">${esc(i.title)}</span> reached its goal<br><span class="text-xs" style="color:var(--subtext)">${timeAgo(i.at)}</span></div></div>`
      : `<div class="notification-item"><div class="activity-avatar"><i data-lucide="heart" style="width:15px"></i></div><div><span class="font-bold">${esc(i.donorName)}</span> gave to <span class="font-bold">${esc(i.campaignTitle)}</span><br><span class="text-xs" style="color:var(--subtext)">${money(i.amountCents, i.currency)} · ${timeAgo(i.at)}</span></div></div>`
    ).join('');
  }
  lucide.createIcons();
}

/* ---------- Skeleton placeholders while campaigns load ---------- */function renderCampaignSkeletons() {
  const list = document.getElementById('campaign-list');
  if (!list) return;
  const loading = document.getElementById('campaign-loading');
  if (loading) loading.classList.add('hidden');
  list.innerHTML = Array.from({ length: 6 }).map(() => `
    <article class="campaign skeleton-card" aria-hidden="true">
      <div class="skeleton skeleton-image"></div>
      <div class="campaign-body">
        <div class="skeleton skeleton-line" style="width:40%"></div>
        <div class="skeleton skeleton-line" style="width:85%"></div>
        <div class="skeleton skeleton-line" style="width:60%"></div>
      </div>
    </article>`).join('');
}

function campaignCardHTML(c) {
  const img = photoURL('donateuz-' + c.imageSeed);
  const saveIcon = saved.has(c.id) ? 'bookmark-check' : 'bookmark';
  const isCompleted = c.progress >= 100;
  const urgencyLevel = c.urgency === 1 ? 'level-high' : c.urgency <= 2 ? 'level-moderate' : 'level-normal';
  const metaBadge = isCompleted
    ? '<span class="badge completed" style="font-size:.62rem;padding:2px 7px"><i data-lucide="circle-check" style="width:12px"></i>Completed</span>'
    : `<span class="badge ${urgencyLevel}" style="font-size:.62rem;padding:2px 7px">${c.urgency === 1 ? '🔥 Urgent' : c.urgency <= 2 ? '⚡ Moderate' : 'Normal'}</span>`;
  return `
    <div class="campaign-media">
      <img src="${img}" class="campaign-image" loading="lazy" alt="${esc(c.title)}">
      <span class="badge cat-overlay">${esc(c.category)}</span>
      <button type="button" class="save-btn" aria-label="Save ${esc(c.title)}" onclick="toggleSave('${esc(c.id)}')">
        <i id="save-${esc(c.id)}" data-lucide="${saveIcon}"></i>
      </button>
    </div>
    <div class="campaign-body">
      <h3 class="campaign-title">${esc(c.title)}</h3>
      <div class="campaign-meta">
        <span>${esc(c.region)} · ${esc(c.category)}</span>
        ${metaBadge}
      </div>
      <div class="progress-track"><div class="progress-bar" style="width:${Math.min(100, c.progress)}%"></div></div>
      <div class="flex justify-between text-xs font-bold">
        <span style="color:var(--primary)">${money(c.raisedAmountCents)} raised</span>
        <span style="color:var(--subtext)">Goal: ${money(c.goalAmountCents)}</span>
      </div>
      <div class="flex gap-2 mt-1">
        <button type="button" class="secondary-btn flex-1 text-xs" onclick="openCampaign('${esc(c.id)}')">Details</button>
        <button type="button" class="primary-btn flex-1 text-xs" onclick="quickDonate('${esc(c.id)}')"><i data-lucide="heart" style="width:14px"></i> Give now</button>
      </div>
    </div>`;
}

function renderCampaignGrid() {
  const list = document.getElementById('campaign-list');
  document.getElementById('campaign-loading').classList.add('hidden');
  list.innerHTML = '';
  campaignOrder.forEach(id => {
    const c = campaigns[id];
    const el = document.createElement('article');
    el.className = 'campaign reveal';
    el.dataset.category = c.category;
    el.dataset.raised = c.raisedAmountCents;
    el.dataset.urgency = c.urgency;
    el.dataset.title = c.title;
    el.dataset.id = c.id;
    el.innerHTML = campaignCardHTML(c);
    list.appendChild(el);
  });
  lucide.createIcons();
  observeReveals(list);
  filterCampaigns();
}

function renderHomeSpotlight() {
  const featuredId = campaignOrder[0];
  if (!featuredId) return;
  const c = campaigns[featuredId];
  const img = photoURL('donateuz-' + c.imageSeed);
  const isCompleted = c.progress >= 100;
  document.getElementById('home-spotlight').innerHTML = `
    <div class="spotlight-card">
      <div class="spotlight-media">
        <img src="${img}" loading="lazy" alt="${esc(c.title)}">
      </div>
      <div class="spotlight-inner">
        <div class="flex justify-between items-center mb-3">
          <span class="badge urgent"><i data-lucide="flame" style="width:14px"></i>Urgent cause spotlight</span>
          <span class="text-lg font-bold" style="color:var(--primary)">${c.progress}% funded</span>
        </div>
        <h3 class="font-bold text-xl mb-2">${esc(c.title)}</h3>
        <p class="text-sm mb-3" style="color:var(--subtext);line-height:1.4">${esc(c.region)} · ${esc(c.category)}</p>
        <div class="progress-track mb-3"><div class="progress-bar" style="width:${Math.min(100, c.progress)}%"></div></div>
        <div class="flex justify-between text-sm font-bold">
          <span style="color:var(--primary)">${money(c.raisedAmountCents)} raised</span>
          <span style="color:var(--subtext)">Goal: ${money(c.goalAmountCents)}</span>
        </div>
        <p class="text-xs mt-2" style="color:var(--subtext)">
          ${isCompleted ? 'This campaign has reached its goal! Thank you to all donors.' : 'Help us reach our goal with your generous donation.'}
        </p>
        <button type="button" class="primary-btn w-full" onclick="quickDonate('${esc(c.id)}')">
          <i data-lucide="heart" style="width:16px"></i> Donate now
        </button>
      </div>
    </div>`;
  lucide.createIcons();
}

function setFilter(el) {
  activeFilter = el.dataset.filter;
  document.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === el));
  filterCampaigns();
}

function cycleSort() {
  sortMode = sortMode === 'urgent' ? 'raised' : sortMode === 'raised' ? 'name' : 'urgent';
  const label = document.getElementById('sort-label');
  if (label) label.textContent = sortMode === 'urgent' ? 'Most urgent' : sortMode === 'raised' ? 'Most funded' : 'A–Z';
  filterCampaigns();
}

function filterCampaigns() {
  const input = document.getElementById('campaign-search');
  const query = input ? input.value.toLowerCase() : '';
  const list = document.getElementById('campaign-list');
  const cards = [...list.querySelectorAll('.campaign:not(.skeleton-card)')];

  cards.sort((a, b) => sortMode === 'raised'
    ? Number(b.dataset.raised) - Number(a.dataset.raised)
    : sortMode === 'name'
      ? a.dataset.title.localeCompare(b.dataset.title)
      : Number(a.dataset.urgency) - Number(b.dataset.urgency));

  cards.forEach(card => {
    const matchesFilter = activeFilter === 'All' || card.dataset.category === activeFilter;
    const matchesQuery = card.dataset.title.toLowerCase().includes(query);
    card.classList.toggle('hidden', !(matchesFilter && matchesQuery));
    list.appendChild(card);
  });

  const empty = document.getElementById('no-campaigns');
  if (empty) empty.classList.toggle('hidden', cards.some(c => !c.classList.contains('hidden')));
}

/* ================= Save / bookmark =================
   Guests: localStorage. Signed in: the account (Neon) is the source of truth,
   so bookmarks follow the user across devices. */
// One in-flight sync per campaign id: a rapid second toggle waits for the
// first request to finish instead of racing it (which could reorder a
// PUT/DELETE pair on the server).
const saveSyncQueues = new Map();

function queueSaveSync(id, method) {
  const run = (saveSyncQueues.get(id) || Promise.resolve()).catch(() => {});
  const next = run.then(() => api(`/saved/${encodeURIComponent(id)}`, { method }))
    .then(() => { saveSyncQueues.delete(id); })
    .catch(() => {
      saveSyncQueues.delete(id);
      // Server unreachable: drop the optimistic local change and adopt server
      // state, rather than replaying stale closure state (which could
      // resurrect a bookmark the user just deleted).
      showToast('Could not sync your saved campaigns. Check your connection.', 'error');
      return api('/saved').then(({ saved: serverSaved }) => {
        saved.clear();
        serverSaved.forEach(sid => saved.add(sid));
        localStorage.setItem('donateuz-saved', JSON.stringify([...saved]));
        const ic = document.getElementById('save-' + id);
        if (ic) { ic.setAttribute('data-lucide', saved.has(id) ? 'bookmark-check' : 'bookmark'); lucide.createIcons(); }
        if (document.getElementById('profile-view').classList.contains('active')) renderSaved();
      }).catch(() => {});
    });
  saveSyncQueues.set(id, next);
  return next;
}

async function syncSavedFromServer() {
  if (!currentUser) return;
  try {
    const { saved: serverSaved } = await api('/saved');
    const before = new Set(saved);
    // Guest saves made before signing in → the account. Only ids that existed
    // locally at this moment are pushed: pushing the whole union would
    // re-add a bookmark deleted in the last few hundred milliseconds.
    const guestSnapshot = before;
    serverSaved.forEach(id => saved.add(id)); // account → this device
    const toPush = [...guestSnapshot].filter(id => !serverSaved.includes(id));
    await Promise.all(toPush.map(id => api(`/saved/${encodeURIComponent(id)}`, { method: 'PUT' }).catch(() => {})));
    if (toPush.length || [...saved].some(id => !before.has(id))) {
      localStorage.setItem('donateuz-saved', JSON.stringify([...saved]));
    }
    if (document.getElementById('profile-view').classList.contains('active')) renderSaved();
    updateNotifBadge();
  } catch (err) {
    console.warn('[saved] could not sync from server', err.message);
  }
}

function toggleSave(id) {
  const willSave = !saved.has(id);
  willSave ? saved.add(id) : saved.delete(id);
  localStorage.setItem('donateuz-saved', JSON.stringify([...saved]));
  const icon = document.getElementById('save-' + id);
  if (icon) { icon.setAttribute('data-lucide', willSave ? 'bookmark-check' : 'bookmark'); lucide.createIcons(); }
  showToast(willSave ? 'Campaign saved' : 'Campaign removed from saved');
  Sound.play(willSave ? 'pop' : 'tap');
  FX.haptic(12);
  if (document.getElementById('profile-view').classList.contains('active')) renderSaved();

  if (currentUser) queueSaveSync(id, willSave ? 'PUT' : 'DELETE');
}

function renderSaved() {
  const list = document.getElementById('saved-list');
  if (!list) return;
  list.innerHTML = '';
  document.getElementById('saved-empty').classList.toggle('hidden', saved.size > 0);
  saved.forEach(id => {
    const c = campaigns[id];
    if (!c) return;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'story text-left w-full';
    el.innerHTML = `<div class="compact-mark"><i data-lucide="heart"></i></div><div class="flex-1 font-bold"><div>${esc(c.title)}</div><p class="text-xs m-0 font-normal" style="color:var(--subtext)">${esc(c.category)} · ${money(c.raisedAmountCents)} raised</p></div>`;
    el.onclick = () => openCampaign(id);
    list.appendChild(el);
  });
  lucide.createIcons();
}

/* ================= Campaign detail + donation sheet ================= */
function openCampaign(id) {
  currentCampaign = id;
  const c = campaigns[id];
  if (!c) return;
  document.getElementById('detail-image').src = photoURL('donateuz-' + c.imageSeed);
  document.getElementById('detail-image').alt = c.title;
  document.getElementById('detail-badge').textContent = c.category;
  document.getElementById('detail-title').textContent = c.title;
  document.getElementById('detail-story').textContent = c.story;
  document.getElementById('detail-progress').style.width = c.progress + '%';
  document.getElementById('detail-amount').textContent = `${money(c.raisedAmountCents)} raised of ${money(c.goalAmountCents)}`;
  const saveBtn = document.getElementById('detail-save');
  saveBtn.innerHTML = saved.has(id) ? '<i data-lucide="bookmark-check"></i>Saved' : '<i data-lucide="bookmark"></i>Save';
  lucide.createIcons();
  history.replaceState(null, '', '#campaign/' + encodeURIComponent(id));
  openSheet('campaign-sheet');
}

// Share button on the campaign sheet: native share sheet on mobile, clipboard elsewhere.
async function shareCurrentCampaign() {
  const id = currentCampaign;
  if (!id) return;
  const c = campaigns[id];
  const url = location.origin + location.pathname + '#campaign/' + encodeURIComponent(id);
  if (navigator.share) {
    try { await navigator.share({ title: c.title, text: `Support "${c.title}" on DonateUZ`, url }); return; }
    catch (err) { if (err.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(url);
    showToast('Link copied — share it with a friend');
  } catch (err) {
    showToast('Could not copy the link. Copy it from the address bar instead.', 'error');
  }
}

function toggleCurrentSave() {
  toggleSave(currentCampaign);
  document.getElementById('detail-save').innerHTML = saved.has(currentCampaign) ? '<i data-lucide="bookmark-check"></i>Saved' : '<i data-lucide="bookmark"></i>Save';
  lucide.createIcons();
}

function openDonation() {
  closeSheet('campaign-sheet');
  const c = campaigns[currentCampaign];
  document.getElementById('donate-title').textContent = 'Give to ' + (c ? c.title : 'this campaign');
  document.getElementById('custom-amount').value = '';
  isAnonymous = false; isRecurring = false;
  const anon = document.getElementById('anonymous-toggle');
  anon.classList.remove('on'); anon.setAttribute('aria-pressed', 'false');
  const recur = document.getElementById('recurring-toggle');
  recur.classList.remove('on'); recur.setAttribute('aria-pressed', 'false');
  syncAmountButtons('donation-amounts');
  openSheet('donation-sheet');
}

function quickDonate(id) { currentCampaign = id; openDonation(); }

function chooseAmount(el, amountCents) {
  selectedAmountCents = amountCents;
  document.getElementById('custom-amount').value = '';
  const group = el.closest('.amounts');
  if (group) group.querySelectorAll('.amount').forEach(a => a.classList.toggle('selected', a === el));
  Sound.play('tap');
  FX.haptic(8);
}

function syncAmountButtons(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('.amount').forEach(b => b.classList.toggle('selected', Number(b.dataset.amount) === selectedAmountCents));
}

document.addEventListener('input', (e) => {
  if (e.target && e.target.id === 'custom-amount') {
    const dollars = Number(e.target.value);
    if (dollars > 0) {
      selectedAmountCents = Math.round(dollars * 100);
      document.querySelectorAll('#donation-amounts .amount').forEach(a => a.classList.remove('selected'));
    } else if (e.target.value === '') {
      // Custom amount cleared: fall back to the last preset instead of charging
      // a stale typed amount that is no longer visible anywhere in the UI.
      selectedAmountCents = 2500;
      syncAmountButtons('donation-amounts');
    }
  }
});

function toggleAnonymous() {
  isAnonymous = !isAnonymous;
  const b = document.getElementById('anonymous-toggle');
  b.classList.toggle('on', isAnonymous); b.setAttribute('aria-pressed', String(isAnonymous));
  Sound.play(isAnonymous ? 'toggleOn' : 'toggleOff');
}
function toggleRecurring() {
  isRecurring = !isRecurring;
  const b = document.getElementById('recurring-toggle');
  b.classList.toggle('on', isRecurring); b.setAttribute('aria-pressed', String(isRecurring));
  Sound.play(isRecurring ? 'toggleOn' : 'toggleOff');
}

/* ================= Stripe Checkout ================= */
async function startCheckout() {
  const button = document.getElementById('pay-button');
  const originalLabel = button.innerHTML;
  button.disabled = true;
  button.innerHTML = 'Redirecting to secure payment…';
  Sound.play('coin');
  FX.haptic([15, 40, 15]);
  try {
    const donorName = document.getElementById('donor-name').value.trim();
    const { url } = await api('/donations/checkout', {
      method: 'POST',
      body: JSON.stringify({
        campaignId: currentCampaign,
        amountCents: selectedAmountCents,
        donorName,
        anonymous: isAnonymous,
        recurring: isRecurring
      })
    });
    window.location.href = url; // hand off to Stripe's hosted checkout page
  } catch (err) {
    button.disabled = false;
    button.innerHTML = originalLabel;
    lucide.createIcons();
    showToast(err.message || 'Could not start checkout.', 'error');
  }
}

// Handles the redirect back from Stripe (?donation=success&session_id=...)
async function handleCheckoutReturn() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get('donation');
  if (!status) return;

  if (status === 'cancelled') {
    showToast('Donation cancelled — no charge was made.');
  } else if (status === 'success') {
    const sessionId = params.get('session_id');
    if (sessionId) {
      try {
        const { donation } = await api(`/donations/verify/${encodeURIComponent(sessionId)}`);
        lastDonation = donation;
        showReceipt(donation);
        if (currentUser) loadDonationHistory();
      } catch (err) {
        showToast('Payment received, but we could not load the receipt yet. Check your history shortly.');
      }
    }
  }
  // Clean the query string so a refresh doesn't re-trigger this.
  window.history.replaceState({}, document.title, window.location.pathname);
}

function showReceipt(donation) {
  const rows = [
    ['Campaign', donation.campaignTitle],
    ['Amount', money(donation.amountCents, donation.currency)],
    ['Frequency', donation.recurring ? 'Monthly' : 'One-time'],
    ['Donor', donation.anonymous ? 'Anonymous' : donation.donorName],
    ['Status', donation.status === 'completed' ? 'Confirmed' : 'Processing…']
  ];
  document.getElementById('receipt-content').innerHTML = rows.map(r => `<div class="receipt-row"><span>${esc(r[0])}</span><strong>${esc(r[1])}</strong></div>`).join('');
  openSheet('receipt-sheet');
  celebrateHearts();
  // The signature moment: fanfare, confetti in the app's palette, a thank-you pulse.
  Sound.play('success');
  if (appSettings.confetti !== false) FX.confetti();
  FX.haptic([30, 50, 30, 50, 80]);
}

/* ================= Support requests ================= */
function supportStep(step) {
  if (step === 2 && !document.getElementById('support-form').reportValidity()) return;
  [1, 2, 3].forEach(n => {
    const div = document.getElementById('support-step-' + ({ 1: 'one', 2: 'two', 3: 'three' }[n]));
    if (div) div.classList.toggle('hidden', n !== step);
    const badge = document.getElementById('step-' + n);
    if (badge) {
      badge.classList.toggle('active', n === step);
      badge.classList.toggle('done', n < step);
    }
  });
  if (step === 3) {
    const targetDollars = Number(document.getElementById('support-target').value);
    document.getElementById('support-review').innerHTML =
      `<div class="receipt-row"><span>Campaign</span><strong>${esc(document.getElementById('support-title').value)}</strong></div>` +
      `<div class="receipt-row"><span>Category</span><strong>${esc(document.getElementById('support-category').value)}</strong></div>` +
      `<div class="receipt-row"><span>Target</span><strong>${money(Math.round(targetDollars * 100))}</strong></div>` +
      `<div class="receipt-row"><span>Region</span><strong>${esc(document.getElementById('support-region').value)}</strong></div>`;
  }
}

async function submitSupport(e) {
  e.preventDefault();
  const btn = document.getElementById('support-submit');
  btn.disabled = true;
  btn.textContent = 'Submitting...';
  try {
    await api('/support-requests', {
      method: 'POST',
      body: JSON.stringify({
        title: document.getElementById('support-title').value.trim(),
        category: document.getElementById('support-category').value,
        region: document.getElementById('support-region').value.trim(),
        targetAmountCents: Math.round(Number(document.getElementById('support-target').value) * 100),
        story: document.getElementById('support-story').value.trim()
      })
    });
    document.getElementById('support-form').classList.add('hidden');
    document.getElementById('support-success').classList.remove('hidden');
    Sound.play('send');
    if (appSettings.confetti !== false) FX.confetti({ count: 90 });
    FX.haptic([20, 40, 20]);
  } catch (err) {
    showToast(err.message || 'Could not submit request. Try again.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit for review';
  }
}

async function loadAdminRequests() {
  const list = document.getElementById('admin-list');
  const empty = document.getElementById('admin-empty');
  if (!currentUser) {
    list.innerHTML = '';
    empty.textContent = 'Sign in to view the admin review queue.';
    empty.classList.remove('hidden');
    return;
  }
  try {
    const { requests } = await api('/support-requests');
    adminRecords = requests;
    list.innerHTML = '';
    empty.classList.toggle('hidden', requests.length > 0);
    empty.textContent = 'No support requests are awaiting review.';
    requests.forEach(r => {
      const item = document.createElement('article');
      item.className = 'campaign-body rounded-2xl';
      item.style.cssText += 'background:var(--muted);border:1px solid var(--border)';
      item.innerHTML = `<span class="badge">Pending review</span><h3 class="font-extrabold mt-2 mb-1 text-sm">${esc(r.title)}</h3><p class="text-xs m-0" style="color:var(--subtext)">${esc(r.category)} · ${esc(r.region)} · ${money(r.target_amount_cents)}</p><p class="text-xs mt-2 mb-0" style="color:var(--subtext)">${esc(r.story)}</p>
        <div class="flex gap-2 mt-3">
          <button type="button" class="secondary-btn flex-1 text-xs" onclick="reviewRequest('${esc(r.id)}', 'reject')">Reject</button>
          <button type="button" class="primary-btn flex-1 text-xs" onclick="reviewRequest('${esc(r.id)}', 'approve')">Approve &amp; publish</button>
        </div>`;
      list.appendChild(item);
    });
  } catch (err) {
    list.innerHTML = '';
    empty.textContent = err.message || 'Could not load requests.';
    empty.classList.remove('hidden');
  }
}

/* ================= Admin Dashboard ================= */
async function loadAdminDashboard() {
  // Ensure currentUser is loaded
  if (!currentUser) {
    await loadCurrentUser();
  }
  if (!currentUser) {
    showToast('Sign in to view the admin dashboard.');
    showView('home');
    return;
  }
  if (currentUser.role !== 'admin') {
    showToast('Admin access required.');
    showView('home');
    return;
  }

  // Reset to first page when loading fresh
  adminPagination.campaigns.page = 1;
  adminPagination.donations.page = 1;
  adminPagination.users.page = 1;
  adminPagination.requests.page = 1;

  // Show loading state for active tab
  showAdminTabLoading(currentAdminTab);

  try {
    // Load all dashboard data in parallel (bigger limits: filtering/paging happen client-side)
    const [statsResult, campaignsResult, usersResult, donationsResult, requestsResult] = await Promise.all([
      api('/admin/stats'),
      api('/admin/campaigns'),
      api('/admin/users?limit=200'),
      api('/admin/donations?limit=200'),
      api('/admin/support-requests?limit=200')
    ]);

    adminStats = statsResult;
    adminCampaigns = campaignsResult.campaigns;
    adminUsers = usersResult.users;
    adminDonations = donationsResult.donations;
    adminSupportRequests = requestsResult.requests;

    // Render all tabs (they'll be filtered/paginated on display)
    renderAdminStats();
    renderAdminCampaignsTab();
    renderAdminDonationsTab();
    renderAdminUsersTab();
    renderAdminRequestsTab();
  } catch (err) {
    console.error('[admin] dashboard error', err);
    showToast(err.message || 'Could not load admin dashboard.', 'error');
    showAdminTabError(currentAdminTab);
  }
}

function showAdminTabLoading(tab) {
  const loadingHtml = '<div class="loading">Loading...</div>';
  if (tab === 'stats') {
    document.getElementById('admin-stats').innerHTML = loadingHtml;
  } else if (tab === 'campaigns') {
    document.getElementById('admin-campaigns').innerHTML = loadingHtml;
  } else if (tab === 'donations') {
    document.getElementById('admin-donations').innerHTML = loadingHtml;
  } else if (tab === 'users') {
    document.getElementById('admin-users').innerHTML = loadingHtml;
  } else if (tab === 'requests') {
    document.getElementById('admin-support-requests').innerHTML = loadingHtml;
  }
}

function showAdminTabError(tab) {
  const errorHtml = '<p class="empty">Failed to load data. Please try again later.</p>';
  if (tab === 'stats') {
    document.getElementById('admin-stats').innerHTML = errorHtml;
  } else if (tab === 'campaigns') {
    document.getElementById('admin-campaigns').innerHTML = errorHtml;
  } else if (tab === 'donations') {
    document.getElementById('admin-donations').innerHTML = errorHtml;
  } else if (tab === 'users') {
    document.getElementById('admin-users').innerHTML = errorHtml;
  } else if (tab === 'requests') {
    document.getElementById('admin-support-requests').innerHTML = errorHtml;
  }
}

function renderAdminStats() {
  const container = document.getElementById('admin-stats');
  if (!container || !adminStats) return;

  const cards = [
    ['dollar-sign', money(adminStats.totalAmountCents || 0), 'Total Raised'],
    ['gift', adminStats.totalDonations || 0, 'Donations'],
    ['trending-up', money(adminStats.monthAmountCents || 0), 'Raised This Month'],
    ['calculator', money(adminStats.avgDonationCents || 0), 'Average Gift'],
    ['repeat', adminStats.recurringCount || 0, 'Monthly Donors'],
    ['heart-handshake', adminStats.activeCampaigns || 0, 'Active Campaigns'],
    ['message-square', adminStats.pendingRequests || 0, 'Pending Requests'],
    ['users', adminStats.totalUsers || 0, 'Total Users']
  ];

  container.innerHTML = cards.map(([icon, value, label]) => `
    <div class="admin-stat">
      <div class="stat-icon"><i data-lucide="${icon}" style="width:20px;color:var(--primary)"></i></div>
      <div class="stat-number">${esc(String(value))}</div>
      <div class="stat-label">${esc(label)}</div>
    </div>
  `).join('');

  // Recreate Lucide icons
  lucide.createIcons();
}

/* ================= Admin Tab Switching ================= */
function switchAdminTab(tabName) {
  // Update tab buttons
  document.querySelectorAll('.admin-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  // Update tab panels
  document.querySelectorAll('.admin-tab-panel').forEach(panel => {
    panel.classList.toggle('hidden', panel.id !== `admin-tab-${tabName}`);
    panel.classList.toggle('active', panel.id === `admin-tab-${tabName}`);
  });

  currentAdminTab = tabName;

  // Render the tab content if not already rendered
  if (tabName === 'campaigns') renderAdminCampaignsTab();
  else if (tabName === 'donations') renderAdminDonationsTab();
  else if (tabName === 'users') renderAdminUsersTab();
  else if (tabName === 'requests') renderAdminRequestsTab();
}

/* ================= Admin Filter & Pagination Helpers ================= */
function getFilteredCampaigns() {
  let filtered = [...adminCampaigns];
  const { search, status } = adminFilters.campaigns;
  if (search) {
    const s = search.toLowerCase();
    filtered = filtered.filter(c =>
      c.title.toLowerCase().includes(s) ||
      c.region.toLowerCase().includes(s) ||
      c.category.toLowerCase().includes(s)
    );
  }
  if (status) {
    filtered = filtered.filter(c => c.status === status);
  }
  return filtered;
}

function getFilteredDonations() {
  let filtered = [...adminDonations];
  const { search, status, recurring } = adminFilters.donations;
  if (search) {
    const s = search.toLowerCase();
    filtered = filtered.filter(d =>
      (d.campaignTitle || '').toLowerCase().includes(s) ||
      (d.donorName || '').toLowerCase().includes(s) ||
      (d.user_name || '').toLowerCase().includes(s) ||
      (d.user_email || '').toLowerCase().includes(s)
    );
  }
  if (status) {
    filtered = filtered.filter(d => d.status === status);
  }
  if (recurring !== '') {
    filtered = filtered.filter(d => String(!!d.recurring) === recurring);
  }
  return filtered;
}

function getFilteredUsers() {
  let filtered = [...adminUsers];
  const { search, role } = adminFilters.users;
  if (search) {
    const s = search.toLowerCase();
    filtered = filtered.filter(u =>
      (u.name || '').toLowerCase().includes(s) ||
      (u.email || '').toLowerCase().includes(s)
    );
  }
  if (role) {
    filtered = filtered.filter(u => u.role === role);
  }
  return filtered;
}

function getFilteredRequests() {
  let filtered = [...adminSupportRequests];
  const { search, status } = adminFilters.requests;
  if (search) {
    const s = search.toLowerCase();
    filtered = filtered.filter(r =>
      (r.title || '').toLowerCase().includes(s) ||
      (r.category || '').toLowerCase().includes(s) ||
      (r.region || '').toLowerCase().includes(s)
    );
  }
  if (status) {
    filtered = filtered.filter(r => r.status === status);
  }
  return filtered;
}

function paginate(items, pagination) {
  const start = (pagination.page - 1) * pagination.pageSize;
  return items.slice(start, start + pagination.pageSize);
}

function renderPagination(containerId, pagination, totalItems, onPageChange) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const totalPages = Math.ceil(totalItems / pagination.pageSize);
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = '';
  // Previous button
  html += `<button ${pagination.page === 1 ? 'disabled' : ''} onclick="${onPageChange}(${pagination.page - 1})"><i data-lucide="chevron-left" style="width:16px"></i></button>`;

  // Page numbers
  const maxVisible = 5;
  let startPage = Math.max(1, pagination.page - Math.floor(maxVisible / 2));
  let endPage = Math.min(totalPages, startPage + maxVisible - 1);

  if (endPage - startPage + 1 < maxVisible) {
    startPage = Math.max(1, endPage - maxVisible + 1);
  }

  if (startPage > 1) {
    html += `<button onclick="${onPageChange}(1)">1</button>`;
    if (startPage > 2) html += `<span class="page-info">...</span>`;
  }

  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="${i === pagination.page ? 'active' : ''}" onclick="${onPageChange}(${i})">${i}</button>`;
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) html += `<span class="page-info">...</span>`;
    html += `<button onclick="${onPageChange}(${totalPages})">${totalPages}</button>`;
  }

  // Next button
  html += `<button ${pagination.page === totalPages ? 'disabled' : ''} onclick="${onPageChange}(${pagination.page + 1})"><i data-lucide="chevron-right" style="width:16px"></i></button>`;

  container.innerHTML = html;
  lucide.createIcons();
}

/* ================= Admin Tab Renderers (with Filtering & Pagination) ================= */
function renderAdminCampaignsTab() {
  const container = document.getElementById('admin-campaigns');
  const emptyEl = document.getElementById('admin-campaigns-empty');
  const paginationEl = document.getElementById('admin-campaigns-pagination');
  if (!container) return;

  const filtered = getFilteredCampaigns();
  const paginated = paginate(filtered, adminPagination.campaigns);

  // Show/hide empty state
  if (emptyEl) emptyEl.classList.toggle('hidden', filtered.length > 0);

  if (filtered.length === 0) {
    container.innerHTML = '';
    if (paginationEl) paginationEl.innerHTML = '';
    return;
  }

  container.innerHTML = paginated.map(c => {
    const img = photoURL('donateuz-' + (c.image_seed || c.id));
    const urgencyLevel = c.urgency === 1 ? 'level-high' : c.urgency <= 2 ? 'level-moderate' : 'level-normal';
    const progress = c.goal_amount_cents > 0 ? Math.min(100, Math.round((c.raisedAmountCents / c.goal_amount_cents) * 100)) : 0;
    const isActive = c.status === 'active';

    const actionButtons = `
      <div class="flex gap-2 mt-3">
        <button type="button" class="secondary-btn flex-1 text-xs" onclick="openEditCampaignModal('${esc(c.id)}')">
          <i data-lucide="edit" style="width:16px"></i> Edit
        </button>
        <button type="button" class="secondary-btn flex-1 text-xs" onclick="setCampaignStatus('${esc(c.id)}', '${isActive ? 'closed' : 'active'}')">
          <i data-lucide="${isActive ? 'pause-circle' : 'play-circle'}" style="width:16px"></i>
          ${isActive ? 'Close' : 'Reopen'}
        </button>
        <button type="button" class="primary-btn flex-1 text-xs danger-btn" onclick="deleteCampaign('${esc(c.id)}')">
          <i data-lucide="trash-2" style="width:16px"></i> Delete
        </button>
      </div>`;

    return `
      <article class="campaign rounded-2xl border" style="border-color:var(--border);background:var(--surface);box-shadow:0 4px 20px rgba(16,50,38,.08)">
        <img src="${img}" class="campaign-image w-full h-48 object-cover" loading="lazy" alt="${esc(c.title)}">
        <div class="campaign-body p-4">
          <h3 class="campaign-title font-bold mb-1">${esc(c.title)}</h3>
          <p class="text-sm mb-2" style="color:var(--subtext)">${esc(c.region)} · ${esc(c.category)}</p>
          <div class="progress-track mb-3">
            <div class="progress-bar" style="width:${progress}%"></div>
          </div>
          <div class="flex justify-between text-xs font-bold mb-2">
            <span style="color:var(--primary)">${money(c.raisedAmountCents)} raised</span>
            <span style="color:var(--subtext)">${money(c.goal_amount_cents)} goal</span>
          </div>
          <div class="flex gap-2 flex-wrap">
            <span class="badge ${urgencyLevel}">${c.urgency === 1 ? '🔥 Urgent' : c.urgency <= 2 ? '⚡ Moderate' : 'Normal'}</span>
            <span class="badge ${isActive ? 'completed' : 'paused'}" style="font-size:.62rem">${isActive ? 'Active' : 'Closed'}</span>
          </div>
          ${actionButtons}
        </div>
      </article>`;
  }).join('');

  // Render pagination
  renderPagination('admin-campaigns-pagination', adminPagination.campaigns, filtered.length, 'goToCampaignsPage');

  lucide.createIcons();
}

function renderAdminDonationsTab() {
  const container = document.getElementById('admin-donations');
  const emptyEl = document.getElementById('admin-donations-empty');
  const paginationEl = document.getElementById('admin-donations-pagination');
  if (!container) return;

  const filtered = getFilteredDonations();
  const paginated = paginate(filtered, adminPagination.donations);

  if (emptyEl) emptyEl.classList.toggle('hidden', filtered.length > 0);

  if (filtered.length === 0) {
    container.innerHTML = '';
    if (paginationEl) paginationEl.innerHTML = '';
    return;
  }

  container.innerHTML = paginated.map(d => {
    const isRecurring = !!d.recurring;
    const donorLabel = d.anonymous
      ? 'Anonymous donor'
      : (d.donorName || d.user_name || 'DonateUZ supporter');
    const donorEmail = !d.anonymous && d.user_email ? ` · ${d.user_email}` : '';
    const statusBadgeClass = d.status === 'completed' ? 'completed' : d.status === 'refunded' ? 'status-refunded' : d.status === 'cancelled' ? 'paused' : d.status === 'pending' ? 'status-pending' : 'status-failed';

    // Real money actions: refund a completed one-time gift, or stop a monthly renewal.
    let action = '';
    if (d.status === 'completed' && !isRecurring) {
      action = `<button type="button" class="secondary-btn text-xs refund-btn" onclick="refundDonation('${esc(d.id)}')"><i data-lucide="undo-2" style="width:14px"></i> Refund</button>`;
    } else if (d.status === 'completed' && isRecurring) {
      action = `<button type="button" class="secondary-btn text-xs refund-btn" onclick="cancelDonation('${esc(d.id)}')"><i data-lucide="ban" style="width:14px"></i> Cancel monthly</button>`;
    }

    return `
      <article class="admin-list-row admin-donation-row">
        <div class="admin-row-main">
          <div class="admin-row-icon"><i data-lucide="dollar-sign" style="width:16px;height:16px;color:var(--primary)"></i></div>
          <div class="min-w-0">
            <p class="font-bold text-sm truncate">${esc(d.campaignTitle || 'Unknown campaign')}</p>
            <p class="text-xs truncate" style="color:var(--subtext)">${esc(donorLabel)}${esc(donorEmail)}</p>
          </div>
        </div>
        <div class="admin-row-amount">
          <p class="font-bold">${money(d.amountCents, d.currency)}</p>
          <p class="text-xs" style="color:var(--subtext)">${isRecurring ? 'Monthly' : 'One-time'}</p>
        </div>
        <div class="admin-row-status">
          <span class="badge ${statusBadgeClass}">${esc(d.status || 'pending')}</span>
        </div>
        <div class="admin-row-date">${new Date(d.created_at).toLocaleDateString()}</div>
        <div class="admin-row-action">${action}</div>
      </article>`;
  }).join('');

  renderPagination('admin-donations-pagination', adminPagination.donations, filtered.length, 'goToDonationsPage');
  lucide.createIcons();
}

function renderAdminUsersTab() {
  const container = document.getElementById('admin-users');
  const emptyEl = document.getElementById('admin-users-empty');
  const paginationEl = document.getElementById('admin-users-pagination');
  if (!container) return;

  const filtered = getFilteredUsers();
  const paginated = paginate(filtered, adminPagination.users);

  if (emptyEl) emptyEl.classList.toggle('hidden', filtered.length > 0);

  if (filtered.length === 0) {
    container.innerHTML = '';
    if (paginationEl) paginationEl.innerHTML = '';
    return;
  }

  container.innerHTML = paginated.map(u => {
    const isSelf = currentUser && u.id === currentUser.id;
    let roleAction = '';
    if (!isSelf) {
      roleAction = u.role === 'admin'
        ? `<button type="button" class="secondary-btn text-xs refund-btn" onclick="setUserRole('${esc(u.id)}', 'user')"><i data-lucide="shield-off" style="width:14px"></i> Remove admin</button>`
        : `<button type="button" class="secondary-btn text-xs" onclick="setUserRole('${esc(u.id)}', 'admin')"><i data-lucide="user-plus" style="width:14px"></i> Make admin</button>`;
    }
    return `
    <article class="admin-list-row admin-user-row">
      <div class="admin-row-main">
        <div class="admin-avatar">${esc((u.name || '?').trim().charAt(0).toUpperCase())}</div>
        <div class="min-w-0">
          <p class="font-bold text-sm">${esc(u.name || 'Unknown')}${isSelf ? ' <span class="text-xs" style="color:var(--subtext)">(you)</span>' : ''}</p>
          <p class="text-xs truncate" style="color:var(--subtext)">${esc(u.email)}</p>
        </div>
      </div>
      <div class="admin-row-status">
        <span class="badge ${u.role === 'admin' ? 'completed' : ''}">
          ${u.role === 'admin' ? '<i data-lucide="shield-check" style="width:12px"></i> Admin' : 'User'}
        </span>
      </div>
      <div class="admin-row-date">${new Date(u.created_at).toLocaleDateString()}</div>
      <div class="admin-row-action">${roleAction}</div>
    </article>`;
  }).join('');

  renderPagination('admin-users-pagination', adminPagination.users, filtered.length, 'goToUsersPage');
  lucide.createIcons();
}

function renderAdminRequestsTab() {
  const container = document.getElementById('admin-support-requests');
  const emptyEl = document.getElementById('admin-support-empty');
  const paginationEl = document.getElementById('admin-requests-pagination');
  if (!container) return;

  const filtered = getFilteredRequests();
  const paginated = paginate(filtered, adminPagination.requests);

  if (emptyEl) emptyEl.classList.toggle('hidden', filtered.length > 0);

  if (filtered.length === 0) {
    container.innerHTML = '';
    if (paginationEl) paginationEl.innerHTML = '';
    return;
  }

  container.innerHTML = paginated.map(r => {
    const statusBadge = r.status === 'approved' ? 'completed' : r.status === 'rejected' ? 'status-refunded' : 'status-pending';
    const reviewer = r.reviewed_at ? ` · reviewed ${new Date(r.reviewed_at).toLocaleDateString()}` : '';
    return `
      <article class="admin-list-row admin-request-row">
        <div class="admin-row-main">
          <div class="admin-row-icon"><i data-lucide="heart-handshake" style="width:16px;height:16px;color:var(--teal)"></i></div>
          <div class="min-w-0">
            <p class="font-bold text-sm truncate">${esc(r.title)}</p>
            <p class="text-xs" style="color:var(--subtext)">${esc(r.category)} · ${esc(r.region)}${r.user_email ? ' · ' + esc(r.user_email) : ' · guest request'}</p>
          </div>
        </div>
        <div class="admin-row-amount">
          <p class="font-bold">${money(r.target_amount_cents)}</p>
        </div>
        <div class="admin-row-status">
          <span class="badge ${statusBadge}">${esc((r.status || 'pending_review').replace('_', ' '))}</span>
        </div>
        <div class="admin-row-date">${new Date(r.created_at).toLocaleDateString()}${esc(reviewer)}</div>
        <div class="admin-row-action admin-row-actions-group">
          <button type="button" class="secondary-btn text-xs" onclick="toggleRequestDetails('${esc(r.id)}')"><i data-lucide="eye" style="width:14px"></i> Details</button>
          ${r.status === 'pending_review' ? `
            <button type="button" class="secondary-btn text-xs refund-btn" onclick="reviewRequest('${esc(r.id)}', 'reject')"><i data-lucide="x-circle" style="width:14px"></i> Reject</button>
            <button type="button" class="primary-btn text-xs" onclick="reviewRequest('${esc(r.id)}', 'approve')"><i data-lucide="check-circle" style="width:14px"></i> Approve</button>` : ''}
        </div>
        <div id="req-details-${esc(r.id)}" class="req-details hidden">
          <p class="text-xs" style="color:var(--text);white-space:pre-wrap">${esc(r.story)}</p>
          ${r.review_note ? `<p class="text-xs mt-2" style="color:var(--subtext)"><em>Reviewer note:</em> ${esc(r.review_note)}</p>` : ''}
        </div>
      </article>`;
  }).join('');

  renderPagination('admin-requests-pagination', adminPagination.requests, filtered.length, 'goToRequestsPage');
  lucide.createIcons();
}

function toggleRequestDetails(id) {
  const el = document.getElementById('req-details-' + id);
  if (!el) return;
  el.classList.toggle('hidden');
}

/* ================= Filter Functions ================= */
function filterAdminCampaigns() {
  adminFilters.campaigns.search = document.getElementById('admin-campaigns-search')?.value || '';
  adminFilters.campaigns.status = document.getElementById('admin-campaigns-status-filter')?.value || '';
  adminPagination.campaigns.page = 1;
  renderAdminCampaignsTab();
}

function filterAdminDonations() {
  adminFilters.donations.search = document.getElementById('admin-donations-search')?.value || '';
  adminFilters.donations.status = document.getElementById('admin-donations-status-filter')?.value || '';
  adminFilters.donations.recurring = document.getElementById('admin-donations-recurring-filter')?.value || '';
  adminPagination.donations.page = 1;
  renderAdminDonationsTab();
}

function filterAdminUsers() {
  adminFilters.users.search = document.getElementById('admin-users-search')?.value || '';
  adminFilters.users.role = document.getElementById('admin-users-role-filter')?.value || '';
  adminPagination.users.page = 1;
  renderAdminUsersTab();
}

function filterAdminRequests() {
  adminFilters.requests.search = document.getElementById('admin-requests-search')?.value || '';
  adminFilters.requests.status = document.getElementById('admin-requests-status-filter')?.value || '';
  adminPagination.requests.page = 1;
  renderAdminRequestsTab();
}

/* ================= Pagination Functions ================= */
function goToCampaignsPage(page) {
  adminPagination.campaigns.page = page;
  renderAdminCampaignsTab();
}

function goToDonationsPage(page) {
  adminPagination.donations.page = page;
  renderAdminDonationsTab();
}

function goToUsersPage(page) {
  adminPagination.users.page = page;
  renderAdminUsersTab();
}

function goToRequestsPage(page) {
  adminPagination.requests.page = page;
  renderAdminRequestsTab();
}

/* ================= Export Functions ================= */
// CSV cells must neutralize leading =, +, -, @ and tab/CR: spreadsheet apps
// evaluate them as formulas (CWE-1236). Donor-controlled text reaches exports.
function csvCell(value) {
  let v = String(value ?? '');
  if (/^[=+@\t\r]|^-/.test(v)) v = `'` + v; // leading apostrophe is the standard neutralizer
  return `"${v.replace(/"/g, '""')}"`;
}

function exportAdminDonations() {
  const filtered = getFilteredDonations();
  if (filtered.length === 0) {
    showToast('No donations to export.', 'error');
    return;
  }

  const headers = ['ID', 'Campaign', 'Donor Name', 'Amount (USD)', 'Currency', 'Type', 'Status', 'Date', 'User Email'];
  const rows = filtered.map(d => [
    d.id,
    d.campaignTitle || '',
    d.donorName || '',
    (d.amountCents / 100).toFixed(2),
    d.currency || 'usd',
    d.recurring ? 'Recurring' : 'One-time',
    d.status || 'pending',
    new Date(d.created_at).toISOString().split('T')[0],
    d.user_email || ''
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.map(csvCell).join(','))].join('\n');
  downloadCSV(csv, 'donations-export.csv');
  showToast('Donations exported successfully');
}

function exportAdminUsers() {
  const filtered = getFilteredUsers();
  if (filtered.length === 0) {
    showToast('No users to export.', 'error');
    return;
  }

  const headers = ['ID', 'Name', 'Email', 'Role', 'Created At'];
  const rows = filtered.map(u => [
    u.id,
    u.name || '',
    u.email || '',
    u.role || 'user',
    new Date(u.created_at).toISOString().split('T')[0]
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.map(csvCell).join(','))].join('\n');
  downloadCSV(csv, 'users-export.csv');
  showToast('Users exported successfully');
}

function downloadCSV(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

/* ================= Create / Edit Campaign Modal ================= */
let editingCampaignId = null;

function openCreateCampaignModal() {
  editingCampaignId = null;
  document.getElementById('create-campaign-form').reset();
  document.getElementById('cc-modal-title').textContent = 'Create New Campaign';
  document.getElementById('cc-submit-btn').textContent = 'Create Campaign';
  document.getElementById('cc-status-group').classList.add('hidden');
  openCampaignModal();
}

function openEditCampaignModal(id) {
  const c = adminCampaigns.find(x => x.id === id);
  if (!c) return;
  editingCampaignId = id;
  document.getElementById('cc-modal-title').textContent = 'Edit Campaign';
  document.getElementById('cc-submit-btn').textContent = 'Save Changes';
  document.getElementById('cc-title').value = c.title || '';
  document.getElementById('cc-category').value = c.category || '';
  document.getElementById('cc-region').value = c.region || '';
  document.getElementById('cc-story').value = c.story || '';
  document.getElementById('cc-goal').value = c.goal_amount_cents ? String(c.goal_amount_cents / 100) : '';
  document.getElementById('cc-urgency').value = String(c.urgency || 3);
  document.getElementById('cc-status').value = c.status || 'active';
  document.getElementById('cc-image-seed').value = c.image_seed || '';
  document.getElementById('cc-status-group').classList.remove('hidden');
  openCampaignModal();
}

function openCampaignModal() {
  document.getElementById('create-campaign-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeCampaignModal() {
  document.getElementById('create-campaign-modal').classList.add('hidden');
  document.body.style.overflow = '';
  editingCampaignId = null;
}

async function handleCampaignSubmit(e) {
  e.preventDefault();
  const submitBtn = document.getElementById('cc-submit-btn');
  submitBtn.disabled = true;
  submitBtn.textContent = editingCampaignId ? 'Saving…' : 'Creating…';

  try {
    const payload = {
      title: document.getElementById('cc-title').value.trim(),
      category: document.getElementById('cc-category').value,
      region: document.getElementById('cc-region').value.trim(),
      story: document.getElementById('cc-story').value.trim(),
      goalAmountCents: Math.round(Number(document.getElementById('cc-goal').value) * 100),
      urgency: Number(document.getElementById('cc-urgency').value)
    };
    const imageSeed = document.getElementById('cc-image-seed').value.trim();
    if (imageSeed) payload.imageSeed = imageSeed;

    if (editingCampaignId) {
      payload.status = document.getElementById('cc-status').value;
      await api(`/admin/campaigns/${encodeURIComponent(editingCampaignId)}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      showToast('Campaign updated');
    } else {
      await api('/admin/campaigns', { method: 'POST', body: JSON.stringify(payload) });
      showToast('Campaign created!');
    }

    closeCampaignModal();
    // Refresh both the dashboard and the public campaign grid.
    await Promise.all([loadAdminDashboard(), loadCampaigns()]);
  } catch (err) {
    showToast(err.message || 'Could not save campaign.', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = editingCampaignId ? 'Save Changes' : 'Create Campaign';
  }
}

/* ================= Admin Action Functions ================= */
async function setUserRole(userId, role) {
  if (currentUser && userId === currentUser.id) {
    showToast('You cannot change your own role. Ask another admin.', 'error');
    return;
  }
  const verb = role === 'admin'
    ? 'Make this user an administrator? They will gain full dashboard access.'
    : 'Remove administrator access from this user?';
  if (!window.confirm(verb)) return;
  try {
    await api(`/admin/users/${encodeURIComponent(userId)}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role })
    });
    showToast(role === 'admin' ? 'User promoted to admin' : 'Admin access removed');
    await loadAdminDashboard();
  } catch (err) {
    showToast(err.message || 'Could not update role.', 'error');
  }
}

async function setCampaignStatus(campaignId, status) {
  try {
    await api(`/admin/campaigns/${encodeURIComponent(campaignId)}`, {
      method: 'PUT',
      body: JSON.stringify({ status })
    });
    showToast(status === 'active' ? 'Campaign reopened' : 'Campaign closed — it is no longer listed publicly');
    await Promise.all([loadAdminDashboard(), loadCampaigns()]);
  } catch (err) {
    showToast(err.message || 'Could not update campaign.', 'error');
  }
}

async function deleteCampaign(campaignId) {
  if (!window.confirm('Delete this campaign? This cannot be undone (campaigns with completed donations are protected).')) return;
  try {
    await api(`/admin/campaigns/${encodeURIComponent(campaignId)}`, { method: 'DELETE' });
    showToast('Campaign deleted');
    await Promise.all([loadAdminDashboard(), loadCampaigns()]);
  } catch (err) {
    showToast(err.message || 'Could not delete campaign.', 'error');
  }
}

// Refund a completed one-time donation through Stripe.
async function refundDonation(donationId) {
  if (!window.confirm('Refund this donation in full via Stripe? This moves real money back to the donor.')) return;
  try {
    await api(`/admin/donations/${encodeURIComponent(donationId)}/refund`, { method: 'POST' });
    showToast('Donation refunded');
    await Promise.all([loadAdminDashboard(), loadRecentActivity(), loadPublicStats()]);
  } catch (err) {
    showToast(err.message || 'Could not refund this donation.', 'error');
  }
}

// Stop future renewals of a monthly donation (cancels at period end in Stripe).
async function cancelDonation(donationId) {
  if (!window.confirm('Cancel this monthly donation? The donor keeps what they already paid for; no further charges will be made.')) return;
  try {
    await api(`/admin/donations/${encodeURIComponent(donationId)}/cancel`, { method: 'POST' });
    showToast('Monthly donation cancelled');
    await loadAdminDashboard();
  } catch (err) {
    showToast(err.message || 'Could not cancel this monthly donation.', 'error');
  }
}

/* ================= Admin Support Request Actions ================= */
async function reviewRequest(requestId, action) {
  if (!window.confirm(`Are you sure you want to ${action === 'approve' ? 'approve and publish' : 'reject'} this support request?`)) return;

  try {
    await api(`/support-requests/${requestId}/${action}`, {
      method: 'POST'
    });

    const actionText = action === 'approve' ? 'approved and published' : 'rejected';
    showToast(`Support request ${actionText} successfully`);

    // Refresh the admin dashboard and review panel if they're open
    if (document.getElementById('admin-dashboard-view').classList.contains('active')) {
      await loadAdminDashboard();
    }
    if (document.getElementById('admin-sheet').classList.contains('open')) {
      await loadAdminRequests();
    }
  } catch (err) {
    showToast(err.message || `Could not ${action} support request.`, 'error');
  }
}

/* ================= Profile ================= */
async function loadDonationHistory() {
  if (!currentUser) { historyRecords = []; return; }
  try {
    const { donations } = await api('/donations/history');
    historyRecords = donations;
  } catch (err) {
    historyRecords = [];
  }
}

async function renderProfile() {
  document.getElementById('profile-signed-out').classList.toggle('hidden', !!currentUser);
  document.getElementById('profile-signed-in').classList.toggle('hidden', !currentUser);
  if (!currentUser) return;

  const adminBtn = document.getElementById('admin-panel-btn');
  if (adminBtn) adminBtn.classList.toggle('hidden', currentUser.role !== 'admin');
  document.getElementById('profile-name').textContent = currentUser.name;
  document.getElementById('profile-email').textContent = currentUser.email;
  document.getElementById('profile-avatar-initial').textContent = (currentUser.name || '?').trim().charAt(0).toUpperCase();
  const since = document.getElementById('profile-member-since');
  if (since) since.textContent = currentUser.createdAt
    ? 'Member since ' + new Date(currentUser.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : '';

  renderSaved();
  await loadDonationHistory();

  const totalCents = historyRecords.reduce((s, r) => s + (r.amountCents || 0), 0);
  const lvl = donorLevel(totalCents);
  const chip = document.getElementById('profile-level-chip');
  if (chip) {
    chip.innerHTML = `<i data-lucide="${lvl.level.icon}"></i><span>${esc(lvl.level.name)}</span>`;
    lucide.createIcons();
  }
  const next = document.getElementById('profile-level-next');
  if (next) next.textContent = lvl.next
    ? `${money(lvl.next.min - totalCents)} to ${lvl.next.name}`
    : 'Top level reached';
  const bar = document.getElementById('profile-level-progress');
  if (bar) bar.style.width = lvl.pct + '%';

  renderImpact(totalCents, historyRecords);
  renderAchievements(historyRecords);
  renderHistory();
}

/* ================= Settings ================= */
const settingDefaults = {
  darkMode: false, reduceMotion: false, pushNotifications: true,
  sound: true, haptics: true, confetti: true, emailUpdates: false,
  accent: 'cobalt'
};
let appSettings = { ...settingDefaults, ...JSON.parse(localStorage.getItem('donateuz-settings') || '{}') };

const ACCENTS = [
  { id: 'cobalt',  label: 'Samarkand cobalt', css: 'linear-gradient(135deg,#1D6FA3,#0F9E96)' },
  { id: 'emerald', label: 'Bukhara emerald',  css: 'linear-gradient(135deg,#0E7C5B,#19A67E)' },
  { id: 'saffron', label: 'Spice-road saffron', css: 'linear-gradient(135deg,#A96A08,#C07E14)' },
  { id: 'anor',    label: 'Anor pomegranate', css: 'linear-gradient(135deg,#B23A2E,#D0553B)' },
  { id: 'atlas',   label: 'Atlas-silk indigo', css: 'linear-gradient(135deg,#4F46B8,#7C5CD6)' }
];

function syncSettingsUI() {
  const dark = !!appSettings.darkMode;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.accent = ACCENTS.some(a => a.id === appSettings.accent) ? appSettings.accent : 'cobalt';
  document.body.classList.toggle('reduce-motion', !!appSettings.reduceMotion);
  if (window.Sound) Sound.setEnabled(appSettings.sound !== false);
  document.querySelectorAll('.setting-switch').forEach(b => {
    const on = !!appSettings[b.dataset.setting];
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
  });
  document.querySelectorAll('.swatch').forEach(b => b.classList.toggle('active', b.dataset.accent === appSettings.accent));
  if (window._updateHeroVideo) window._updateHeroVideo();
}
function saveSettings() {
  try { localStorage.setItem('donateuz-settings', JSON.stringify(appSettings)); } catch (e) {}
}
function toggleSetting(key, button) {
  appSettings[key] = !appSettings[key];
  syncSettingsUI();
  saveSettings();
  // Motion answers the action: a click, a state change.
  FX.haptic(10);
  Sound.play(appSettings[key] ? 'toggleOn' : 'toggleOff');
}
function selectAccent(id) {
  appSettings.accent = id;
  syncSettingsUI();
  saveSettings();
  FX.haptic(10);
  Sound.play('pop');
  showToast('Accent colour updated');
}
function renderAccentSwatches() {
  const host = document.getElementById('accent-swatches');
  if (!host) return;
  host.innerHTML = ACCENTS.map(a =>
    `<button type="button" class="swatch ${appSettings.accent === a.id ? 'active' : ''}" data-accent="${a.id}"
       style="background:${a.css}" role="radio" aria-checked="${appSettings.accent === a.id}"
       aria-label="${esc(a.label)}" title="${esc(a.label)}" onclick="selectAccent('${a.id}')"></button>`
  ).join('');
}

/* ================= Donor levels, impact & achievements ================= */
const LEVELS = [
  { name: 'Friend',    min: 0,     icon: 'heart' },
  { name: 'Supporter', min: 2500,  icon: 'star' },
  { name: 'Guardian',  min: 10000, icon: 'shield' },
  { name: 'Champion',  min: 25000, icon: 'crown' },
  { name: 'Legend',    min: 50000, icon: 'gem' }
];

function donorLevel(totalCents) {
  let idx = 0;
  LEVELS.forEach((l, i) => { if (totalCents >= l.min) idx = i; });
  const cur = LEVELS[idx];
  const next = LEVELS[idx + 1] || null;
  const pct = next ? Math.min(100, Math.round(((totalCents - cur.min) / (next.min - cur.min)) * 100)) : 100;
  return { level: cur, next, pct };
}

let historyFilter = 'all';
function setHistoryFilter(mode, btn) {
  historyFilter = mode;
  document.querySelectorAll('#history-filters .chip').forEach(c => c.classList.toggle('active', c === btn));
  renderHistory();
}

function renderHistory() {
  const list = document.getElementById('history-list');
  if (!list) return;
  const records = historyRecords.filter(r => historyFilter === 'all'
    ? true
    : historyFilter === 'monthly' ? r.recurring : !r.recurring);
  document.getElementById('history-empty').classList.toggle('hidden', records.length > 0);
  list.innerHTML = '';
  records.forEach(r => {
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'story text-left w-full glow-card';
    el.innerHTML = `<div class="compact-mark"><i data-lucide="${r.recurring ? 'repeat' : 'receipt'}"></i></div><div class="flex-1"><strong>${esc(r.campaignTitle)}</strong><p class="text-xs m-0 mt-1" style="color:var(--subtext)">${money(r.amountCents, r.currency)} · ${r.recurring ? 'Monthly' : 'One-time'} · ${timeAgo(r.createdAt)}</p></div><i data-lucide="chevron-right"></i>`;
    el.onclick = () => showReceipt(r);
    list.appendChild(el);
  });
  lucide.createIcons();
}

function renderImpact(totalCents, records) {
  const host = document.getElementById('impact-stats');
  if (!host) return;
  const causes = new Set(records.map(r => r.campaignId).filter(Boolean));
  const catCounts = {};
  records.forEach(r => {
    const c = campaigns[r.campaignId];
    if (c) catCounts[c.category] = (catCounts[c.category] || 0) + 1;
  });
  const fav = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0];
  const tiles = [
    ['hand-heart', money(totalCents), 'Given in total'],
    ['gift', String(records.length), 'Gifts made'],
    ['heart-handshake', String(causes.size), 'Causes supported'],
    [fav ? 'sparkle' : 'compass', fav ? fav[0] : '—', 'Favourite category']
  ];
  host.innerHTML = tiles.map(([icon, value, label]) => `
    <div class="mini-stat glow-card stat-glow">
      <span style="display:flex;align-items:center;gap:6px"><i data-lucide="${icon}" style="width:14px;height:14px;color:var(--primary)"></i>${esc(label)}</span>
      <strong class="block mt-1">${esc(value)}</strong>
    </div>`).join('');
  lucide.createIcons();
}

function renderAchievements(records) {
  const host = document.getElementById('achievements-row');
  if (!host) return;
  const total = records.reduce((s, r) => s + (r.amountCents || 0), 0);
  const cats = new Set(records.map(r => campaigns[r.campaignId] && campaigns[r.campaignId].category).filter(Boolean));
  const hasGoal = records.some(r => r.campaignId && campaigns[r.campaignId] && campaigns[r.campaignId].goalReachedAt);
  const defs = [
    { icon: 'heart',           label: 'First gift',      hint: 'Make your first donation',   ok: records.length >= 1 },
    { icon: 'star',            label: 'Regular giver',   hint: 'Give 5 times',               ok: records.length >= 5 },
    { icon: 'repeat',          label: 'Monthly hero',    hint: 'Set up monthly giving',      ok: records.some(r => r.recurring) },
    { icon: 'gem',             label: 'Big heart',       hint: 'Give $100 at once',          ok: records.some(r => r.amountCents >= 10000) },
    { icon: 'shapes',          label: 'All-rounder',     hint: 'Support 3 categories',       ok: cats.size >= 3 },
    { icon: 'trophy',          label: 'Goal maker',      hint: 'Give to a cause that reached its goal', ok: hasGoal }
  ];
  host.innerHTML = defs.map(d => `
    <div class="ach ${d.ok ? 'unlocked' : 'locked'}">
      <div class="ach-icon"><i data-lucide="${d.icon}"></i></div>
      <div><strong>${esc(d.label)}</strong><small>${esc(d.ok ? 'Unlocked' : d.hint)}</small></div>
    </div>`).join('');
  lucide.createIcons();
}

/* ================= Account: edit profile & password ================= */
function openEditProfile() {
  if (!currentUser) { showToast('Sign in to edit your profile.', 'error'); openAuthSheet('login'); return; }
  const err = document.getElementById('profile-error');
  if (err) err.classList.add('hidden');
  document.getElementById('edit-name').value = currentUser.name || '';
  openSheet('edit-profile-sheet');
}

async function handleProfileSave(e) {
  e.preventDefault();
  const btn = document.getElementById('profile-save-btn');
  const err = document.getElementById('profile-error');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    const { user } = await api('/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify({ name: document.getElementById('edit-name').value.trim() })
    });
    currentUser = user;
    closeSheet('edit-profile-sheet');
    syncAccountUI();
    renderProfile();
    showToast('Profile updated');
    Sound.play('success');
  } catch (err2) {
    if (err) { err.textContent = err2.message; err.classList.remove('hidden'); }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save changes';
  }
}

function openChangePassword() {
  if (!currentUser) { showToast('Sign in to change your password.', 'error'); openAuthSheet('login'); return; }
  const err = document.getElementById('pw-error');
  if (err) err.classList.add('hidden');
  document.getElementById('password-form').reset();
  openSheet('password-sheet');
}

async function handlePasswordChange(e) {
  e.preventDefault();
  const btn = document.getElementById('pw-submit');
  const err = document.getElementById('pw-error');
  const currentPassword = document.getElementById('pw-current').value;
  const newPassword = document.getElementById('pw-new').value;
  const confirm = document.getElementById('pw-confirm').value;
  const fail = msg => { if (err) { err.textContent = msg; err.classList.remove('hidden'); } Sound.play('error'); };
  if (newPassword !== confirm) { fail('The two new passwords do not match.'); return; }
  btn.disabled = true;
  btn.textContent = 'Updating…';
  try {
    await api('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword })
    });
    closeSheet('password-sheet');
    showToast('Password updated — other sessions were signed out');
    Sound.play('success');
  } catch (err2) {
    fail(err2.message || 'Could not update the password.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Update password';
  }
}

async function exportMyData() {
  try {
    if (!currentUser) { showToast('Sign in first — your data lives with your account.', 'error'); return; }
    await loadDonationHistory();
    const payload = {
      exportedAt: new Date().toISOString(),
      app: 'DonateUZ',
      profile: { name: currentUser.name, email: currentUser.email, role: currentUser.role, memberSince: currentUser.createdAt || null },
      donations: historyRecords,
      savedCampaigns: [...saved],
      settings: appSettings
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'donateuz-my-data.json';
    link.click();
    URL.revokeObjectURL(link.href);
    showToast('Your data export is downloading');
  } catch (err) {
    showToast(err.message || 'Could not export your data.', 'error');
  }
}

/* ================= Command palette ================= */
let paletteOpen = false;
let paletteItems = [];
let paletteIndex = 0;

function openPalette() {
  const overlay = document.getElementById('palette-overlay');
  if (!overlay) return;
  paletteOpen = true;
  overlay.classList.add('open');
  const input = document.getElementById('palette-input');
  input.value = '';
  buildPaletteItems('');
  setTimeout(() => input.focus(), 40);
  Sound.play('whooshUp');
}

function closePalette() {
  if (!paletteOpen) return;
  paletteOpen = false;
  document.getElementById('palette-overlay').classList.remove('open');
  Sound.play('whooshDown');
}

function buildPaletteItems(query) {
  const q = query.toLowerCase().trim();
  const acts = [
    { icon: 'house', label: 'Go to Home', hint: 'Page', run: () => showView('home') },
    { icon: 'heart-handshake', label: 'Browse causes', hint: 'Page', run: () => showView('donate') },
    { icon: 'file-heart', label: 'Request support', hint: 'Page', run: () => showView('request') },
    { icon: 'user-round', label: 'My profile', hint: 'Page', run: () => showView('profile') },
    { icon: 'settings-2', label: 'Settings', hint: 'Page', run: () => showView('settings') },
    { icon: 'moon', label: 'Toggle dark mode', hint: 'Action', run: () => toggleSetting('darkMode') },
    { icon: 'volume-2', label: (appSettings.sound !== false ? 'Disable' : 'Enable') + ' sound effects', hint: 'Action', run: () => toggleSetting('sound') },
    { icon: 'bookmark', label: 'Toggle reduce motion', hint: 'Action', run: () => toggleSetting('reduceMotion') }
  ];
  if (currentUser && currentUser.role === 'admin') {
    acts.push({ icon: 'shield-check', label: 'Admin dashboard', hint: 'Page', run: () => showView('admin-dashboard') });
  }
  if (currentUser) {
    acts.push({ icon: 'log-out', label: 'Sign out', hint: 'Action', run: () => handleSignOut() });
  } else {
    acts.push({ icon: 'log-in', label: 'Sign in or create account', hint: 'Action', run: () => openAuthSheet('login') });
  }
  const camps = Object.values(campaigns).map(c => ({
    icon: 'heart',
    label: c.title,
    hint: `Cause · ${c.category} · ${c.region}`,
    run: () => openCampaign(c.id)
  }));
  let all = acts.concat(camps);
  if (q) {
    all = all.filter(i => (i.label + ' ' + i.hint).toLowerCase().includes(q));
  }
  paletteItems = all.slice(0, 12);
  paletteIndex = 0;
  renderPaletteResults(q);
}

function renderPaletteResults(q) {
  const host = document.getElementById('palette-results');
  if (!host) return;
  if (!paletteItems.length) {
    host.innerHTML = `<div class="pal-empty">Nothing matches “${esc(q)}”. Try a page name or a cause.</div>`;
    return;
  }
  host.innerHTML = paletteItems.map((item, i) => `
    <button type="button" class="pal-item ${i === paletteIndex ? 'active' : ''}" data-pal-index="${i}">
      <span class="pal-icon"><i data-lucide="${item.icon}"></i></span>
      <span class="flex-1 min-w-0"><span class="block truncate">${esc(item.label)}</span><small>${esc(item.hint)}</small></span>
    </button>`).join('');
  lucide.createIcons();
  host.querySelectorAll('.pal-item').forEach(btn => {
    btn.addEventListener('click', () => runPaletteItem(Number(btn.dataset.palIndex)));
    btn.addEventListener('pointerenter', () => {
      paletteIndex = Number(btn.dataset.palIndex);
      host.querySelectorAll('.pal-item').forEach((b, i) => b.classList.toggle('active', i === paletteIndex));
    });
  });
}

function runPaletteItem(i) {
  const item = paletteItems[i];
  if (!item) return;
  closePalette();
  setTimeout(() => item.run(), 60); // let the palette close before the view flips
}

function initPalette() {
  const overlay = document.getElementById('palette-overlay');
  const input = document.getElementById('palette-input');
  if (!overlay || !input) return;
  overlay.addEventListener('click', e => { if (e.target === overlay) closePalette(); });
  input.addEventListener('input', () => buildPaletteItems(input.value));
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); paletteIndex = Math.min(paletteItems.length - 1, paletteIndex + 1); renderPaletteResults(input.value); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); paletteIndex = Math.max(0, paletteIndex - 1); renderPaletteResults(input.value); }
    else if (e.key === 'Enter') { e.preventDefault(); runPaletteItem(paletteIndex); }
  });
  document.addEventListener('keydown', e => {
    const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.isContentEditable);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      paletteOpen ? closePalette() : openPalette();
    } else if (e.key === 'Escape' && paletteOpen) {
      closePalette();
    } else if (e.key === '/' && !typing && !paletteOpen) {
      e.preventDefault();
      openPalette();
    }
  });
}

/* ================= Init ================= */
// Register service worker for PWA / offline support
if ('serviceWorker' in navigator && window.location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('[PWA] Service worker registered', reg.scope))
      .catch(err => console.log('[PWA] Service worker registration failed', err));
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  setImage('hero-image', STATIC_PHOTOS.hero, 'Volunteers distributing aid');
  setImage('impact-one-image', STATIC_PHOTOS.impactOne, 'Repaired home roof');
  setImage('impact-two-image', STATIC_PHOTOS.impactTwo, 'Students with supplies');

  syncSettingsUI();
  renderAccentSwatches();
  lucide.createIcons();

  initHeroVideo();
  initStoryVideo();
  observeReveals();
  if (window.FX) {
    FX.initGlow();
    FX.initScrollProgress();
  }
  initPalette();

  renderCampaignSkeletons();

  await loadCurrentUser();
  // These three are independent — run them together so the home page fills in fast.
  await Promise.all([
    loadCampaigns(),
    loadPublicStats(),
    loadRecentActivity()
  ]);
  applyHashRoute(); // open a shared #campaign/<id> link once the data it needs is loaded
  updateNotifBadge();
  await handleCheckoutReturn();

  // Keep the home feed alive: a quiet refresh while the tab is visible.
  setInterval(() => {
    if (!document.hidden) loadRecentActivity().then(updateNotifBadge).catch(() => {});
  }, 45000);
});
