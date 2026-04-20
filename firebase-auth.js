import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCoRklAVI5FXMTBBE0YcG2NW9LjjASSqOU",
  authDomain: "collageproject-crypto.firebaseapp.com",
  databaseURL: "https://collageproject-crypto-default-rtdb.firebaseio.com",
  projectId: "collageproject-crypto",
  storageBucket: "collageproject-crypto.firebasestorage.app",
  messagingSenderId: "1013491160294",
  appId: "1:1013491160294:web:9761da2e98384af1c0d727",
  measurementId: "G-0NJMNRXY4F"
};

let auth;
try {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  setupAuthListeners();
} catch (err) {
  console.error("Firebase init failed:", err);
}

// ── Login ────────────────────────────────────────────────────
window.handleFirebaseLogin = async (e) => {
  e.preventDefault();
  if (!auth) { if (typeof window.handleLogin === 'function') window.handleLogin(e); return; }

  const email   = document.getElementById('login-email').value;
  const pass    = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';
  document.querySelector('#form-login .btn-text').textContent = 'Signing in…';

  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (error) {
    errorEl.textContent = error.message;
    document.querySelector('#form-login .btn-text').textContent = 'Sign In';
  }
};

// ── Signup ───────────────────────────────────────────────────
window.handleFirebaseSignup = async (e) => {
  e.preventDefault();
  if (!auth) { if (typeof window.handleSignup === 'function') window.handleSignup(e); return; }

  const email   = document.getElementById('signup-email').value;
  const pass    = document.getElementById('signup-password').value;
  const name    = document.getElementById('signup-name').value;
  const errorEl = document.getElementById('signup-error');
  errorEl.textContent = '';

  if (pass.length < 8) { errorEl.textContent = 'Password must be at least 8 characters.'; return; }

  document.querySelector('#form-signup .btn-text').textContent = 'Creating…';

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await updateProfile(cred.user, { displayName: name });
  } catch (error) {
    errorEl.textContent = error.message;
    document.querySelector('#form-signup .btn-text').textContent = 'Create Account';
  }
};

// ── Logout ───────────────────────────────────────────────────
window.handleFirebaseLogout = async () => {
  if (auth) {
    await signOut(auth);
    // onAuthStateChanged handles the rest
  } else {
    if (typeof window.handleLogout === 'function') window.handleLogout();
  }
};

// ── Auth State Listener ──────────────────────────────────────
function setupAuthListeners() {
  onAuthStateChanged(auth, async (user) => {

    if (user) {
      // ── USER LOGGED IN ──────────────────────────────────
      window.state = window.state || {};
      window.state.currentUser = {
        name:  user.displayName || 'User',
        email: user.email,
        uid:   user.uid,
      };
      localStorage.setItem('cpt_session', JSON.stringify(window.state.currentUser));

      // ✅ FIX: Wait for firebase-db.js to:
      //    1. Clear old user's state from memory
      //    2. Patch save/load functions for new user
      //    3. Load new user's data from Firestore
      // Only THEN call bootApp() so UI renders correct data.
      if (typeof window.__dbReady === 'function') {
        await window.__dbReady(user.uid);
      }

      if (typeof window.bootApp === 'function') window.bootApp();
      if (typeof window.showToast === 'function') window.showToast('Welcome back! 👋', 'success');

    } else {
      // ── USER LOGGED OUT ─────────────────────────────────
      // ✅ FIX: Wipe ALL user data from memory immediately
      //    so it is never visible to the next login session.
      if (window.state) {
        window.state.watchlist   = [];
        window.state.portfolio   = [];
        window.state.alerts      = [];
        window.state.exBalance   = 10000;
        window.state.exHoldings  = {};
        window.state.exTrades    = [];
        window.state.currentUser = null;
        window.state.allCoins    = [];
        window.state.filteredCoins = [];
      }

      localStorage.removeItem('cpt_session');
      if (window.state?.refreshTimer) clearInterval(window.state.refreshTimer);

      document.getElementById('app').classList.add('hidden');
      document.getElementById('auth-overlay').classList.add('active');
    }
  });
}