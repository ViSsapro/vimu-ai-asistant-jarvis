// firebase.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";

import {
    getAuth
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";

import {
    getFirestore
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

import {
    getStorage
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-storage.js";


// ===============================
// FIREBASE CONFIG
// ===============================

const firebaseConfig = {
    apiKey: "AIzaSyATTNAX63B0cKEKGTIh6sOZRZlL4dGWb8k",
    authDomain: "vimu-jarvis-ai-asistant.firebaseapp.com",
    projectId: "vimu-jarvis-ai-asistant",
    storageBucket: "vimu-jarvis-ai-asistant.firebasestorage.app",
    messagingSenderId: "353303740893",
    appId: "1:353303740893:web:c5fd67fd09e7403a367634",
    measurementId: "G-0WLE09NZW1"
};


// ===============================
// INITIALIZE FIREBASE
// ===============================

const app = initializeApp(firebaseConfig);


// ===============================
// FIREBASE SERVICES
// ===============================

const auth = getAuth(app);

const db = getFirestore(app);

const storage = getStorage(app);


// ===============================
// EXPORT
// ===============================

export {
    app,
    auth,
    db,
    storage
};
