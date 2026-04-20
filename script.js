/* ===========================================
   CRYPTO PRICE TRACKER - script.js
   Modular JavaScript – All Features
   =========================================== */

'use strict';

// =============================================
// CONSTANTS & CONFIGURATION
// =============================================
const CONFIG = {
  COINGECKO_BASE: 'https://api.coingecko.com/api/v3',
  REFRESH_INTERVAL: 60000,  // 60 seconds
  COINS_PER_PAGE: 100,
  CURRENCY: 'usd',
};

// Fiat exchange rates vs USD (fallback if API fails)
const FALLBACK_RATES = {
  usd: 1, inr: 83.5, eur: 0.92, gbp: 0.79,
  jpy: 150.5, cad: 1.36, aud: 1.52, chf: 0.9,
  cny: 7.14, sgd: 1.34,
};

const CURRENCY_SYMBOLS = {
  usd: '$', inr: '₹', eur: '€', gbp: '£',
  jpy: '¥', cad: 'CA$', aud: 'A$', chf: 'CHF',
  cny: '¥', sgd: 'S$',
};

// =============================================
// STATE
// =============================================
var state = {
  allCoins: [],               // Raw data from CoinGecko
  filteredCoins: [],          // After search/filter
  watchlist: [],              // Coin IDs
  portfolio: [],              // Transaction objects
  alerts: [],                 // Alert objects
  currentUser: null,
  currentPage: 'dashboard',
  refreshTimer: null,
  coinDetailChart: null,
  portfolioChart: null,
  analysisChart: null,
  exchangeRates: { ...FALLBACK_RATES },
  currentModalCoin: null,
  currentAnalysisCoin: null,
  darkMode: true,
  alertAudio: null,
  exBalance: 10000.00,        // Simulated exchange balance
  exHoldings: {},             // { coinId: { qty, avgPrice } }
  exTrades: [],               // List of trade objects
  exChart: null,              // Exchange chart instance
  chartCache: {},             // { "coinId-days": { data, timestamp } }
  isRateLimited: false,       // Track active rate limit
  rateLimitStartTime: 0,      // Timestamp of last 429 error
};

// =============================================
// INIT
// =============================================
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

function initApp() {
  // Check existing currency
  const savedCurrency = localStorage.getItem('cpt_currency');
  if (savedCurrency) {
    CONFIG.CURRENCY = savedCurrency;
    const curSelect = document.getElementById('global-currency');
    if (curSelect) curSelect.value = savedCurrency;
  }

  // FIX: Do NOT call bootApp() here when Firebase is present.
  // firebase-auth.js onAuthStateChanged will fire and call __dbReady + bootApp.
  // Calling bootApp here would race with Firebase and load empty localStorage data
  // before Firestore data is ready.
  //
  // We only call bootApp() directly if there's a local session AND no Firebase module.
  const saved = localStorage.getItem('cpt_session');
  if (saved) {
    state.currentUser = JSON.parse(saved);
    // If firebase-db is present, it will call bootApp via onAuthStateChanged.
    // Only boot directly if Firebase module hasn't patched __dbReady yet.
    if (typeof window.__dbReady !== 'function') {
      bootApp();
    }
    // If __dbReady IS available, Firebase onAuthStateChanged handles bootApp.
  }

  // Seed demo user
  seedDemoUser();

  // Build alert audio
  state.alertAudio = buildAlertBeep();
}

function seedDemoUser() {
  const users = getUsers();
  if (!users['rishirajrathore9e36@gmail.com']) {
    users['rishirajrathore9e36@gmail.com'] = {
      name: 'john',
      email: 'rishirajrathore9e36@gmail.com',
      password: 'demo1234',
    };
    saveUsers(users);
  }
}

function bootApp() {
  document.getElementById('auth-overlay').classList.remove('active');
  document.getElementById('app').classList.remove('hidden');

  // Restore theme
  state.darkMode = localStorage.getItem('cpt_darkmode') !== 'false';
  applyTheme();

  // Populate user info
  updateUserDisplay();

  // Load saved data — if firebase-db is loaded, this is a no-op (data already in state).
  // If running without Firebase (local fallback), this loads from localStorage.
  if (typeof window.loadUserData === 'function') {
    window.loadUserData();
  } else {
    loadUserData();
  }

  // Fetch market data
  fetchAllCoins();

  // Populate dropdowns
  fetchExchangeRates();
  renderNews();
  renderFearGreed();

  // Start auto-refresh
  state.refreshTimer = setInterval(fetchAllCoins, CONFIG.REFRESH_INTERVAL);

  // Request notification permission
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

// =============================================
// AUTH
// =============================================
function getUsers() {
  return JSON.parse(localStorage.getItem('cpt_users') || '{}');
}
function saveUsers(users) {
  localStorage.setItem('cpt_users', JSON.stringify(users));
}

function switchAuthTab(tab) {
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-signup').classList.toggle('active', tab === 'signup');
  document.getElementById('form-login').classList.toggle('active', tab === 'login');
  document.getElementById('form-signup').classList.toggle('active', tab === 'signup');
  document.getElementById('login-error').textContent = '';
  document.getElementById('signup-error').textContent = '';
}

function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim().toLowerCase();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');

  const users = getUsers();
  const user = users[email];

  if (!user || user.password !== password) {
    errorEl.textContent = 'Invalid email or password.';
    return;
  }

  state.currentUser = { name: user.name, email: user.email };
  localStorage.setItem('cpt_session', JSON.stringify(state.currentUser));
  bootApp();
  showToast('Welcome back, ' + user.name + '! 👋', 'success');
}

function handleSignup(e) {
  e.preventDefault();
  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim().toLowerCase();
  const password = document.getElementById('signup-password').value;
  const errorEl = document.getElementById('signup-error');

  if (password.length < 8) {
    errorEl.textContent = 'Password must be at least 8 characters.';
    return;
  }

  const users = getUsers();
  if (users[email]) {
    errorEl.textContent = 'An account with this email already exists.';
    return;
  }

  users[email] = { name, email, password };
  saveUsers(users);

  state.currentUser = { name, email };
  localStorage.setItem('cpt_session', JSON.stringify(state.currentUser));
  bootApp();
  showToast('Account created! Welcome, ' + name + ' 🎉', 'success');
}

function handleLogout() {
  localStorage.removeItem('cpt_session');
  state.currentUser = null;
  clearInterval(state.refreshTimer);
  document.getElementById('app').classList.add('hidden');
  document.getElementById('auth-overlay').classList.add('active');
  showToast('Logged out successfully.', 'info');
}

function togglePassword(inputId) {
  const input = document.getElementById(inputId);
  input.type = input.type === 'password' ? 'text' : 'password';
}

function updateUserDisplay() {
  if (!state.currentUser) return;
  const name = state.currentUser.name || 'User';
  document.getElementById('user-name').textContent = name;
  document.getElementById('user-email').textContent = state.currentUser.email || '';
  document.getElementById('user-avatar').textContent = name.charAt(0).toUpperCase();
}

// =============================================
// LOCAL STORAGE HELPERS
// =============================================
function userKey(key) {
  return `cpt_${state.currentUser?.email}_${key}`;
}
// FIX: Expose userKey on window so firebase-db.js can call it for localStorage cache
window.userKey = userKey;

function loadUserData() {
  state.watchlist  = JSON.parse(localStorage.getItem(userKey('watchlist'))  || '[]');
  state.portfolio  = JSON.parse(localStorage.getItem(userKey('portfolio'))  || '[]');
  state.alerts     = JSON.parse(localStorage.getItem(userKey('alerts'))     || '[]');
  state.exBalance  = JSON.parse(localStorage.getItem(userKey('exBalance'))  || '10000');
  state.exHoldings = JSON.parse(localStorage.getItem(userKey('exHoldings')) || '{}');
  state.exTrades   = JSON.parse(localStorage.getItem(userKey('exTrades'))   || '[]');
  updateAlertBadge();
}

// FIX: Expose save functions on window so firebase-db.js can override them
// with Firestore-aware versions. The overrides happen AFTER this script loads.
function saveExData() {
  localStorage.setItem(userKey('exBalance'),  JSON.stringify(state.exBalance));
  localStorage.setItem(userKey('exHoldings'), JSON.stringify(state.exHoldings));
  localStorage.setItem(userKey('exTrades'),   JSON.stringify(state.exTrades));
}
window.saveExData = saveExData;

function saveWatchlist() { localStorage.setItem(userKey('watchlist'), JSON.stringify(state.watchlist)); }
function savePortfolio() { localStorage.setItem(userKey('portfolio'), JSON.stringify(state.portfolio)); }
function saveAlerts()    { localStorage.setItem(userKey('alerts'),    JSON.stringify(state.alerts)); }
window.saveWatchlist = saveWatchlist;
window.savePortfolio = savePortfolio;
window.saveAlerts    = saveAlerts;

// =============================================
// NAVIGATION
// =============================================
function navigateTo(page) {
  // Hide all pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  // Remove active nav
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  // Show selected
  document.getElementById('page-' + page).classList.add('active');
  document.getElementById('nav-' + page).classList.add('active');
  document.getElementById('page-title').textContent = pageTitles[page] || page;

  state.currentPage = page;

  // Close sidebar on mobile
  closeSidebarMobile();

  // Page-specific init
  if (page === 'watchlist') renderWatchlist();
  if (page === 'portfolio') { renderPortfolio(); renderPortfolioChart(); }
  if (page === 'alerts')    renderAlerts();
  if (page === 'exchange')  initExchangePage();
  if (page === 'chatbot')   initChatbotPage();

  // Show/hide global search
  const showSearch = page === 'dashboard';
  document.getElementById('global-search-wrap').style.display = showSearch ? 'flex' : 'none';
}

const pageTitles = {
  dashboard: 'Dashboard',
  watchlist: 'Watchlist',
  portfolio: 'Portfolio',
  alerts: 'Price Alerts',
  exchange: 'Crypto Exchange',
  news: 'Crypto News',
  chatbot: 'AI Chatbot',
};

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('open');
  // Add overlay
  let overlay = document.getElementById('sidebar-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'sidebar-overlay';
    overlay.className = 'sidebar-overlay';
    overlay.onclick = closeSidebarMobile;
    document.body.appendChild(overlay);
  }
  overlay.classList.toggle('active', sidebar.classList.contains('open'));
}

function closeSidebarMobile() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebar-overlay')?.classList.remove('active');
}

// =============================================
// THEME
// =============================================
function toggleDarkMode() {
  state.darkMode = !state.darkMode;
  applyTheme();
  localStorage.setItem('cpt_darkmode', state.darkMode);
}

function applyTheme() {
  document.documentElement.setAttribute('data-theme', state.darkMode ? 'dark' : 'light');
}

// =============================================
// COINGECKO API
// =============================================
async function fetchAllCoins() {
  if (state.isRateLimited) {
    const now = Date.now();
    if (now - state.rateLimitStartTime < 60000) {
      console.warn('Skipping data fetch due to active rate limit.');
      return;
    }
    state.isRateLimited = false;
  }

  showLoading(true);
  try {
    const url = `${CONFIG.COINGECKO_BASE}/coins/markets?vs_currency=${CONFIG.CURRENCY}&order=market_cap_desc&per_page=${CONFIG.COINS_PER_PAGE}&page=1&sparkline=true&price_change_percentage=24h`;
    const res = await fetch(url);
    
    if (res.status === 429) {
      state.isRateLimited = true;
      state.rateLimitStartTime = Date.now();
      throw new Error('Rate limit exceeded');
    }

    if (!res.ok) throw new Error('API error: ' + res.status);
    const data = await res.json();
    state.allCoins = data;
    state.filteredCoins = [...data];

    renderCoinsTable(state.filteredCoins);
    fetchGlobalStats();
    populateDropdowns();
    checkAlerts();
    updateLastUpdated();
  } catch (err) {
    console.error('Fetch coins error:', err);
    if (err.message === 'Rate limit exceeded') {
      showToast('Rate limit hit. Slowing down background updates.', 'warning');
    } else {
      showToast('Failed to fetch market data. Retrying…', 'error');
    }
    
    // Show cached data if available
    if (state.allCoins.length) {
      renderCoinsTable(state.filteredCoins);
    } else {
      document.getElementById('coins-loading').innerHTML =
        '<div class="empty-state"><div class="empty-icon">⚠️</div><h3>Unable to fetch data</h3><p>Please check your internet connection or try again later.</p></div>';
    }
  }
  showLoading(false);
}

