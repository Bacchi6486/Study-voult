import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";

import {
  getAuth,
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut
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
  console.error("Firebase Auth:", error);
  if (status) status.textContent = "Sign-in error";
  if (note) note.textContent =
    error?.message || "Google sign-in could not be completed.";
}

function renderUser(user) {
  if (!status || !action || !note) return;

  if (!user) {
    status.textContent = "Not signed in";
    action.textContent = "Sign in with Google";
    note.textContent = "Sign in with the owner Gmail account.";

    action.onclick = () =>
      signInWithRedirect(auth, provider).catch(showError);

    return;
  }

  const email = (user.email || "").toLowerCase();
  const isOwner = email === OWNER_EMAIL;

  status.textContent = isOwner
    ? "Owner account connected"
    : "Signed in as " + (user.email || "Google user");

  action.textContent = "Sign out";

  note.textContent = isOwner
    ? "Owner identity verified. Secure Drive access still needs server-side setup."
    : "This is not the configured owner account.";

  action.onclick = () => signOut(auth).catch(showError);
}

getRedirectResult(auth).catch(showError);
onAuthStateChanged(auth, renderUser);
