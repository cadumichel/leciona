
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyA9aD53AHcErDH0-PK81dfk-Cyaib_An-A",
  authDomain: "leciona-c93a9.firebaseapp.com",
  projectId: "leciona-c93a9",
  storageBucket: "leciona-c93a9.firebasestorage.app",
  messagingSenderId: "24660236180",
  appId: "1:24660236180:web:8d247c2f58f22ae5cd2181",
  measurementId: "G-6YM0TR6EP5"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