async function fetchGlobalStats() {
  try {
    const res = await fetch(`${CONFIG.COINGECKO_BASE}/global`);
    if (!res.ok) return;
    const { data } = await res.json();

    const mc = data.total_market_cap?.usd;
    const vol = data.total_volume?.usd;
    const btcDom = data.market_cap_percentage?.btc;
    const active = data.active_cryptocurrencies;
    const mcChange = data.market_cap_change_percentage_24h_usd;

    document.getElementById('stat-marketcap').textContent = formatLargeNum(mc);
    document.getElementById('stat-volume').textContent = formatLargeNum(vol);
    document.getElementById('stat-btc-dom').textContent = btcDom ? btcDom.toFixed(1) + '%' : '—';
    document.getElementById('stat-active').textContent = active ? active.toLocaleString() : '—';

    const mcChangeEl = document.getElementById('stat-mc-change');
    if (mcChange !== undefined) {
      const sign = mcChange >= 0 ? '+' : '';
      mcChangeEl.textContent = `${sign}${mcChange.toFixed(2)}% (24h)`;
      mcChangeEl.className = 'stat-change ' + (mcChange >= 0 ? 'positive' : 'negative');
    }
  } catch (err) {
    console.warn('Global stats fetch failed:', err);
  }
}


async function fetchCoinHistory(coinId, days) {
  const cacheKey = `history-${coinId}-${days}`;
  const now = Date.now();
  const CACHE_DURATION = 5 * 60 * 1000;

  if (state.chartCache[cacheKey]) {
    const cached = state.chartCache[cacheKey];
    if (now - cached.timestamp < CACHE_DURATION) return cached.data;
  }

  const currency = CONFIG.CURRENCY || 'usd';
  const urls = [
    `${CONFIG.COINGECKO_BASE}/coins/${coinId}/market_chart?vs_currency=${currency}&days=${days}`,
  ];
  if (currency !== 'usd') {
    urls.push(`${CONFIG.COINGECKO_BASE}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`);
  }

  let lastErr;
  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (res.status === 429) throw new Error('Rate limit exceeded');
      if (!res.ok) throw new Error(`API error: ${res.status}`);

      const data = await res.json();
      if (!data || !data.prices || data.prices.length === 0) throw new Error('No data available');

      state.chartCache[cacheKey] = { data, timestamp: now };
      return data;
    } catch (err) {
      lastErr = err;
      console.warn('fetchCoinHistory attempt failed:', err.message);
    }
  }

  console.error('fetchCoinHistory all attempts failed:', lastErr);
  throw lastErr;
}

async function fetchCoinOHLC(coinId, days) {
  let ohlcDays = days;
  if(!['1', '7', '14', '30', '90', '365', 'max'].includes(days)) {
    ohlcDays = '30';
  }

  const cacheKey = `${coinId}-${ohlcDays}-${CONFIG.CURRENCY}`;
  const now = Date.now();
  const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  if (state.chartCache[cacheKey]) {
    const cached = state.chartCache[cacheKey];
    if (now - cached.timestamp < CACHE_DURATION) {
      console.log(`Using cached chart data for ${cacheKey}`);
      return cached.data;
    }
  }

  const currency = CONFIG.CURRENCY || 'usd';
  const urls = [
    `${CONFIG.COINGECKO_BASE}/coins/${coinId}/ohlc?vs_currency=${currency}&days=${ohlcDays}`,
  ];
  // If non-USD, also try USD as a fallback currency
  if (currency !== 'usd') {
    urls.push(`${CONFIG.COINGECKO_BASE}/coins/${coinId}/ohlc?vs_currency=usd&days=${ohlcDays}`);
  }

  let lastErr;
  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (res.status === 429) throw new Error('Rate limit exceeded');
      if (!res.ok) throw new Error(`API error: ${res.status}`);

      const data = await res.json();
      if (!data || data.length === 0) throw new Error('No data available');

      state.chartCache[cacheKey] = { data, timestamp: now };
      return data;
    } catch (err) {
      lastErr = err;
      console.warn('fetchCoinOHLC attempt failed:', err.message);
    }
  }

  console.error('fetchCoinOHLC all attempts failed:', lastErr);
  throw lastErr;
}

async function fetchExchangeRates() {
  try {
    // CoinGecko simple price for popular coins in multiple currencies
    // We use a static approach: USD base rates from ExchangeRate-API (free tier)
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!res.ok) throw new Error('Rate API failed');
    const data = await res.json();
    if (data.rates) {
      state.exchangeRates = { usd: 1 };
      ['inr','eur','gbp','jpy','cad','aud','chf','cny','sgd'].forEach(c => {
        state.exchangeRates[c] = data.rates[c.toUpperCase()] ?? FALLBACK_RATES[c];
      });
    }
  } catch {
    state.exchangeRates = { ...FALLBACK_RATES };
  }
  renderRateGrid();
}

// =============================================
// COINS TABLE RENDER
// =============================================
function showLoading(show) {
  const el = document.getElementById('coins-loading');
  const table = document.getElementById('coins-table');
  if (show) {
    el.style.display = 'flex';
    table.style.display = 'none';
  } else {
    el.style.display = 'none';
    table.style.display = 'table';
  }
}

