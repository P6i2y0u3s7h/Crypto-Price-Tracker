// ============================================================
//  firebase-db.js  –  Firestore persistence layer for CryptoPT
//  FIX: Clears previous user's state before loading new user's
//       data, preventing watchlist/portfolio cross-contamination.
// ============================================================

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

import { getApps } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";

const firebaseApp = getApps()[0];
if (!firebaseApp) {
  console.error("[firebase-db] No Firebase app found — make sure firebase-auth.js loads first.");
}

const db = getFirestore(firebaseApp);

// ── Helpers ───────────────────────────────────────────────────

function userRef(uid) {
  return doc(db, "users", uid);
}

/**
 * ✅ FIX: Reset ALL user-specific state to clean defaults
 * before loading the new user's data.
 * This prevents the previous user's watchlist/portfolio
 * from showing up for the newly logged-in user.
 */
function clearUserState() {
  window.state = window.state || {};
  window.state.watchlist   = [];
  window.state.portfolio   = [];
  window.state.alerts      = [];
  window.state.exBalance   = 10000;
  window.state.exHoldings  = {};
  window.state.exTrades    = [];
  console.log("[firebase-db] State cleared for new user session.");
}

/**
 * Load this user's data from Firestore into window.state.
 * Always called AFTER clearUserState() so no old data leaks through.
 */
async function loadFromFirestore(uid) {
  try {
    const snap = await getDoc(userRef(uid));
    if (!snap.exists()) {
      console.log("[firebase-db] No existing Firestore data — fresh start for this user.");
      return;
    }
    const d = snap.data();
    window.state = window.state || {};

    if (Array.isArray(d.watchlist))  window.state.watchlist  = d.watchlist;
    if (Array.isArray(d.portfolio))  window.state.portfolio  = d.portfolio;
    if (Array.isArray(d.alerts))     window.state.alerts     = d.alerts;
    if (d.exBalance  !== undefined)  window.state.exBalance  = d.exBalance;
    if (d.exHoldings !== undefined)  window.state.exHoldings = d.exHoldings;
    if (Array.isArray(d.exTrades))   window.state.exTrades   = d.exTrades;

    console.log("[firebase-db] ✅ Firestore data loaded for uid:", uid);
  } catch (err) {
    console.error("[firebase-db] Load failed:", err);
  }
}

/**
 * Merge-write a partial payload to Firestore.
 */
async function savePartial(uid, payload) {
  try {
    await setDoc(userRef(uid), payload, { merge: true });
  } catch (err) {
    console.error("[firebase-db] Save failed:", err, payload);
  }
}

// ── Patch save functions ──────────────────────────────────────

function patchSaves(uid) {

  function lsSet(key, value) {
    try {
      if (typeof window.userKey === 'function')
        localStorage.setItem(window.userKey(key), JSON.stringify(value));
    } catch (_) {}
  }

  window.saveWatchlist = function () {
    const data = window.state.watchlist || [];
    lsSet('watchlist', data);
    savePartial(uid, { watchlist: data });
  };

  window.savePortfolio = function () {
    const data = window.state.portfolio || [];
    lsSet('portfolio', data);
    savePartial(uid, { portfolio: data });
  };

  window.saveAlerts = function () {
    const data = window.state.alerts || [];
    lsSet('alerts', data);
    savePartial(uid, { alerts: data });
  };

  window.saveExData = function () {
    const balance  = window.state.exBalance  ?? 10000;
    const holdings = window.state.exHoldings ?? {};
    const trades   = window.state.exTrades   ?? [];
    lsSet('exBalance',  balance);
    lsSet('exHoldings', holdings);
    lsSet('exTrades',   trades);
    savePartial(uid, { exBalance: balance, exHoldings: holdings, exTrades: trades });
  };

  console.log("[firebase-db] ✅ Save functions wired to Firestore for uid:", uid);
}

/**
 * Patch loadUserData so bootApp() pulls from Firestore.
 * The async version means bootApp must also await it.
 */
function patchLoad(uid) {
  window.loadUserData = async function () {
    await loadFromFirestore(uid);
    if (typeof window.updateAlertBadge === 'function') window.updateAlertBadge();
  };
}

// ── Entry point called by firebase-auth.js ────────────────────
// firebase-auth.js calls:  await window.__dbReady(user.uid)
// BEFORE bootApp() — so state is clean and data is loaded first.

window.__dbReady = async function (uid) {
  clearUserState();      // ✅ wipe previous user's data from memory
  patchLoad(uid);        // override loadUserData to use Firestore
  patchSaves(uid);       // override all save functions to use Firestore
  await loadFromFirestore(uid);  // pre-load so bootApp renders correct data
};

console.log("[firebase-db] Module loaded.");