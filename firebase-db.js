// ============================================================
//  firebase-db.js  –  Firestore persistence layer for CryptoPT
//
//  FIXES APPLIED:
//  1. clearUserState() wipes previous user's data before loading new user's
//  2. patchSaves() correctly patches all 4 save functions to write to Firestore
//  3. loadUserData is replaced with a no-op after __dbReady pre-loads data,
//     preventing bootApp() from overwriting Firestore state with empty localStorage
//  4. window.userKey is used correctly (script.js exposes it on window)
//  5. All data groups: watchlist, portfolio, alerts, exchange → saved to Firestore
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
 * Reset ALL user-specific state to clean defaults before loading
 * the new user's data. Prevents previous user's data from leaking.
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
    console.log("[firebase-db] ✅ Saved to Firestore:", Object.keys(payload));
  } catch (err) {
    console.error("[firebase-db] Save failed:", err, payload);
  }
}

// ── Patch save functions ──────────────────────────────────────

function patchSaves(uid) {

  // Also write to localStorage as a local cache using the key helper
  // from script.js (exposed on window so firebase-db can access it).
  function lsSet(key, value) {
    try {
      if (typeof window.userKey === 'function') {
        localStorage.setItem(window.userKey(key), JSON.stringify(value));
      }
    } catch (_) {}
  }

  // ── Watchlist ──
  window.saveWatchlist = function () {
    const data = window.state.watchlist || [];
    lsSet('watchlist', data);
    savePartial(uid, { watchlist: data });
  };

  // ── Portfolio ──
  window.savePortfolio = function () {
    const data = window.state.portfolio || [];
    lsSet('portfolio', data);
    savePartial(uid, { portfolio: data });
  };

  // ── Alerts ──
  window.saveAlerts = function () {
    const data = window.state.alerts || [];
    lsSet('alerts', data);
    savePartial(uid, { alerts: data });
  };

  // ── Exchange data (balance + holdings + trades) ──
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
 * Patch loadUserData so bootApp() does NOT overwrite Firestore-loaded state
 * with empty localStorage data.
 *
 * WHY: bootApp() calls loadUserData() synchronously. By the time bootApp()
 * runs, __dbReady has already loaded Firestore data into window.state.
 * If we let the original loadUserData() run, it reads localStorage
 * (which is empty for new logins) and zeros out the Firestore data.
 *
 * FIX: Replace loadUserData with a lightweight function that only
 * refreshes UI derived from the already-correct window.state.
 */
function patchLoad() {
  window.loadUserData = function () {
    // Data is already in window.state (pre-loaded by __dbReady).
    // Just refresh UI elements that depend on state — do NOT touch state itself.
    if (typeof window.updateAlertBadge === 'function') {
      window.updateAlertBadge();
    }
    console.log("[firebase-db] loadUserData() — using pre-loaded Firestore state.");
  };
}

// ── Entry point called by firebase-auth.js ────────────────────
// firebase-auth.js calls:  await window.__dbReady(user.uid)
// BEFORE bootApp() — so state is clean and data is loaded first.

window.__dbReady = async function (uid) {
  clearUserState();             // ✅ wipe previous user's data from memory
  patchLoad();                  // ✅ prevent bootApp() from overwriting with localStorage
  patchSaves(uid);              // ✅ wire all 4 save functions to Firestore
  await loadFromFirestore(uid); // ✅ pre-load data so bootApp renders correct state
  console.log("[firebase-db] __dbReady complete for uid:", uid);
};

console.log("[firebase-db] Module loaded.");