function renderCoinsTable(coins) {
  const tbody = document.getElementById('coins-body');
  tbody.innerHTML = '';

  if (!coins || coins.length === 0) {
    document.getElementById('coins-loading').innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><h3>No coins found</h3><p>Try adjusting your search.</p></div>';
    document.getElementById('coins-loading').style.display = 'flex';
    document.getElementById('coins-table').style.display = 'none';
    return;
  }

  coins.forEach((coin, idx) => {
    const change = coin.price_change_percentage_24h || 0;
    const isPos = change >= 0;
    const inWatchlist = state.watchlist.includes(coin.id);

    const tr = document.createElement('tr');
    tr.id = `coin-row-${coin.id}`;
    tr.innerHTML = `
      <td><span class="rank-badge">${coin.market_cap_rank ?? idx + 1}</span></td>
      <td>
        <div class="coin-info">
          <img class="coin-logo" src="${coin.image}" alt="${coin.name}" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=\\'http://www.w3.org/2000/svg\\'><circle cx=\\'16\\' cy=\\'16\\' r=\\'16\\' fill=\\'%236c63ff\\'/></svg>'" />
          <div>
            <div class="coin-name">${escHtml(coin.name)}</div>
            <div class="coin-symbol">${coin.symbol.toUpperCase()}</div>
          </div>
        </div>
      </td>
      <td><span class="price">${formatPrice(coin.current_price)}</span></td>
      <td>
        <span class="change-pill ${isPos ? 'positive' : 'negative'}">
          ${isPos ? '+' : ''}${change.toFixed(2)}%
        </span>
      </td>
      <td>${formatLargeNum(coin.market_cap)}</td>
      <td>${formatLargeNum(coin.total_volume)}</td>
      <td class="mini-chart-cell" id="spark-${coin.id}"></td>
      <td>
        <div class="action-btns">
          <button class="btn-sm ${inWatchlist ? 'starred' : ''}" title="${inWatchlist ? 'Remove from watchlist' : 'Add to watchlist'}"
            onclick="toggleWatchlist('${coin.id}', this)" aria-label="Watchlist">
            ${inWatchlist 
              ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>' 
              : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>'}
          </button>
          <button class="btn-sm btn-chart-action" onclick="openCoinModal('${coin.id}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"></path><path d="m19 9-5 5-4-4-3 3"></path></svg>
            <span>Chart</span>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
    // Draw sparkline
    drawSparkline(`spark-${coin.id}`, coin.sparkline_in_7d?.price, isPos);
  });
}

function drawSparkline(containerId, prices, isPositive) {
  if (!prices || prices.length < 2) return;
  const container = document.getElementById(containerId);
  if (!container) return;

  const canvas = document.createElement('canvas');
  canvas.width = 80; canvas.height = 36;
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  const color = isPositive ? '#22d3a0' : '#ff5b6e';

  // Sample to ~20 points for performance
  const sampled = prices.filter((_, i) => i % Math.max(1, Math.floor(prices.length / 20)) === 0);
  const min = Math.min(...sampled);
  const max = Math.max(...sampled);
  const range = max - min || 1;

  const grad = ctx.createLinearGradient(0, 0, 0, 36);
  grad.addColorStop(0, color + '33');
  grad.addColorStop(1, 'transparent');

  ctx.beginPath();
  sampled.forEach((p, i) => {
    const x = (i / (sampled.length - 1)) * 80;
    const y = 32 - ((p - min) / range) * 28;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });

  // Fill area
  ctx.lineTo(80, 36); ctx.lineTo(0, 36); ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  sampled.forEach((p, i) => {
    const x = (i / (sampled.length - 1)) * 80;
    const y = 32 - ((p - min) / range) * 28;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function updateLastUpdated() {
  const now = new Date();
  document.getElementById('last-updated').textContent =
    'Updated ' + now.toLocaleTimeString();
}

// =============================================
// SEARCH & FILTER
// =============================================
function filterCoins(query) {
  const q = query.toLowerCase().trim();
  const changeFilter = document.getElementById('filter-change')?.value ?? 'all';

  let filtered = state.allCoins.filter(c =>
    c.name.toLowerCase().includes(q) ||
    c.symbol.toLowerCase().includes(q)
  );

  if (changeFilter === 'gainers') filtered = filtered.filter(c => (c.price_change_percentage_24h || 0) > 0);
  if (changeFilter === 'losers')  filtered = filtered.filter(c => (c.price_change_percentage_24h || 0) < 0);

  state.filteredCoins = filtered;
  renderCoinsTable(filtered);
}

function filterByChange(val) {
  const q = document.getElementById('global-search')?.value ?? '';
  filterCoins(q);
}

function sortCoins(val) {
  const coins = [...state.filteredCoins];
  switch (val) {
    case 'market_cap_desc': coins.sort((a, b) => (b.market_cap || 0) - (a.market_cap || 0)); break;
    case 'volume_desc':     coins.sort((a, b) => (b.total_volume || 0) - (a.total_volume || 0)); break;
    case 'price_asc':       coins.sort((a, b) => (a.current_price || 0) - (b.current_price || 0)); break;
    case 'price_desc':      coins.sort((a, b) => (b.current_price || 0) - (a.current_price || 0)); break;
    case 'change_desc':     coins.sort((a, b) => (b.price_change_percentage_24h || 0) - (a.price_change_percentage_24h || 0)); break;
  }
  state.filteredCoins = coins;
  renderCoinsTable(coins);
}

function refreshData() {
  fetchAllCoins();
  fetchExchangeRates();
}

// =============================================
// WATCHLIST
// =============================================
function toggleWatchlist(coinId, btnEl) {
  const idx = state.watchlist.indexOf(coinId);
  if (idx === -1) {
    state.watchlist.push(coinId);
    if (btnEl) { 
      btnEl.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>'; 
      btnEl.classList.add('starred'); 
    }
    showToast('Added to watchlist ⭐', 'success');
  } else {
    state.watchlist.splice(idx, 1);
    if (btnEl) { 
      btnEl.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>'; 
      btnEl.classList.remove('starred'); 
    }
    showToast('Removed from watchlist', 'info');
  }
  window.saveWatchlist();
  if (state.currentPage === 'watchlist') renderWatchlist();
}

function renderWatchlist() {
  const grid = document.getElementById('watchlist-grid');
  const empty = document.getElementById('watchlist-empty');
  grid.innerHTML = '';

  if (state.watchlist.length === 0) {
    empty.style.display = 'flex';
    grid.style.display = 'none';
    return;
  }

  empty.style.display = 'none';
  grid.style.display = 'grid';

  state.watchlist.forEach(id => {
    const coin = state.allCoins.find(c => c.id === id);
    if (!coin) return;
    const change = coin.price_change_percentage_24h || 0;
    const isPos = change >= 0;

    const card = document.createElement('div');
    card.className = 'watch-card';
    card.onclick = () => openCoinModal(coin.id);
    card.innerHTML = `
      <button class="watch-remove" title="Remove" onclick="event.stopPropagation(); toggleWatchlist('${coin.id}')">✕</button>
      <div class="watch-card-header">
        <img class="coin-logo" src="${coin.image}" alt="${coin.name}" width="36" height="36" />
        <div>
          <div class="watch-coin-name">${escHtml(coin.name)}</div>
          <div class="watch-coin-symbol">${coin.symbol.toUpperCase()}</div>
        </div>
      </div>
      <div class="watch-price">${formatPrice(coin.current_price)}</div>
      <span class="change-pill ${isPos ? 'positive' : 'negative'}">
        ${isPos ? '+' : ''}${change.toFixed(2)}%
      </span>
      <div style="margin-top:0.75rem;color:var(--text-muted);font-size:0.78rem;">
        Mkt Cap: ${formatLargeNum(coin.market_cap)}
      </div>
    `;
    grid.appendChild(card);
  });
}

// =============================================
// PORTFOLIO
// =============================================
function populateDropdowns() {
  const selectors = ['portfolio-coin', 'alert-coin', 'ex-coin'];
  selectors.forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">Select Coin…</option>';
    state.allCoins.forEach(coin => {
      const opt = document.createElement('option');
      opt.value = coin.id;
      opt.textContent = `${coin.name} (${coin.symbol.toUpperCase()})`;
      sel.appendChild(opt);
    });
    if (current) sel.value = current;
  });
  populateConverterDropdown();
}

function populateConverterDropdown() {
  const sel = document.getElementById('conv-from');
  if (!sel || state.allCoins.length === 0) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">Choose crypto…</option>';
  state.allCoins.forEach(coin => {
    const opt = document.createElement('option');
    opt.value = coin.id;
    opt.textContent = `${coin.name} (${coin.symbol.toUpperCase()})`;
    sel.appendChild(opt);
  });
  if (current) sel.value = current;
}

function updatePortfolioCoinPrice() {
  const coinId = document.getElementById('portfolio-coin').value;
  const coin = state.allCoins.find(c => c.id === coinId);
  if (coin) {
    document.getElementById('portfolio-price').value = coin.current_price.toFixed(6);
    updatePortfolioTotal();
  }
}

function updatePortfolioTotal() {
  const amount = parseFloat(document.getElementById('portfolio-amount').value) || 0;
  const price  = parseFloat(document.getElementById('portfolio-price').value) || 0;
  document.getElementById('portfolio-total').value = '$' + (amount * price).toFixed(2);
}

function addPortfolioTransaction() {
  const coinId = document.getElementById('portfolio-coin').value;
  const type   = document.getElementById('portfolio-type').value;
  const amount = parseFloat(document.getElementById('portfolio-amount').value);
  const price  = parseFloat(document.getElementById('portfolio-price').value);

  if (!coinId || !amount || !price || amount <= 0 || price <= 0) {
    showToast('Please fill all fields correctly.', 'error');
    return;
  }

  const coin = state.allCoins.find(c => c.id === coinId);
  const tx = {
    id: Date.now(),
    coinId,
    coinName: coin?.name || coinId,
    coinSymbol: coin?.symbol?.toUpperCase() || '',
    coinImage: coin?.image || '',
    type, amount, price,
    total: amount * price,
    date: new Date().toISOString(),
  };

  state.portfolio.push(tx);
  window.savePortfolio();
  renderPortfolio();
  renderPortfolioChart();
  showToast(`${type === 'buy' ? '🟢 Bought' : '🔴 Sold'} ${amount} ${tx.coinSymbol} @ ${formatPrice(price)}`, 'success');

  // Reset form
  document.getElementById('portfolio-amount').value = '';
  document.getElementById('portfolio-price').value = '';
  document.getElementById('portfolio-total').value = '';
  document.getElementById('portfolio-coin').value = '';
}

function removeTransaction(txId) {
  state.portfolio = state.portfolio.filter(t => t.id !== txId);
  window.savePortfolio();
  renderPortfolio();
  renderPortfolioChart();
  showToast('Transaction removed.', 'info');
}

function renderPortfolio() {
  const list  = document.getElementById('transactions-list');
  const empty = document.getElementById('transactions-empty');
  list.innerHTML = '';

  if (state.portfolio.length === 0) {
    empty.style.display = 'flex';
    list.style.display = 'none';
    updatePortfolioSummary(0, 0);
    return;
  }

  empty.style.display = 'none';
  list.style.display = 'flex';

  // Calculate summary
  let totalInvested = 0;
  let currentValue  = 0;

  // Group by coin
  const holdings = {};
  state.portfolio.forEach(tx => {
    if (!holdings[tx.coinId]) holdings[tx.coinId] = { qty: 0, invested: 0, coin: tx };
    if (tx.type === 'buy') {
      holdings[tx.coinId].qty += tx.amount;
      holdings[tx.coinId].invested += tx.total;
      totalInvested += tx.total;
    } else {
      holdings[tx.coinId].qty -= tx.amount;
      totalInvested -= tx.total; // reduce cost basis
    }
  });

  Object.values(holdings).forEach(h => {
    const liveCoin = state.allCoins.find(c => c.id === h.coin.coinId);
    if (liveCoin) {
      currentValue += Math.max(0, h.qty) * liveCoin.current_price;
    }
  });

  updatePortfolioSummary(totalInvested, currentValue);

  // Render individual transactions
  [...state.portfolio].reverse().forEach(tx => {
    const item = document.createElement('div');
    item.className = 'transaction-item';
    item.innerHTML = `
      <span class="tx-type-badge ${tx.type}">${tx.type}</span>
      <img src="${tx.coinImage}" width="30" height="30" style="border-radius:50%;" />
      <div class="tx-details">
        <div class="tx-coin">${escHtml(tx.coinName)} <span style="color:var(--text-muted);font-size:0.78rem;">${tx.coinSymbol}</span></div>
        <div class="tx-sub">${tx.amount} × ${formatPrice(tx.price)} • ${formatDate(tx.date)}</div>
      </div>
      <div class="tx-total">${formatPrice(tx.total)}</div>
      <button class="tx-remove" onclick="removeTransaction(${tx.id})" title="Remove">✕</button>
    `;
    list.appendChild(item);
  });
}

function updatePortfolioSummary(invested, current) {
  const pl = current - invested;
  const roi = invested > 0 ? (pl / invested) * 100 : 0;

  document.getElementById('total-invested').textContent = '$' + invested.toFixed(2);
  document.getElementById('current-value').textContent  = '$' + current.toFixed(2);

  const plEl  = document.getElementById('profit-loss');
  const roiEl = document.getElementById('roi-percent');
  const sign = pl >= 0 ? '+' : '';
  plEl.textContent  = sign + '$' + Math.abs(pl).toFixed(2);
  roiEl.textContent = sign + roi.toFixed(2) + '%';
  plEl.style.color  = pl >= 0 ? 'var(--gain)' : 'var(--loss)';
  roiEl.style.color = pl >= 0 ? 'var(--gain)' : 'var(--loss)';
}

function renderPortfolioChart() {
  const holdings = {};
  state.portfolio.forEach(tx => {
    if (!holdings[tx.coinId]) holdings[tx.coinId] = { qty: 0, name: tx.coinName };
    holdings[tx.coinId].qty += tx.type === 'buy' ? tx.amount : -tx.amount;
  });

  const labels = [];
  const values = [];

  Object.entries(holdings).forEach(([id, h]) => {
    const live = state.allCoins.find(c => c.id === id);
    if (live && h.qty > 0) {
      labels.push(h.name);
      values.push(parseFloat((h.qty * live.current_price).toFixed(2)));
    }
  });

  const emptyEl = document.getElementById('portfolio-chart-empty');
  const canvas  = document.getElementById('portfolio-chart');

  if (labels.length === 0) {
    emptyEl.style.display = 'flex';
    canvas.style.display = 'none';
    return;
  }
  emptyEl.style.display = 'none';
  canvas.style.display = 'block';

  if (state.portfolioChart) state.portfolioChart.destroy();

  const COLORS = ['#6c63ff','#f093fb','#22d3a0','#ff5b6e','#f59e0b','#38bdf8','#fb7185','#a78bfa','#34d399','#60a5fa'];

  state.portfolioChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: COLORS,
        borderColor: 'transparent',
        borderWidth: 0,
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: { position: 'bottom', labels: { color: getComputedStyle(document.documentElement).getPropertyValue('--text-secondary'), padding: 16, font: { size: 12, family: 'Inter' } } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: $${ctx.raw.toLocaleString()}` } },
      },
    },
  });
}

// =============================================
// PRICE ALERTS
// =============================================
function addAlert() {
  const coinId    = document.getElementById('alert-coin').value;
  const condition = document.getElementById('alert-condition').value;
  const price     = parseFloat(document.getElementById('alert-price').value);

  if (!coinId || !condition || !price || price <= 0) {
    showToast('Please fill all alert fields.', 'error');
    return;
  }

  const coin = state.allCoins.find(c => c.id === coinId);
  const alert = {
    id: Date.now(),
    coinId,
    coinName: coin?.name || coinId,
    coinSymbol: coin?.symbol?.toUpperCase() || '',
    coinImage: coin?.image || '',
    condition,
    targetPrice: price,
    triggered: false,
    createdAt: new Date().toISOString(),
  };

  state.alerts.push(alert);
  window.saveAlerts();
  renderAlerts();
  updateAlertBadge();
  showToast(`🔔 Alert set for ${coin?.name} ${condition} $${price}`, 'success');

  // Reset
  document.getElementById('alert-price').value = '';
  document.getElementById('alert-coin').value = '';
}

function removeAlert(alertId) {
  state.alerts = state.alerts.filter(a => a.id !== alertId);
  window.saveAlerts();
  renderAlerts();
  updateAlertBadge();
}

function renderAlerts() {
  const list  = document.getElementById('alerts-list');
  const empty = document.getElementById('alerts-empty');
  list.innerHTML = '';

  if (state.alerts.length === 0) {
    empty.style.display = 'flex';
    list.style.display = 'none';
    return;
  }

  empty.style.display = 'none';
  list.style.display = 'flex';

  state.alerts.forEach(alert => {
    const item = document.createElement('div');
    item.className = 'alert-item' + (alert.triggered ? ' triggered' : '');
    item.innerHTML = `
      <img src="${alert.coinImage}" width="36" height="36" style="border-radius:50%;" />
      <div class="alert-coin-info">
        <div class="alert-coin-name">${escHtml(alert.coinName)} (${alert.coinSymbol})</div>
        <div class="alert-details">
          Price goes <strong>${alert.condition}</strong> $${alert.targetPrice.toLocaleString()}
          • Set ${formatDate(alert.createdAt)}
        </div>
      </div>
      <span class="alert-status ${alert.triggered ? 'triggered' : 'active'}">
        ${alert.triggered ? '✅ Triggered' : '🔔 Active'}
      </span>
      <button class="alert-remove" onclick="removeAlert(${alert.id})" title="Remove">✕</button>
    `;
    list.appendChild(item);
  });
}

function checkAlerts() {
  let triggered = 0;
  state.alerts.forEach(alert => {
    if (alert.triggered) return;
    const coin = state.allCoins.find(c => c.id === alert.coinId);
    if (!coin) return;

    const currentPrice = coin.current_price;
    let shouldTrigger = false;
    if (alert.condition === 'above' && currentPrice >= alert.targetPrice) shouldTrigger = true;
    if (alert.condition === 'below' && currentPrice <= alert.targetPrice) shouldTrigger = true;

    if (shouldTrigger) {
      alert.triggered = true;
      triggered++;
      triggerAlertNotification(alert, currentPrice);
    }
  });

  if (triggered > 0) {
    window.saveAlerts();
    updateAlertBadge();
    if (state.currentPage === 'alerts') renderAlerts();
  }
}

function triggerAlertNotification(alert, currentPrice) {
  const msg = `🚨 ${alert.coinName} is ${alert.condition} $${alert.targetPrice}! Current: ${formatPrice(currentPrice)}`;

  // In-app toast
  showToast(msg, 'warn', 6000);

  // Browser notification
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('CryptoPrice Alert 🔔', {
      body: msg,
      icon: alert.coinImage || '',
    });
  }

  // Sound
  playAlertSound();
}

function updateAlertBadge() {
  const active = state.alerts.filter(a => !a.triggered).length;
  const badge = document.getElementById('alert-badge');
  badge.textContent = active;
  badge.classList.toggle('visible', active > 0);
}

// Alert sound using Web Audio API
function buildAlertBeep() {
  return null; // Built lazily
}

function playAlertSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [523, 659, 784].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.25);
      osc.start(ctx.currentTime + i * 0.15);
      osc.stop(ctx.currentTime + i * 0.15 + 0.25);
    });
  } catch (e) {
    console.warn('Audio alert failed:', e);
  }
}

