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

const firebaseConfig = {
  apiKey: "AIzaSyBUpfwh6IR0GXerdR5bbbHV6AD7ESO80MY",
  authDomain: "studyvoult-ccafb.firebaseapp.com",
  projectId: "studyvoult-ccafb",
  storageBucket: "studyvoult-ccafb.firebasestorage.app",
  messagingSenderId: "543560182590",
  appId: "1:543560182590:web:0324a486f94fff5bd75a6f",
  measurementId: "G-R2B3CKENDT"
};

const OWNER_EMAIL = "bachhi6486@gmail.com";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

provider.setCustomParameters({
  prompt: "select_account"
});

const status = document.getElementById("accountStatus");
const action = document.getElementById("accountAction");
const note = document.getElementById("accountNote");

function showError(error) {
  console.error(error);
  if (status) status.textContent = "Login failed";
  if (note) note.textContent = error.message;
}

action.onclick = async () => {
  try {
    if (auth.currentUser) {
      await signOut(auth);
    } else {
      await signInWithPopup(auth, provider);
    }
  } catch (error) {
    showError(error);
  }
};

setPersistence(auth, browserLocalPersistence).catch(showError);

onAuthStateChanged(auth, user => {
  if (!user) {
    status.textContent = "Not signed in";
    action.textContent = "Sign in with Google";
    note.textContent = "Sign in with owner Gmail.";
    return;
  }

  const isOwner =
    user.email?.toLowerCase() === OWNER_EMAIL;

  status.textContent = isOwner
    ? "Owner account connected"
    : "Signed in as " + user.email;

  action.textContent = "Sign out";

  note.textContent = isOwner
    ? "Owner identity verified."
    : "This is not the configured owner account.";
});
