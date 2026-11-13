import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";

import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBUpfwh6IR0GXerdR5bbbHV6AD7ESO80MY",
  authDomain: "studyvoult-ccafb.firebaseapp.com",
  projectId: "studyvoult-ccafb",
  storageBucket: "studyvoult-ccafb.firebasestorage.app",
  messagingSenderId: "543560182590",
  appId: "1:543560182590:web:0324a486f94fff5bd75a6f",
  measurementId: "G-R2B3CKENDT"
};

// Owner Gmail
const OWNER_EMAIL = "bacchi6486@gmail.com";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

provider.setCustomParameters({
  prompt: "select_account"
});

// Account elements
const status = document.getElementById("accountStatus");
const action = document.getElementById("accountAction");
const note = document.getElementById("accountNote");

function showMessage(message) {
  if (status) status.textContent = message;
}

function showError(error) {
  console.error("StudyVault Authentication Error:", error);

  showMessage("Login failed");

  if (note) {
    note.textContent = error.message || "Please try again.";
  }
}

// Login / Logout
if (action) {
  action.addEventListener("click", async () => {
    action.disabled = true;

    try {
      await setPersistence(auth, browserLocalPersistence);

      if (auth.currentUser) {
        await signOut(auth);
      } else {
        await signInWithPopup(auth, provider);
      }
    } catch (error) {
      showError(error);
    } finally {
      action.disabled = false;
    }
  });
}

// Check login status
onAuthStateChanged(auth, (user) => {
  if (!user) {
    showMessage("Not signed in");

    if (action) action.textContent = "Sign in with Google";

    if (note) {
      note.textContent = "Sign in with your owner Gmail.";
    }

    return;
  }

  const email = (user.email || "").toLowerCase();
  const isOwner = email === OWNER_EMAIL.toLowerCase();

  if (isOwner) {
    showMessage("Owner account connected");

    if (note) {
      note.textContent = "Owner identity verified.";
    }
  } else {
    showMessage("Signed in as " + (user.email || "Unknown"));

    if (note) {
      note.textContent = "This is not the configured owner account.";
    }
  }

  if (action) {
    action.textContent = "Sign out";
  }
});