// =============================================
// COIN DETAIL MODAL
// =============================================
async function openCoinModal(coinId) {
  const coin = state.allCoins.find(c => c.id === coinId);
  if (!coin) return;

  state.currentModalCoin = coin;

  const modal = document.getElementById('coin-modal');
  const header = document.getElementById('modal-header');
  const change = coin.price_change_percentage_24h || 0;
  const isPos = change >= 0;

  header.innerHTML = `
    <img src="${coin.image}" alt="${coin.name}" width="48" height="48" style="border-radius:50%; flex-shrink:0;" />
    <div>
      <div class="modal-coin-name">${escHtml(coin.name)} <span style="color:var(--text-muted);font-size:0.85rem;">${coin.symbol.toUpperCase()}</span></div>
      <div class="modal-price">
        ${formatPrice(coin.current_price)}
        <span class="change-pill ${isPos ? 'positive' : 'negative'}" style="font-size:0.82rem;margin-left:0.5rem;">
          ${isPos ? '+' : ''}${change.toFixed(2)}%
        </span>
      </div>
    </div>
  `;

  // Stats
  document.getElementById('modal-stats').innerHTML = `
    <div class="modal-stat"><div class="modal-stat-label">Market Cap</div><div class="modal-stat-value">${formatLargeNum(coin.market_cap)}</div></div>
    <div class="modal-stat"><div class="modal-stat-label">24h Volume</div><div class="modal-stat-value">${formatLargeNum(coin.total_volume)}</div></div>
    <div class="modal-stat"><div class="modal-stat-label">24h High</div><div class="modal-stat-value">${formatPrice(coin.high_24h)}</div></div>
    <div class="modal-stat"><div class="modal-stat-label">24h Low</div><div class="modal-stat-value">${formatPrice(coin.low_24h)}</div></div>
    <div class="modal-stat"><div class="modal-stat-label">All-Time High</div><div class="modal-stat-value">${formatPrice(coin.ath)}</div></div>
    <div class="modal-stat"><div class="modal-stat-label">Circulating Supply</div><div class="modal-stat-value">${formatLargeNum(coin.circulating_supply)}</div></div>
  `;

  // Reset time buttons
  document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.time-btn').classList.add('active');

  modal.classList.add('active');
  await loadCoinChart('1');
}

function closeCoinModal(e) {
  if (e && e.target !== document.getElementById('coin-modal')) return;
  // Exit fullscreen first if active
  const wrap = document.getElementById('modal-chart-wrap');
  if (wrap && wrap.classList.contains('fullscreen')) {
    wrap.classList.remove('fullscreen');
    document.body.style.overflow = '';
  }
  document.getElementById('coin-modal').classList.remove('active');
  if (state.coinDetailChart) { state.coinDetailChart.destroy(); state.coinDetailChart = null; }
}

function toggleChartFullscreen() {
  const wrap = document.getElementById('modal-chart-wrap');
  if (!wrap) return;
  const isNowFullscreen = wrap.classList.toggle('fullscreen');
  document.body.style.overflow = isNowFullscreen ? 'hidden' : '';

  // Give the DOM one frame to settle, then resize the chart
  requestAnimationFrame(() => {
    setTimeout(() => {
      const container = document.getElementById('coin-detail-chart');
      if (state.coinDetailChart && container) {
        state.coinDetailChart.applyOptions({
          width:  container.clientWidth  || (isNowFullscreen ? window.innerWidth  - 64 : 600),
          height: container.clientHeight || (isNowFullscreen ? window.innerHeight - 96 : 320),
        });
        state.coinDetailChart.timeScale().fitContent();
      }
    }, 60);
  });
}

// Escape key: exit fullscreen or close modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const wrap = document.getElementById('modal-chart-wrap');
    if (wrap && wrap.classList.contains('fullscreen')) {
      toggleChartFullscreen();
    } else if (document.getElementById('coin-modal')?.classList.contains('active')) {
      closeCoinModal();
    }
  }
  // 'F' key toggles fullscreen when modal is open
  if ((e.key === 'f' || e.key === 'F') && document.getElementById('coin-modal')?.classList.contains('active')) {
    toggleChartFullscreen();
  }
});

async function loadCoinChart(days) {
  // Update active time button
  document.querySelectorAll('.time-btn').forEach(b => {
    b.classList.toggle('active', b.textContent.replace('D','') === days || (days === '365' && b.textContent === '1Y'));
  });

  const coin = state.currentModalCoin;
  if (!coin) return;

  const container = document.getElementById('coin-detail-chart');
  
  // Show loading & remove existing chart
  if (state.coinDetailChart) { state.coinDetailChart.remove(); state.coinDetailChart = null; }
  container.innerHTML = '<div class="loading-spinner" style="margin: auto; width: 40px; height: 40px; border: 4px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 1s linear infinite;"></div>';

  try {
    // Check if LightweightCharts is loaded
    if (typeof LightweightCharts === 'undefined') {
      throw new Error('Charting library not loaded. Please check your internet connection.');
    }

    // Try OHLC first; fall back to market_chart if it fails (rate limit / API error)
    let rawData;
    let isOHLC = true;
    try {
      rawData = await fetchCoinOHLC(coin.id, days);
    } catch (ohlcErr) {
      console.warn(`OHLC fetch failed (${ohlcErr.message}), falling back to market_chart…`);
      isOHLC = false;
      const marketData = await fetchCoinHistory(coin.id, days);
      // market_chart returns { prices: [[timestamp, price], ...], ... }
      rawData = marketData.prices || marketData;
    }

    // Small delay to ensure container has dimensions (important for modals)
    await new Promise(r => requestAnimationFrame(r));
    
    if (container.clientWidth === 0) {
        await new Promise(r => setTimeout(r, 100));
    }

    container.innerHTML = ''; 

    const isDark = state.darkMode;
    const bg = isDark ? 'transparent' : '#ffffff';
    const textColor = isDark ? '#a9b1d6' : '#333333';
    const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';

    const chart = LightweightCharts.createChart(container, {
      width: container.clientWidth || 600,
      height: container.clientHeight || 400,
      layout: { 
        background: { type: 'solid', color: bg }, 
        textColor,
        fontFamily: "'Inter', sans-serif",
      },
      grid: { 
        vertLines: { color: gridColor }, 
        horzLines: { color: gridColor } 
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: {
          width: 1,
          color: '#6c63ff',
          style: 2, // Dashed
          labelBackgroundColor: '#6c63ff',
        },
        horzLine: {
          width: 1,
          color: '#6c63ff',
          style: 2, // Dashed
          labelBackgroundColor: '#6c63ff',
        },
      },
      timeScale: { 
        timeVisible: true, 
        secondsVisible: false,
        borderVisible: false,
      },
      rightPriceScale: {
        borderVisible: false,
      },
      handleScroll: true,
      handleScale: true,
    });

    state.coinDetailChart = chart;

    const areaSeries = chart.addAreaSeries({
      lineColor: '#6c63ff',
      topColor: 'rgba(108, 99, 255, 0.4)',
      bottomColor: 'rgba(108, 99, 255, 0.0)',
      lineWidth: 3,
      priceLineVisible: true,
      lastValueVisible: true,
    });

    // OHLC format: [timestamp, open, high, low, close]  → use index 4 (close)
    // market_chart format: [timestamp, price]           → use index 1
    const formattedData = rawData
      .map(d => ({
        time: Math.floor(d[0] / 1000),
        value: isOHLC ? d[4] : d[1],
      }))
      // Remove duplicate timestamps (LightweightCharts requires strictly ascending times)
      .filter((d, i, arr) => i === 0 || d.time > arr[i - 1].time);

    areaSeries.setData(formattedData);
    chart.timeScale().fitContent();

    new ResizeObserver(entries => {
      if (entries.length === 0 || entries[0].target !== container) return;
      if (!state.coinDetailChart) return;
      const newRect = entries[0].contentRect;
      if (newRect.width > 0) {
        chart.applyOptions({ width: newRect.width, height: newRect.height });
      }
    }).observe(container);

  } catch (err) {
    console.error('Chart load error:', err);
    let msg = 'Failed to load chart data.';
    
    if (err.message === 'Rate limit exceeded') {
      msg = 'API Rate limit reached. Please wait 60s.';
    } else if (err.message === 'No data available') {
      msg = 'No candlestick data found for this coin.';
    } else if (err.message.includes('API error')) {
      msg = 'CoinGecko API is currently unavailable.';
    } else if (err.message.includes('Charting library')) {
      msg = err.message;
    }

    container.innerHTML = `<div style="display:flex;flex-direction:column;height:100%;align-items:center;justify-content:center;color:var(--loss);text-align:center;padding:1rem;gap:1rem;">
      <div style="font-size:2.5rem;">⚠️</div>
      <div style="font-weight:600;">${msg}</div>
      <button class="btn-sm" onclick="loadCoinChart('${days}')" style="background:var(--accent);color:white;border:none;padding:0.5rem 1rem;border-radius:4px;cursor:pointer;">Retry</button>
    </div>`;
    showToast(msg, 'error');
  }
}

