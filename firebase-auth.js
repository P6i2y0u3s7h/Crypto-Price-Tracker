import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";

// TODO: Replace with your actual Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyCoRklAVI5FXMTBBE0YcG2NW9LjjASSqOU",
  authDomain: "collageproject-crypto.firebaseapp.com",
  projectId: "collageproject-crypto",
  storageBucket: "collageproject-crypto.firebasestorage.app",
  messagingSenderId: "1013491160294",
  appId: "1:1013491160294:web:9761da2e98384af1c0d727",
  measurementId: "G-0NJMNRXY4F"
};

let auth;
try {
  if (firebaseConfig.apiKey !== "YOUR_API_KEY") {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    setupAuthListeners();
  } else {
    console.warn("Firebase config is missing. Falling back to simple LocalStorage auth or displaying an alert on click.");
  }
} catch (err) {
  console.error("Firebase init failed:", err);
}

window.handleFirebaseLogin = async (e) => {
    e.preventDefault();
    if (!auth) {
        alert("Firebase is not configured yet! Please update firebase-auth.js with your config.");
        if (typeof window.handleLogin === 'function') window.handleLogin(e);
        return;
    }
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');
    errorEl.textContent = '';
    const btnText = document.querySelector('#form-login .btn-text');
    btnText.textContent = 'Signing in...';

    try {
        await signInWithEmailAndPassword(auth, email, pass);
        // The auth listener will redirect / start app
    } catch (error) {
        errorEl.textContent = error.message;
        btnText.textContent = 'Sign In';
    }
};

window.handleFirebaseSignup = async (e) => {
    e.preventDefault();
    if (!auth) {
        alert("Firebase is not configured yet! Please update firebase-auth.js with your config.");
        if (typeof window.handleSignup === 'function') window.handleSignup(e);
        return;
    }
    const email = document.getElementById('signup-email').value;
    const pass = document.getElementById('signup-password').value;
    const name = document.getElementById('signup-name').value;
    const errorEl = document.getElementById('signup-error');
    errorEl.textContent = '';
    
    if (pass.length < 8) {
        errorEl.textContent = 'Password must be at least 8 characters.';
        return;
    }

    const btnText = document.querySelector('#form-signup .btn-text');
    btnText.textContent = 'Creating...';

    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, pass);
        await updateProfile(userCredential.user, { displayName: name });
        // The auth listener will start app
    } catch (error) {
        errorEl.textContent = error.message;
        btnText.textContent = 'Create Account';
    }
};

window.handleFirebaseLogout = async () => {
    if (auth) {
        await signOut(auth);
    } else {
        // Fallback
        if (typeof window.handleLogout === 'function') window.handleLogout();
    }
};

function setupAuthListeners() {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            // Logged in
            window.state = window.state || {};
            window.state.currentUser = {
                name: user.displayName || 'User',
                email: user.email,
                uid: user.uid
            };
            localStorage.setItem('cpt_session', JSON.stringify(window.state.currentUser));
            if(typeof window.bootApp === 'function') window.bootApp();
            if(typeof window.showToast === 'function') window.showToast('Authentication Successful!', 'success');
        } else {
            // Logged out
            if (typeof window.handleLogout === 'function' && window.state && window.state.currentUser) {
                 localStorage.removeItem('cpt_session');
                 window.state.currentUser = null;
                 if (window.state.refreshTimer) clearInterval(window.state.refreshTimer);
                 document.getElementById('app').classList.add('hidden');
                 document.getElementById('auth-overlay').classList.add('active');
            }
        }
    });
}