// =============================================
// CURRENCY CONVERTER
// =============================================
function convertCurrency() {
  const coinId = document.getElementById('conv-from').value;
  const fiat   = document.getElementById('conv-to').value;
  const amount = parseFloat(document.getElementById('conv-amount').value) || 0;

  const resultEl     = document.getElementById('conv-result-amount');
  const labelEl      = document.getElementById('conv-result-label');
  const rateInfoEl   = document.getElementById('conv-rate-info');

  if (!coinId || !fiat) {
    resultEl.textContent = '—';
    labelEl.textContent  = '';
    return;
  }

  const coin = state.allCoins.find(c => c.id === coinId);
  if (!coin) { resultEl.textContent = '?'; return; }

  const priceUSD   = coin.current_price;
  const fiatRate   = state.exchangeRates[fiat] ?? 1;
  const converted  = amount * priceUSD * fiatRate;
  const symbol     = CURRENCY_SYMBOLS[fiat] ?? fiat.toUpperCase();

  resultEl.textContent = symbol + converted.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  labelEl.textContent  = fiat.toUpperCase();
  rateInfoEl.textContent = `1 ${coin.symbol.toUpperCase()} = ${symbol}${(priceUSD * fiatRate).toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
}

function swapConverter() {
  // Swap the crypto value into the amount (reverse conversion is complex; just reset)
  const resultText = document.getElementById('conv-result-amount').textContent;
  const num = parseFloat(resultText.replace(/[^0-9.]/g, ''));
  if (!isNaN(num)) {
    document.getElementById('conv-amount').value = num.toFixed(6);
  }
  convertCurrency();
}

function renderRateGrid() {
  const grid = document.getElementById('rate-grid');
  if (!grid) return;
  const labels = { usd:'🇺🇸 USD', inr:'🇮🇳 INR', eur:'🇪🇺 EUR', gbp:'🇬🇧 GBP', jpy:'🇯🇵 JPY', cad:'🇨🇦 CAD', aud:'🇦🇺 AUD', chf:'🇨🇭 CHF', cny:'🇨🇳 CNY', sgd:'🇸🇬 SGD' };
  grid.innerHTML = '';
  Object.entries(state.exchangeRates).forEach(([key, val]) => {
    const item = document.createElement('div');
    item.className = 'rate-item';
    item.innerHTML = `<div class="rate-currency">${labels[key] || key.toUpperCase()}</div><div class="rate-value">${Number(val).toFixed(4)}</div>`;
    grid.appendChild(item);
  });
}

// =============================================
// NEWS
// =============================================
const NEWS_DATA = [
  { id:1, category:'bitcoin', tag:'Bitcoin', tagColor:'#f59e0b', headline:'Bitcoin Surpasses $100K Milestone, Setting New All-Time High Record', summary:'The largest cryptocurrency breaks the psychological barrier as institutional demand surges.', source:'CryptoTimes', time:'2h ago', img:'https://images.unsplash.com/photo-1518546305927-5a555bb7020d?w=400&q=70' },
  { id:2, category:'ethereum', tag:'Ethereum', tagColor:'#6c63ff', headline:'Ethereum Shanghai Upgrade Unlocks $30B in Staked ETH for Withdrawal', summary:'Validators can now unstake their ETH following the highly anticipated protocol upgrade.', source:'DeFi Pulse', time:'4h ago', img:'https://images.unsplash.com/photo-1622630998477-20aa696ecb05?w=400&q=70' },
  { id:3, category:'defi', tag:'DeFi', tagColor:'#22d3a0', headline:'Total Value Locked in DeFi Protocols Reaches $200B as Yield Farming Returns', summary:'Decentralized finance sees a massive resurgence with new protocols offering high APY.', source:'DeFi Insider', time:'6h ago', img:'https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=400&q=70' },
  { id:4, category:'nft', tag:'NFT', tagColor:'#f093fb', headline:'Major Gaming Studio Launches NFT Marketplace with 10M User Base', summary:'The move signals mainstream adoption of NFTs in the gaming industry worldwide.', source:'NFT World', time:'8h ago', img:'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&q=70' },
  { id:5, category:'regulation', tag:'Regulation', tagColor:'#ff5b6e', headline:'SEC Approves Next Batch of Spot Bitcoin ETFs from Major Asset Managers', summary:'The landmark decision opens the door for billions in new institutional investment flows.', source:'Reuters Crypto', time:'10h ago', img:'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=400&q=70' },
  { id:6, category:'bitcoin', tag:'Bitcoin', tagColor:'#f59e0b', headline:'MicroStrategy Adds 10,000 BTC to Treasury, Now Holds Over 200,000 BTC', summary:'Michael Saylor\'s firm continues its aggressive Bitcoin accumulation strategy.', source:'Forbes Crypto', time:'12h ago', img:'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=400&q=70' },
  { id:7, category:'ethereum', tag:'Ethereum', tagColor:'#6c63ff', headline:'Ethereum Layer-2 Networks Process More Transactions Than Ethereum Mainnet', summary:'Optimistic rollups and ZK-rollups now handle the majority of Ethereum ecosystem activity.', source:'L2Beat', time:'1d ago', img:'https://images.unsplash.com/photo-1565372195458-9de0b320ef04?w=400&q=70' },
  { id:8, category:'defi', tag:'DeFi', tagColor:'#22d3a0', headline:'Uniswap v4 Launches with Hooks Feature, Reshaping DEX Landscape Forever', summary:'The latest version of the popular DEX introduces customizable pool logic through hooks.', source:'The Block', time:'1d ago', img:'https://images.unsplash.com/photo-1580048915913-4f8f5cb481c4?w=400&q=70' },
  { id:9, category:'regulation', tag:'Regulation', tagColor:'#ff5b6e', headline:'EU MiCA Regulation Takes Full Effect, Bringing Clarity to Crypto Industry', summary:'Europe\'s comprehensive crypto regulation framework becomes fully enforceable across member states.', source:'CoinDesk', time:'2d ago', img:'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=400&q=70' },
];

let currentNewsFilter = 'all';

function filterNews(category, btn) {
  currentNewsFilter = category;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderNews();
}

function renderNews() {
  const grid = document.getElementById('news-grid');
  if (!grid) return;

  const filtered = currentNewsFilter === 'all'
    ? NEWS_DATA
    : NEWS_DATA.filter(n => n.category === currentNewsFilter);

  grid.innerHTML = '';
  filtered.forEach(news => {
    const card = document.createElement('div');
    card.className = 'news-card';
    card.onclick = () => showToast('Opening: ' + news.headline, 'info');
    card.innerHTML = `
      <img class="news-img" src="${news.img}" alt="${news.tag}" loading="lazy" onerror="this.style.display='none'"/>
      <div class="news-body">
        <span class="news-tag" style="background:${news.tagColor}22;color:${news.tagColor};">${news.tag}</span>
        <div class="news-headline">${escHtml(news.headline)}</div>
        <div class="news-meta">${news.source} • ${news.time}</div>
      </div>
    `;
    grid.appendChild(card);
  });
}

// =============================================
// AI CHATBOT ENGINE
// =============================================

// Chatbot state
const chatState = {
  history: [],       // { role: 'user'|'bot', text, time }
  initialized: false,
};

// Greeting messages shown on first open
const BOT_GREETINGS = [
  'Hey there! 👋 I\'m <strong>CryptoBot</strong>, your personal crypto assistant powered by live market data.',
  'I can help you with live prices, market analysis, portfolio insights, and much more.',
  'Try asking: <em>"What\'s the price of Bitcoin?"</em> or <em>"Who are today\'s top gainers?"</em>',
];

/** Called when user navigates to chatbot page */
function initChatbotPage() {
  renderFearGreed();
  renderTrending();
  if (!chatState.initialized) {
    chatState.initialized = true;
    const messagesEl = document.getElementById('chat-messages');
    messagesEl.innerHTML = '';
    // Show intro messages with staggered delay
    BOT_GREETINGS.forEach((msg, i) => {
      setTimeout(() => appendBotMessage(msg), i * 700);
    });
  }

  // Make sidebar tips clickable
  document.querySelectorAll('.chat-tips-card .tips-list li').forEach(li => {
    li.onclick = () => {
      const txt = li.textContent.replace(/^›\s*/, '').replace(/"/g, '');
      sendQuick(txt);
    };
  });
}

/** Render top-5 trending coins in sidebar */
function renderTrending() {
  const el = document.getElementById('chat-trending');
  if (!el || state.allCoins.length === 0) return;
  const top5 = [...state.allCoins]
    .sort((a, b) => Math.abs(b.price_change_percentage_24h || 0) - Math.abs(a.price_change_percentage_24h || 0))
    .slice(0, 5);

  el.innerHTML = '';
  top5.forEach((coin, i) => {
    const ch = coin.price_change_percentage_24h || 0;
    const isPos = ch >= 0;
    const item = document.createElement('div');
    item.className = 'trending-item';
    item.onclick = () => sendQuick(`Tell me about ${coin.name}`);
    item.innerHTML = `
      <span class="trending-rank">#${i + 1}</span>
      <img src="${coin.image}" width="22" height="22" style="border-radius:50%;" />
      <span class="trending-name">${escHtml(coin.name)}</span>
      <span class="trending-change ${isPos ? 'positive' : 'negative'}">${isPos ? '+' : ''}${ch.toFixed(2)}%</span>
    `;
    el.appendChild(item);
  });
}

/** User clicks a quick-chip button */
function sendQuick(text) {
  const input = document.getElementById('chat-input');
  input.value = text;
  handleSendMessage();
}

/** Enter key handler */
function handleChatKey(e) {
  if (e.key === 'Enter') handleSendMessage();
}

/** Main send handler */
function handleSendMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  appendUserMessage(text);
  chatState.history.push({ role: 'user', text, time: new Date() });

  // Show typing indicator, then respond
  const typingId = showTypingIndicator();
  const delay = 600 + Math.random() * 700; // 600–1300ms realistic delay
  setTimeout(() => {
    hideTypingIndicator(typingId);
    const response = generateBotResponse(text);
    appendBotMessage(response);
    chatState.history.push({ role: 'bot', text: response, time: new Date() });
  }, delay);
}

/** Clear chat history */
function clearChat() {
  chatState.history = [];
  chatState.initialized = false;
  initChatbotPage();
}

// ---- UI Helpers ----

function appendUserMessage(text) {
  const el = document.getElementById('chat-messages');
  const name = (state.currentUser?.name || 'U').charAt(0).toUpperCase();
  const div = document.createElement('div');
  div.className = 'chat-msg user';
  div.innerHTML = `
    <div class="msg-body">
      <div class="msg-bubble">${escHtml(text)}</div>
      <div class="msg-time">${timeNow()}</div>
    </div>
    <div class="msg-avatar">${name}</div>
  `;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

function appendBotMessage(html) {
  const el = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-msg bot';
  div.innerHTML = `
    <div class="msg-avatar">🤖</div>
    <div class="msg-body">
      <div class="msg-bubble">${html}</div>
      <div class="msg-time">${timeNow()}</div>
    </div>
  `;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

function showTypingIndicator() {
  const el = document.getElementById('chat-messages');
  const id = 'typing-' + Date.now();
  const div = document.createElement('div');
  div.className = 'chat-msg bot';
  div.id = id;
  div.innerHTML = `
    <div class="msg-avatar">🤖</div>
    <div class="typing-indicator">
      <div class="typing-dots"><span></span><span></span><span></span></div>
    </div>
  `;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
  return id;
}

function hideTypingIndicator(id) {
  document.getElementById(id)?.remove();
}

function timeNow() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ---- NLP Intent Parser & Response Generator ----

function generateBotResponse(input) {
  const q = input.toLowerCase().trim();

  // ---- Greetings ----
  if (/^(hi|hello|hey|sup|yo|hiya|good\s*(morning|evening|afternoon))/.test(q)) {
    return `Hey! 👋 How can I help you today? Try asking about a coin price, top gainers, or your portfolio!`;
  }

  // ---- Thanks ----
  if (/thank|thanks|thx|ty/.test(q)) {
    return `You\'re welcome! 😊 Feel free to ask anything else about crypto!`;
  }

  // ---- Help ----
  if (/\bhelp\b|what can you do|commands/.test(q)) {
    return `Here\'s what I can help with:<br><br>
      💰 <strong>Coin prices</strong> — "Price of Bitcoin"<br>
      📈 <strong>Top gainers/losers</strong> — "Top 5 gainers today"<br>
      🌍 <strong>Market cap</strong> — "What is the global market cap?"<br>
      🔍 <strong>Coin details</strong> — "Tell me about Ethereum"<br>
      📊 <strong>Compare coins</strong> — "Compare BTC and ETH"<br>
      💱 <strong>Currency price</strong> — "Price of Solana in INR"<br>
      💼 <strong>Portfolio</strong> — "What is my portfolio worth?"<br>
      ⭐ <strong>Watchlist</strong> — "What\'s in my watchlist?"<br>
      🧠 <strong>Recommendation</strong> — "Should I buy ETH?"<br>
      📚 <strong>Education</strong> — "What is DeFi?", "Explain blockchain"`;
  }

  // ---- Global market cap ----
  if (/market\s*cap|global\s*market|total\s*market/.test(q)) {
    const mcEl = document.getElementById('stat-marketcap');
    const volEl = document.getElementById('stat-volume');
    const domEl = document.getElementById('stat-btc-dom');
    const mc  = mcEl?.textContent || '—';
    const vol = volEl?.textContent || '—';
    const dom = domEl?.textContent || '—';
    return `🌍 <strong>Global Crypto Market</strong><br><br>
      📊 Total Market Cap: <strong>${mc}</strong><br>
      🔄 24h Volume: <strong>${vol}</strong><br>
      ₿ BTC Dominance: <strong>${dom}</strong><br><br>
      <em>Data refreshes every 60 seconds.</em>`;
  }

  // ---- Top gainers ----
  if (/top\s*\d*\s*(gainer|gain|winner|pump|moon|best\s*perform)/.test(q)) {
    const n = parseInt(q.match(/\d+/)?.[0]) || 5;
    return buildTopTable('gainers', Math.min(n, 10));
  }

  // ---- Top losers ----
  if (/top\s*\d*\s*(loser|loss|dump|crash|worst|fall|drop|down)/.test(q)) {
    const n = parseInt(q.match(/\d+/)?.[0]) || 5;
    return buildTopTable('losers', Math.min(n, 10));
  }

  // ---- Top by market cap ----
  if (/top\s*\d*\s*(coin|crypto|currency|market\s*cap|ranked)/.test(q)) {
    const n = parseInt(q.match(/\d+/)?.[0]) || 5;
    return buildTopTable('marketcap', Math.min(n, 10));
  }

  // ---- Compare two coins ----
  const compareMatch = q.match(/compare\s+(\w+)\s+(?:and|vs\.?|versus)\s+(\w+)/);
  if (compareMatch) {
    return compareCoins(compareMatch[1], compareMatch[2]);
  }

  // ---- Portfolio worth ----
  if (/portfolio|my\s*(holdings?|assets?|coins?)|how\s*much.*worth/.test(q)) {
    return getPortfolioSummaryResponse();
  }

  // ---- Watchlist ----
  if (/watchlist|favorite|starred\s*coin/.test(q)) {
    return getWatchlistResponse();
  }

  // ---- Price in specific fiat — check FIRST (e.g. "price of SOL in INR") ----
  const fiatMatch = q.match(/(?:price|value|worth|cost)\s+(?:of\s+)?(\w+)\s+in\s+(inr|usd|eur|gbp|jpy|cad|aud|chf|cny|sgd)/);
  if (fiatMatch) {
    return getCoinPriceInFiat(fiatMatch[1], fiatMatch[2]);
  }

  // ---- Price of coin — check BEFORE "what is" to catch "what is the price of X" ----
  const PRICE_STOPWORDS = new Set(['the','a','an','of','is','it','in','on','at','to','for','this','that','crypto','coin','token']);
  const priceMatch = q.match(/(?:price|cost|how much (?:is|does)|what.*price.*of)\s+(?:of\s+|the\s+)?(\w+)/);
  if (priceMatch && !PRICE_STOPWORDS.has(priceMatch[1].toLowerCase())) {
    return getCoinPriceResponse(priceMatch[1]);
  }
  if (priceMatch && PRICE_STOPWORDS.has(priceMatch[1].toLowerCase())) {
    // Fallback: scan remaining words for a coin name
    const words = q.replace(/.*price\s+(?:of\s+)?/, '').split(/\s+/).filter(Boolean);
    for (const w of words) {
      if (!PRICE_STOPWORDS.has(w) && w.length > 1) {
        const found = findCoinByNameOrSymbol(w);
        if (found) return getCoinPriceResponse(w);
      }
    }
  }

  // ---- Should I buy/sell/hold ----
  const adviceMatch = q.match(/should\s+i\s+(buy|sell|hold)\s+(\w+)/);
  if (adviceMatch) {
    return giveTradingAdvice(adviceMatch[2], adviceMatch[1]);
  }
  if (/(?:buy|sell|hold|invest)\s+(\w+)/.test(q)) {
    const m = q.match(/(?:buy|sell|hold|invest)\s+(\w+)/);
    const action = q.includes('sell') ? 'sell' : q.includes('hold') ? 'hold' : 'buy';
    return giveTradingAdvice(m[1], action);
  }

  // ---- Tell me about / info on coin (with stopword guard) ----
  const COIN_STOPWORDS = new Set(['the','a','an','of','is','it','in','on','at','to','for','this','that','crypto','coin','token','price','market']);
  const aboutMatch = q.match(/(?:tell me about|info(?:rmation)? (?:on|about)|what(?:'s| is)(?: the)?|details? (?:of|about)|describe)\s+(?:the\s+)?(\w+)/);
  if (aboutMatch && !COIN_STOPWORDS.has(aboutMatch[1].toLowerCase())) {
    return getCoinInfo(aboutMatch[1]);
  }

  // ---- Direct coin name/symbol mention ----
  const directCoin = findCoinInText(q);
  if (directCoin) {
    return getCoinInfo(directCoin.symbol);
  }

  // ---- Education: DeFi, blockchain, NFT... ----
  if (/\bdefi\b|decentralized\s*finance/.test(q)) {
    return `📚 <strong>What is DeFi (Decentralized Finance)?</strong><br><br>
      DeFi refers to financial services and applications built on blockchains like Ethereum, running through <strong>smart contracts</strong> instead of traditional banks.<br><br>
      🔑 Key concepts:<br>
      • <strong>DEX</strong> – Decentralized exchanges like Uniswap<br>
      • <strong>Lending</strong> – Platforms like Aave, Compound<br>
      • <strong>Yield Farming</strong> – Earning rewards by providing liquidity<br>
      • <strong>Stablecoins</strong> – USDC, DAI pegged to USD<br><br>
      Total Value Locked (TVL) in DeFi often exceeds $100B.`;
  }

  if (/blockchain|distributed\s*ledger/.test(q)) {
    return `⛓️ <strong>What is Blockchain?</strong><br><br>
      A blockchain is a <strong>decentralized, immutable ledger</strong> that records transactions across many computers.<br><br>
      🔑 Key properties:<br>
      • <strong>Decentralized</strong> — No single authority controls it<br>
      • <strong>Immutable</strong> — Records can't be altered once confirmed<br>
      • <strong>Transparent</strong> — Anyone can verify transactions<br>
      • <strong>Secure</strong> — Cryptographically protected<br><br>
      Bitcoin was the first blockchain (2009). Ethereum extended it with smart contracts.`;
  }

  if (/\bnft\b|non.fungible/.test(q)) {
    return `🖼️ <strong>What are NFTs?</strong><br><br>
      NFTs (Non-Fungible Tokens) are unique digital assets stored on a blockchain. Unlike BTC or ETH, <strong>each NFT is one-of-a-kind</strong>.<br><br>
      Common uses:<br>
      • 🎨 Digital art & collectibles<br>
      • 🎮 In-game items & virtual land<br>
      • 🎵 Music & entertainment rights<br>
      • 🏆 Sports cards & memorabilia<br><br>
      Marketplaces: OpenSea, Blur, Magic Eden`;
  }

  if (/\bstaking\b|proof\s*of\s*stake/.test(q)) {
    return `🥩 <strong>What is Staking?</strong><br><br>
      Staking means <strong>locking up your crypto</strong> to help validate blockchain transactions, earning rewards in return.<br><br>
      How it works:<br>
      1. You lock up tokens in a staking contract<br>
      2. You become a validator (or delegate to one)<br>
      3. You earn <strong>APY rewards</strong> for securing the network<br><br>
      Popular staking coins: ETH (~4% APY), SOL, ADA, DOT, ATOM<br><br>
      ⚠️ Risk: Funds are locked for a period and exposed to price volatility.`;
  }

  if (/\bhalving\b|bitcoin\s*halving/.test(q)) {
    return `₿ <strong>What is Bitcoin Halving?</strong><br><br>
      Every ~4 years, Bitcoin's block reward is <strong>cut in half</strong>. This reduces the rate new BTC is created, making it more scarce over time.<br><br>
      📅 Halving history:<br>
      • 2012 — 50 → 25 BTC/block<br>
      • 2016 — 25 → 12.5 BTC/block<br>
      • 2020 — 12.5 → 6.25 BTC/block<br>
      • 2024 — 6.25 → 3.125 BTC/block<br><br>
      Historically, halvings have preceded major bull runs. There will only ever be <strong>21 million BTC</strong>.`;
  }

  if (/\bweb3\b/.test(q)) {
    return `🌐 <strong>What is Web3?</strong><br><br>
      Web3 is the next evolution of the internet, built on <strong>decentralized protocols</strong> using blockchain technology.<br><br>
      • <strong>Web1</strong> — Read-only static websites<br>
      • <strong>Web2</strong> — Interactive social media (Facebook, Google)<br>
      • <strong>Web3</strong> — Owned by users, powered by crypto & smart contracts<br><br>
      Key pillars: DeFi, NFTs, DAOs, and decentralized identity.`;
  }

  if (/\bgas\s*fee|transaction\s*fee/.test(q)) {
    return `⛽ <strong>What are Gas Fees?</strong><br><br>
      Gas fees are the cost to execute transactions on a blockchain (mainly Ethereum). They're paid to validators who process your transaction.<br><br>
      💡 Tips to save on gas:<br>
      • Transact during off-peak hours (early morning UTC)<br>
      • Use Layer-2 networks (Arbitrum, Optimism, Base)<br>
      • Adjust gas price manually in your wallet<br><br>
      Tools: <em>etherscan.io/gastracker</em>, <em>gasnow.org</em>`;
  }

  // ---- Fallback ----
  const fallbacks = [
    `I'm not sure I understand that. Try asking about a specific coin like <em>"What is the price of Ethereum?"</em>`,
    `Hmm, I didn't catch that. You can ask me about prices, gainers, losers, your portfolio, or crypto concepts! 🤔`,
    `I couldn't find an answer. Try something like <em>"Top 5 gainers"</em> or <em>"Tell me about Solana"</em>`,
  ];
  return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

// =============================================
// CRYPTO EXCHANGE LOGIC
// =============================================
let exchangeState = {
  mode: 'buy', // buy or sell
  selectedCoinId: null,
};

function initExchangePage() {
  updateExchangeBalanceDisplay();
  renderExchangeHistory();
  
  // Select first coin by default if none selected
  const el = document.getElementById('ex-coin');
  if (el && !el.value && state.allCoins.length > 0) {
    el.value = state.allCoins[0].id;
    updateExchangePrice();
  }
}

function updateExchangeBalanceDisplay() {
  document.getElementById('ex-balance').textContent = '$' + state.exBalance.toLocaleString(undefined, { minimumFractionDigits: 2 });
}

function updateExchangePrice() {
  const coinId = document.getElementById('ex-coin').value;
  exchangeState.selectedCoinId = coinId;
  
  const coin = state.allCoins.find(c => c.id === coinId);
  const priceEl = document.getElementById('ex-live-price');
  const changeEl = document.getElementById('ex-live-change');
  const pairEl = document.getElementById('ex-chart-pair');

  if (!coin) {
    priceEl.textContent = '—';
    changeEl.textContent = '—';
    pairEl.textContent = 'Select a pair';
    document.getElementById('ex-chart-empty').style.display = 'flex';
    return;
  }

  priceEl.textContent = formatPrice(coin.current_price);
  const change = coin.price_change_percentage_24h || 0;
  changeEl.textContent = (change >= 0 ? '+' : '') + change.toFixed(2) + '%';
  changeEl.className = 'ex-price-change ' + (change >= 0 ? 'positive' : 'negative');
  
  pairEl.textContent = `${coin.name} / USD`;
  document.getElementById('ex-price-input').value = coin.current_price.toFixed(2);
  
  document.getElementById('ex-chart-empty').style.display = 'none';
  loadExchangeChart('1');
  renderOrderBook(coinId);
  updateExchangePreview();
}

function switchExTab(mode) {
  exchangeState.mode = mode;
  const buyTab = document.getElementById('ex-tab-buy');
  const sellTab = document.getElementById('ex-tab-sell');
  
  buyTab.classList.toggle('active', mode === 'buy');
  buyTab.classList.toggle('buy-active', mode === 'buy');
  sellTab.classList.toggle('active', mode === 'sell');
  sellTab.classList.toggle('sell-active', mode === 'sell');
  
  // Accessibility & UI updates
  const label = document.getElementById('ex-amount-label');
  const submitBtn = document.getElementById('ex-submit-btn');
  const prefix = document.getElementById('ex-prefix');
  
  if (mode === 'buy') {
    label.textContent = 'Amount (USD to spend)';
    prefix.textContent = '$';
    submitBtn.innerHTML = '🟢 Place Buy Order';
    submitBtn.className = 'btn-exchange buy-mode';
  } else {
    label.textContent = 'Amount (Crypto to sell)';
    prefix.textContent = '₿';
    submitBtn.innerHTML = '🔴 Place Sell Order';
    submitBtn.className = 'btn-exchange sell-mode';
  }
  
  updateExchangePreview();
}

function updateExchangePreview() {
  const amountInput = document.getElementById('ex-amount');
  const priceInput = document.getElementById('ex-price-input');
  const type = exchangeState.mode;
  
  const amount = parseFloat(amountInput.value) || 0;
  const price = parseFloat(priceInput.value) || 0;
  
  const cryptoEl = document.getElementById('ex-preview-crypto');
  const feeEl = document.getElementById('ex-preview-fee');
  const totalEl = document.getElementById('ex-preview-total');
  
  const coin = state.allCoins.find(c => c.id === exchangeState.selectedCoinId);
  const sym = coin ? coin.symbol.toUpperCase() : 'Units';

  if (amount <= 0 || price <= 0) {
    cryptoEl.textContent = '—';
    feeEl.textContent = '—';
    totalEl.textContent = '—';
    return;
  }

  let receive, fee, total;
  
  if (type === 'buy') {
    // spend USD, get crypto
    total = amount;
    fee = total * 0.001; // 0.1% fee
    const net = total - fee;
    receive = net / price;
    
    cryptoEl.textContent = receive.toFixed(6) + ' ' + sym;
    feeEl.textContent = '$' + fee.toFixed(2);
    totalEl.textContent = '$' + total.toFixed(2);
  } else {
    // sell crypto, get USD
    const cryptoAmount = amount;
    const grossVal = cryptoAmount * price;
    fee = grossVal * 0.001;
    total = grossVal - fee; // net USD received
    
    cryptoEl.textContent = '$' + total.toFixed(2);
    feeEl.textContent = '$' + fee.toFixed(2);
    totalEl.textContent = cryptoAmount + ' ' + sym;
  }
}

async function executeExchangeOrder() {
  const coinId = exchangeState.selectedCoinId;
  const mode = exchangeState.mode;
  const amount = parseFloat(document.getElementById('ex-amount').value) || 0;
  const price = parseFloat(document.getElementById('ex-price-input').value) || 0;

  if (!coinId || amount <= 0 || price <= 0) {
    showToast('Please enter a valid amount.', 'error');
    return;
  }

  const coin = state.allCoins.find(c => c.id === coinId);
  if (!coin) return;

  if (mode === 'buy') {
    if (amount > state.exBalance) {
      showToast('Insufficient balance!', 'error');
      return;
    }
    
    // Process Buy
    const fee = amount * 0.001;
    const netUsd = amount - fee;
    const cryptoQty = netUsd / price;
    
    state.exBalance -= amount;
    
    // Update holdings
    if (!state.exHoldings[coinId]) {
      state.exHoldings[coinId] = { qty: 0, avgPrice: 0 };
    }
    const h = state.exHoldings[coinId];
    const totalCost = (h.qty * h.avgPrice) + netUsd;
    h.qty += cryptoQty;
    h.avgPrice = totalCost / h.qty;
    
    addExchangeTrade(coin, 'buy', cryptoQty, price, amount);
    showToast(`Successfully bought ${cryptoQty.toFixed(4)} ${coin.symbol.toUpperCase()}`, 'success');
  } else {
    // Process Sell
    const h = state.exHoldings[coinId];
    if (!h || h.qty < amount) {
      showToast(`Insufficient ${coin.symbol.toUpperCase()} holdings!`, 'error');
      return;
    }
    
    const grossUsd = amount * price;
    const fee = grossUsd * 0.001;
    const netUsd = grossUsd - fee;
    
    state.exBalance += netUsd;
    h.qty -= amount;
    if (h.qty <= 0.00000001) delete state.exHoldings[coinId];
    
    addExchangeTrade(coin, 'sell', amount, price, netUsd);
    showToast(`Successfully sold ${amount} ${coin.symbol.toUpperCase()}`, 'success');
  }

  window.saveExData();
  updateExchangeBalanceDisplay();
  renderExchangeHistory();
  document.getElementById('ex-amount').value = '';
  updateExchangePreview();
}

function addExchangeTrade(coin, type, qty, price, total) {
  const trade = {
    id: Date.now(),
    coinId: coin.id,
    coinName: coin.name,
    symbol: coin.symbol,
    image: coin.image,
    type, qty, price, total,
    date: new Date().toISOString()
  };
  state.exTrades.unshift(trade);
  if (state.exTrades.length > 50) state.exTrades.pop();
}

function renderExchangeHistory() {
  const list = document.getElementById('ex-trades-list');
  const empty = document.getElementById('ex-trades-empty');
  list.innerHTML = '';

  if (state.exTrades.length === 0) {
    empty.style.display = 'flex';
  } else {
    empty.style.display = 'none';
    state.exTrades.forEach(t => {
      const item = document.createElement('div');
      item.className = 'ex-trade-item';
      item.innerHTML = `
        <div class="ex-trade-header">
          <span class="ex-trade-badge ${t.type}">${t.type}</span>
          <span class="ex-trade-coin">${t.coinName}</span>
          <span class="ex-trade-time">${new Date(t.date).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
        </div>
        <div class="ex-trade-details">
          ${t.qty.toFixed(4)} @ ${formatPrice(t.price)} = ${formatPrice(t.total)}
        </div>
      `;
      list.appendChild(item);
    });
  }

  // Render holdings
  const holdingsEl = document.getElementById('ex-holdings');
  holdingsEl.innerHTML = '';
  const holdingsKeys = Object.keys(state.exHoldings);
  
  if (holdingsKeys.length === 0) {
    holdingsEl.innerHTML = '<p style="color:var(--text-muted);font-size:0.82rem;">No holdings yet.</p>';
  } else {
    holdingsKeys.forEach(id => {
      const h = state.exHoldings[id];
      const coin = state.allCoins.find(c => c.id === id);
      if (!coin) return;
      
      const val = h.qty * coin.current_price;
      const item = document.createElement('div');
      item.className = 'ex-holding-item';
      item.innerHTML = `
        <img class="ex-holding-img" src="${coin.image}" />
        <span class="ex-holding-name">${coin.symbol.toUpperCase()}</span>
        <div style="text-align:right">
          <div class="ex-holding-qty">${h.qty.toFixed(4)}</div>
          <div class="ex-holding-value">${formatPrice(val)}</div>
        </div>
      `;
      holdingsEl.appendChild(item);
    });
  }
}

async function loadExchangeChart(days, btn) {
  if (btn) {
    btn.parentElement.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }

  const coinId = exchangeState.selectedCoinId;
  if (!coinId) return;

  const container = document.getElementById('exchange-chart');
  const chartWrap = container.parentElement;
  
  if (state.exChart) { state.exChart.destroy(); state.exChart = null; }
  
  // Show a mini loading state
  const loadingId = 'ex-chart-loading';
  if (!document.getElementById(loadingId)) {
    const loader = document.createElement('div');
    loader.id = loadingId;
    loader.className = 'loading-spinner';
    loader.style.position = 'absolute';
    loader.style.top = '50%';
    loader.style.left = '50%';
    loader.style.transform = 'translate(-50%, -50%)';
    chartWrap.style.position = 'relative';
    chartWrap.appendChild(loader);
  }

  try {
    if (typeof Chart === 'undefined') {
      throw new Error('Chart.js library not loaded.');
    }

    const data = await fetchCoinHistory(coinId, days);
    const loader = document.getElementById(loadingId);
    if (loader) loader.remove();

    const prices = data.prices;
    if (!prices || prices.length === 0) throw new Error('No data available');

    const labels = prices.map(p => {
      const date = new Date(p[0]);
      return days === '1' ? date.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : date.toLocaleDateString([], {month:'short', day:'numeric'});
    });
    
    const values = prices.map(p => p[1]);

    const ctx = container.getContext('2d');
    state.exChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          data: values,
          borderColor: '#6c63ff',
          backgroundColor: 'rgba(108, 99, 255, 0.1)',
          fill: true,
          tension: 0.4,
          pointRadius: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { 
          legend: { display: false },
          tooltip: {
            mode: 'index',
            intersect: false,
            backgroundColor: 'rgba(30, 32, 47, 0.9)',
            titleColor: '#fff',
            bodyColor: '#fff',
            borderColor: '#6c63ff',
            borderWidth: 1
          }
        },
        scales: {
          x: { display: false },
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8b8fa8', font: { size: 10 } } }
        }
      }
    });
  } catch (err) {
    const loader = document.getElementById(loadingId);
    if (loader) loader.remove();
    console.warn('Exchange chart fail:', err);
    
    const errorMsg = err.message === 'Rate limit exceeded' ? 'Rate limit reached.' : 'Failed to load chart.';
    showToast(errorMsg, 'error');
    
    // Show error in chart area
    const ctx = container.getContext('2d');
    ctx.clearRect(0, 0, container.width, container.height);
    ctx.fillStyle = '#ff5b6e';
    ctx.textAlign = 'center';
    ctx.fillText(errorMsg, container.width / 2, container.height / 2);
  }
}

function renderOrderBook(coinId) {
  const coin = state.allCoins.find(c => c.id === coinId);
  if (!coin) return;
  
  const midPrice = coin.current_price;
  const container = document.getElementById('order-book');
  
  let html = `
    <div class="order-book-header">
      <span>Price</span>
      <span style="text-align:right">Amount</span>
      <span style="text-align:right">Total</span>
    </div>
  `;

  // Asks (Sells) - Red
  for (let i = 5; i > 0; i--) {
    const p = midPrice * (1 + (i * 0.001));
    const a = Math.random() * 2;
    html += `
      <div class="order-book-row ask">
        <span class="col-price">${p.toFixed(2)}</span>
        <span style="text-align:right">${a.toFixed(3)}</span>
        <span style="text-align:right">${(p*a).toFixed(2)}</span>
      </div>
    `;
  }

  // Spread
  html += `<div class="ob-spread">Spread: ${(midPrice * 0.001).toFixed(2)} USD</div>`;

  // Bids (Buys) - Green
  for (let i = 1; i <= 5; i++) {
    const p = midPrice * (1 - (i * 0.001));
    const a = Math.random() * 2;
    html += `
      <div class="order-book-row bid">
        <span class="col-price">${p.toFixed(2)}</span>
        <span style="text-align:right">${a.toFixed(3)}</span>
        <span style="text-align:right">${(p*a).toFixed(2)}</span>
      </div>
    `;
  }

  container.innerHTML = html;
}

// ---- Response Builders ---- SECTION CONTINUES BELOW

function buildTopTable(type, n) {
  if (state.allCoins.length === 0) return '⚠️ Market data not loaded yet. Please wait a moment.';
  let sorted;
  let title;
  if (type === 'gainers') {
    sorted = [...state.allCoins].sort((a, b) => (b.price_change_percentage_24h || 0) - (a.price_change_percentage_24h || 0));
    title = `📈 Top ${n} Gainers (24h)`;
  } else if (type === 'losers') {
    sorted = [...state.allCoins].sort((a, b) => (a.price_change_percentage_24h || 0) - (b.price_change_percentage_24h || 0));
    title = `📉 Top ${n} Losers (24h)`;
  } else {
    sorted = [...state.allCoins].sort((a, b) => (b.market_cap || 0) - (a.market_cap || 0));
    title = `🏆 Top ${n} by Market Cap`;
  }
  const top = sorted.slice(0, n);
  let rows = top.map((c, i) => {
    const ch = c.price_change_percentage_24h || 0;
    const chStr = (ch >= 0 ? '+' : '') + ch.toFixed(2) + '%';
    const color = ch >= 0 ? 'var(--gain)' : 'var(--loss)';
    return `<tr>
      <td>${i + 1}</td>
      <td><strong>${escHtml(c.name)}</strong> <span style="color:var(--text-muted);font-size:0.78rem;">${c.symbol.toUpperCase()}</span></td>
      <td>${formatPrice(c.current_price)}</td>
      <td style="color:${color};font-weight:700;">${chStr}</td>
    </tr>`;
  }).join('');
  return `<strong>${title}</strong>
    <table>
      <thead><tr><th>#</th><th>Coin</th><th>Price</th><th>24h %</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function getCoinPriceResponse(nameOrSymbol) {
  const coin = findCoinByNameOrSymbol(nameOrSymbol);
  if (!coin) return `😕 I couldn't find a coin matching "<strong>${escHtml(nameOrSymbol)}</strong>". Try the full name or symbol (e.g. BTC, ETH, SOL).`;
  const ch = coin.price_change_percentage_24h || 0;
  const isPos = ch >= 0;
  return `<strong>${escHtml(coin.name)}</strong> <span class="coin-tag">${coin.symbol.toUpperCase()}</span><br><br>
    💰 Price: <strong>${formatPrice(coin.current_price)}</strong><br>
    ${isPos ? '📈' : '📉'} 24h Change: <strong style="color:${isPos ? 'var(--gain)' : 'var(--loss)'}">${isPos ? '+' : ''}${ch.toFixed(2)}%</strong><br>
    🏛️ Market Cap: <strong>${formatLargeNum(coin.market_cap)}</strong><br>
    🔄 24h Volume: <strong>${formatLargeNum(coin.total_volume)}</strong>`;
}

function getCoinPriceInFiat(nameOrSymbol, fiat) {
  const coin = findCoinByNameOrSymbol(nameOrSymbol);
  if (!coin) return `😕 I couldn't find "<strong>${escHtml(nameOrSymbol)}</strong>".`;
  const rate = state.exchangeRates[fiat] ?? FALLBACK_RATES[fiat] ?? 1;
  const symbol = CURRENCY_SYMBOLS[fiat] ?? fiat.toUpperCase();
  const converted = coin.current_price * rate;
  return `<strong>${escHtml(coin.name)}</strong> price in <strong>${fiat.toUpperCase()}</strong>:<br><br>
    💰 <strong style="font-size:1.1em;">${symbol}${converted.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong><br><br>
    <em>USD Price: ${formatPrice(coin.current_price)} × ${rate.toFixed(4)} = ${symbol}${converted.toFixed(2)}</em>`;
}

function getCoinInfo(nameOrSymbol) {
  const coin = findCoinByNameOrSymbol(nameOrSymbol);
  if (!coin) return `😕 I couldn't find a coin matching "<strong>${escHtml(nameOrSymbol)}</strong>".`;
  const ch24 = coin.price_change_percentage_24h || 0;
  const isPos = ch24 >= 0;
  const athPct = coin.ath ? (((coin.current_price - coin.ath) / coin.ath) * 100).toFixed(1) : 'N/A';
  const analysis = quickAnalysis(coin);
  return `<img src="${coin.image}" width="22" height="22" style="border-radius:50%;vertical-align:middle;margin-right:6px;"/>
    <strong>${escHtml(coin.name)}</strong> <span class="coin-tag">${coin.symbol.toUpperCase()}</span>
    <span style="font-size:0.78rem;color:var(--text-muted);"> · Rank #${coin.market_cap_rank}</span><br><br>
    💰 Price: <strong>${formatPrice(coin.current_price)}</strong><br>
    ${isPos ? '📈' : '📉'} 24h: <strong style="color:${isPos ? 'var(--gain)' : 'var(--loss)'}">${isPos ? '+' : ''}${ch24.toFixed(2)}%</strong><br>
    🏛️ Market Cap: <strong>${formatLargeNum(coin.market_cap)}</strong><br>
    🔄 24h Volume: <strong>${formatLargeNum(coin.total_volume)}</strong><br>
    ⬆️ 24h High: <strong>${formatPrice(coin.high_24h)}</strong><br>
    ⬇️ 24h Low: <strong>${formatPrice(coin.low_24h)}</strong><br>
    🏔️ ATH Distance: <strong>${athPct}%</strong><br><br>
    🤖 Signal: <strong style="color:${analysis.color}">${analysis.verdict}</strong> — ${analysis.reason}`;
}

function compareCoins(name1, name2) {
  const c1 = findCoinByNameOrSymbol(name1);
  const c2 = findCoinByNameOrSymbol(name2);
  if (!c1) return `😕 Couldn't find "<strong>${escHtml(name1)}</strong>".`;
  if (!c2) return `😕 Couldn't find "<strong>${escHtml(name2)}</strong>".`;

  const ch1 = c1.price_change_percentage_24h || 0;
  const ch2 = c2.price_change_percentage_24h || 0;
  const winner = ch1 >= ch2 ? c1 : c2;

  return `⚖️ <strong>Comparing ${escHtml(c1.name)} vs ${escHtml(c2.name)}</strong>
    <table>
      <thead><tr><th>Metric</th><th>${c1.symbol.toUpperCase()}</th><th>${c2.symbol.toUpperCase()}</th></tr></thead>
      <tbody>
        <tr><td>Price</td><td>${formatPrice(c1.current_price)}</td><td>${formatPrice(c2.current_price)}</td></tr>
        <tr><td>24h %</td>
          <td style="color:${ch1>=0?'var(--gain)':'var(--loss)'}">${(ch1>=0?'+':'')+ch1.toFixed(2)}%</td>
          <td style="color:${ch2>=0?'var(--gain)':'var(--loss)'}">${(ch2>=0?'+':'')+ch2.toFixed(2)}%</td>
        </tr>
        <tr><td>Market Cap</td><td>${formatLargeNum(c1.market_cap)}</td><td>${formatLargeNum(c2.market_cap)}</td></tr>
        <tr><td>Volume</td><td>${formatLargeNum(c1.total_volume)}</td><td>${formatLargeNum(c2.total_volume)}</td></tr>
        <tr><td>Rank</td><td>#${c1.market_cap_rank}</td><td>#${c2.market_cap_rank}</td></tr>
      </tbody>
    </table><br>
    🏆 <strong>Better 24h performer:</strong> ${escHtml(winner.name)}`;
}

function giveTradingAdvice(nameOrSymbol, action) {
  const coin = findCoinByNameOrSymbol(nameOrSymbol);
  if (!coin) return `😕 I couldn't find "<strong>${escHtml(nameOrSymbol)}</strong>". Try the coin name or symbol.`;
  const analysis = quickAnalysis(coin);
  const ch24 = coin.price_change_percentage_24h || 0;
  const isPos = ch24 >= 0;

  let advice = '';
  if (action === 'buy') {
    advice = analysis.score >= 0
      ? `📗 Based on current signals, <strong>${coin.name}</strong> shows <strong>${analysis.verdict}</strong> momentum. Dollar-cost averaging (DCA) could be a prudent strategy.`
      : `📕 The signals for <strong>${coin.name}</strong> are currently <strong>${analysis.verdict}</strong>. Consider waiting for a reversal or use strict risk management.`;
  } else if (action === 'sell') {
    advice = analysis.score <= 0
      ? `📕 Weak signals support taking profits or reducing risk on <strong>${coin.name}</strong>.`
      : `📗 <strong>${coin.name}</strong> is showing strong momentum. Selling now means leaving potential gains on the table. Consider setting a stop-loss instead.`;
  } else {
    advice = `📒 Holding <strong>${coin.name}</strong> could be wise given mixed signals. Watch for a breakout above key levels.`;
  }

  return `${advice}<br><br>
    📊 <strong>${escHtml(coin.name)}</strong> snapshot:<br>
    • Price: <strong>${formatPrice(coin.current_price)}</strong><br>
    • 24h: <strong style="color:${isPos?'var(--gain)':'var(--loss)'}">${isPos?'+':''}${ch24.toFixed(2)}%</strong><br>
    • Signal: <strong style="color:${analysis.color}">${analysis.verdict}</strong><br><br>
    <span style="font-size:0.78rem;color:var(--text-muted);">⚠️ Not financial advice. Always do your own research (DYOR).</span>`;
}

function getPortfolioSummaryResponse() {
  if (state.portfolio.length === 0) {
    return `💼 Your portfolio is empty. Go to the <strong>Portfolio</strong> page and add your first transaction!`;
  }
  let totalInvested = 0, currentValue = 0;
  const holdings = {};
  state.portfolio.forEach(tx => {
    if (!holdings[tx.coinId]) holdings[tx.coinId] = { qty: 0, name: tx.coinName, symbol: tx.coinSymbol };
    holdings[tx.coinId].qty += tx.type === 'buy' ? tx.amount : -tx.amount;
    totalInvested += tx.type === 'buy' ? tx.total : -tx.total;
  });
  let rows = '';
  Object.entries(holdings).forEach(([id, h]) => {
    if (h.qty <= 0) return;
    const live = state.allCoins.find(c => c.id === id);
    if (!live) return;
    const val = h.qty * live.current_price;
    currentValue += val;
    rows += `<tr><td>${escHtml(h.name)}</td><td>${h.qty.toFixed(4)}</td><td>${formatPrice(live.current_price)}</td><td>${formatPrice(val)}</td></tr>`;
  });
  const pl = currentValue - totalInvested;
  const plColor = pl >= 0 ? 'var(--gain)' : 'var(--loss)';
  const roiPct = totalInvested > 0 ? ((pl / totalInvested) * 100).toFixed(2) : '0';
  return `💼 <strong>Your Portfolio Summary</strong><br>
    ${rows ? `<table><thead><tr><th>Coin</th><th>Amount</th><th>Price</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table><br>` : ''}
    💵 Invested: <strong>${formatPrice(totalInvested)}</strong><br>
    📈 Current Value: <strong>${formatPrice(currentValue)}</strong><br>
    ${pl >= 0 ? '✅' : '❌'} P&L: <strong style="color:${plColor}">${pl >= 0 ? '+' : ''}${formatPrice(pl)}</strong><br>
    📊 ROI: <strong style="color:${plColor}">${pl >= 0 ? '+' : ''}${roiPct}%</strong>`;
}

function getWatchlistResponse() {
  if (state.watchlist.length === 0) {
    return `⭐ Your watchlist is empty. Go to the <strong>Dashboard</strong> and click ☆ on any coin to add it!`;
  }
  let rows = '';
  state.watchlist.forEach(id => {
    const coin = state.allCoins.find(c => c.id === id);
    if (!coin) return;
    const ch = coin.price_change_percentage_24h || 0;
    const color = ch >= 0 ? 'var(--gain)' : 'var(--loss)';
    rows += `<tr>
      <td><strong>${escHtml(coin.name)}</strong></td>
      <td>${formatPrice(coin.current_price)}</td>
      <td style="color:${color}">${(ch>=0?'+':'')+ch.toFixed(2)}%</td>
    </tr>`;
  });
  return `⭐ <strong>Your Watchlist (${state.watchlist.length} coins)</strong>
    <table><thead><tr><th>Coin</th><th>Price</th><th>24h %</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ---- Coin finder helpers ----

function findCoinByNameOrSymbol(query) {
  if (!query || state.allCoins.length === 0) return null;
  const q = query.toLowerCase().trim();
  // Exact symbol match first (highest priority)
  let found = state.allCoins.find(c => c.symbol.toLowerCase() === q);
  if (found) return found;
  // Exact name match
  found = state.allCoins.find(c => c.name.toLowerCase() === q);
  if (found) return found;
  // Partial name match
  found = state.allCoins.find(c => c.name.toLowerCase().startsWith(q));
  if (found) return found;
  // Contains
  found = state.allCoins.find(c => c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q));
  return found || null;
}

function findCoinInText(text) {
  if (state.allCoins.length === 0) return null;
  // Try to find any known coin name or symbol in the text
  return state.allCoins.find(c =>
    text.includes(c.symbol.toLowerCase()) ||
    text.includes(c.name.toLowerCase())
  ) || null;
}

function quickAnalysis(coin) {
  const ch24 = coin.price_change_percentage_24h || 0;
  const vol = coin.total_volume || 0;
  const mc = coin.market_cap || 1;
  let score = 0;
  if (ch24 > 5) score += 2; else if (ch24 > 0) score += 1; else if (ch24 > -5) score -= 1; else score -= 2;
  if (vol / mc > 0.1) score += 1; else if (vol / mc < 0.03) score -= 1;
  let verdict = 'HOLD', color = 'var(--warn)', reason = 'Mixed signals — monitor closely.';
  if (score >= 2) { verdict = 'BUY'; color = 'var(--gain)'; reason = 'Positive momentum detected.'; }
  else if (score <= -2) { verdict = 'SELL'; color = 'var(--loss)'; reason = 'Bearish signals — caution advised.'; }
  return { verdict, color, score, reason };
}



// =============================================
// FEAR & GREED INDEX
// =============================================
function renderFearGreed() {
  const wrap = document.getElementById('fear-greed-wrap');
  if (!wrap) return;

  // Simulated Fear & Greed index (range 0-100)
  const value = Math.floor(Math.random() * 40) + 45; // 45-85
  let label = 'Neutral', color = 'var(--warn)';
  if (value >= 75) { label = 'Extreme Greed 🤑'; color = 'var(--gain)'; }
  else if (value >= 55) { label = 'Greed 😎'; color = '#86efac'; }
  else if (value >= 45) { label = 'Neutral 😐'; color = 'var(--warn)'; }
  else if (value >= 25) { label = 'Fear 😨'; color = 'var(--loss)'; }
  else { label = 'Extreme Fear 😱'; color = 'var(--loss)'; }

  // Needle angle: 0 = extreme fear (left), 180 = extreme greed (right)
  const angle = (value / 100) * 180 - 90; // -90 to +90 deg

  wrap.innerHTML = `
    <div class="fear-greed-meter">
      <div class="fg-arc"></div>
      <div class="fg-mask"></div>
      <div class="fg-needle" style="transform: rotate(${angle}deg);"></div>
    </div>
    <div class="fg-value" style="color:${color};">${value}</div>
    <div class="fg-label" style="color:${color};">${label}</div>
    <div class="fg-desc">The Fear & Greed Index measures market sentiment from extreme fear (0) to extreme greed (100).</div>
  `;
}

// =============================================
// FORMATTERS & UTILITIES
// =============================================
function formatPrice(n) {
  if (n === null || n === undefined) return '—';
  const sym = CURRENCY_SYMBOLS[CONFIG.CURRENCY] || '$';
  if (n >= 1) return sym + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 0.01) return sym + n.toFixed(4);
  if (n >= 0.0001) return sym + n.toFixed(6);
  return sym + n.toFixed(8);
}

function formatLargeNum(n) {
  if (!n) return '—';
  const sym = CURRENCY_SYMBOLS[CONFIG.CURRENCY] || '$';
  if (n >= 1e12) return sym + (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9)  return sym + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6)  return sym + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3)  return sym + (n / 1e3).toFixed(2) + 'K';
  return sym + n.toFixed(2);
}

function changeGlobalCurrency(curr) {
  CONFIG.CURRENCY = curr;
  localStorage.setItem('cpt_currency', curr);
  // Re-fetch all data with new currency
  refreshData();
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// =============================================
// TOAST NOTIFICATIONS
// =============================================
function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', warn: '⚠️', info: 'ℹ️' };
  toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${escHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}