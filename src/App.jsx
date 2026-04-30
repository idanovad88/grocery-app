import { useState, useEffect, useRef, useMemo } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, deleteDoc, updateDoc, doc, getDoc, onSnapshot, query, orderBy, getDocs, where, setDoc, arrayUnion, limit } from "firebase/firestore";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithCredential,
  linkWithPopup,
  linkWithRedirect,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import { getStorage, ref, uploadBytes, getDownloadURL, getBlob } from "firebase/storage";
import { getFunctions, httpsCallable } from "firebase/functions";

const firebaseConfig = {
  apiKey: "AIzaSyBRAaqDl5ywLm-wSOmvo-ucPxtVNdWjH7w",
  authDomain: "grocery-app-5fa03.firebaseapp.com",
  projectId: "grocery-app-5fa03",
  storageBucket: "grocery-app-5fa03.firebasestorage.app",
  messagingSenderId: "161144194083",
  appId: "1:161144194083:web:c2e9da8c036d16e39c5d96",
  measurementId: "G-1MVD3024P3"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);
const functions = getFunctions(app);

// ─── Constants ───────────────────────────────────────────────────────────────

const PRIORITY_CONFIG = {
  red:    { label: "דחוף",          color: "#E53935", bg: "#FFEBEE", icon: "🔴" },
  yellow: { label: "חשוב",           color: "#F9A825", bg: "#FFF8E1", icon: "🟡" },
  green:  { label: "עדיפות נמוכה",  color: "#43A047", bg: "#E8F5E9", icon: "🟢" },
};

const USER_COLORS = [
  { color: "#2980B9", bg: "#EBF5FB" },
  { color: "#8E44AD", bg: "#F5EEF8" },
  { color: "#E67E22", bg: "#FEF9E7" },
  { color: "#00897B", bg: "#E0F2F1" },
  { color: "#D81B60", bg: "#FCE4EC" },
  { color: "#3949AB", bg: "#E8EAF6" },
  { color: "#0097A7", bg: "#E0F7FA" },
  { color: "#E64A19", bg: "#FBE9E7" },
];

const BILL_CYAN = "#00ACC1";
const BILL_DARK = "#006064";
const BILL_BG   = "#E0F7FA";

const MODULES = [
  { id: "shopping",  icon: "🛒", label: "רשימת קניות",   desc: "ניהול קניות משותף",        color: "#2D3436", bg: "#F0EDED", available: true  },
  { id: "coupons",   icon: "🎟️", label: "שוברים",        desc: "שמירת שוברים והטבות",      color: "#8E44AD", bg: "#F5EEF8", available: true  },
  { id: "insurance", icon: "🛡️", label: "מסמכי ביטוח",  desc: "ניהול פוליסות וביטוחים",   color: "#1565C0", bg: "#E3F2FD", available: true  },
  { id: "birthdays",     icon: "🎈", label: "ימי הולדת",     desc: "מעקב ימי הולדת משפחה",     color: "#E91E63", bg: "#FCE4EC", available: true  },
  { id: "subscriptions", icon: "📺", label: "מנויים",        desc: "ניהול מנויים ותשלומים חוזרים", color: "#00897B", bg: "#E0F2F1", available: true  },
  { id: "bills",         icon: "💰", label: "חשבונות",       desc: "מעקב חשבונות ותשלומים",        color: "#00ACC1", bg: "#E0F7FA", available: true  },
  { id: "personal_docs", icon: "📄", label: "מסמכים אישיים", desc: "תעודות, רישיונות, מסמכים סרוקים", color: "#5E35B1", bg: "#EDE7F6", available: true  },
  { id: "service_providers", icon: "🛠️", label: "אנשי מקצוע", desc: "רשימת טלפונים — חשמלאי, אינסטלטור ועוד", color: "#EF6C00", bg: "#FFF3E0", available: true  },
  // ── Optional modules (activated per household) ──
  { id: "split_bills", icon: "🤝", label: "חלוקת חשבונות", desc: "חלוקת חשבונות בין שותפים", color: "#7B1FA2", bg: "#F3E5F5", available: true, optional: true },
];

// ─── Invite-code expiry ───────────────────────────────────────────────────────
const INVITE_EXPIRY_DAYS = 1;
const expiryFromNow = () =>
  new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
const isInviteExpired = (iso) => {
  if (!iso) return false; // legacy households without expiry are treated as valid
  const t = Date.parse(iso);
  return Number.isNaN(t) || t < Date.now();
};
const formatExpiryDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};

// ─── Shared input style ───────────────────────────────────────────────────────

const inputStyle = {
  width: "100%",
  padding: "12px 16px",
  border: "2px solid #E8E5E0",
  borderRadius: 12,
  fontSize: 15,
  fontFamily: "'Rubik', sans-serif",
  outline: "none",
  boxSizing: "border-box",
  direction: "rtl",
  transition: "border-color 0.2s",
  background: "#fff",
};

// ─── Utilities ───────────────────────────────────────────────────────────────

function getUserColor(name = "") {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i);
    hash = hash & hash;
  }
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
}

function formatDate(iso) {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

function getExpiryStatus(dateStr) {
  if (!dateStr) return null;
  const now  = new Date();
  const exp  = new Date(dateStr);
  const days = Math.ceil((exp - now) / 86400000);
  if (days < 0)  return { label: "פג תוקף",      color: "#E53935", bg: "#FFEBEE" };
  if (days <= 7) return { label: `${days} ימים`,  color: "#F9A825", bg: "#FFF8E1" };
  const d = exp;
  return { label: `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`, color: "#43A047", bg: "#E8F5E9" };
}

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ─── SwipeItem ────────────────────────────────────────────────────────────────
// onSwipeLeft  = delete (swipe left)
// onSwipeRight = edit   (swipe right, optional)

function SwipeItem({ children, onSwipeLeft, onSwipeRight, borderRadius = 16 }) {
  const startX    = useRef(0);
  const startY    = useRef(0);
  const currentX  = useRef(0);
  const swiping   = useRef(false);
  const locked    = useRef(false); // true once we've committed to horizontal
  const innerRef  = useRef(null);
  const [offset, setOffset]     = useState(0);
  const [removing, setRemoving] = useState(false);

  const onSwipeLeftRef  = useRef(onSwipeLeft);
  const onSwipeRightRef = useRef(onSwipeRight);
  useEffect(() => { onSwipeLeftRef.current = onSwipeLeft; onSwipeRightRef.current = onSwipeRight; });

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;

    const onTouchStart = (e) => {
      startX.current   = e.touches[0].clientX;
      startY.current   = e.touches[0].clientY;
      currentX.current = 0;
      swiping.current  = true;
      locked.current   = false;
    };

    const onTouchMove = (e) => {
      if (!swiping.current) return;
      const dx = e.touches[0].clientX - startX.current;
      const dy = e.touches[0].clientY - startY.current;

      if (!locked.current) {
        if (Math.abs(dx) < Math.abs(dy)) { swiping.current = false; return; } // vertical scroll — give up
        locked.current = true;
      }

      e.preventDefault(); // stop page scroll now that we own this gesture
      currentX.current = dx;
      setOffset(dx);
    };

    const onTouchEnd = () => {
      if (!swiping.current) return;
      swiping.current = false;
      locked.current  = false;
      if (currentX.current < -80) {
        setRemoving(true); setOffset(-500); setTimeout(() => onSwipeLeftRef.current?.(), 300);
      } else if (currentX.current > 80 && onSwipeRightRef.current) {
        currentX.current = 0; setOffset(0);
        onSwipeRightRef.current();
      } else {
        currentX.current = 0; setOffset(0);
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove",  onTouchMove,  { passive: false });
    el.addEventListener("touchend",   onTouchEnd,   { passive: true });
    el.addEventListener("touchcancel",onTouchEnd,   { passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove",  onTouchMove);
      el.removeEventListener("touchend",   onTouchEnd);
      el.removeEventListener("touchcancel",onTouchEnd);
    };
  }, []);

  // Mouse support for desktop
  const mouseDown = useRef(false);
  const onMouseDown = (e) => { mouseDown.current = true; startX.current = e.clientX; currentX.current = 0; };
  const onMouseMove = (e) => {
    if (!mouseDown.current) return;
    const diff = e.clientX - startX.current;
    currentX.current = diff;
    setOffset(diff);
  };
  const onMouseUp = () => {
    if (!mouseDown.current) return;
    mouseDown.current = false;
    if (currentX.current < -80) {
      setRemoving(true); setOffset(-500); setTimeout(() => onSwipeLeftRef.current?.(), 300);
    } else if (currentX.current > 80 && onSwipeRightRef.current) {
      currentX.current = 0; setOffset(0); onSwipeRightRef.current();
    } else {
      currentX.current = 0; setOffset(0);
    }
  };

  const dir = offset < -15 ? "left" : offset > 15 ? "right" : null;

  return (
    <div style={{ position: "relative", overflow: "hidden", borderRadius }}>
      {/* Delete hint — left swipe */}
      <div style={{ position: "absolute", inset: 0, background: "#E53935", display: "flex", alignItems: "center", justifyContent: "flex-start", paddingLeft: 24, color: "#fff", fontSize: 14, fontWeight: 600 }}>
        🗑️ מחיקה
      </div>
      {/* Edit hint — right swipe */}
      {onSwipeRight && (
        <div style={{ position: "absolute", inset: 0, background: "#8E44AD", display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 24, color: "#fff", fontSize: 14, fontWeight: 600, opacity: dir === "right" ? 1 : 0, transition: "opacity 0.15s" }}>
          עריכה ✏️
        </div>
      )}
      <div
        ref={innerRef}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}
        onMouseLeave={() => { if (mouseDown.current) onMouseUp(); }}
        style={{ transform: `translateX(${offset}px)`, transition: (swiping.current || mouseDown.current) ? "none" : "transform 0.3s ease", opacity: removing ? 0 : 1, cursor: "grab", userSelect: "none" }}
      >
        {children}
      </div>
    </div>
  );
}

// ─── LoginScreen ──────────────────────────────────────────────────────────────
// Google Sign-In gateway. Replaces the previous anonymous-auth flow so that
// the same human keeps the same Firebase UID across devices, which fixes the
// duplicate-member pill on the home screen and lets household membership
// follow users to new browsers/phones automatically.

function LoginScreen({ onSignIn, loading, error }) {
  return (
    <div dir="rtl" style={{ fontFamily: "'Rubik', sans-serif", maxWidth: 480, margin: "0 auto", minHeight: "100vh", background: "linear-gradient(165deg, #FAFAFA 0%, #F0EDE8 100%)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ fontSize: 72, marginBottom: 20 }}>🏠</div>
      <h1 style={{ fontSize: 26, fontWeight: 700, color: "#2D3436", marginBottom: 8 }}>ברוך הבא</h1>
      <p style={{ fontSize: 15, color: "#888", marginBottom: 36, fontWeight: 300, textAlign: "center", maxWidth: 320 }}>
        התחבר כדי לשמור את המשקי בית שלך ולגשת אליהם מכל מכשיר
      </p>
      <button
        onClick={onSignIn}
        disabled={loading}
        style={{
          width: "100%",
          maxWidth: 300,
          border: "1px solid #DADCE0",
          background: loading ? "#F5F5F5" : "#fff",
          color: "#3C4043",
          borderRadius: 14,
          padding: "14px 16px",
          fontSize: 15,
          fontWeight: 600,
          fontFamily: "inherit",
          cursor: loading ? "default" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
        }}
      >
        <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"/>
          <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"/>
          <path fill="#FBBC05" d="M11.69 28.18c-.44-1.32-.69-2.73-.69-4.18s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"/>
          <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"/>
        </svg>
        {loading ? "מתחבר..." : "התחבר עם Google"}
      </button>
      {error && (
        <p style={{ color: "#E53935", fontSize: 13, marginTop: 16, maxWidth: 300, textAlign: "center" }}>
          {error}
        </p>
      )}
      <p style={{ fontSize: 11, color: "#BBB", marginTop: 32, textAlign: "center", maxWidth: 300, fontWeight: 300 }}>
        אנחנו לא משתפים את המידע שלך. החשבון משמש רק לזיהוי בין המכשירים שלך.
      </p>
    </div>
  );
}

// ─── NameSetup ────────────────────────────────────────────────────────────────

function NameSetup({ onSave }) {
  const [name, setName] = useState("");
  return (
    <div dir="rtl" style={{ fontFamily: "'Rubik', sans-serif", maxWidth: 480, margin: "0 auto", minHeight: "100vh", background: "linear-gradient(165deg, #FAFAFA 0%, #F0EDE8 100%)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ fontSize: 64, marginBottom: 20 }}>🏠</div>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: "#2D3436", marginBottom: 8 }}>ברוך הבא</h1>
      <p style={{ fontSize: 15, color: "#888", marginBottom: 32, fontWeight: 300 }}>איך קוראים לך?</p>
      <input
        value={name} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && name.trim() && onSave(name.trim())}
        placeholder="הכנס את השם שלך" autoFocus
        style={{ ...inputStyle, maxWidth: 280, fontSize: 18, textAlign: "center", marginBottom: 16 }}
      />
      <button
        onClick={() => name.trim() && onSave(name.trim())} disabled={!name.trim()}
        style={{ width: "100%", maxWidth: 280, border: "none", background: name.trim() ? "linear-gradient(135deg, #2D3436, #636E72)" : "#ccc", color: "#fff", borderRadius: 14, padding: "14px", fontSize: 16, fontWeight: 600, fontFamily: "inherit", cursor: name.trim() ? "pointer" : "default" }}
      >
        בואו נתחיל ✓
      </button>
    </div>
  );
}

// ─── HouseholdSetup ───────────────────────────────────────────────────────────

function HouseholdSetup({ userName, onDone, onCancel, initialJoinCode }) {
  const [mode, setMode]         = useState(initialJoinCode ? "join" : null); // "create" | "join"
  const [name, setName]         = useState("");
  const [joinCode, setJoinCode] = useState(initialJoinCode || "");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [createdCode, setCreatedCode] = useState(null); // after creation, show code
  const [createdId, setCreatedId]     = useState(null);
  const [createdName, setCreatedName] = useState(null);
  const autoJoinFired = useRef(false);

  const createHousehold = async () => {
    if (!name.trim()) return;
    setLoading(true); setError("");
    try {
      if (!auth.currentUser) await signInAnonymously(auth);
      const inviteCode = generateCode();
      const newRef = doc(collection(db, "households"));
      await setDoc(newRef, {
        name: name.trim(),
        inviteCode,
        inviteCodeExpiry: expiryFromNow(),
        createdBy: userName,
        createdAt: new Date().toISOString(),
        members: [auth.currentUser.uid],
        memberNames: { [auth.currentUser.uid]: userName },
      });
      setCreatedCode(inviteCode);
      setCreatedId(newRef.id);
      setCreatedName(name.trim());
    } catch (e) {
      console.error("Create household error:", e);
      setError(e?.code || e?.message || "שגיאה ביצירת משק הבית. נסה שוב.");
    }
    setLoading(false);
  };

  const finishCreate = () => {
    localStorage.setItem("grocery-householdId", createdId);
    localStorage.setItem("grocery-householdName", createdName);
    onDone(createdId, createdName);
  };

  const joinHousehold = async (explicitCode) => {
    const code = (explicitCode ?? joinCode).trim().toUpperCase();
    if (code.length !== 6) { setError("הזן קוד בן 6 תווים"); return; }
    setLoading(true); setError("");
    try {
      if (!auth.currentUser) await signInAnonymously(auth);
      // limit(1) is required: the Firestore rule for `list` enforces
      // request.query.limit <= 20, and queries without an explicit limit
      // are rejected.
      const q = query(collection(db, "households"), where("inviteCode", "==", code), limit(1));
      const snap = await getDocs(q);
      if (snap.empty) { setError("קוד לא נמצא. בדוק שוב."); setLoading(false); return; }
      const hDoc = snap.docs[0];
      // Reject expired invite codes (client-side check; the doc was just
      // returned by the list query so we already have the expiry field).
      if (isInviteExpired(hDoc.data().inviteCodeExpiry)) {
        setError("הקוד פג תוקף. בקש מבעל הבית קוד חדש.");
        setLoading(false);
        return;
      }
      // Add the current user to the members array (idempotent via arrayUnion).
      // Without this, Firestore rules will reject subsequent reads/writes.
      try {
        await updateDoc(hDoc.ref, {
          members: arrayUnion(auth.currentUser.uid),
          [`memberNames.${auth.currentUser.uid}`]: userName,
        });
      } catch (e) {
        console.error("Failed to add member:", e);
        setError("שגיאה בהצטרפות. נסה שוב.");
        setLoading(false);
        return;
      }
      onDone(hDoc.id, hDoc.data().name);
    } catch (e) { setError("שגיאה בחיבור. נסה שוב."); console.error(e); }
    setLoading(false);
  };

  // ── Deep-link auto-join: if a code arrived via ?join=, fire it once. ──
  useEffect(() => {
    if (autoJoinFired.current) return;
    if (initialJoinCode && initialJoinCode.length === 6) {
      autoJoinFired.current = true;
      joinHousehold(initialJoinCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJoinCode]);

  const btnBase = { border: "none", borderRadius: 14, padding: "14px", fontSize: 16, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", color: "#fff" };

  // ── After create: show invite code ──
  if (createdCode) {
    return (
      <div dir="rtl" style={{ fontFamily: "'Rubik', sans-serif", maxWidth: 480, margin: "0 auto", minHeight: "100vh", background: "linear-gradient(165deg, #FAFAFA 0%, #F0EDE8 100%)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>🎉</div>
        <h2 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 700, color: "#2D3436" }}>משק הבית נוצר!</h2>
        <p style={{ fontSize: 15, color: "#888", marginBottom: 24, textAlign: "center" }}>שתף את הקוד הזה עם בני המשפחה כדי שיוכלו להצטרף:</p>
        <div style={{ background: "#fff", borderRadius: 20, padding: "20px 40px", boxShadow: "0 4px 20px rgba(0,0,0,0.08)", marginBottom: 28, textAlign: "center" }}>
          <p style={{ margin: "0 0 8px", fontSize: 13, color: "#AAA" }}>קוד הצטרפות</p>
          <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: 8, color: "#2D3436" }}>{createdCode}</div>
        </div>
        <button onClick={finishCreate} style={{ ...btnBase, width: "100%", maxWidth: 280, background: "linear-gradient(135deg, #2D3436, #636E72)" }}>
          המשך לאפליקציה ✓
        </button>
      </div>
    );
  }

  // ── Mode selection ──
  if (!mode) {
    return (
      <div dir="rtl" style={{ fontFamily: "'Rubik', sans-serif", maxWidth: 480, margin: "0 auto", minHeight: "100vh", background: "linear-gradient(165deg, #FAFAFA 0%, #F0EDE8 100%)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ fontSize: 64, marginBottom: 20 }}>🏠</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "#2D3436", marginBottom: 8 }}>ברוך הבא, {userName}!</h1>
        <p style={{ fontSize: 15, color: "#888", marginBottom: 36, textAlign: "center", fontWeight: 300 }}>צור משק בית חדש או הצטרף לקיים</p>
        <div style={{ width: "100%", maxWidth: 320, display: "flex", flexDirection: "column", gap: 14 }}>
          <button onClick={() => setMode("create")} style={{ ...btnBase, background: "linear-gradient(135deg, #2D3436, #636E72)" }}>
            🏠 צור משק בית חדש
          </button>
          <button onClick={() => setMode("join")} style={{ ...btnBase, background: "linear-gradient(135deg, #8E44AD, #6C3483)" }}>
            🔗 הצטרף למשק בית קיים
          </button>
          {onCancel && (
            <button onClick={onCancel} style={{ ...btnBase, background: "transparent", color: "#888", border: "1px solid #DDD" }}>
              ← חזור לרשימה
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Create mode ──
  if (mode === "create") {
    return (
      <div dir="rtl" style={{ fontFamily: "'Rubik', sans-serif", maxWidth: 480, margin: "0 auto", minHeight: "100vh", background: "linear-gradient(165deg, #FAFAFA 0%, #F0EDE8 100%)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ fontSize: 64, marginBottom: 20 }}>🏠</div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: "#2D3436", marginBottom: 8 }}>משק בית חדש</h2>
        <p style={{ fontSize: 15, color: "#888", marginBottom: 28, fontWeight: 300 }}>תן שם למשק הבית שלך</p>
        <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && createHousehold()}
          placeholder='למשל: "משפחת לוי"' autoFocus
          style={{ ...inputStyle, maxWidth: 300, fontSize: 16, textAlign: "center", marginBottom: 14 }} />
        {error && <p style={{ color: "#E53935", fontSize: 13, marginBottom: 10 }}>{error}</p>}
        <div style={{ display: "flex", gap: 10, width: "100%", maxWidth: 300 }}>
          <button onClick={() => { setMode(null); setError(""); }} style={{ ...btnBase, flex: 1, background: "#ccc" }}>← חזור</button>
          <button onClick={createHousehold} disabled={!name.trim() || loading} style={{ ...btnBase, flex: 2, background: name.trim() && !loading ? "linear-gradient(135deg, #2D3436, #636E72)" : "#ccc" }}>
            {loading ? "יוצר..." : "צור ✓"}
          </button>
        </div>
      </div>
    );
  }

  // ── Join mode ──
  return (
    <div dir="rtl" style={{ fontFamily: "'Rubik', sans-serif", maxWidth: 480, margin: "0 auto", minHeight: "100vh", background: "linear-gradient(165deg, #FAFAFA 0%, #F0EDE8 100%)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ fontSize: 64, marginBottom: 20 }}>🔗</div>
      <h2 style={{ fontSize: 22, fontWeight: 700, color: "#2D3436", marginBottom: 8 }}>הצטרף למשק בית</h2>
      <p style={{ fontSize: 15, color: "#888", marginBottom: 28, fontWeight: 300 }}>הזן את קוד ההזמנה (6 תווים)</p>
      <input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && joinHousehold()}
        placeholder="ABC123" maxLength={6} autoFocus
        style={{ ...inputStyle, maxWidth: 200, fontSize: 24, textAlign: "center", letterSpacing: 6, fontWeight: 700, marginBottom: 14 }} />
      {error && <p style={{ color: "#E53935", fontSize: 13, marginBottom: 10 }}>{error}</p>}
      <div style={{ display: "flex", gap: 10, width: "100%", maxWidth: 300 }}>
        <button onClick={() => { setMode(null); setError(""); }} style={{ ...btnBase, flex: 1, background: "#ccc" }}>← חזור</button>
        <button onClick={joinHousehold} disabled={joinCode.trim().length !== 6 || loading} style={{ ...btnBase, flex: 2, background: joinCode.trim().length === 6 && !loading ? "linear-gradient(135deg, #8E44AD, #6C3483)" : "#ccc" }}>
          {loading ? "מחפש..." : "הצטרף ✓"}
        </button>
      </div>
    </div>
  );
}

// ─── HouseholdPickerScreen ────────────────────────────────────────────────────

function HouseholdPickerScreen({ userName, households, onSelect, onAddHousehold, onDelete, onSignOut }) {
  const HOUSE_COLORS = [
    { bg: "#E3F2FD", icon: "#1565C0" },
    { bg: "#F3E5F5", icon: "#6A1B9A" },
    { bg: "#E8F5E9", icon: "#2E7D32" },
    { bg: "#FFF3E0", icon: "#E65100" },
    { bg: "#FCE4EC", icon: "#880E4F" },
  ];

  const [pendingDelete, setPendingDelete] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null); // { id, name }
  const [swipeResetKeys, setSwipeResetKeys] = useState({});

  const handleDelete = (id, name) => {
    setConfirmDelete({ id, name });
  };

  const cancelDelete = () => {
    if (confirmDelete) {
      setSwipeResetKeys(prev => ({ ...prev, [confirmDelete.id]: (prev[confirmDelete.id] || 0) + 1 }));
    }
    setConfirmDelete(null);
  };

  const confirmAndDelete = () => {
    if (!confirmDelete) return;
    if (pendingDelete) clearTimeout(pendingDelete.timerId);
    const { id, name } = confirmDelete;
    setConfirmDelete(null);
    const timerId = setTimeout(() => { onDelete(id); setPendingDelete(null); }, 4500);
    setPendingDelete({ id, name, timerId });
  };

  const undoDelete = () => {
    if (pendingDelete) { clearTimeout(pendingDelete.timerId); setPendingDelete(null); }
  };

  return (
    <div dir="rtl" style={{ fontFamily: "'Rubik', sans-serif", maxWidth: 480, margin: "0 auto", minHeight: "100vh", background: "linear-gradient(165deg, #FAFAFA 0%, #F0EDE8 100%)" }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #2D3436 0%, #636E72 100%)", padding: "48px 24px 32px", borderRadius: "0 0 32px 32px", boxShadow: "0 8px 32px rgba(0,0,0,0.12)", marginBottom: 24, position: "relative" }}>
        {onSignOut && (
          <button
            onClick={onSignOut}
            style={{
              position: "absolute",
              top: 16,
              left: 16,
              background: "rgba(255,255,255,0.12)",
              border: "none",
              borderRadius: 10,
              padding: "6px 12px",
              fontSize: 12,
              color: "rgba(255,255,255,0.75)",
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            התנתק ⏻
          </button>
        )}
        <p style={{ margin: "0 0 6px", fontSize: 14, color: "rgba(255,255,255,0.55)", fontWeight: 300 }}>👋 שלום, {userName}</p>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#fff" }}>הבתים שלי</h1>
        <p style={{ margin: "8px 0 0", fontSize: 14, color: "rgba(255,255,255,0.6)", fontWeight: 300 }}>בחר משק בית להיכנס אליו</p>
      </div>

      {/* List */}
      <div style={{ padding: "0 16px 32px" }}>
        {households.filter(h => h.id !== pendingDelete?.id).map((h, i) => {
          const col = HOUSE_COLORS[i % HOUSE_COLORS.length];
          return (
            <div key={h.id} style={{ marginBottom: 12 }}>
              <SwipeItem key={`${h.id}-${swipeResetKeys[h.id] || 0}`} onSwipeLeft={() => handleDelete(h.id, h.name)} borderRadius={20}>
                <div
                  onClick={() => onSelect(h.id, h.name)}
                  style={{
                    background: "#fff", borderRadius: 20, padding: "18px 20px",
                    boxShadow: "0 2px 12px rgba(0,0,0,0.06)", cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 16,
                  }}
                >
                  <div style={{ width: 52, height: 52, borderRadius: 16, background: col.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>🏠</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 17, fontWeight: 600, color: "#2D3436" }}>{h.name}</div>
                    <div style={{ fontSize: 13, color: "#AAA", marginTop: 2 }}>לחץ להיכנס</div>
                  </div>
                  <div style={{ color: "#CCC", fontSize: 22 }}>‹</div>
                </div>
              </SwipeItem>
            </div>
          );
        })}

        {/* Add household */}
        <button
          onClick={onAddHousehold}
          style={{
            width: "100%", border: "2px dashed #D5D0CA", background: "transparent",
            borderRadius: 20, padding: "18px 20px", cursor: "pointer",
            display: "flex", alignItems: "center", gap: 16, fontFamily: "inherit",
          }}
        >
          <div style={{ width: 52, height: 52, borderRadius: 16, background: "#F5F2EF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>➕</div>
          <div style={{ flex: 1, textAlign: "right" }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: "#888" }}>הוסף משק בית</div>
            <div style={{ fontSize: 13, color: "#BBB", marginTop: 2 }}>צור חדש או הצטרף לקיים</div>
          </div>
        </button>
      </div>

      {/* Confirm Delete Modal */}
      {confirmDelete && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={(e) => { if (e.target === e.currentTarget) cancelDelete(); }}>
          <div dir="rtl" style={{ background: "#fff", borderRadius: 24, padding: 28, width: "100%", maxWidth: 380, boxShadow: "0 16px 48px rgba(0,0,0,0.2)", animation: "slideUp 0.25s ease" }}>
            <div style={{ fontSize: 40, textAlign: "center", marginBottom: 12 }}>🗑️</div>
            <h3 style={{ margin: "0 0 10px", fontSize: 18, fontWeight: 700, color: "#2D3436", textAlign: "center" }}>מחיקת בית</h3>
            <p style={{ margin: "0 0 6px", fontSize: 14, color: "#636E72", textAlign: "center", lineHeight: 1.6 }}>
              האם אתה בטוח שברצונך למחוק את הבית
            </p>
            <p style={{ margin: "0 0 24px", fontSize: 16, fontWeight: 700, color: "#E53935", textAlign: "center" }}>
              "{confirmDelete.name}"?
            </p>
            <p style={{ margin: "0 0 24px", fontSize: 12, color: "#AAA", textAlign: "center", lineHeight: 1.5 }}>
              פעולה זו תמחק את כל הנתונים של הבית ולא ניתן לשחזרם.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={cancelDelete}
                style={{ flex: 1, border: "2px solid #E8E5E0", background: "#fff", color: "#636E72", borderRadius: 14, padding: "13px", fontSize: 15, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                ביטול
              </button>
              <button onClick={confirmAndDelete}
                style={{ flex: 1, border: "none", background: "linear-gradient(135deg, #E53935, #B71C1C)", color: "#fff", borderRadius: 14, padding: "13px", fontSize: 15, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                מחק לצמיתות
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Undo Delete Toast */}
      {pendingDelete && (
        <div style={{ position: "fixed", bottom: 32, left: "50%", transform: "translateX(-50%)", background: "#2D3436", color: "#fff", borderRadius: 14, padding: "12px 18px", display: "flex", alignItems: "center", gap: 14, zIndex: 60, boxShadow: "0 6px 24px rgba(0,0,0,0.3)", whiteSpace: "nowrap", animation: "slideUp 0.25s ease" }}>
          <span style={{ fontSize: 14 }}>🗑️ "{pendingDelete.name}" הוסר</span>
          <button onClick={undoDelete} style={{ background: "#636E72", border: "none", borderRadius: 8, padding: "6px 14px", color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>ביטול</button>
        </div>
      )}
    </div>
  );
}

// ─── HomeScreen ───────────────────────────────────────────────────────────────

function HomeScreen({ userName, householdName, inviteCode, inviteCodeExpiry, onRotateInvite, onNavigate, onSwitchHousehold, householdId, memberNames, currentUid, enabledModules = [], onToggleModule }) {
  const storageKey = `module-order-${householdId}`;
  const [showInvite, setShowInvite] = useState(false);
  const [showManageModules, setShowManageModules] = useState(false);
  const [moduleOrder, setModuleOrder] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        const ids = MODULES.map(m => m.id);
        const valid = parsed.filter(id => ids.includes(id));
        const missing = ids.filter(id => !valid.includes(id));
        return [...valid, ...missing];
      }
    } catch {}
    return MODULES.map(m => m.id);
  });

  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const [dragY, setDragY]         = useState(0);
  const listRef = useRef(null);
  const pRef    = useRef({ active: false, startY: 0, startIdx: 0, itemH: 88 });

  const orderedModules = moduleOrder
    .map(id => MODULES.find(m => m.id === id))
    .filter(Boolean)
    .filter(m => !m.optional || enabledModules.includes(m.id));

  const handleDragStart = (e, index) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (listRef.current?.children[index]) {
      pRef.current.itemH = listRef.current.children[index].offsetHeight + 12;
    }
    pRef.current = { ...pRef.current, active: true, startY: e.clientY, startIdx: index };
    setDragIndex(index); setOverIndex(index); setDragY(0);
  };

  const handleDragMove = (e) => {
    if (!pRef.current.active) return;
    const dy = e.clientY - pRef.current.startY;
    setDragY(dy);
    const moved   = Math.round(dy / pRef.current.itemH);
    const newOver = Math.max(0, Math.min(orderedModules.length - 1, pRef.current.startIdx + moved));
    setOverIndex(newOver);
  };

  const handleDragEnd = () => {
    if (!pRef.current.active) return;
    pRef.current.active = false;
    const from = pRef.current.startIdx;
    if (overIndex !== null && overIndex !== from) {
      const newOrder = [...moduleOrder];
      const [item] = newOrder.splice(from, 1);
      newOrder.splice(overIndex, 0, item);
      setModuleOrder(newOrder);
      localStorage.setItem(storageKey, JSON.stringify(newOrder));
    }
    setDragIndex(null); setOverIndex(null); setDragY(0);
  };

  const getShift = (i) => {
    if (dragIndex === null || overIndex === null || i === dragIndex) return 0;
    const h = pRef.current.itemH;
    if (dragIndex < overIndex && i > dragIndex && i <= overIndex) return -h;
    if (dragIndex > overIndex && i >= overIndex && i < dragIndex) return  h;
    return 0;
  };

  return (
    <div dir="rtl" style={{ fontFamily: "'Rubik', sans-serif", maxWidth: 480, margin: "0 auto", minHeight: "100vh", background: "linear-gradient(165deg, #FAFAFA 0%, #F0EDE8 100%)" }}>
      <div style={{ background: "linear-gradient(135deg, #2D3436 0%, #636E72 100%)", padding: "36px 24px 28px", borderRadius: "0 0 32px 32px", boxShadow: "0 8px 32px rgba(0,0,0,0.12)", marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <p style={{ margin: "0 0 6px", fontSize: 14, color: "rgba(255,255,255,0.55)", fontWeight: 300 }}>👋 שלום, {userName}</p>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#fff" }}>מה נפתח?</h1>
            {householdName && (
              <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, color: "rgba(255,255,255,0.75)", fontWeight: 400 }}>🏠 {householdName}</span>
              </div>
            )}
            {memberNames && Object.keys(memberNames).length > 0 && (
              <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6, maxWidth: 260 }}>
                {Object.entries(memberNames).map(([uid, name]) => {
                  const c = getUserColor(name);
                  const isMe = uid === currentUid;
                  return (
                    <div
                      key={uid}
                      title={isMe ? `${name} (את/ה)` : name}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        background: c.bg,
                        color: c.color,
                        borderRadius: 999,
                        padding: "3px 10px 3px 4px",
                        fontSize: 12,
                        fontWeight: 600,
                        border: isMe ? `1px solid ${c.color}` : "1px solid transparent",
                      }}
                    >
                      <div
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: "50%",
                          background: c.color,
                          color: "#fff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 11,
                          fontWeight: 700,
                          flexShrink: 0,
                        }}
                      >
                        {(name || "?").charAt(0)}
                      </div>
                      <span style={{ whiteSpace: "nowrap" }}>{name}{isMe ? " (את/ה)" : ""}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            {onSwitchHousehold && (
              <button onClick={onSwitchHousehold} style={{ background: "rgba(255,255,255,0.12)", border: "none", borderRadius: 10, padding: "8px 12px", fontSize: 12, color: "rgba(255,255,255,0.75)", fontFamily: "inherit", cursor: "pointer" }}>
                החלף 🔄
              </button>
            )}
            {inviteCode && (
              <button onClick={() => setShowInvite(true)} style={{ background: "rgba(255,255,255,0.15)", border: "none", borderRadius: 10, padding: "8px 12px", fontSize: 12, color: "#fff", fontFamily: "inherit", cursor: "pointer", fontWeight: 600 }}>
                הזמן +
              </button>
            )}
          </div>
        </div>
      </div>

      <div ref={listRef} style={{ padding: "0 16px 32px", display: "flex", flexDirection: "column", gap: 12 }}>
        {orderedModules.map((mod, index) => {
          const isDragging = dragIndex === index;
          const shift      = getShift(index);
          return (
            <div
              key={mod.id}
              style={{
                display: "flex", alignItems: "center",
                background: "#fff", borderRadius: 20,
                boxShadow: isDragging ? "0 16px 48px rgba(0,0,0,0.18)" : "0 2px 12px rgba(0,0,0,0.06)",
                opacity: mod.available ? 1 : 0.5,
                transform: isDragging ? `translateY(${dragY}px) scale(1.02)` : `translateY(${shift}px)`,
                transition: isDragging ? "box-shadow 0.15s" : "transform 0.2s ease, box-shadow 0.15s",
                zIndex: isDragging ? 10 : 1,
                position: "relative",
              }}
            >
              {/* ── Drag handle ── */}
              <div
                onPointerDown={(e) => handleDragStart(e, index)}
                onPointerMove={handleDragMove}
                onPointerUp={handleDragEnd}
                onPointerCancel={handleDragEnd}
                style={{ padding: "24px 6px 24px 18px", cursor: dragIndex !== null ? "grabbing" : "grab", touchAction: "none", userSelect: "none", color: "#CECECE", fontSize: 18, flexShrink: 0, lineHeight: 1 }}
              >
                ⠿
              </div>
              {/* ── Card content ── */}
              <div
                onClick={() => mod.available && onNavigate(mod.id)}
                style={{ flex: 1, display: "flex", alignItems: "center", gap: 16, padding: "20px 20px 20px 0", cursor: mod.available ? "pointer" : "default" }}
              >
                <div style={{ width: 58, height: 58, borderRadius: 16, background: mod.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, flexShrink: 0 }}>
                  {mod.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 17, fontWeight: 600, color: "#2D3436", marginBottom: 3 }}>{mod.label}</div>
                  <div style={{ fontSize: 13, color: "#AAA", fontWeight: 300 }}>{mod.available ? mod.desc : "בקרוב..."}</div>
                </div>
                {mod.available && <div style={{ color: "#CCC", fontSize: 20 }}>‹</div>}
              </div>
            </div>
          );
        })}

        {/* Manage modules button */}
        {MODULES.some(m => m.optional) && (
          <button
            onClick={() => setShowManageModules(true)}
            style={{
              width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              background: "#fff", border: "2px dashed #DDD", borderRadius: 20, padding: "16px",
              fontSize: 14, fontWeight: 600, color: "#888", fontFamily: "inherit", cursor: "pointer",
              marginTop: 4,
            }}
          >
            ⚙️ נהל מודולים
          </button>
        )}
      </div>

      {/* Manage modules bottom sheet */}
      {showManageModules && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={(e) => { if (e.target === e.currentTarget) setShowManageModules(false); }}>
          <div dir="rtl" style={{ background: "#fff", borderRadius: "24px 24px 0 0", padding: 28, width: "100%", maxWidth: 480, animation: "slideUp 0.3s ease" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#2D3436" }}>⚙️ מודולים אופציונליים</h3>
              <button onClick={() => setShowManageModules(false)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#999", lineHeight: 1 }}>✕</button>
            </div>
            <p style={{ margin: "0 0 20px", fontSize: 13, color: "#888" }}>הפעל מודולים נוספים עבור משק הבית</p>
            {MODULES.filter(m => m.optional).map(mod => {
              const isEnabled = enabledModules.includes(mod.id);
              return (
                <div key={mod.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 0", borderBottom: "1px solid #F0EDE8" }}>
                  <div style={{ width: 48, height: 48, borderRadius: 14, background: mod.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0 }}>
                    {mod.icon}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "#2D3436" }}>{mod.label}</div>
                    <div style={{ fontSize: 12, color: "#AAA" }}>{mod.desc}</div>
                  </div>
                  <button
                    onClick={() => onToggleModule && onToggleModule(mod.id, !isEnabled)}
                    style={{
                      width: 52, height: 28, borderRadius: 14, border: "none", cursor: "pointer",
                      background: isEnabled ? mod.color : "#DDD",
                      position: "relative", transition: "background 0.2s", flexShrink: 0,
                    }}
                  >
                    <div style={{
                      position: "absolute", top: 3, width: 22, height: 22, borderRadius: "50%",
                      background: "#fff", transition: "right 0.2s, left 0.2s",
                      right: isEnabled ? 3 : undefined,
                      left: isEnabled ? undefined : 3,
                      boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
                    }} />
                  </button>
                </div>
              );
            })}
            <div style={{ paddingBottom: 8 }} />
          </div>
        </div>
      )}

      {/* Invite modal */}
      {showInvite && (() => {
        const expired = isInviteExpired(inviteCodeExpiry);
        const expiryText = inviteCodeExpiry
          ? (expired ? "פג תוקף" : `תוקף עד ${formatExpiryDate(inviteCodeExpiry)}`)
          : "";
        const joinUrl = `https://grocery-app-livid-nu.vercel.app/?join=${inviteCode}`;
        const waMsg = `הי! הצטרף/י לבית "${householdName}" באפליקציה שלנו 🏠\nקוד הצטרפות: *${inviteCode}*\nלחיצה אחת להצטרפות:\n${joinUrl}`;
        const mailSubject = encodeURIComponent(`הזמנה להצטרף לבית "${householdName}"`);
        const mailBody = encodeURIComponent(`הי!\n\nהוזמנת להצטרף לבית "${householdName}" באפליקציה שלנו.\n\nלחיצה אחת להצטרפות:\n${joinUrl}\n\nאו פתח/י את האפליקציה והזן/י את הקוד: ${inviteCode}`);
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={(e) => { if (e.target === e.currentTarget) setShowInvite(false); }}>
            <div dir="rtl" style={{ background: "#fff", borderRadius: "24px 24px 0 0", padding: 28, width: "100%", maxWidth: 480, animation: "slideUp 0.3s ease" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#2D3436" }}>הזמן לבית</h3>
                <button onClick={() => setShowInvite(false)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#999", lineHeight: 1 }}>✕</button>
              </div>
              <p style={{ margin: "0 0 20px", fontSize: 14, color: "#888" }}>שתף את קוד ההצטרפות עם בני המשפחה</p>
              <div style={{ background: expired ? "#FFEBEE" : "#F5F2EF", borderRadius: 14, padding: "14px 20px", textAlign: "center", marginBottom: 12, border: expired ? "1px solid #EF9A9A" : "none" }}>
                <p style={{ margin: "0 0 4px", fontSize: 12, color: "#AAA" }}>קוד הצטרפות</p>
                <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: 8, color: expired ? "#C62828" : "#2D3436" }}>{inviteCode}</div>
                {expiryText && (
                  <p style={{ margin: "6px 0 0", fontSize: 12, color: expired ? "#C62828" : "#888", fontWeight: expired ? 600 : 400 }}>
                    {expired ? "⚠️ " : ""}{expiryText}
                  </p>
                )}
              </div>
              <button
                onClick={onRotateInvite}
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#fff", border: "1px solid #DDD", borderRadius: 12, padding: "10px", fontSize: 14, fontWeight: 600, color: "#555", fontFamily: "inherit", cursor: "pointer", marginBottom: 16 }}>
                <span style={{ fontSize: 16 }}>🔄</span> רענן קוד (תוקף ליום)
              </button>
              <div style={{ display: "flex", gap: 12 }}>
                <button
                  disabled={expired}
                  onClick={() => {
                    if (expired) return;
                    window.open(`https://wa.me/?text=${encodeURIComponent(waMsg)}`, "_blank");
                  }}
                  style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: expired ? "#CCC" : "#25D366", border: "none", borderRadius: 14, padding: "14px", fontSize: 15, fontWeight: 600, color: "#fff", fontFamily: "inherit", cursor: expired ? "not-allowed" : "pointer" }}>
                  <span style={{ fontSize: 20 }}>💬</span> WhatsApp
                </button>
                <button
                  disabled={expired}
                  onClick={() => {
                    if (expired) return;
                    window.open(`mailto:?subject=${mailSubject}&body=${mailBody}`, "_blank");
                  }}
                  style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: expired ? "#CCC" : "#EA4335", border: "none", borderRadius: 14, padding: "14px", fontSize: 15, fontWeight: 600, color: "#fff", fontFamily: "inherit", cursor: expired ? "not-allowed" : "pointer" }}>
                  <span style={{ fontSize: 20 }}>✉️</span> אימייל
                </button>
              </div>
              <div style={{ paddingBottom: 8 }} />
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── ShoppingScreen ───────────────────────────────────────────────────────────

function ShoppingScreen({ userName, householdId, onBack }) {
  const [items, setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [priority, setPriority]     = useState("yellow");
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [history, setHistory] = useState(() => { try { return JSON.parse(localStorage.getItem("grocery-history")) || []; } catch { return []; } });
  const inputRef = useRef(null);

  // Edit state
  const [editingItem, setEditingItem]         = useState(null);
  const [editItemName, setEditItemName]       = useState("");

  // Delete-all confirmation state
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [deleteAllConfirm, setDeleteAllConfirm] = useState("");
  const [editItemPriority, setEditItemPriority] = useState("yellow");

  // Undo-delete state
  const [pendingDelete, setPendingDelete] = useState(null);

  useEffect(() => {
    const q = query(collection(db, "households", householdId, "items"), orderBy("date", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => { setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); setLoading(false); },
      (err) => { console.error("items listener error:", err); setLoading(false); }
    );
    return () => unsub();
  }, [householdId]);

  useEffect(() => { localStorage.setItem("grocery-history", JSON.stringify(history)); }, [history]);
  useEffect(() => { if (showAdd && inputRef.current) inputRef.current.focus(); }, [showAdd]);

  const deleteAllItems = async () => {
    try {
      const snap = await getDocs(collection(db, "households", householdId, "items"));
      await Promise.all(snap.docs.map(d => deleteDoc(doc(db, "households", householdId, "items", d.id))));
    } catch (e) { console.error("Error deleting all items:", e); }
    setShowDeleteAll(false);
    setDeleteAllConfirm("");
  };

  const addItem = async () => {
    const name = inputValue.trim();
    if (!name) return;
    try {
      await addDoc(collection(db, "households", householdId, "items"), { name, priority, addedBy: userName, date: new Date().toISOString() });
      if (!history.includes(name)) setHistory((p) => [...p, name]);
    } catch (e) { console.error("Error adding item:", e); }
    setInputValue(""); setPriority("yellow"); setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const removeItem = (id, itemData) => {
    const timerId = setTimeout(async () => {
      try { await deleteDoc(doc(db, "households", householdId, "items", id)); } catch (e) { console.error(e); }
      setPendingDelete(null);
    }, 4500);
    setPendingDelete({ id, item: itemData, timerId });
  };

  const undoDelete = () => {
    if (pendingDelete) { clearTimeout(pendingDelete.timerId); setPendingDelete(null); }
  };

  const openEditItem = (item) => { setEditingItem(item); setEditItemName(item.name); setEditItemPriority(item.priority); };
  const closeEditItem = () => setEditingItem(null);
  const updateItem = async () => {
    if (!editItemName.trim()) return;
    try { await updateDoc(doc(db, "households", householdId, "items", editingItem.id), { name: editItemName.trim(), priority: editItemPriority }); closeEditItem(); }
    catch (e) { console.error("Error updating item:", e); }
  };

  const onInput = (val) => {
    setInputValue(val);
    if (val.trim()) { const f = history.filter((h) => h.includes(val.trim()) && h !== val.trim()); setSuggestions(f.slice(0,5)); setShowSuggestions(f.length > 0); }
    else setShowSuggestions(false);
  };

  const sorted = [...items]
    .filter((item) => item.id !== pendingDelete?.id)
    .sort((a, b) => ({ red:0, yellow:1, green:2 }[a.priority] - { red:0, yellow:1, green:2 }[b.priority]));

  if (loading) return <Loader />;

  return (
    <div dir="rtl" style={{ fontFamily: "'Rubik', sans-serif", maxWidth: 480, margin: "0 auto", minHeight: "100vh", background: "linear-gradient(165deg, #FAFAFA 0%, #F0EDE8 100%)", position: "relative" }}>
      <div style={{ background: "linear-gradient(135deg, #2D3436 0%, #636E72 100%)", padding: "28px 24px 20px", borderRadius: "0 0 28px 28px", boxShadow: "0 8px 32px rgba(0,0,0,0.12)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: "#fff" }}>🛒 רשימת קניות</h1>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "rgba(255,255,255,0.6)", fontWeight: 300 }}>{items.length} פריטים ברשימה</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {items.length > 0 && (
              <button onClick={() => { setShowDeleteAll(true); setDeleteAllConfirm(""); }} style={{ background: "rgba(255,255,255,0.15)", border: "none", borderRadius: 12, padding: "8px 12px", cursor: "pointer", color: "#fff", fontSize: 18, lineHeight: 1 }}>🗑️</button>
            )}
            <BackButton onBack={onBack} />
          </div>
        </div>
      </div>

      <div style={{ padding: "16px 16px 100px" }}>
        {showAdd && (
          <div style={{ background: "#fff", borderRadius: 20, padding: 20, marginBottom: 16, boxShadow: "0 4px 20px rgba(0,0,0,0.06)", animation: "slideDown 0.3s ease" }}>
            <div style={{ position: "relative" }}>
              <input ref={inputRef} value={inputValue} onChange={(e) => onInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addItem()} placeholder="מה צריך לקנות?"
                style={inputStyle} onFocus={(e) => (e.target.style.borderColor = "#636E72")} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
              {showSuggestions && (
                <div style={{ position: "absolute", top: "100%", right: 0, left: 0, background: "#fff", borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.1)", zIndex: 10, marginTop: 4, overflow: "hidden" }}>
                  {suggestions.map((s, i) => (
                    <div key={i} onClick={() => { setInputValue(s); setShowSuggestions(false); }} style={{ padding: "12px 16px", cursor: "pointer", fontSize: 15, borderBottom: i < suggestions.length-1 ? "1px solid #f0f0f0" : "none" }}>🔄 {s}</div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ marginTop: 14 }}>
              <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 500, color: "#888" }}>רמת דחיפות:</p>
              <div style={{ display: "flex", gap: 8 }}>
                {Object.entries(PRIORITY_CONFIG).map(([key, cfg]) => (
                  <button key={key} onClick={() => setPriority(key)}
                    style={{ flex: 1, border: priority===key ? `2px solid ${cfg.color}` : "2px solid #E8E5E0", background: priority===key ? cfg.bg : "#FAFAFA", borderRadius: 12, padding: "10px 8px", cursor: "pointer", fontSize: 13, fontFamily: "inherit", fontWeight: priority===key ? 600 : 400, color: priority===key ? cfg.color : "#999", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                    {cfg.icon} {cfg.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button onClick={addItem} disabled={!inputValue.trim()}
                style={{ flex: 1, border: "none", background: inputValue.trim() ? "linear-gradient(135deg, #2D3436, #636E72)" : "#ccc", color: "#fff", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 600, fontFamily: "inherit", cursor: inputValue.trim() ? "pointer" : "default" }}>
                הוסף לרשימה ✓
              </button>
              <button onClick={() => { setShowAdd(false); setInputValue(""); setShowSuggestions(false); }}
                style={{ border: "2px solid #E8E5E0", background: "#fff", color: "#999", borderRadius: 12, padding: "14px 20px", fontSize: 15, fontFamily: "inherit", cursor: "pointer" }}>✕</button>
            </div>
          </div>
        )}

        {items.length > 0 && <p style={{ textAlign: "center", fontSize: 12, color: "#BBB", margin: "8px 0 12px", fontWeight: 300 }}>עריכה → | ← מחיקה</p>}

        {sorted.length === 0 && !showAdd && (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>🛒</div>
            <p style={{ fontSize: 18, color: "#999", fontWeight: 300 }}>הרשימה ריקה</p>
            <p style={{ fontSize: 14, color: "#CCC", fontWeight: 300, marginTop: 4 }}>לחצו על + כדי להוסיף פריטים</p>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sorted.map((item) => {
            const cfg = PRIORITY_CONFIG[item.priority];
            return (
              <SwipeItem key={item.id} onSwipeLeft={() => removeItem(item.id, item)} onSwipeRight={() => openEditItem(item)}>
                <div style={{ background: "#fff", borderRadius: 16, padding: "16px 18px", display: "flex", alignItems: "center", gap: 14, boxShadow: "0 2px 8px rgba(0,0,0,0.04)", borderRight: `4px solid ${cfg.color}` }}>
                  <div style={{ width: 40, height: 40, borderRadius: 12, background: cfg.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{cfg.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 16, fontWeight: 500, color: "#2D3436" }}>{item.name}</p>
                    <div style={{ display: "flex", gap: 12, marginTop: 4, alignItems: "center" }}>
                      <span style={{ fontSize: 12, color: "#AAA", fontWeight: 300 }}>📅 {formatDate(item.date)}</span>
                      <span style={{ fontSize: 12, color: getUserColor(item.addedBy).color, fontWeight: 500 }}>👤 {item.addedBy}</span>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: cfg.color, background: cfg.bg, padding: "4px 10px", borderRadius: 8, flexShrink: 0 }}>{cfg.label}</div>
                </div>
              </SwipeItem>
            );
          })}
        </div>
      </div>

      {!showAdd && <FAB onClick={() => setShowAdd(true)} color="linear-gradient(135deg, #2D3436, #636E72)" shadow="rgba(45,52,54,0.35)" />}

      {/* ── Undo Delete Toast ── */}
      {pendingDelete && (
        <div style={{ position: "fixed", bottom: 104, left: "50%", transform: "translateX(-50%)", background: "#2D3436", color: "#fff", borderRadius: 14, padding: "12px 18px", display: "flex", alignItems: "center", gap: 14, zIndex: 60, boxShadow: "0 6px 24px rgba(0,0,0,0.3)", whiteSpace: "nowrap", animation: "slideUp 0.25s ease" }}>
          <span style={{ fontSize: 14 }}>🗑️ "{pendingDelete.item.name}" נמחק</span>
          <button onClick={undoDelete} style={{ background: "#636E72", border: "none", borderRadius: 8, padding: "6px 14px", color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>ביטול</button>
        </div>
      )}

      {/* ── Edit Item Modal ── */}
      {editingItem && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={(e) => { if (e.target === e.currentTarget) closeEditItem(); }}>
          <div dir="rtl" style={{ background: "#fff", borderRadius: "24px 24px 0 0", padding: 24, width: "100%", maxWidth: 480, animation: "slideUp 0.3s ease" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: "#2D3436" }}>✏️ עריכת פריט</h3>
              <button onClick={closeEditItem} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#999", lineHeight: 1 }}>✕</button>
            </div>
            <input value={editItemName} onChange={(e) => setEditItemName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && updateItem()} placeholder="שם הפריט" autoFocus
              style={inputStyle} onFocus={(e) => (e.target.style.borderColor = "#636E72")} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
            <div style={{ marginTop: 14 }}>
              <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 500, color: "#888" }}>רמת דחיפות:</p>
              <div style={{ display: "flex", gap: 8 }}>
                {Object.entries(PRIORITY_CONFIG).map(([key, cfg]) => (
                  <button key={key} onClick={() => setEditItemPriority(key)}
                    style={{ flex: 1, border: editItemPriority===key ? `2px solid ${cfg.color}` : "2px solid #E8E5E0", background: editItemPriority===key ? cfg.bg : "#FAFAFA", borderRadius: 12, padding: "10px 8px", cursor: "pointer", fontSize: 13, fontFamily: "inherit", fontWeight: editItemPriority===key ? 600 : 400, color: editItemPriority===key ? cfg.color : "#999", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                    {cfg.icon} {cfg.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16, paddingBottom: 8 }}>
              <button onClick={updateItem} disabled={!editItemName.trim()}
                style={{ flex: 1, border: "none", background: editItemName.trim() ? "linear-gradient(135deg, #2D3436, #636E72)" : "#ccc", color: "#fff", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 600, fontFamily: "inherit", cursor: editItemName.trim() ? "pointer" : "default" }}>
                שמור שינויים ✓
              </button>
              <button onClick={closeEditItem}
                style={{ border: "2px solid #E8E5E0", background: "#fff", color: "#999", borderRadius: 12, padding: "14px 20px", fontSize: 15, fontFamily: "inherit", cursor: "pointer" }}>✕</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete All Confirmation Modal ── */}
      {showDeleteAll && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={(e) => { if (e.target === e.currentTarget) { setShowDeleteAll(false); setDeleteAllConfirm(""); } }}>
          <div dir="rtl" style={{ background: "#fff", borderRadius: "24px 24px 0 0", padding: 24, width: "100%", maxWidth: 480, animation: "slideUp 0.3s ease" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: "#E53935" }}>🗑️ מחיקת כל הפריטים</h3>
              <button onClick={() => { setShowDeleteAll(false); setDeleteAllConfirm(""); }} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#999", lineHeight: 1 }}>✕</button>
            </div>
            <p style={{ margin: "0 0 16px", fontSize: 14, color: "#666", lineHeight: 1.5 }}>פעולה זו תמחק את כל {items.length} הפריטים ברשימה ולא ניתן לשחזר אותם.<br/>כדי לאשר, הקלד <strong>מחק</strong> בתיבה:</p>
            <input
              value={deleteAllConfirm}
              onChange={(e) => setDeleteAllConfirm(e.target.value)}
              placeholder="מחק"
              autoFocus
              style={{ ...inputStyle, marginBottom: 16 }}
              onFocus={(e) => (e.target.style.borderColor = "#E53935")}
              onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")}
            />
            <div style={{ display: "flex", gap: 8, paddingBottom: 8 }}>
              <button
                onClick={deleteAllItems}
                disabled={deleteAllConfirm !== "מחק"}
                style={{ flex: 1, border: "none", background: deleteAllConfirm === "מחק" ? "#E53935" : "#ccc", color: "#fff", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 600, fontFamily: "inherit", cursor: deleteAllConfirm === "מחק" ? "pointer" : "default" }}>
                מחק
              </button>
              <button onClick={() => { setShowDeleteAll(false); setDeleteAllConfirm(""); }}
                style={{ border: "2px solid #E8E5E0", background: "#fff", color: "#999", borderRadius: 12, padding: "14px 20px", fontSize: 15, fontFamily: "inherit", cursor: "pointer" }}>ביטול</button>
            </div>
          </div>
        </div>
      )}

      <GlobalStyles />
    </div>
  );
}

// ─── CouponsScreen ────────────────────────────────────────────────────────────

function CouponsScreen({ userName, householdId, onBack }) {
  const [coupons, setCoupons]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [showAdd, setShowAdd]   = useState(false);
  const [title, setTitle]       = useState("");
  const [code, setCode]         = useState("");
  const [url, setUrl]           = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [file, setFile]         = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [fileError, setFileError]         = useState(null);
  const [editFileError, setEditFileError] = useState(null);
  const fileInputRef = useRef(null);

  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

  // Undo-delete state
  const [pendingDelete, setPendingDelete] = useState(null);

  // Delete-all confirmation state
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [deleteAllConfirm, setDeleteAllConfirm] = useState("");

  const [lightboxSrc, setLightboxSrc] = useState(null);

  // Edit state
  const [editingCoupon, setEditingCoupon]     = useState(null);
  const [editTitle, setEditTitle]             = useState("");
  const [editCode, setEditCode]               = useState("");
  const [editUrl, setEditUrl]                 = useState("");
  const [editExpiryDate, setEditExpiryDate]   = useState("");
  const [editFile, setEditFile]               = useState(null);
  const [editFilePreview, setEditFilePreview] = useState(null);
  const [editUploading, setEditUploading]     = useState(false);
  const editFileInputRef = useRef(null);

  useEffect(() => {
    const q = query(collection(db, "households", householdId, "coupons"), orderBy("date", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => { setCoupons(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); setLoading(false); },
      (err) => { console.error("coupons listener error:", err); setLoading(false); }
    );
    return () => unsub();
  }, [householdId]);

  const handleFileChange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > MAX_FILE_SIZE) {
      setFileError(`הקובץ גדול מדי (${(f.size / 1024 / 1024).toFixed(1)}MB) — מקסימום 5MB`);
      e.target.value = "";
      return;
    }
    setFileError(null);
    setFile(f);
    if (f.type.startsWith("image/")) { const r = new FileReader(); r.onload = (ev) => setFilePreview(ev.target.result); r.readAsDataURL(f); }
    else setFilePreview("pdf");
  };

  const resetForm = () => { setTitle(""); setCode(""); setUrl(""); setExpiryDate(""); setFile(null); setFilePreview(null); setFileError(null); setShowAdd(false); };

  const addCoupon = async () => {
    if (!title.trim()) return;
    setUploading(true);
    try {
      let imageUrl = "", imagePath = "";
      if (file) {
        imagePath = `households/${householdId}/coupons/${Date.now()}_${file.name}`;
        const storageRef = ref(storage, imagePath);
        await uploadBytes(storageRef, file, { contentType: file.type });
        imageUrl = await getDownloadURL(storageRef);
      }
      await addDoc(collection(db, "households", householdId, "coupons"), { title: title.trim(), code: code.trim(), url: url.trim(), expiryDate, imageUrl, imagePath, fileType: file ? file.type : "", addedBy: userName, date: new Date().toISOString() });
      resetForm();
    } catch (e) { console.error("Error adding coupon:", e); }
    setUploading(false);
  };

  const removeCoupon = (id, couponData) => {
    const timerId = setTimeout(async () => {
      try { await deleteDoc(doc(db, "households", householdId, "coupons", id)); } catch (e) { console.error(e); }
      setPendingDelete(null);
    }, 4500);
    setPendingDelete({ id, coupon: couponData, timerId });
  };

  const undoDelete = () => {
    if (pendingDelete) { clearTimeout(pendingDelete.timerId); setPendingDelete(null); }
  };

  const deleteAllCoupons = async () => {
    try {
      const snap = await getDocs(collection(db, "households", householdId, "coupons"));
      await Promise.all(snap.docs.map(d => deleteDoc(doc(db, "households", householdId, "coupons", d.id))));
    } catch (e) { console.error("Error deleting all coupons:", e); }
    setShowDeleteAll(false);
    setDeleteAllConfirm("");
  };

  const copyCode = (id, c) => { navigator.clipboard.writeText(c).then(() => { setCopiedId(id); setTimeout(() => setCopiedId(null), 2000); }); };

  const openEdit = (coupon) => {
    setEditingCoupon(coupon);
    setEditTitle(coupon.title || "");
    setEditCode(coupon.code || "");
    setEditUrl(coupon.url || "");
    setEditExpiryDate(coupon.expiryDate || "");
    setEditFile(null);
    setEditFilePreview(coupon.imageUrl || null);
  };

  const closeEdit = () => { setEditingCoupon(null); setEditFile(null); setEditFilePreview(null); setEditFileError(null); };

  const handleEditFileChange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > MAX_FILE_SIZE) {
      setEditFileError(`הקובץ גדול מדי (${(f.size / 1024 / 1024).toFixed(1)}MB) — מקסימום 5MB`);
      e.target.value = "";
      return;
    }
    setEditFileError(null);
    setEditFile(f);
    if (f.type.startsWith("image/")) { const r = new FileReader(); r.onload = (ev) => setEditFilePreview(ev.target.result); r.readAsDataURL(f); }
    else setEditFilePreview("pdf");
  };

  const updateCoupon = async () => {
    if (!editTitle.trim()) return;
    setEditUploading(true);
    try {
      let imageUrl  = editingCoupon.imageUrl  || "";
      let imagePath = editingCoupon.imagePath || "";
      if (editFile) {
        imagePath = `households/${householdId}/coupons/${Date.now()}_${editFile.name}`;
        const storageRef = ref(storage, imagePath);
        await uploadBytes(storageRef, editFile, { contentType: editFile.type });
        imageUrl = await getDownloadURL(storageRef);
      }
      await updateDoc(doc(db, "households", householdId, "coupons", editingCoupon.id), {
        title: editTitle.trim(),
        code: editCode.trim(),
        url: editUrl.trim(),
        expiryDate: editExpiryDate,
        imageUrl,
        imagePath,
        fileType: editFile ? editFile.type : (editingCoupon.fileType || ""),
      });
      closeEdit();
    } catch (e) { console.error("Error updating coupon:", e); }
    setEditUploading(false);
  };

  const sorted = [...coupons]
    .filter((c) => c.id !== pendingDelete?.id)
    .sort((a, b) => {
      const rank = (c) => { if (!c.expiryDate) return 1; const d = new Date(c.expiryDate)-new Date(); return d < 0 ? 3 : d < 604800000 ? 2 : 1; };
      return rank(a) - rank(b);
    });

  if (loading) return <Loader />;

  return (
    <div dir="rtl" style={{ fontFamily: "'Rubik', sans-serif", maxWidth: 480, margin: "0 auto", minHeight: "100vh", background: "linear-gradient(165deg, #FAFAFA 0%, #F0EDE8 100%)" }}>
      <div style={{ background: "linear-gradient(135deg, #8E44AD 0%, #6C3483 100%)", padding: "28px 24px 20px", borderRadius: "0 0 28px 28px", boxShadow: "0 8px 32px rgba(142,68,173,0.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: "#fff" }}>🎟️ שוברים</h1>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "rgba(255,255,255,0.6)", fontWeight: 300 }}>{coupons.length} שוברים שמורים</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {coupons.length > 0 && (
              <button onClick={() => { setShowDeleteAll(true); setDeleteAllConfirm(""); }} style={{ background: "rgba(255,255,255,0.15)", border: "none", borderRadius: 12, padding: "8px 12px", cursor: "pointer", color: "#fff", fontSize: 18, lineHeight: 1 }}>🗑️</button>
            )}
            <BackButton onBack={onBack} light />
          </div>
        </div>
      </div>

      <div style={{ padding: "16px 16px 100px" }}>
        {showAdd && (
          <div style={{ background: "#fff", borderRadius: 20, padding: 20, marginBottom: 16, boxShadow: "0 4px 20px rgba(0,0,0,0.08)", animation: "slideDown 0.3s ease" }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 600, color: "#2D3436" }}>שובר חדש</h3>

            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="שם החנות / תיאור *"
              style={inputStyle} onFocus={(e) => (e.target.style.borderColor = "#8E44AD")} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />

            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="קוד השובר (אופציונלי)"
              style={{ ...inputStyle, marginTop: 10, letterSpacing: 1 }} onFocus={(e) => (e.target.style.borderColor = "#8E44AD")} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />

            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="קישור לשובר (אופציונלי)" type="url" dir="ltr"
              style={{ ...inputStyle, marginTop: 10 }} onFocus={(e) => (e.target.style.borderColor = "#8E44AD")} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />

            <div style={{ marginTop: 10 }}>
              <p style={{ margin: "0 0 6px", fontSize: 13, color: "#888" }}>תאריך תפוגה (אופציונלי)</p>
              <input value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} type="date"
                style={{ ...inputStyle, color: expiryDate ? "#2D3436" : "#CCC" }} onFocus={(e) => (e.target.style.borderColor = "#8E44AD")} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
            </div>

            <div style={{ marginTop: 10 }}>
              <input ref={fileInputRef} type="file" accept="image/*,application/pdf" onChange={handleFileChange} style={{ display: "none" }} />
              {filePreview ? (
                <div style={{ position: "relative" }}>
                  {filePreview === "pdf"
                    ? <div style={{ background: "#F5EEF8", borderRadius: 12, padding: 16, textAlign: "center", color: "#8E44AD", fontSize: 14 }}>📄 {file.name}</div>
                    : <img src={filePreview} alt="preview" style={{ width: "100%", borderRadius: 12, maxHeight: 160, objectFit: "cover" }} />
                  }
                  <button onClick={() => { setFile(null); setFilePreview(null); }}
                    style={{ position: "absolute", top: 8, left: 8, background: "rgba(0,0,0,0.5)", color: "#fff", border: "none", borderRadius: "50%", width: 28, height: 28, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
                </div>
              ) : (
                <button onClick={() => fileInputRef.current.click()}
                  style={{ width: "100%", border: `2px dashed ${fileError ? "#E53935" : "#E8E5E0"}`, background: fileError ? "#FFF5F5" : "#FAFAFA", borderRadius: 12, padding: 16, cursor: "pointer", fontSize: 14, color: fileError ? "#E53935" : "#AAA", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  📎 צרף תמונה או PDF (אופציונלי)
                </button>
              )}
              {fileError && <p style={{ margin: "6px 0 0", fontSize: 12, color: "#E53935", fontWeight: 500 }}>⚠️ {fileError}</p>}
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={addCoupon} disabled={!title.trim() || uploading}
                style={{ flex: 1, border: "none", background: title.trim() && !uploading ? "linear-gradient(135deg, #8E44AD, #6C3483)" : "#ccc", color: "#fff", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 600, fontFamily: "inherit", cursor: title.trim() && !uploading ? "pointer" : "default" }}>
                {uploading ? "מעלה..." : "שמור שובר ✓"}
              </button>
              <button onClick={resetForm}
                style={{ border: "2px solid #E8E5E0", background: "#fff", color: "#999", borderRadius: 12, padding: "14px 20px", fontSize: 15, fontFamily: "inherit", cursor: "pointer" }}>✕</button>
            </div>
          </div>
        )}

        {sorted.length === 0 && !showAdd && (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>🎟️</div>
            <p style={{ fontSize: 18, color: "#999", fontWeight: 300 }}>אין שוברים שמורים</p>
            <p style={{ fontSize: 14, color: "#CCC", fontWeight: 300, marginTop: 4 }}>לחצו על + כדי להוסיף שובר</p>
          </div>
        )}

        {sorted.length > 0 && <p style={{ textAlign: "center", fontSize: 12, color: "#BBB", margin: "8px 0 12px", fontWeight: 300 }}>עריכה → | ← מחיקה</p>}

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {sorted.map((coupon) => {
            const expiry    = getExpiryStatus(coupon.expiryDate);
            const uc        = getUserColor(coupon.addedBy);
            const isExpired = expiry && new Date(coupon.expiryDate) < new Date();
            return (
              <SwipeItem key={coupon.id} borderRadius={18} onSwipeLeft={() => removeCoupon(coupon.id, coupon)} onSwipeRight={() => openEdit(coupon)}>
                <div style={{ background: "#fff", borderRadius: 18, overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,0.06)", opacity: isExpired ? 0.6 : 1 }}>
                  {coupon.imageUrl && (
                    coupon.fileType === "application/pdf" || coupon.imagePath?.toLowerCase().endsWith(".pdf") ? (
                      <a href={coupon.imageUrl} target="_blank" rel="noopener noreferrer"
                        style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, height: 72, background: "#F5EEF8", textDecoration: "none" }}>
                        <span style={{ fontSize: 26 }}>📄</span>
                        <span style={{ color: "#8E44AD", fontWeight: 600, fontSize: 14 }}>פתח PDF</span>
                        <span style={{ fontSize: 12, color: "#B39DDB" }}>↗</span>
                      </a>
                    ) : (
                      <img src={coupon.imageUrl} alt={coupon.title} onClick={(e) => { e.stopPropagation(); setLightboxSrc(coupon.imageUrl); }} style={{ width: "100%", height: 140, objectFit: "cover", cursor: "zoom-in" }} />
                    )
                  )}
                  <div style={{ padding: "14px 16px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                      <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#2D3436", flex: 1 }}>🎟️ {coupon.title}</p>
                      {expiry && <span style={{ fontSize: 11, fontWeight: 600, color: expiry.color, background: expiry.bg, padding: "3px 8px", borderRadius: 8, flexShrink: 0 }}>⏱ {expiry.label}</span>}
                    </div>

                    {coupon.code && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, background: "#F5EEF8", borderRadius: 10, padding: "8px 12px" }}>
                        <span style={{ flex: 1, fontSize: 15, fontWeight: 700, color: "#8E44AD", letterSpacing: 1, direction: "ltr" }}>{coupon.code}</span>
                        <button onClick={() => copyCode(coupon.id, coupon.code)}
                          style={{ background: copiedId===coupon.id ? "#8E44AD" : "transparent", border: "none", borderRadius: 6, padding: "4px 8px", fontSize: 12, color: copiedId===coupon.id ? "#fff" : "#8E44AD", cursor: "pointer", fontFamily: "inherit", fontWeight: 500, transition: "all 0.2s" }}>
                          {copiedId===coupon.id ? "✓ הועתק" : "העתק"}
                        </button>
                      </div>
                    )}

                    {coupon.url && (
                      <a href={coupon.url} target="_blank" rel="noopener noreferrer"
                        style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 13, color: "#2980B9", textDecoration: "none" }}>
                        🔗 <span style={{ direction: "ltr", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{coupon.url}</span>
                      </a>
                    )}

                    <div style={{ display: "flex", gap: 12, marginTop: 10, alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: "#CCC" }}>📅 {formatDate(coupon.date)}</span>
                      <span style={{ fontSize: 11, color: uc.color, fontWeight: 500 }}>👤 {coupon.addedBy}</span>
                    </div>
                  </div>
                </div>
              </SwipeItem>
            );
          })}
        </div>
      </div>

      {!showAdd && <FAB onClick={() => setShowAdd(true)} color="linear-gradient(135deg, #8E44AD, #6C3483)" shadow="rgba(142,68,173,0.4)" />}

      {/* ── Undo Delete Toast ── */}
      {pendingDelete && (
        <div style={{ position: "fixed", bottom: 104, left: "50%", transform: "translateX(-50%)", background: "#2D3436", color: "#fff", borderRadius: 14, padding: "12px 18px", display: "flex", alignItems: "center", gap: 14, zIndex: 60, boxShadow: "0 6px 24px rgba(0,0,0,0.3)", whiteSpace: "nowrap", animation: "slideUp 0.25s ease" }}>
          <span style={{ fontSize: 14 }}>🗑️ "{pendingDelete.coupon.title}" נמחק</span>
          <button onClick={undoDelete} style={{ background: "#8E44AD", border: "none", borderRadius: 8, padding: "6px 14px", color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>ביטול</button>
        </div>
      )}

      {/* ── Edit Modal ── */}
      {editingCoupon && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={(e) => { if (e.target === e.currentTarget) closeEdit(); }}>
          <div dir="rtl" style={{ background: "#fff", borderRadius: "24px 24px 0 0", padding: 24, width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto", animation: "slideUp 0.3s ease" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: "#2D3436" }}>✏️ עריכת שובר</h3>
              <button onClick={closeEdit} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#999", lineHeight: 1 }}>✕</button>
            </div>

            <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="שם החנות / תיאור *"
              style={inputStyle} onFocus={(e) => (e.target.style.borderColor = "#8E44AD")} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />

            <input value={editCode} onChange={(e) => setEditCode(e.target.value)} placeholder="קוד השובר (אופציונלי)"
              style={{ ...inputStyle, marginTop: 10, letterSpacing: 1 }} onFocus={(e) => (e.target.style.borderColor = "#8E44AD")} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />

            <input value={editUrl} onChange={(e) => setEditUrl(e.target.value)} placeholder="קישור לשובר (אופציונלי)" type="url" dir="ltr"
              style={{ ...inputStyle, marginTop: 10 }} onFocus={(e) => (e.target.style.borderColor = "#8E44AD")} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />

            <div style={{ marginTop: 10 }}>
              <p style={{ margin: "0 0 6px", fontSize: 13, color: "#888" }}>תאריך תפוגה (אופציונלי)</p>
              <input value={editExpiryDate} onChange={(e) => setEditExpiryDate(e.target.value)} type="date"
                style={{ ...inputStyle, color: editExpiryDate ? "#2D3436" : "#CCC" }} onFocus={(e) => (e.target.style.borderColor = "#8E44AD")} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
            </div>

            <div style={{ marginTop: 10 }}>
              <input ref={editFileInputRef} type="file" accept="image/*,application/pdf" onChange={handleEditFileChange} style={{ display: "none" }} />
              {editFilePreview ? (
                <div style={{ position: "relative" }}>
                  {editFilePreview === "pdf"
                    ? <div style={{ background: "#F5EEF8", borderRadius: 12, padding: 16, textAlign: "center", color: "#8E44AD", fontSize: 14 }}>📄 {editFile ? editFile.name : "קובץ מצורף"}</div>
                    : <img src={editFilePreview} alt="preview" style={{ width: "100%", borderRadius: 12, maxHeight: 160, objectFit: "cover" }} />
                  }
                  <button onClick={() => { setEditFile(null); setEditFilePreview(null); }}
                    style={{ position: "absolute", top: 8, left: 8, background: "rgba(0,0,0,0.5)", color: "#fff", border: "none", borderRadius: "50%", width: 28, height: 28, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
                </div>
              ) : (
                <button onClick={() => editFileInputRef.current.click()}
                  style={{ width: "100%", border: `2px dashed ${editFileError ? "#E53935" : "#E8E5E0"}`, background: editFileError ? "#FFF5F5" : "#FAFAFA", borderRadius: 12, padding: 16, cursor: "pointer", fontSize: 14, color: editFileError ? "#E53935" : "#AAA", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  📎 צרף תמונה או PDF (אופציונלי)
                </button>
              )}
              {editFileError && <p style={{ margin: "6px 0 0", fontSize: 12, color: "#E53935", fontWeight: 500 }}>⚠️ {editFileError}</p>}
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 16, paddingBottom: 8 }}>
              <button onClick={updateCoupon} disabled={!editTitle.trim() || editUploading}
                style={{ flex: 1, border: "none", background: editTitle.trim() && !editUploading ? "linear-gradient(135deg, #8E44AD, #6C3483)" : "#ccc", color: "#fff", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 600, fontFamily: "inherit", cursor: editTitle.trim() && !editUploading ? "pointer" : "default" }}>
                {editUploading ? "שומר..." : "שמור שינויים ✓"}
              </button>
              <button onClick={closeEdit}
                style={{ border: "2px solid #E8E5E0", background: "#fff", color: "#999", borderRadius: 12, padding: "14px 20px", fontSize: 15, fontFamily: "inherit", cursor: "pointer" }}>✕</button>
            </div>
          </div>
        </div>
      )}

      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />

      {/* ── Delete All Confirmation Modal ── */}
      {showDeleteAll && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={(e) => { if (e.target === e.currentTarget) { setShowDeleteAll(false); setDeleteAllConfirm(""); } }}>
          <div dir="rtl" style={{ background: "#fff", borderRadius: "24px 24px 0 0", padding: 24, width: "100%", maxWidth: 480, animation: "slideUp 0.3s ease" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: "#E53935" }}>🗑️ מחיקת כל השוברים</h3>
              <button onClick={() => { setShowDeleteAll(false); setDeleteAllConfirm(""); }} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#999", lineHeight: 1 }}>✕</button>
            </div>
            <p style={{ margin: "0 0 16px", fontSize: 14, color: "#666", lineHeight: 1.5 }}>פעולה זו תמחק את כל {coupons.length} השוברים ולא ניתן לשחזר אותם.<br/>כדי לאשר, הקלד <strong>מחק</strong> בתיבה:</p>
            <input value={deleteAllConfirm} onChange={(e) => setDeleteAllConfirm(e.target.value)} placeholder="מחק" autoFocus
              style={{ ...inputStyle, marginBottom: 16 }}
              onFocus={(e) => (e.target.style.borderColor = "#E53935")} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
            <div style={{ display: "flex", gap: 8, paddingBottom: 8 }}>
              <button onClick={deleteAllCoupons} disabled={deleteAllConfirm !== "מחק"}
                style={{ flex: 1, border: "none", background: deleteAllConfirm === "מחק" ? "#E53935" : "#ccc", color: "#fff", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 600, fontFamily: "inherit", cursor: deleteAllConfirm === "מחק" ? "pointer" : "default" }}>
                מחק הכל
              </button>
              <button onClick={() => { setShowDeleteAll(false); setDeleteAllConfirm(""); }}
                style={{ border: "2px solid #E8E5E0", background: "#fff", color: "#999", borderRadius: 12, padding: "14px 20px", fontSize: 15, fontFamily: "inherit", cursor: "pointer" }}>ביטול</button>
            </div>
          </div>
        </div>
      )}

      <GlobalStyles />
    </div>
  );
}

// ─── InsuranceScreen ──────────────────────────────────────────────────────────

const INS_BLUE    = "#1565C0";
const INS_DARK    = "#0D47A1";
const INS_BG      = "#E3F2FD";
const INS_SHADOW  = "rgba(21,101,192,0.4)";

function InsuranceScreen({ userName, householdId, onBack }) {
  const [docs, setDocs]               = useState([]);
  const [loading, setLoading]         = useState(true);
  const [showAdd, setShowAdd]         = useState(false);
  const [title, setTitle]             = useState("");
  const [comment, setComment]         = useState("");
  const [startDate, setStartDate]     = useState("");
  const [endDate, setEndDate]         = useState("");
  const [file, setFile]               = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const [uploading, setUploading]     = useState(false);
  const [fileError, setFileError]     = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [deleteAllConfirm, setDeleteAllConfirm] = useState("");
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const fileInputRef = useRef(null);

  const [editingDoc, setEditingDoc]           = useState(null);
  const [editTitle, setEditTitle]             = useState("");
  const [editComment, setEditComment]         = useState("");
  const [editStartDate, setEditStartDate]     = useState("");
  const [editEndDate, setEditEndDate]         = useState("");
  const [editFile, setEditFile]               = useState(null);
  const [editFilePreview, setEditFilePreview] = useState(null);
  const [editUploading, setEditUploading]     = useState(false);
  const [editFileError, setEditFileError]     = useState(null);
  const editFileInputRef = useRef(null);

  const MAX_FILE_SIZE = 5 * 1024 * 1024;

  useEffect(() => {
    const q = query(collection(db, "households", householdId, "insurance"), orderBy("date", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => { setDocs(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); setLoading(false); },
      (err) => { console.error("insurance listener error:", err); setLoading(false); }
    );
    return () => unsub();
  }, [householdId]);

  const handleFileChange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > MAX_FILE_SIZE) { setFileError(`הקובץ גדול מדי (${(f.size/1024/1024).toFixed(1)}MB) — מקסימום 5MB`); e.target.value = ""; return; }
    setFileError(null); setFile(f);
    if (f.type.startsWith("image/")) { const r = new FileReader(); r.onload = (ev) => setFilePreview(ev.target.result); r.readAsDataURL(f); }
    else setFilePreview("pdf");
  };

  const handleEditFileChange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > MAX_FILE_SIZE) { setEditFileError(`הקובץ גדול מדי (${(f.size/1024/1024).toFixed(1)}MB) — מקסימום 5MB`); e.target.value = ""; return; }
    setEditFileError(null); setEditFile(f);
    if (f.type.startsWith("image/")) { const r = new FileReader(); r.onload = (ev) => setEditFilePreview(ev.target.result); r.readAsDataURL(f); }
    else setEditFilePreview("pdf");
  };

  const resetForm = () => { setTitle(""); setComment(""); setStartDate(""); setEndDate(""); setFile(null); setFilePreview(null); setFileError(null); setShowAdd(false); };

  const saveDoc = async () => {
    if (!title.trim()) return;
    setUploading(true);
    try {
      let fileUrl = "", filePath = "";
      if (file) {
        filePath = `households/${householdId}/insurance/${Date.now()}_${file.name}`;
        const sRef = ref(storage, filePath);
        await uploadBytes(sRef, file, { contentType: file.type });
        fileUrl = await getDownloadURL(sRef);
      }
      await addDoc(collection(db, "households", householdId, "insurance"), { title: title.trim(), comment: comment.trim(), startDate, endDate, fileUrl, filePath, fileType: file ? file.type : "", addedBy: userName, date: new Date().toISOString() });
      resetForm();
    } catch (e) { console.error("Error saving insurance doc:", e); }
    setUploading(false);
  };

  const removeInsDoc = (id, docData) => {
    const timerId = setTimeout(async () => {
      try { await deleteDoc(doc(db, "households", householdId, "insurance", id)); } catch (e) { console.error(e); }
      setPendingDelete(null);
    }, 4500);
    setPendingDelete({ id, insDoc: docData, timerId });
  };

  const undoDelete = () => { if (pendingDelete) { clearTimeout(pendingDelete.timerId); setPendingDelete(null); } };

  const deleteAllDocs = async () => {
    try {
      const snap = await getDocs(collection(db, "households", householdId, "insurance"));
      await Promise.all(snap.docs.map(d => deleteDoc(doc(db, "households", householdId, "insurance", d.id))));
    } catch (e) { console.error("Error deleting all insurance docs:", e); }
    setShowDeleteAll(false);
    setDeleteAllConfirm("");
  };

  const openEdit = (d) => {
    setEditingDoc(d);
    setEditTitle(d.title || ""); setEditComment(d.comment || "");
    setEditStartDate(d.startDate || ""); setEditEndDate(d.endDate || "");
    setEditFile(null);
    setEditFilePreview(d.fileUrl ? (d.fileType === "application/pdf" ? "pdf" : d.fileUrl) : null);
  };

  const closeEdit = () => { setEditingDoc(null); setEditFile(null); setEditFilePreview(null); setEditFileError(null); };

  const saveEditDoc = async () => {
    if (!editTitle.trim()) return;
    setEditUploading(true);
    try {
      let fileUrl  = editingDoc.fileUrl  || "";
      let filePath = editingDoc.filePath || "";
      if (editFile) {
        filePath = `households/${householdId}/insurance/${Date.now()}_${editFile.name}`;
        const sRef = ref(storage, filePath);
        await uploadBytes(sRef, editFile, { contentType: editFile.type });
        fileUrl = await getDownloadURL(sRef);
      }
      await updateDoc(doc(db, "households", householdId, "insurance", editingDoc.id), { title: editTitle.trim(), comment: editComment.trim(), startDate: editStartDate, endDate: editEndDate, fileUrl, filePath, fileType: editFile ? editFile.type : (editingDoc.fileType || "") });
      closeEdit();
    } catch (e) { console.error("Error updating insurance doc:", e); }
    setEditUploading(false);
  };

  const sorted = [...docs]
    .filter((d) => d.id !== pendingDelete?.id)
    .sort((a, b) => {
      const rank = (d) => { if (!d.endDate) return 2; const diff = new Date(d.endDate) - new Date(); return diff < 0 ? 3 : diff < 2592000000 ? 1 : 2; };
      return rank(a) - rank(b);
    });

  const FileAttachArea = ({ preview, isPdf, onClear, onPick, inputRef, onChange, error, existingName }) => (
    <div style={{ marginTop: 10 }}>
      <input ref={inputRef} type="file" accept="image/*,application/pdf" onChange={onChange} style={{ display: "none" }} />
      {preview ? (
        <div style={{ position: "relative" }}>
          {isPdf || preview === "pdf"
            ? <div style={{ background: INS_BG, borderRadius: 12, padding: 16, textAlign: "center", color: INS_BLUE, fontSize: 14 }}>📄 {existingName || "קובץ מצורף"}</div>
            : <img src={preview} alt="preview" style={{ width: "100%", borderRadius: 12, maxHeight: 160, objectFit: "cover" }} />
          }
          <button onClick={onClear} style={{ position: "absolute", top: 8, left: 8, background: "rgba(0,0,0,0.5)", color: "#fff", border: "none", borderRadius: "50%", width: 28, height: 28, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>
      ) : (
        <button onClick={onPick}
          style={{ width: "100%", border: `2px dashed ${error ? "#E53935" : "#E8E5E0"}`, background: error ? "#FFF5F5" : "#FAFAFA", borderRadius: 12, padding: 16, cursor: "pointer", fontSize: 14, color: error ? "#E53935" : "#AAA", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          📎 צרף מסמך ביטוח — PDF או תמונה
        </button>
      )}
      {error && <p style={{ margin: "6px 0 0", fontSize: 12, color: "#E53935", fontWeight: 500 }}>⚠️ {error}</p>}
    </div>
  );

  if (loading) return <Loader />;

  return (
    <div dir="rtl" style={{ fontFamily: "'Rubik', sans-serif", maxWidth: 480, margin: "0 auto", minHeight: "100vh", background: "linear-gradient(165deg, #FAFAFA 0%, #F0EDE8 100%)", position: "relative" }}>
      {/* Header */}
      <div style={{ background: `linear-gradient(135deg, ${INS_BLUE} 0%, ${INS_DARK} 100%)`, padding: "28px 24px 20px", borderRadius: "0 0 28px 28px", boxShadow: "0 8px 32px rgba(21,101,192,0.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: "#fff" }}>🛡️ מסמכי ביטוח</h1>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "rgba(255,255,255,0.6)", fontWeight: 300 }}>{docs.length} מסמכים שמורים</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {docs.length > 0 && (
              <button onClick={() => { setShowDeleteAll(true); setDeleteAllConfirm(""); }} style={{ background: "rgba(255,255,255,0.15)", border: "none", borderRadius: 12, padding: "8px 12px", cursor: "pointer", color: "#fff", fontSize: 18, lineHeight: 1 }}>🗑️</button>
            )}
            <BackButton onBack={onBack} light />
          </div>
        </div>
      </div>

      <div style={{ padding: "16px 16px 100px" }}>
        {/* Add form */}
        {showAdd && (
          <div style={{ background: "#fff", borderRadius: 20, padding: 20, marginBottom: 16, boxShadow: "0 4px 20px rgba(0,0,0,0.08)", animation: "slideDown 0.3s ease" }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 600, color: "#2D3436" }}>מסמך חדש</h3>

            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="שם המסמך / סוג הביטוח *"
              style={inputStyle} onFocus={(e) => (e.target.style.borderColor = INS_BLUE)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />

            <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="הערה (אופציונלי)" rows={2}
              style={{ ...inputStyle, marginTop: 10, resize: "vertical", lineHeight: 1.5 }}
              onFocus={(e) => (e.target.style.borderColor = INS_BLUE)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />

            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <div style={{ flex: 1 }}>
                <p style={{ margin: "0 0 6px", fontSize: 13, color: "#888" }}>תחילת ביטוח</p>
                <input value={startDate} onChange={(e) => setStartDate(e.target.value)} type="date"
                  style={{ ...inputStyle, color: startDate ? "#2D3436" : "#CCC" }}
                  onFocus={(e) => (e.target.style.borderColor = INS_BLUE)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: "0 0 6px", fontSize: 13, color: "#888" }}>סיום ביטוח</p>
                <input value={endDate} onChange={(e) => setEndDate(e.target.value)} type="date"
                  style={{ ...inputStyle, color: endDate ? "#2D3436" : "#CCC" }}
                  onFocus={(e) => (e.target.style.borderColor = INS_BLUE)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
              </div>
            </div>

            <FileAttachArea preview={filePreview} isPdf={false} onClear={() => { setFile(null); setFilePreview(null); }} onPick={() => fileInputRef.current.click()} inputRef={fileInputRef} onChange={handleFileChange} error={fileError} existingName={file?.name} />

            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={saveDoc} disabled={!title.trim() || uploading}
                style={{ flex: 1, border: "none", background: title.trim() && !uploading ? `linear-gradient(135deg, ${INS_BLUE}, ${INS_DARK})` : "#ccc", color: "#fff", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 600, fontFamily: "inherit", cursor: title.trim() && !uploading ? "pointer" : "default" }}>
                {uploading ? "מעלה..." : "שמור מסמך ✓"}
              </button>
              <button onClick={resetForm} style={{ border: "2px solid #E8E5E0", background: "#fff", color: "#999", borderRadius: 12, padding: "14px 20px", fontSize: 15, fontFamily: "inherit", cursor: "pointer" }}>✕</button>
            </div>
          </div>
        )}

        {sorted.length === 0 && !showAdd && (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>🛡️</div>
            <p style={{ fontSize: 18, color: "#999", fontWeight: 300 }}>אין מסמכי ביטוח</p>
            <p style={{ fontSize: 14, color: "#CCC", fontWeight: 300, marginTop: 4 }}>לחצו על + כדי להוסיף מסמך</p>
          </div>
        )}

        {sorted.length > 0 && <p style={{ textAlign: "center", fontSize: 12, color: "#BBB", margin: "8px 0 12px", fontWeight: 300 }}>עריכה → | ← מחיקה</p>}

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {sorted.map((insDoc) => {
            const expiry    = getExpiryStatus(insDoc.endDate);
            const uc        = getUserColor(insDoc.addedBy);
            const isPdf     = insDoc.fileType === "application/pdf" || insDoc.filePath?.toLowerCase().endsWith(".pdf");
            const isExpired = expiry && new Date(insDoc.endDate) < new Date();
            return (
              <SwipeItem key={insDoc.id} borderRadius={18} onSwipeLeft={() => removeInsDoc(insDoc.id, insDoc)} onSwipeRight={() => openEdit(insDoc)}>
                <div style={{ background: "#fff", borderRadius: 18, overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,0.06)", opacity: isExpired ? 0.65 : 1, borderRight: `4px solid ${INS_BLUE}` }}>
                  {insDoc.fileUrl && (
                    isPdf ? (
                      <a href={insDoc.fileUrl} target="_blank" rel="noopener noreferrer"
                        style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, height: 64, background: INS_BG, textDecoration: "none" }}>
                        <span style={{ fontSize: 22 }}>📄</span>
                        <span style={{ color: INS_BLUE, fontWeight: 600, fontSize: 14 }}>פתח מסמך PDF</span>
                        <span style={{ fontSize: 12, color: "#90CAF9" }}>↗</span>
                      </a>
                    ) : (
                      <img src={insDoc.fileUrl} alt={insDoc.title} onClick={(e) => { e.stopPropagation(); setLightboxSrc(insDoc.fileUrl); }} style={{ width: "100%", height: 120, objectFit: "cover", cursor: "zoom-in" }} />
                    )
                  )}
                  <div style={{ padding: "14px 16px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                      <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#2D3436", flex: 1 }}>🛡️ {insDoc.title}</p>
                      {expiry && <span style={{ fontSize: 11, fontWeight: 600, color: expiry.color, background: expiry.bg, padding: "3px 8px", borderRadius: 8, flexShrink: 0 }}>⏱ {expiry.label}</span>}
                    </div>
                    {insDoc.comment && <p style={{ margin: "8px 0 0", fontSize: 13, color: "#555", lineHeight: 1.5 }}>{insDoc.comment}</p>}
                    {(insDoc.startDate || insDoc.endDate) && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 12, color: "#888" }}>
                        <span>📅</span>
                        {insDoc.startDate && <span>{insDoc.startDate.split("-").reverse().join("/")}</span>}
                        {insDoc.startDate && insDoc.endDate && <span style={{ color: "#CCC" }}>—</span>}
                        {insDoc.endDate && <span>{insDoc.endDate.split("-").reverse().join("/")}</span>}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 12, marginTop: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: "#CCC" }}>🕐 {formatDate(insDoc.date)}</span>
                      <span style={{ fontSize: 11, color: uc.color, fontWeight: 500 }}>👤 {insDoc.addedBy}</span>
                    </div>
                  </div>
                </div>
              </SwipeItem>
            );
          })}
        </div>
      </div>

      {!showAdd && <FAB onClick={() => setShowAdd(true)} color={`linear-gradient(135deg, ${INS_BLUE}, ${INS_DARK})`} shadow={INS_SHADOW} />}

      {/* Undo Delete Toast */}
      {pendingDelete && (
        <div style={{ position: "fixed", bottom: 104, left: "50%", transform: "translateX(-50%)", background: "#2D3436", color: "#fff", borderRadius: 14, padding: "12px 18px", display: "flex", alignItems: "center", gap: 14, zIndex: 60, boxShadow: "0 6px 24px rgba(0,0,0,0.3)", whiteSpace: "nowrap", animation: "slideUp 0.25s ease" }}>
          <span style={{ fontSize: 14 }}>🗑️ "{pendingDelete.insDoc.title}" נמחק</span>
          <button onClick={undoDelete} style={{ background: INS_BLUE, border: "none", borderRadius: 8, padding: "6px 14px", color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>ביטול</button>
        </div>
      )}

      {/* Edit Modal */}
      {editingDoc && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={(e) => { if (e.target === e.currentTarget) closeEdit(); }}>
          <div dir="rtl" style={{ background: "#fff", borderRadius: "24px 24px 0 0", padding: 24, width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto", animation: "slideUp 0.3s ease" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: "#2D3436" }}>✏️ עריכת מסמך</h3>
              <button onClick={closeEdit} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#999", lineHeight: 1 }}>✕</button>
            </div>
            <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="שם המסמך / סוג הביטוח *"
              style={inputStyle} onFocus={(e) => (e.target.style.borderColor = INS_BLUE)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
            <textarea value={editComment} onChange={(e) => setEditComment(e.target.value)} placeholder="הערה (אופציונלי)" rows={2}
              style={{ ...inputStyle, marginTop: 10, resize: "vertical", lineHeight: 1.5 }}
              onFocus={(e) => (e.target.style.borderColor = INS_BLUE)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <div style={{ flex: 1 }}>
                <p style={{ margin: "0 0 6px", fontSize: 13, color: "#888" }}>תחילת ביטוח</p>
                <input value={editStartDate} onChange={(e) => setEditStartDate(e.target.value)} type="date"
                  style={{ ...inputStyle, color: editStartDate ? "#2D3436" : "#CCC" }}
                  onFocus={(e) => (e.target.style.borderColor = INS_BLUE)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: "0 0 6px", fontSize: 13, color: "#888" }}>סיום ביטוח</p>
                <input value={editEndDate} onChange={(e) => setEditEndDate(e.target.value)} type="date"
                  style={{ ...inputStyle, color: editEndDate ? "#2D3436" : "#CCC" }}
                  onFocus={(e) => (e.target.style.borderColor = INS_BLUE)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
              </div>
            </div>
            <FileAttachArea preview={editFilePreview} isPdf={editFilePreview === "pdf"} onClear={() => { setEditFile(null); setEditFilePreview(null); }} onPick={() => editFileInputRef.current.click()} inputRef={editFileInputRef} onChange={handleEditFileChange} error={editFileError} existingName={editFile?.name} />
            <div style={{ display: "flex", gap: 8, marginTop: 16, paddingBottom: 8 }}>
              <button onClick={saveEditDoc} disabled={!editTitle.trim() || editUploading}
                style={{ flex: 1, border: "none", background: editTitle.trim() && !editUploading ? `linear-gradient(135deg, ${INS_BLUE}, ${INS_DARK})` : "#ccc", color: "#fff", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 600, fontFamily: "inherit", cursor: editTitle.trim() && !editUploading ? "pointer" : "default" }}>
                {editUploading ? "שומר..." : "שמור שינויים ✓"}
              </button>
              <button onClick={closeEdit} style={{ border: "2px solid #E8E5E0", background: "#fff", color: "#999", borderRadius: 12, padding: "14px 20px", fontSize: 15, fontFamily: "inherit", cursor: "pointer" }}>✕</button>
            </div>
          </div>
        </div>
      )}

      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />

      {/* ── Delete All Confirmation Modal ── */}
      {showDeleteAll && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={(e) => { if (e.target === e.currentTarget) { setShowDeleteAll(false); setDeleteAllConfirm(""); } }}>
          <div dir="rtl" style={{ background: "#fff", borderRadius: "24px 24px 0 0", padding: 24, width: "100%", maxWidth: 480, animation: "slideUp 0.3s ease" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: "#E53935" }}>🗑️ מחיקת כל המסמכים</h3>
              <button onClick={() => { setShowDeleteAll(false); setDeleteAllConfirm(""); }} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#999", lineHeight: 1 }}>✕</button>
            </div>
            <p style={{ margin: "0 0 16px", fontSize: 14, color: "#666", lineHeight: 1.5 }}>פעולה זו תמחק את כל {docs.length} המסמכים ולא ניתן לשחזר אותם.<br/>כדי לאשר, הקלד <strong>מחק</strong> בתיבה:</p>
            <input value={deleteAllConfirm} onChange={(e) => setDeleteAllConfirm(e.target.value)} placeholder="מחק" autoFocus
              style={{ ...inputStyle, marginBottom: 16 }}
              onFocus={(e) => (e.target.style.borderColor = "#E53935")} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
            <div style={{ display: "flex", gap: 8, paddingBottom: 8 }}>
              <button onClick={deleteAllDocs} disabled={deleteAllConfirm !== "מחק"}
                style={{ flex: 1, border: "none", background: deleteAllConfirm === "מחק" ? "#E53935" : "#ccc", color: "#fff", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 600, fontFamily: "inherit", cursor: deleteAllConfirm === "מחק" ? "pointer" : "default" }}>
                מחק הכל
              </button>
              <button onClick={() => { setShowDeleteAll(false); setDeleteAllConfirm(""); }}
                style={{ border: "2px solid #E8E5E0", background: "#fff", color: "#999", borderRadius: 12, padding: "14px 20px", fontSize: 15, fontFamily: "inherit", cursor: "pointer" }}>ביטול</button>
            </div>
          </div>
        </div>
      )}

      <GlobalStyles />
    </div>
  );
}

// ─── PersonalDocsScreen ──────────────────────────────────────────────────────

const PDOC_PURPLE = "#5E35B1";
const PDOC_DARK   = "#4527A0";
const PDOC_BG     = "#EDE7F6";
const PDOC_SHADOW = "rgba(94,53,177,0.4)";

function PersonalDocsScreen({ userName, householdId, onBack }) {
  const [docs, setDocs]                       = useState([]);
  const [loading, setLoading]                 = useState(true);
  const [showAdd, setShowAdd]                 = useState(false);
  const [title, setTitle]                     = useState("");
  const [comment, setComment]                 = useState("");
  const [file, setFile]                       = useState(null);
  const [filePreview, setFilePreview]         = useState(null);
  const [uploading, setUploading]             = useState(false);
  const [fileError, setFileError]             = useState(null);
  const [pendingDelete, setPendingDelete]     = useState(null);
  const [showDeleteAll, setShowDeleteAll]     = useState(false);
  const [deleteAllConfirm, setDeleteAllConfirm] = useState("");
  const [lightboxSrc, setLightboxSrc]         = useState(null);
  const fileInputRef = useRef(null);

  const [editingDoc, setEditingDoc]           = useState(null);
  const [editTitle, setEditTitle]             = useState("");
  const [editComment, setEditComment]         = useState("");
  const [editFile, setEditFile]               = useState(null);
  const [editFilePreview, setEditFilePreview] = useState(null);
  const [editUploading, setEditUploading]     = useState(false);
  const [editFileError, setEditFileError]     = useState(null);
  const editFileInputRef = useRef(null);

  // Share-menu state: which doc the bottom-sheet is currently open for
  const [shareMenuDoc, setShareMenuDoc]       = useState(null);
  const [shareBusy, setShareBusy]             = useState(false);
  const [shareToast, setShareToast]           = useState("");
  // Detect Web Share API Level 2 (file sharing) support once on mount
  const [supportsFileShare, setSupportsFileShare] = useState(false);
  useEffect(() => {
    try {
      const probe = new File(["x"], "probe.txt", { type: "text/plain" });
      setSupportsFileShare(typeof navigator !== "undefined" && !!navigator.canShare && navigator.canShare({ files: [probe] }));
    } catch { setSupportsFileShare(false); }
  }, []);

  const MAX_FILE_SIZE = 5 * 1024 * 1024;

  useEffect(() => {
    const q = query(collection(db, "households", householdId, "personal_docs"), orderBy("date", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => { setDocs(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); setLoading(false); },
      (err) => { console.error("personal_docs listener error:", err); setLoading(false); }
    );
    return () => unsub();
  }, [householdId]);

  const handleFileChange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > MAX_FILE_SIZE) { setFileError(`הקובץ גדול מדי (${(f.size/1024/1024).toFixed(1)}MB) — מקסימום 5MB`); e.target.value = ""; return; }
    setFileError(null); setFile(f);
    if (f.type.startsWith("image/")) { const r = new FileReader(); r.onload = (ev) => setFilePreview(ev.target.result); r.readAsDataURL(f); }
    else setFilePreview("pdf");
  };

  const handleEditFileChange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > MAX_FILE_SIZE) { setEditFileError(`הקובץ גדול מדי (${(f.size/1024/1024).toFixed(1)}MB) — מקסימום 5MB`); e.target.value = ""; return; }
    setEditFileError(null); setEditFile(f);
    if (f.type.startsWith("image/")) { const r = new FileReader(); r.onload = (ev) => setEditFilePreview(ev.target.result); r.readAsDataURL(f); }
    else setEditFilePreview("pdf");
  };

  const resetForm = () => { setTitle(""); setComment(""); setFile(null); setFilePreview(null); setFileError(null); setShowAdd(false); };

  const saveDoc = async () => {
    if (!title.trim()) return;
    setUploading(true);
    try {
      let fileUrl = "", filePath = "";
      if (file) {
        filePath = `households/${householdId}/personal_docs/${Date.now()}_${file.name}`;
        const sRef = ref(storage, filePath);
        await uploadBytes(sRef, file, { contentType: file.type });
        fileUrl = await getDownloadURL(sRef);
      }
      await addDoc(collection(db, "households", householdId, "personal_docs"), {
        title: title.trim(),
        comment: comment.trim(),
        fileUrl,
        filePath,
        fileType: file ? file.type : "",
        addedBy: userName,
        date: new Date().toISOString(),
      });
      resetForm();
    } catch (e) { console.error("Error saving personal doc:", e); }
    setUploading(false);
  };

  const removePersDoc = (id, docData) => {
    const timerId = setTimeout(async () => {
      try { await deleteDoc(doc(db, "households", householdId, "personal_docs", id)); } catch (e) { console.error(e); }
      setPendingDelete(null);
    }, 4500);
    setPendingDelete({ id, persDoc: docData, timerId });
  };

  const undoDelete = () => { if (pendingDelete) { clearTimeout(pendingDelete.timerId); setPendingDelete(null); } };

  const deleteAllDocs = async () => {
    try {
      const snap = await getDocs(collection(db, "households", householdId, "personal_docs"));
      await Promise.all(snap.docs.map(d => deleteDoc(doc(db, "households", householdId, "personal_docs", d.id))));
    } catch (e) { console.error("Error deleting all personal docs:", e); }
    setShowDeleteAll(false);
    setDeleteAllConfirm("");
  };

  const openEdit = (d) => {
    setEditingDoc(d);
    setEditTitle(d.title || "");
    setEditComment(d.comment || "");
    setEditFile(null);
    setEditFilePreview(d.fileUrl ? (d.fileType === "application/pdf" ? "pdf" : d.fileUrl) : null);
  };

  const closeEdit = () => { setEditingDoc(null); setEditFile(null); setEditFilePreview(null); setEditFileError(null); };

  // ── Share helpers ─────────────────────────────────────────────────────────
  const showToast = (msg) => { setShareToast(msg); setTimeout(() => setShareToast(""), 2200); };

  // Real file attachment via Web Share API Level 2 (mobile + modern desktop).
  // Downloads the file from Firebase Storage as a Blob, wraps it in a File,
  // and hands it to the OS share sheet. Apps like Mail/WhatsApp/Drive then
  // receive the actual file as an attachment, not a link.
  //
  // Uses Firebase's getBlob() first, which goes through the authenticated
  // SDK path and has proper CORS headers set by Google. Falls back to raw
  // fetch() of the signed download URL if getBlob() is unavailable or the
  // doc has no filePath (legacy records where only fileUrl was saved).
  const shareFile = async (persDoc) => {
    if (!persDoc?.fileUrl) return;
    setShareBusy(true);
    try {
      let blob;
      if (persDoc.filePath) {
        try {
          blob = await getBlob(ref(storage, persDoc.filePath));
        } catch (e) {
          console.warn("getBlob failed, falling back to fetch:", e);
        }
      }
      if (!blob) {
        const resp = await fetch(persDoc.fileUrl);
        if (!resp.ok) throw new Error(`fetch ${resp.status}`);
        blob = await resp.blob();
      }
      const rawName = persDoc.filePath?.split("/").pop()?.replace(/^\d+_/, "") || "document";
      const file = new File([blob], rawName, { type: persDoc.fileType || blob.type || "application/octet-stream" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: persDoc.title || "מסמך אישי",
          text:  persDoc.comment || persDoc.title || "",
        });
        setShareMenuDoc(null);
      } else {
        showToast("הדפדפן לא תומך בשיתוף קבצים — נסה אימייל / WhatsApp");
      }
    } catch (e) {
      if (e.name !== "AbortError") {
        console.error("share file error:", e);
        showToast("שגיאה בשיתוף הקובץ");
      }
    }
    setShareBusy(false);
  };

  const shareViaEmail = (persDoc) => {
    if (!persDoc) return;
    const subject = encodeURIComponent(persDoc.title || "מסמך אישי");
    const lines = [];
    if (persDoc.comment) lines.push(persDoc.comment, "");
    if (persDoc.fileUrl) { lines.push("קישור למסמך:", persDoc.fileUrl); }
    const body = encodeURIComponent(lines.join("\n"));
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
    setShareMenuDoc(null);
  };

  const shareViaWhatsApp = (persDoc) => {
    if (!persDoc) return;
    const lines = [];
    if (persDoc.title)   lines.push(`*${persDoc.title}*`);
    if (persDoc.comment) lines.push(persDoc.comment);
    if (persDoc.fileUrl) lines.push(persDoc.fileUrl);
    const text = encodeURIComponent(lines.join("\n"));
    window.open(`https://wa.me/?text=${text}`, "_blank");
    setShareMenuDoc(null);
  };

  const copyLink = async (persDoc) => {
    if (!persDoc?.fileUrl) return;
    try {
      await navigator.clipboard.writeText(persDoc.fileUrl);
      showToast("הקישור הועתק ✓");
      setShareMenuDoc(null);
    } catch (e) {
      console.error("copy error:", e);
      showToast("שגיאה בהעתקה");
    }
  };

  const saveEditDoc = async () => {
    if (!editTitle.trim()) return;
    setEditUploading(true);
    try {
      let fileUrl  = editingDoc.fileUrl  || "";
      let filePath = editingDoc.filePath || "";
      if (editFile) {
        filePath = `households/${householdId}/personal_docs/${Date.now()}_${editFile.name}`;
        const sRef = ref(storage, filePath);
        await uploadBytes(sRef, editFile, { contentType: editFile.type });
        fileUrl = await getDownloadURL(sRef);
      }
      await updateDoc(doc(db, "households", householdId, "personal_docs", editingDoc.id), {
        title: editTitle.trim(),
        comment: editComment.trim(),
        fileUrl,
        filePath,
        fileType: editFile ? editFile.type : (editingDoc.fileType || ""),
      });
      closeEdit();
    } catch (e) { console.error("Error updating personal doc:", e); }
    setEditUploading(false);
  };

  const sorted = docs.filter((d) => d.id !== pendingDelete?.id);

  const FileAttachArea = ({ preview, isPdf, onClear, onPick, inputRef, onChange, error, existingName }) => (
    <div style={{ marginTop: 10 }}>
      <input ref={inputRef} type="file" accept="image/*,application/pdf" onChange={onChange} style={{ display: "none" }} />
      {preview ? (
        <div style={{ position: "relative" }}>
          {isPdf || preview === "pdf"
            ? <div style={{ background: PDOC_BG, borderRadius: 12, padding: 16, textAlign: "center", color: PDOC_PURPLE, fontSize: 14 }}>📄 {existingName || "קובץ מצורף"}</div>
            : <img src={preview} alt="preview" style={{ width: "100%", borderRadius: 12, maxHeight: 160, objectFit: "cover" }} />
          }
          <button onClick={onClear} style={{ position: "absolute", top: 8, left: 8, background: "rgba(0,0,0,0.5)", color: "#fff", border: "none", borderRadius: "50%", width: 28, height: 28, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>
      ) : (
        <button onClick={onPick}
          style={{ width: "100%", border: `2px dashed ${error ? "#E53935" : "#E8E5E0"}`, background: error ? "#FFF5F5" : "#FAFAFA", borderRadius: 12, padding: 16, cursor: "pointer", fontSize: 14, color: error ? "#E53935" : "#AAA", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          📎 צרף מסמך — PDF או תמונה
        </button>
      )}
      {error && <p style={{ margin: "6px 0 0", fontSize: 12, color: "#E53935", fontWeight: 500 }}>⚠️ {error}</p>}
    </div>
  );

  if (loading) return <Loader />;

  return (
    <div dir="rtl" style={{ fontFamily: "'Rubik', sans-serif", maxWidth: 480, margin: "0 auto", minHeight: "100vh", background: "linear-gradient(165deg, #FAFAFA 0%, #F0EDE8 100%)", position: "relative" }}>
      {/* Header */}
      <div style={{ background: `linear-gradient(135deg, ${PDOC_PURPLE} 0%, ${PDOC_DARK} 100%)`, padding: "28px 24px 20px", borderRadius: "0 0 28px 28px", boxShadow: `0 8px 32px ${PDOC_SHADOW}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: "#fff" }}>📄 מסמכים אישיים</h1>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "rgba(255,255,255,0.6)", fontWeight: 300 }}>{docs.length} מסמכים שמורים</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {docs.length > 0 && (
              <button onClick={() => { setShowDeleteAll(true); setDeleteAllConfirm(""); }} style={{ background: "rgba(255,255,255,0.15)", border: "none", borderRadius: 12, padding: "8px 12px", cursor: "pointer", color: "#fff", fontSize: 18, lineHeight: 1 }}>🗑️</button>
            )}
            <BackButton onBack={onBack} light />
          </div>
        </div>
      </div>

      <div style={{ padding: "16px 16px 100px" }}>
        {/* Add form */}
        {showAdd && (
          <div style={{ background: "#fff", borderRadius: 20, padding: 20, marginBottom: 16, boxShadow: "0 4px 20px rgba(0,0,0,0.08)", animation: "slideDown 0.3s ease" }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 600, color: "#2D3436" }}>מסמך חדש</h3>

            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="שם המסמך *"
              style={inputStyle} onFocus={(e) => (e.target.style.borderColor = PDOC_PURPLE)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />

            <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="הערה (אופציונלי)" rows={2}
              style={{ ...inputStyle, marginTop: 10, resize: "vertical", lineHeight: 1.5 }}
              onFocus={(e) => (e.target.style.borderColor = PDOC_PURPLE)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />

            <FileAttachArea preview={filePreview} isPdf={false} onClear={() => { setFile(null); setFilePreview(null); }} onPick={() => fileInputRef.current.click()} inputRef={fileInputRef} onChange={handleFileChange} error={fileError} existingName={file?.name} />

            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={saveDoc} disabled={!title.trim() || uploading}
                style={{ flex: 1, border: "none", background: title.trim() && !uploading ? `linear-gradient(135deg, ${PDOC_PURPLE}, ${PDOC_DARK})` : "#ccc", color: "#fff", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 600, fontFamily: "inherit", cursor: title.trim() && !uploading ? "pointer" : "default" }}>
                {uploading ? "מעלה..." : "שמור מסמך ✓"}
              </button>
              <button onClick={resetForm} style={{ border: "2px solid #E8E5E0", background: "#fff", color: "#999", borderRadius: 12, padding: "14px 20px", fontSize: 15, fontFamily: "inherit", cursor: "pointer" }}>✕</button>
            </div>
          </div>
        )}

        {sorted.length === 0 && !showAdd && (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>📄</div>
            <p style={{ fontSize: 18, color: "#999", fontWeight: 300 }}>אין מסמכים אישיים</p>
            <p style={{ fontSize: 14, color: "#CCC", fontWeight: 300, marginTop: 4 }}>לחצו על + כדי להוסיף מסמך</p>
          </div>
        )}

        {sorted.length > 0 && <p style={{ textAlign: "center", fontSize: 12, color: "#BBB", margin: "8px 0 12px", fontWeight: 300 }}>עריכה → | ← מחיקה</p>}

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {sorted.map((persDoc) => {
            const uc    = getUserColor(persDoc.addedBy);
            const isPdf = persDoc.fileType === "application/pdf" || persDoc.filePath?.toLowerCase().endsWith(".pdf");
            return (
              <SwipeItem key={persDoc.id} borderRadius={18} onSwipeLeft={() => removePersDoc(persDoc.id, persDoc)} onSwipeRight={() => openEdit(persDoc)}>
                <div style={{ background: "#fff", borderRadius: 18, overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,0.06)", borderRight: `4px solid ${PDOC_PURPLE}` }}>
                  {persDoc.fileUrl && (
                    isPdf ? (
                      <a href={persDoc.fileUrl} target="_blank" rel="noopener noreferrer"
                        style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, height: 64, background: PDOC_BG, textDecoration: "none" }}>
                        <span style={{ fontSize: 22 }}>📄</span>
                        <span style={{ color: PDOC_PURPLE, fontWeight: 600, fontSize: 14 }}>פתח מסמך PDF</span>
                        <span style={{ fontSize: 12, color: "#B39DDB" }}>↗</span>
                      </a>
                    ) : (
                      <img src={persDoc.fileUrl} alt={persDoc.title} onClick={(e) => { e.stopPropagation(); setLightboxSrc(persDoc.fileUrl); }} style={{ width: "100%", height: 120, objectFit: "cover", cursor: "zoom-in" }} />
                    )
                  )}
                  <div style={{ padding: "14px 16px" }}>
                    <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#2D3436" }}>📄 {persDoc.title}</p>
                    {persDoc.comment && <p style={{ margin: "8px 0 0", fontSize: 13, color: "#555", lineHeight: 1.5 }}>{persDoc.comment}</p>}
                    <div style={{ display: "flex", gap: 12, marginTop: 8, alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: "#CCC" }}>🕐 {formatDate(persDoc.date)}</span>
                        <span style={{ fontSize: 11, color: uc.color, fontWeight: 500 }}>👤 {persDoc.addedBy}</span>
                      </div>
                      {persDoc.fileUrl && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setShareMenuDoc(persDoc); }}
                          aria-label="שלח / שתף"
                          title="שלח / שתף"
                          style={{
                            background: PDOC_BG,
                            border: "none",
                            borderRadius: "50%",
                            width: 32,
                            height: 32,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            fontSize: 15,
                            color: PDOC_PURPLE,
                            padding: 0,
                            flexShrink: 0,
                          }}
                        >
                          📤
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </SwipeItem>
            );
          })}
        </div>
      </div>

      {!showAdd && <FAB onClick={() => setShowAdd(true)} color={`linear-gradient(135deg, ${PDOC_PURPLE}, ${PDOC_DARK})`} shadow={PDOC_SHADOW} />}

      {/* Undo Delete Toast */}
      {pendingDelete && (
        <div style={{ position: "fixed", bottom: 104, left: "50%", transform: "translateX(-50%)", background: "#2D3436", color: "#fff", borderRadius: 14, padding: "12px 18px", display: "flex", alignItems: "center", gap: 14, zIndex: 60, boxShadow: "0 6px 24px rgba(0,0,0,0.3)", whiteSpace: "nowrap", animation: "slideUp 0.25s ease" }}>
          <span style={{ fontSize: 14 }}>🗑️ "{pendingDelete.persDoc.title}" נמחק</span>
          <button onClick={undoDelete} style={{ background: PDOC_PURPLE, border: "none", borderRadius: 8, padding: "6px 14px", color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>ביטול</button>
        </div>
      )}

      {/* Edit Modal */}
      {editingDoc && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={(e) => { if (e.target === e.currentTarget) closeEdit(); }}>
          <div dir="rtl" style={{ background: "#fff", borderRadius: "24px 24px 0 0", padding: 24, width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto", animation: "slideUp 0.3s ease" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: "#2D3436" }}>✏️ עריכת מסמך</h3>
              <button onClick={closeEdit} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#999", lineHeight: 1 }}>✕</button>
            </div>
            <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="שם המסמך *"
              style={inputStyle} onFocus={(e) => (e.target.style.borderColor = PDOC_PURPLE)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
            <textarea value={editComment} onChange={(e) => setEditComment(e.target.value)} placeholder="הערה (אופציונלי)" rows={2}
              style={{ ...inputStyle, marginTop: 10, resize: "vertical", lineHeight: 1.5 }}
              onFocus={(e) => (e.target.style.borderColor = PDOC_PURPLE)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
            <FileAttachArea preview={editFilePreview} isPdf={editFilePreview === "pdf"} onClear={() => { setEditFile(null); setEditFilePreview(null); }} onPick={() => editFileInputRef.current.click()} inputRef={editFileInputRef} onChange={handleEditFileChange} error={editFileError} existingName={editFile?.name} />
            <div style={{ display: "flex", gap: 8, marginTop: 16, paddingBottom: 8 }}>
              <button onClick={saveEditDoc} disabled={!editTitle.trim() || editUploading}
                style={{ flex: 1, border: "none", background: editTitle.trim() && !editUploading ? `linear-gradient(135deg, ${PDOC_PURPLE}, ${PDOC_DARK})` : "#ccc", color: "#fff", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 600, fontFamily: "inherit", cursor: editTitle.trim() && !editUploading ? "pointer" : "default" }}>
                {editUploading ? "שומר..." : "שמור שינויים ✓"}
              </button>
              <button onClick={closeEdit} style={{ border: "2px solid #E8E5E0", background: "#fff", color: "#999", borderRadius: 12, padding: "14px 20px", fontSize: 15, fontFamily: "inherit", cursor: "pointer" }}>✕</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Share Bottom-Sheet ─────────────────────────────────────────────
          Renders a list of share options for the currently-selected doc.
          To add more options later (Telegram, SMS, Drive upload, etc.),
          add a new entry to SHARE_OPTIONS below — no other UI changes needed. */}
      {shareMenuDoc && (() => {
        const SHARE_OPTIONS = [
          ...(supportsFileShare ? [{ id: "file",  icon: "📎", label: "שלח קובץ (מצורף)",       sub: "פותח את חלון השיתוף של המערכת",          color: PDOC_PURPLE, action: () => shareFile(shareMenuDoc), busy: shareBusy }] : []),
          { id: "email",    icon: "✉️", label: "אימייל",        sub: "פותח את אפליקציית המייל עם קישור למסמך", color: "#EA4335",   action: () => shareViaEmail(shareMenuDoc) },
          { id: "whatsapp", icon: "💬", label: "WhatsApp",      sub: "שולח קישור למסמך ב-WhatsApp",            color: "#25D366",   action: () => shareViaWhatsApp(shareMenuDoc) },
          { id: "copy",     icon: "📋", label: "העתק קישור",     sub: "מעתיק את הקישור ללוח",                   color: "#666",      action: () => copyLink(shareMenuDoc) },
        ];
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 110, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
               onClick={(e) => { if (e.target === e.currentTarget) setShareMenuDoc(null); }}>
            <div dir="rtl" style={{ background: "#fff", borderRadius: "24px 24px 0 0", padding: 24, width: "100%", maxWidth: 480, animation: "slideUp 0.3s ease" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: "#2D3436" }}>📤 שיתוף מסמך</h3>
                <button onClick={() => setShareMenuDoc(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#999", lineHeight: 1 }}>✕</button>
              </div>
              <p style={{ margin: "0 0 16px", fontSize: 13, color: "#888", fontWeight: 300 }}>{shareMenuDoc.title}</p>

              <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingBottom: 8 }}>
                {SHARE_OPTIONS.map((opt) => (
                  <button key={opt.id}
                    onClick={opt.action}
                    disabled={opt.busy}
                    style={{
                      display: "flex", alignItems: "center", gap: 14,
                      background: "#FAFAFA", border: "1.5px solid #F0EDE8", borderRadius: 14,
                      padding: "14px 16px", cursor: opt.busy ? "wait" : "pointer", fontFamily: "inherit", textAlign: "right",
                      opacity: opt.busy ? 0.6 : 1,
                    }}>
                    <div style={{ width: 40, height: 40, borderRadius: 12, background: opt.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, color: "#fff", flexShrink: 0 }}>{opt.icon}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#2D3436" }}>{opt.label}{opt.busy ? " ..." : ""}</p>
                      <p style={{ margin: "2px 0 0", fontSize: 12, color: "#888", fontWeight: 300 }}>{opt.sub}</p>
                    </div>
                  </button>
                ))}
              </div>

              {!supportsFileShare && (
                <p style={{ margin: "8px 0 0", fontSize: 11, color: "#BBB", fontWeight: 300, textAlign: "center" }}>
                  הדפדפן שלך לא תומך בשיתוף קבצים מצורפים — האפשרויות לעיל ישלחו קישור בלבד.
                </p>
              )}
            </div>
          </div>
        );
      })()}

      {/* Share-action toast (clipboard / errors) */}
      {shareToast && (
        <div style={{ position: "fixed", bottom: 104, left: "50%", transform: "translateX(-50%)", background: "#2D3436", color: "#fff", borderRadius: 14, padding: "10px 18px", fontSize: 14, zIndex: 120, boxShadow: "0 6px 24px rgba(0,0,0,0.3)", whiteSpace: "nowrap", animation: "slideUp 0.25s ease" }}>
          {shareToast}
        </div>
      )}

      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />

      {/* ── Delete All Confirmation Modal ── */}
      {showDeleteAll && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={(e) => { if (e.target === e.currentTarget) { setShowDeleteAll(false); setDeleteAllConfirm(""); } }}>
          <div dir="rtl" style={{ background: "#fff", borderRadius: "24px 24px 0 0", padding: 24, width: "100%", maxWidth: 480, animation: "slideUp 0.3s ease" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: "#E53935" }}>🗑️ מחיקת כל המסמכים</h3>
              <button onClick={() => { setShowDeleteAll(false); setDeleteAllConfirm(""); }} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#999", lineHeight: 1 }}>✕</button>
            </div>
            <p style={{ margin: "0 0 16px", fontSize: 14, color: "#666", lineHeight: 1.5 }}>פעולה זו תמחק את כל {docs.length} המסמכים ולא ניתן לשחזר אותם.<br/>כדי לאשר, הקלד <strong>מחק</strong> בתיבה:</p>
            <input value={deleteAllConfirm} onChange={(e) => setDeleteAllConfirm(e.target.value)} placeholder="מחק" autoFocus
              style={{ ...inputStyle, marginBottom: 16 }}
              onFocus={(e) => (e.target.style.borderColor = "#E53935")} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
            <div style={{ display: "flex", gap: 8, paddingBottom: 8 }}>
              <button onClick={deleteAllDocs} disabled={deleteAllConfirm !== "מחק"}
                style={{ flex: 1, border: "none", background: deleteAllConfirm === "מחק" ? "#E53935" : "#ccc", color: "#fff", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 600, fontFamily: "inherit", cursor: deleteAllConfirm === "מחק" ? "pointer" : "default" }}>
                מחק הכל
              </button>
              <button onClick={() => { setShowDeleteAll(false); setDeleteAllConfirm(""); }}
                style={{ border: "2px solid #E8E5E0", background: "#fff", color: "#999", borderRadius: 12, padding: "14px 20px", fontSize: 15, fontFamily: "inherit", cursor: "pointer" }}>ביטול</button>
            </div>
          </div>
        </div>
      )}

      <GlobalStyles />
    </div>
  );
}

// ─── BirthdaysScreen ─────────────────────────────────────────────────────────

const BDAY_PINK  = "#E91E63";
const BDAY_DARK  = "#C2185B";

function parseDateParts(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  return { year, month: month - 1, day };
}

function getDaysUntilBirthday(dateStr) {
  if (!dateStr) return Infinity;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { month, day } = parseDateParts(dateStr);
  const next = new Date(today.getFullYear(), month, day);
  if (next < today) next.setFullYear(today.getFullYear() + 1);
  return Math.round((next - today) / 86400000);
}

function formatBirthdayDate(dateStr) {
  if (!dateStr) return "";
  const { month, day } = parseDateParts(dateStr);
  return `${day}/${month + 1}`;
}

function getAge(dateStr) {
  if (!dateStr) return null;
  const today = new Date();
  const { year, month, day } = parseDateParts(dateStr);
  let age = today.getFullYear() - year;
  const hasBirthdayPassed = today.getMonth() > month || (today.getMonth() === month && today.getDate() >= day);
  if (!hasBirthdayPassed) age--;
  return age + 1; // age they'll turn on next birthday
}

function BirthdaysScreen({ userName, householdId, onBack }) {
  const [birthdays, setBirthdays] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showAdd, setShowAdd]     = useState(false);
  const [name, setName]           = useState("");
  const [date, setDate]           = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);
  const [editingBday, setEditingBday]     = useState(null);
  const [editName, setEditName]           = useState("");
  const [editDate, setEditDate]           = useState("");

  useEffect(() => {
    const q = query(collection(db, "households", householdId, "birthdays"), orderBy("date", "asc"));
    const unsub = onSnapshot(
      q,
      (snap) => { setBirthdays(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); },
      (err) => { console.error("birthdays listener error:", err); setLoading(false); }
    );
    return () => unsub();
  }, [householdId]);

  const addBirthday = async () => {
    if (!name.trim() || !date) return;
    try { await addDoc(collection(db, "households", householdId, "birthdays"), { name: name.trim(), date, addedBy: userName }); }
    catch (e) { console.error(e); }
    setName(""); setDate(""); setShowAdd(false);
  };

  const removeBirthday = (id, bdayData) => {
    if (pendingDelete) clearTimeout(pendingDelete.timerId);
    const timerId = setTimeout(async () => {
      try { await deleteDoc(doc(db, "households", householdId, "birthdays", id)); } catch (e) { console.error(e); }
      setPendingDelete(null);
    }, 4500);
    setPendingDelete({ id, bday: bdayData, timerId });
  };

  const undoDelete = () => { if (pendingDelete) { clearTimeout(pendingDelete.timerId); setPendingDelete(null); } };

  const openEdit = (b) => { setEditingBday(b); setEditName(b.name); setEditDate(b.date); };
  const closeEdit = () => setEditingBday(null);
  const updateBirthday = async () => {
    if (!editName.trim() || !editDate) return;
    try { await updateDoc(doc(db, "households", householdId, "birthdays", editingBday.id), { name: editName.trim(), date: editDate }); closeEdit(); }
    catch (e) { console.error(e); }
  };

  const sorted = [...birthdays]
    .filter(b => b.id !== pendingDelete?.id)
    .sort((a, b) => getDaysUntilBirthday(a.date) - getDaysUntilBirthday(b.date));

  if (loading) return <Loader />;

  return (
    <div dir="rtl" style={{ fontFamily: "'Rubik', sans-serif", maxWidth: 480, margin: "0 auto", minHeight: "100vh", background: "linear-gradient(165deg, #FAFAFA 0%, #F0EDE8 100%)" }}>
      {/* Header */}
      <div style={{ background: `linear-gradient(135deg, ${BDAY_PINK} 0%, ${BDAY_DARK} 100%)`, padding: "28px 24px 20px", borderRadius: "0 0 28px 28px", boxShadow: "0 8px 32px rgba(233,30,99,0.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: "#fff" }}>🎈 ימי הולדת</h1>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "rgba(255,255,255,0.6)", fontWeight: 300 }}>{birthdays.length} ימי הולדת שמורים</p>
          </div>
          <BackButton onBack={onBack} light />
        </div>
      </div>

      <div style={{ padding: "16px 16px 100px" }}>
        {/* Add form */}
        {showAdd && (
          <div style={{ background: "#fff", borderRadius: 20, padding: 20, marginBottom: 16, boxShadow: "0 4px 20px rgba(0,0,0,0.08)", animation: "slideDown 0.3s ease" }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 600, color: "#2D3436" }}>יום הולדת חדש</h3>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="שם *" autoFocus
              style={inputStyle} onFocus={(e) => (e.target.style.borderColor = BDAY_PINK)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
            <div style={{ marginTop: 10 }}>
              <p style={{ margin: "0 0 6px", fontSize: 13, color: "#888" }}>תאריך לידה</p>
              <input value={date} onChange={(e) => setDate(e.target.value)} type="date"
                style={{ ...inputStyle, color: date ? "#2D3436" : "#CCC" }} onFocus={(e) => (e.target.style.borderColor = BDAY_PINK)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={addBirthday} disabled={!name.trim() || !date}
                style={{ flex: 1, border: "none", background: name.trim() && date ? `linear-gradient(135deg, ${BDAY_PINK}, ${BDAY_DARK})` : "#ccc", color: "#fff", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 600, fontFamily: "inherit", cursor: name.trim() && date ? "pointer" : "default" }}>
                שמור ✓
              </button>
              <button onClick={() => { setShowAdd(false); setName(""); setDate(""); }}
                style={{ border: "2px solid #E8E5E0", background: "#fff", color: "#999", borderRadius: 12, padding: "14px 20px", fontSize: 15, fontFamily: "inherit", cursor: "pointer" }}>✕</button>
            </div>
          </div>
        )}

        {sorted.length === 0 && !showAdd && (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>🎈</div>
            <p style={{ fontSize: 18, color: "#999", fontWeight: 300 }}>אין ימי הולדת שמורים</p>
            <p style={{ fontSize: 14, color: "#CCC", fontWeight: 300, marginTop: 4 }}>לחצו על + כדי להוסיף</p>
          </div>
        )}

        {sorted.length > 0 && <p style={{ textAlign: "center", fontSize: 12, color: "#BBB", margin: "8px 0 12px", fontWeight: 300 }}>עריכה → | ← מחיקה</p>}

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {sorted.map((b) => {
            const days    = getDaysUntilBirthday(b.date);
            const age     = getAge(b.date);
            const isToday = days === 0;
            const isSoon  = days <= 7 && days > 0;
            return (
              <SwipeItem key={b.id} borderRadius={18} onSwipeLeft={() => removeBirthday(b.id, b)} onSwipeRight={() => openEdit(b)}>
                <div style={{ background: "#fff", borderRadius: 18, padding: "16px 18px", boxShadow: "0 2px 12px rgba(0,0,0,0.06)", display: "flex", alignItems: "center", gap: 14, border: isToday ? `2px solid ${BDAY_PINK}` : "2px solid transparent" }}>
                  <div style={{ width: 48, height: 48, borderRadius: 14, background: isToday ? "#FCE4EC" : isSoon ? "#FFF3E0" : "#F5F5F5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0 }}>
                    {isToday ? "🎂" : isSoon ? "🎁" : "🎈"}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 16, fontWeight: 600, color: "#2D3436" }}>{b.name}</div>
                    <div style={{ fontSize: 13, color: "#AAA", marginTop: 2 }}>
                      {formatBirthdayDate(b.date)}{age ? ` · גיל ${age}` : ""}
                    </div>
                  </div>
                  <div style={{ textAlign: "center", flexShrink: 0 }}>
                    {isToday
                      ? <span style={{ fontSize: 12, fontWeight: 700, color: BDAY_PINK, background: "#FCE4EC", padding: "4px 10px", borderRadius: 10 }}>🎉 היום!</span>
                      : isSoon
                        ? <span style={{ fontSize: 12, fontWeight: 700, color: "#E65100", background: "#FFF3E0", padding: "4px 10px", borderRadius: 10 }}>בעוד {days} ימים</span>
                        : <span style={{ fontSize: 12, color: "#BBB" }}>בעוד {days} ימים</span>
                    }
                  </div>
                </div>
              </SwipeItem>
            );
          })}
        </div>
      </div>

      {!showAdd && <FAB onClick={() => setShowAdd(true)} color={`linear-gradient(135deg, ${BDAY_PINK}, ${BDAY_DARK})`} shadow="rgba(233,30,99,0.4)" />}

      {/* Undo Delete Toast */}
      {pendingDelete && (
        <div style={{ position: "fixed", bottom: 104, left: "50%", transform: "translateX(-50%)", background: "#2D3436", color: "#fff", borderRadius: 14, padding: "12px 18px", display: "flex", alignItems: "center", gap: 14, zIndex: 60, boxShadow: "0 6px 24px rgba(0,0,0,0.3)", whiteSpace: "nowrap", animation: "slideUp 0.25s ease" }}>
          <span style={{ fontSize: 14 }}>🗑️ "{pendingDelete.bday.name}" נמחק</span>
          <button onClick={undoDelete} style={{ background: BDAY_PINK, border: "none", borderRadius: 8, padding: "6px 14px", color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>ביטול</button>
        </div>
      )}

      {/* Edit Modal */}
      {editingBday && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={(e) => { if (e.target === e.currentTarget) closeEdit(); }}>
          <div dir="rtl" style={{ background: "#fff", borderRadius: "24px 24px 0 0", padding: 24, width: "100%", maxWidth: 480, animation: "slideUp 0.3s ease" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: "#2D3436" }}>✏️ עריכה</h3>
              <button onClick={closeEdit} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#999", lineHeight: 1 }}>✕</button>
            </div>
            <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="שם *" autoFocus
              style={inputStyle} onFocus={(e) => (e.target.style.borderColor = BDAY_PINK)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
            <div style={{ marginTop: 10 }}>
              <p style={{ margin: "0 0 6px", fontSize: 13, color: "#888" }}>תאריך לידה</p>
              <input value={editDate} onChange={(e) => setEditDate(e.target.value)} type="date"
                style={{ ...inputStyle, color: editDate ? "#2D3436" : "#CCC" }} onFocus={(e) => (e.target.style.borderColor = BDAY_PINK)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16, paddingBottom: 8 }}>
              <button onClick={updateBirthday} disabled={!editName.trim() || !editDate}
                style={{ flex: 1, border: "none", background: editName.trim() && editDate ? `linear-gradient(135deg, ${BDAY_PINK}, ${BDAY_DARK})` : "#ccc", color: "#fff", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 600, fontFamily: "inherit", cursor: editName.trim() && editDate ? "pointer" : "default" }}>
                שמור שינויים ✓
              </button>
              <button onClick={closeEdit}
                style={{ border: "2px solid #E8E5E0", background: "#fff", color: "#999", borderRadius: 12, padding: "14px 20px", fontSize: 15, fontFamily: "inherit", cursor: "pointer" }}>✕</button>
            </div>
          </div>
        </div>
      )}

      <GlobalStyles />
    </div>
  );
}

// ─── ServiceProvidersScreen ──────────────────────────────────────────────────

const SP_ORANGE = "#EF6C00";
const SP_DARK   = "#E65100";

// Strip everything except digits and a single leading + so tel:/wa.me links work.
function normalizePhone(raw) {
  if (!raw) return "";
  const trimmed = String(raw).trim();
  const hasPlus = trimmed.startsWith("+");
  const digits  = trimmed.replace(/\D/g, "");
  return hasPlus ? `+${digits}` : digits;
}

// For wa.me we need digits only; assume Israeli local numbers starting with 0
// map to +972. Otherwise keep the digits (caller already included country code).
function toWhatsAppDigits(raw) {
  const n = normalizePhone(raw);
  if (!n) return "";
  if (n.startsWith("+")) return n.slice(1);
  if (n.startsWith("00")) return n.slice(2);
  if (n.startsWith("0"))  return `972${n.slice(1)}`;
  return n;
}

function ServiceProvidersScreen({ userName, householdId, onBack }) {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showAdd, setShowAdd]     = useState(false);
  const [name, setName]                 = useState("");
  const [profession, setProfession]     = useState("");
  const [phone, setPhone]               = useState("");
  const [notes, setNotes]               = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);
  const [editing, setEditing]             = useState(null);
  const [editName, setEditName]           = useState("");
  const [editProfession, setEditProfession] = useState("");
  const [editPhone, setEditPhone]           = useState("");
  const [editNotes, setEditNotes]           = useState("");

  useEffect(() => {
    const q = query(
      collection(db, "households", householdId, "service_providers"),
      orderBy("name", "asc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => { setProviders(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); },
      (err) => { console.error("service_providers listener error:", err); setLoading(false); }
    );
    return () => unsub();
  }, [householdId]);

  const addProvider = async () => {
    if (!name.trim() || !phone.trim()) return;
    try {
      await addDoc(collection(db, "households", householdId, "service_providers"), {
        name:       name.trim(),
        profession: profession.trim(),
        phone:      normalizePhone(phone),
        notes:      notes.trim(),
        addedBy:    userName,
        createdAt:  new Date().toISOString(),
      });
    } catch (e) { console.error(e); }
    setName(""); setProfession(""); setPhone(""); setNotes(""); setShowAdd(false);
  };

  const removeProvider = (id, data) => {
    if (pendingDelete) clearTimeout(pendingDelete.timerId);
    const timerId = setTimeout(async () => {
      try { await deleteDoc(doc(db, "households", householdId, "service_providers", id)); }
      catch (e) { console.error(e); }
      setPendingDelete(null);
    }, 4500);
    setPendingDelete({ id, provider: data, timerId });
  };

  const undoDelete = () => { if (pendingDelete) { clearTimeout(pendingDelete.timerId); setPendingDelete(null); } };

  const openEdit = (p) => {
    setEditing(p);
    setEditName(p.name || "");
    setEditProfession(p.profession || "");
    setEditPhone(p.phone || "");
    setEditNotes(p.notes || "");
  };
  const closeEdit = () => setEditing(null);
  const updateProvider = async () => {
    if (!editName.trim() || !editPhone.trim()) return;
    try {
      await updateDoc(doc(db, "households", householdId, "service_providers", editing.id), {
        name:       editName.trim(),
        profession: editProfession.trim(),
        phone:      normalizePhone(editPhone),
        notes:      editNotes.trim(),
      });
      closeEdit();
    } catch (e) { console.error(e); }
  };

  const visible = providers.filter(p => p.id !== pendingDelete?.id);

  if (loading) return <Loader />;

  return (
    <div dir="rtl" style={{ fontFamily: "'Rubik', sans-serif", maxWidth: 480, margin: "0 auto", minHeight: "100vh", background: "linear-gradient(165deg, #FAFAFA 0%, #F0EDE8 100%)" }}>
      {/* Header */}
      <div style={{ background: `linear-gradient(135deg, ${SP_ORANGE} 0%, ${SP_DARK} 100%)`, padding: "28px 24px 20px", borderRadius: "0 0 28px 28px", boxShadow: "0 8px 32px rgba(239,108,0,0.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: "#fff" }}>🛠️ אנשי מקצוע</h1>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "rgba(255,255,255,0.6)", fontWeight: 300 }}>{providers.length} אנשי קשר שמורים</p>
          </div>
          <BackButton onBack={onBack} light />
        </div>
      </div>

      <div style={{ padding: "16px 16px 100px" }}>
        {/* Add form */}
        {showAdd && (
          <div style={{ background: "#fff", borderRadius: 20, padding: 20, marginBottom: 16, boxShadow: "0 4px 20px rgba(0,0,0,0.08)", animation: "slideDown 0.3s ease" }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 600, color: "#2D3436" }}>איש מקצוע חדש</h3>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="שם *" autoFocus
              style={inputStyle} onFocus={(e) => (e.target.style.borderColor = SP_ORANGE)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
            <div style={{ marginTop: 10 }}>
              <input value={profession} onChange={(e) => setProfession(e.target.value)} placeholder="מקצוע (חשמלאי, אינסטלטור...)"
                style={inputStyle} onFocus={(e) => (e.target.style.borderColor = SP_ORANGE)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
            </div>
            <div style={{ marginTop: 10 }}>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="טלפון *" type="tel" inputMode="tel" dir="ltr"
                style={{ ...inputStyle, textAlign: "right" }} onFocus={(e) => (e.target.style.borderColor = SP_ORANGE)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
            </div>
            <div style={{ marginTop: 10 }}>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="הערות (אופציונלי)"
                style={inputStyle} onFocus={(e) => (e.target.style.borderColor = SP_ORANGE)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={addProvider} disabled={!name.trim() || !phone.trim()}
                style={{ flex: 1, border: "none", background: name.trim() && phone.trim() ? `linear-gradient(135deg, ${SP_ORANGE}, ${SP_DARK})` : "#ccc", color: "#fff", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 600, fontFamily: "inherit", cursor: name.trim() && phone.trim() ? "pointer" : "default" }}>
                שמור ✓
              </button>
              <button onClick={() => { setShowAdd(false); setName(""); setProfession(""); setPhone(""); setNotes(""); }}
                style={{ border: "2px solid #E8E5E0", background: "#fff", color: "#999", borderRadius: 12, padding: "14px 20px", fontSize: 15, fontFamily: "inherit", cursor: "pointer" }}>✕</button>
            </div>
          </div>
        )}

        {visible.length === 0 && !showAdd && (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>🛠️</div>
            <p style={{ fontSize: 18, color: "#999", fontWeight: 300 }}>אין אנשי קשר שמורים</p>
            <p style={{ fontSize: 14, color: "#CCC", fontWeight: 300, marginTop: 4 }}>לחצו על + כדי להוסיף</p>
          </div>
        )}

        {visible.length > 0 && <p style={{ textAlign: "center", fontSize: 12, color: "#BBB", margin: "8px 0 12px", fontWeight: 300 }}>עריכה → | ← מחיקה</p>}

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {visible.map((p) => {
            const telHref = p.phone ? `tel:${normalizePhone(p.phone)}` : null;
            const waHref  = p.phone ? `https://wa.me/${toWhatsAppDigits(p.phone)}` : null;
            return (
              <SwipeItem key={p.id} borderRadius={18} onSwipeLeft={() => removeProvider(p.id, p)} onSwipeRight={() => openEdit(p)}>
                <div style={{ background: "#fff", borderRadius: 18, padding: "16px 18px", boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <div style={{ width: 48, height: 48, borderRadius: 14, background: "#FFF3E0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0 }}>
                      🛠️
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 600, color: "#2D3436", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                      {p.profession && <div style={{ fontSize: 13, color: SP_ORANGE, marginTop: 2, fontWeight: 500 }}>{p.profession}</div>}
                      {p.phone && <div dir="ltr" style={{ fontSize: 13, color: "#888", marginTop: 2, textAlign: "right" }}>{p.phone}</div>}
                      {p.notes && <div style={{ fontSize: 12, color: "#AAA", marginTop: 4 }}>{p.notes}</div>}
                    </div>
                  </div>
                  {p.phone && (
                    <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                      <a href={telHref}
                        style={{ flex: 1, textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: `linear-gradient(135deg, ${SP_ORANGE}, ${SP_DARK})`, color: "#fff", borderRadius: 12, padding: "12px", fontSize: 14, fontWeight: 600, boxShadow: "0 4px 14px rgba(239,108,0,0.3)" }}>
                        📞 התקשר
                      </a>
                      <a href={waHref} target="_blank" rel="noopener noreferrer"
                        style={{ flex: 1, textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#25D366", color: "#fff", borderRadius: 12, padding: "12px", fontSize: 14, fontWeight: 600, boxShadow: "0 4px 14px rgba(37,211,102,0.3)" }}>
                        💬 WhatsApp
                      </a>
                    </div>
                  )}
                </div>
              </SwipeItem>
            );
          })}
        </div>
      </div>

      {!showAdd && <FAB onClick={() => setShowAdd(true)} color={`linear-gradient(135deg, ${SP_ORANGE}, ${SP_DARK})`} shadow="rgba(239,108,0,0.4)" />}

      {/* Undo Delete Toast */}
      {pendingDelete && (
        <div style={{ position: "fixed", bottom: 104, left: "50%", transform: "translateX(-50%)", background: "#2D3436", color: "#fff", borderRadius: 14, padding: "12px 18px", display: "flex", alignItems: "center", gap: 14, zIndex: 60, boxShadow: "0 6px 24px rgba(0,0,0,0.3)", whiteSpace: "nowrap", animation: "slideUp 0.25s ease" }}>
          <span style={{ fontSize: 14 }}>🗑️ "{pendingDelete.provider.name}" נמחק</span>
          <button onClick={undoDelete} style={{ background: SP_ORANGE, border: "none", borderRadius: 8, padding: "6px 14px", color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>ביטול</button>
        </div>
      )}

      {/* Edit Modal */}
      {editing && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={(e) => { if (e.target === e.currentTarget) closeEdit(); }}>
          <div dir="rtl" style={{ background: "#fff", borderRadius: "24px 24px 0 0", padding: 24, width: "100%", maxWidth: 480, animation: "slideUp 0.3s ease" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: "#2D3436" }}>✏️ עריכה</h3>
              <button onClick={closeEdit} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#999", lineHeight: 1 }}>✕</button>
            </div>
            <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="שם *" autoFocus
              style={inputStyle} onFocus={(e) => (e.target.style.borderColor = SP_ORANGE)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
            <div style={{ marginTop: 10 }}>
              <input value={editProfession} onChange={(e) => setEditProfession(e.target.value)} placeholder="מקצוע"
                style={inputStyle} onFocus={(e) => (e.target.style.borderColor = SP_ORANGE)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
            </div>
            <div style={{ marginTop: 10 }}>
              <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="טלפון *" type="tel" inputMode="tel" dir="ltr"
                style={{ ...inputStyle, textAlign: "right" }} onFocus={(e) => (e.target.style.borderColor = SP_ORANGE)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
            </div>
            <div style={{ marginTop: 10 }}>
              <input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="הערות"
                style={inputStyle} onFocus={(e) => (e.target.style.borderColor = SP_ORANGE)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16, paddingBottom: 8 }}>
              <button onClick={updateProvider} disabled={!editName.trim() || !editPhone.trim()}
                style={{ flex: 1, border: "none", background: editName.trim() && editPhone.trim() ? `linear-gradient(135deg, ${SP_ORANGE}, ${SP_DARK})` : "#ccc", color: "#fff", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 600, fontFamily: "inherit", cursor: editName.trim() && editPhone.trim() ? "pointer" : "default" }}>
                שמור שינויים ✓
              </button>
              <button onClick={closeEdit}
                style={{ border: "2px solid #E8E5E0", background: "#fff", color: "#999", borderRadius: 12, padding: "14px 20px", fontSize: 15, fontFamily: "inherit", cursor: "pointer" }}>✕</button>
            </div>
          </div>
        </div>
      )}

      <GlobalStyles />
    </div>
  );
}

// ─── SubscriptionsScreen ─────────────────────────────────────────────────────

const SUB_GREEN  = "#00897B";
const SUB_DARK   = "#00695C";

const SUB_PRESETS = [
  { name: "Netflix",        icon: "🎬" },
  { name: "Disney+",        icon: "🏰" },
  { name: "Apple TV+",      icon: "🍎" },
  { name: "Spotify",        icon: "🎵" },
  { name: "YouTube Premium",icon: "▶️" },
  { name: "כבלים / HOT",    icon: "📡" },
  { name: "אינטרנט",        icon: "🌐" },
  { name: "סלולר",          icon: "📱" },
  { name: "iCloud",         icon: "☁️" },
  { name: "Amazon Prime",   icon: "📦" },
  { name: "Xbox / PS Plus", icon: "🎮" },
];

function getDaysUntilRenewal(dateStr) {
  if (!dateStr) return Infinity;
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(dateStr); d.setHours(0,0,0,0);
  return Math.round((d - today) / 86400000);
}

function SubscriptionsScreen({ userName, householdId, onBack }) {
  const MAX_FILE_SIZE = 5 * 1024 * 1024;
  const [subs, setSubs]               = useState([]);
  const [loading, setLoading]         = useState(true);
  const [showAdd, setShowAdd]         = useState(false);
  const [name, setName]               = useState("");
  const [customIcon, setCustomIcon]   = useState("📺");
  const [price, setPrice]             = useState("");
  const [renewalDate, setRenewalDate] = useState("");
  const [file, setFile]               = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const [fileError, setFileError]     = useState(null);
  const [uploading, setUploading]     = useState(false);
  const fileInputRef                  = useRef(null);
  const [lightboxSrc, setLightboxSrc] = useState(null);

  const [pendingDelete, setPendingDelete]       = useState(null);
  const [editingSub, setEditingSub]             = useState(null);
  const [editName, setEditName]                 = useState("");
  const [editIcon, setEditIcon]                 = useState("📺");
  const [editPrice, setEditPrice]               = useState("");
  const [editRenewalDate, setEditRenewalDate]   = useState("");
  const [editFile, setEditFile]                 = useState(null);
  const [editFilePreview, setEditFilePreview]   = useState(null);
  const [editFileError, setEditFileError]       = useState(null);
  const [editUploading, setEditUploading]       = useState(false);
  const editFileInputRef                        = useRef(null);

  useEffect(() => {
    const q = query(collection(db, "households", householdId, "subscriptions"), orderBy("renewalDate", "asc"));
    const unsub = onSnapshot(
      q,
      (snap) => { setSubs(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); },
      (err) => { console.error("subscriptions listener error:", err); setLoading(false); }
    );
    return () => unsub();
  }, [householdId]);

  const handleFileChange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > MAX_FILE_SIZE) { setFileError(`הקובץ גדול מדי — מקסימום 5MB`); e.target.value = ""; return; }
    setFileError(null); setFile(f);
    if (f.type.startsWith("image/")) { const r = new FileReader(); r.onload = (ev) => setFilePreview(ev.target.result); r.readAsDataURL(f); }
    else setFilePreview("pdf");
  };

  const handleEditFileChange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > MAX_FILE_SIZE) { setEditFileError(`הקובץ גדול מדי — מקסימום 5MB`); e.target.value = ""; return; }
    setEditFileError(null); setEditFile(f);
    if (f.type.startsWith("image/")) { const r = new FileReader(); r.onload = (ev) => setEditFilePreview(ev.target.result); r.readAsDataURL(f); }
    else setEditFilePreview("pdf");
  };

  const resetForm = () => { setName(""); setCustomIcon("📺"); setPrice(""); setRenewalDate(""); setFile(null); setFilePreview(null); setFileError(null); setShowAdd(false); };

  const addSub = async () => {
    if (!name.trim()) return;
    setUploading(true);
    try {
      let fileUrl = "", filePath = "", fileType = "";
      if (file) {
        filePath = `households/${householdId}/subscriptions/${Date.now()}_${file.name}`;
        const sRef = ref(storage, filePath);
        await uploadBytes(sRef, file, { contentType: file.type });
        fileUrl = await getDownloadURL(sRef);
        fileType = file.type;
      }
      await addDoc(collection(db, "households", householdId, "subscriptions"), { name: name.trim(), icon: customIcon, price: price.trim(), renewalDate, fileUrl, filePath, fileType, addedBy: userName, date: new Date().toISOString() });
      resetForm();
    } catch (e) { console.error(e); }
    setUploading(false);
  };

  const removeSub = (id, subData) => {
    if (pendingDelete) clearTimeout(pendingDelete.timerId);
    const timerId = setTimeout(async () => {
      try { await deleteDoc(doc(db, "households", householdId, "subscriptions", id)); } catch (e) { console.error(e); }
      setPendingDelete(null);
    }, 4500);
    setPendingDelete({ id, sub: subData, timerId });
  };

  const undoDelete = () => { if (pendingDelete) { clearTimeout(pendingDelete.timerId); setPendingDelete(null); } };

  const openEdit = (s) => {
    setEditingSub(s); setEditName(s.name); setEditIcon(s.icon || "📺");
    setEditPrice(s.price || ""); setEditRenewalDate(s.renewalDate || "");
    setEditFile(null); setEditFileError(null);
    setEditFilePreview(s.fileUrl ? (s.fileType?.startsWith("image/") ? s.fileUrl : "pdf") : null);
  };
  const closeEdit = () => { setEditingSub(null); setEditFile(null); setEditFilePreview(null); setEditFileError(null); };

  const updateSub = async () => {
    if (!editName.trim()) return;
    setEditUploading(true);
    try {
      let fileUrl  = editingSub.fileUrl  || "";
      let filePath = editingSub.filePath || "";
      let fileType = editingSub.fileType || "";
      if (editFile) {
        filePath = `households/${householdId}/subscriptions/${Date.now()}_${editFile.name}`;
        const sRef = ref(storage, filePath);
        await uploadBytes(sRef, editFile, { contentType: editFile.type });
        fileUrl = await getDownloadURL(sRef);
        fileType = editFile.type;
      }
      await updateDoc(doc(db, "households", householdId, "subscriptions", editingSub.id), { name: editName.trim(), icon: editIcon, price: editPrice.trim(), renewalDate: editRenewalDate, fileUrl, filePath, fileType });
      closeEdit();
    } catch (e) { console.error(e); }
    setEditUploading(false);
  };

  const selectPreset = (preset) => { setName(preset.name); setCustomIcon(preset.icon); };

  const sorted = [...subs]
    .filter(s => s.id !== pendingDelete?.id)
    .sort((a, b) => getDaysUntilRenewal(a.renewalDate) - getDaysUntilRenewal(b.renewalDate));

  const totalMonthly = subs.reduce((sum, s) => sum + (parseFloat(s.price) || 0), 0);

  if (loading) return <Loader />;

  const FileArea = ({ preview, f, inputRef, onChange, onClear, error, accentColor }) => (
    <div style={{ marginTop: 10 }}>
      <input ref={inputRef} type="file" accept="image/*,application/pdf" onChange={onChange} style={{ display: "none" }} />
      {preview ? (
        <div style={{ position: "relative" }}>
          {preview === "pdf"
            ? <div style={{ background: "#E0F2F1", borderRadius: 12, padding: 14, textAlign: "center", color: accentColor, fontSize: 14 }}>📄 {f?.name || "קובץ מצורף"}</div>
            : <img src={preview} alt="preview" onClick={() => setLightboxSrc(preview)} style={{ width: "100%", borderRadius: 12, maxHeight: 160, objectFit: "cover", cursor: "zoom-in" }} />
          }
          <button onClick={onClear} style={{ position: "absolute", top: 8, left: 8, background: "rgba(0,0,0,0.5)", color: "#fff", border: "none", borderRadius: "50%", width: 28, height: 28, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>
      ) : (
        <button onClick={() => inputRef.current.click()}
          style={{ width: "100%", border: `2px dashed ${error ? "#E53935" : "#E8E5E0"}`, background: error ? "#FFF5F5" : "#FAFAFA", borderRadius: 12, padding: 14, cursor: "pointer", fontSize: 14, color: error ? "#E53935" : "#AAA", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          📎 צרף הסכם / תמונה (אופציונלי)
        </button>
      )}
      {error && <p style={{ margin: "6px 0 0", fontSize: 12, color: "#E53935", fontWeight: 500 }}>⚠️ {error}</p>}
    </div>
  );

  return (
    <div dir="rtl" style={{ fontFamily: "'Rubik', sans-serif", maxWidth: 480, margin: "0 auto", minHeight: "100vh", background: "linear-gradient(165deg, #FAFAFA 0%, #F0EDE8 100%)" }}>
      {/* Header */}
      <div style={{ background: `linear-gradient(135deg, ${SUB_GREEN} 0%, ${SUB_DARK} 100%)`, padding: "28px 24px 20px", borderRadius: "0 0 28px 28px", boxShadow: "0 8px 32px rgba(0,137,123,0.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: "#fff" }}>📺 מנויים</h1>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "rgba(255,255,255,0.7)", fontWeight: 300 }}>
              {subs.length} מנויים{totalMonthly > 0 ? ` · ₪${totalMonthly.toFixed(0)}/חודש` : ""}
            </p>
          </div>
          <BackButton onBack={onBack} light />
        </div>
      </div>

      <div style={{ padding: "16px 16px 100px" }}>
        {/* Add form */}
        {showAdd && (
          <div style={{ background: "#fff", borderRadius: 20, padding: 20, marginBottom: 16, boxShadow: "0 4px 20px rgba(0,0,0,0.08)", animation: "slideDown 0.3s ease" }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 600, color: "#2D3436" }}>מנוי חדש</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
              {SUB_PRESETS.map(p => (
                <button key={p.name} onClick={() => selectPreset(p)}
                  style={{ border: name === p.name ? `2px solid ${SUB_GREEN}` : "2px solid #E8E5E0", background: name === p.name ? "#E0F2F1" : "#FAFAFA", borderRadius: 10, padding: "6px 10px", cursor: "pointer", fontSize: 13, fontFamily: "inherit", fontWeight: name === p.name ? 600 : 400, color: name === p.name ? SUB_GREEN : "#666", display: "flex", alignItems: "center", gap: 4 }}>
                  {p.icon} {p.name}
                </button>
              ))}
            </div>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="שם המנוי *"
              style={inputStyle} onFocus={(e) => (e.target.style.borderColor = SUB_GREEN)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <div style={{ flex: 1 }}>
                <p style={{ margin: "0 0 6px", fontSize: 13, color: "#888" }}>מחיר חודשי (₪)</p>
                <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" type="number" min="0"
                  style={{ ...inputStyle, textAlign: "left" }} onFocus={(e) => (e.target.style.borderColor = SUB_GREEN)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: "0 0 6px", fontSize: 13, color: "#888" }}>תאריך חידוש</p>
                <input value={renewalDate} onChange={(e) => setRenewalDate(e.target.value)} type="date"
                  style={{ ...inputStyle, color: renewalDate ? "#2D3436" : "#CCC" }} onFocus={(e) => (e.target.style.borderColor = SUB_GREEN)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
              </div>
            </div>
            <FileArea preview={filePreview} f={file} inputRef={fileInputRef} onChange={handleFileChange} onClear={() => { setFile(null); setFilePreview(null); }} error={fileError} accentColor={SUB_GREEN} />
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={addSub} disabled={!name.trim() || uploading}
                style={{ flex: 1, border: "none", background: name.trim() && !uploading ? `linear-gradient(135deg, ${SUB_GREEN}, ${SUB_DARK})` : "#ccc", color: "#fff", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 600, fontFamily: "inherit", cursor: name.trim() && !uploading ? "pointer" : "default" }}>
                {uploading ? "מעלה..." : "שמור ✓"}
              </button>
              <button onClick={resetForm}
                style={{ border: "2px solid #E8E5E0", background: "#fff", color: "#999", borderRadius: 12, padding: "14px 20px", fontSize: 15, fontFamily: "inherit", cursor: "pointer" }}>✕</button>
            </div>
          </div>
        )}

        {sorted.length === 0 && !showAdd && (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>📺</div>
            <p style={{ fontSize: 18, color: "#999", fontWeight: 300 }}>אין מנויים שמורים</p>
            <p style={{ fontSize: 14, color: "#CCC", fontWeight: 300, marginTop: 4 }}>לחצו על + כדי להוסיף</p>
          </div>
        )}

        {sorted.length > 0 && <p style={{ textAlign: "center", fontSize: 12, color: "#BBB", margin: "8px 0 12px", fontWeight: 300 }}>עריכה → | ← מחיקה</p>}

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {sorted.map((s) => {
            const days      = getDaysUntilRenewal(s.renewalDate);
            const isToday   = days === 0;
            const isSoon    = days > 0 && days <= 7;
            const isExpired = days < 0;
            const isPdf     = s.fileType === "application/pdf" || s.filePath?.toLowerCase().endsWith(".pdf");
            return (
              <SwipeItem key={s.id} borderRadius={18} onSwipeLeft={() => removeSub(s.id, s)} onSwipeRight={() => openEdit(s)}>
                <div style={{ background: "#fff", borderRadius: 18, overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,0.06)", border: isExpired ? "2px solid #E53935" : isToday ? `2px solid ${SUB_GREEN}` : "2px solid transparent" }}>
                  {s.fileUrl && (
                    isPdf ? (
                      <a href={s.fileUrl} target="_blank" rel="noopener noreferrer"
                        style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, height: 52, background: "#E0F2F1", textDecoration: "none" }}>
                        <span style={{ fontSize: 20 }}>📄</span>
                        <span style={{ color: SUB_GREEN, fontWeight: 600, fontSize: 13 }}>פתח הסכם PDF</span>
                        <span style={{ fontSize: 12, color: "#80CBC4" }}>↗</span>
                      </a>
                    ) : (
                      <img src={s.fileUrl} alt={s.name} onClick={(e) => { e.stopPropagation(); setLightboxSrc(s.fileUrl); }} style={{ width: "100%", height: 110, objectFit: "cover", cursor: "zoom-in" }} />
                    )
                  )}
                  <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 14 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: isExpired ? "#FFEBEE" : isToday ? "#E0F2F1" : isSoon ? "#FFF3E0" : "#F5F5F5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>
                      {s.icon || "📺"}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 16, fontWeight: 600, color: "#2D3436" }}>{s.name}</div>
                      <div style={{ fontSize: 13, color: "#AAA", marginTop: 2 }}>
                        {s.price ? `₪${s.price}/חודש` : ""}
                        {s.price && s.renewalDate ? " · " : ""}
                        {s.renewalDate ? `חידוש ${new Date(s.renewalDate).toLocaleDateString("he-IL")}` : ""}
                      </div>
                    </div>
                    <div style={{ flexShrink: 0 }}>
                      {isExpired
                        ? <span style={{ fontSize: 12, fontWeight: 700, color: "#E53935", background: "#FFEBEE", padding: "4px 10px", borderRadius: 10 }}>פג תוקף</span>
                        : isToday
                          ? <span style={{ fontSize: 12, fontWeight: 700, color: SUB_GREEN, background: "#E0F2F1", padding: "4px 10px", borderRadius: 10 }}>היום!</span>
                          : isSoon
                            ? <span style={{ fontSize: 12, fontWeight: 700, color: "#E65100", background: "#FFF3E0", padding: "4px 10px", borderRadius: 10 }}>בעוד {days}י׳</span>
                            : s.renewalDate
                              ? <span style={{ fontSize: 12, color: "#BBB" }}>בעוד {days}י׳</span>
                              : null
                      }
                    </div>
                  </div>
                </div>
              </SwipeItem>
            );
          })}
        </div>
      </div>

      {!showAdd && <FAB onClick={() => setShowAdd(true)} color={`linear-gradient(135deg, ${SUB_GREEN}, ${SUB_DARK})`} shadow="rgba(0,137,123,0.4)" />}

      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />

      {/* Undo Delete Toast */}
      {pendingDelete && (
        <div style={{ position: "fixed", bottom: 104, left: "50%", transform: "translateX(-50%)", background: "#2D3436", color: "#fff", borderRadius: 14, padding: "12px 18px", display: "flex", alignItems: "center", gap: 14, zIndex: 60, boxShadow: "0 6px 24px rgba(0,0,0,0.3)", whiteSpace: "nowrap", animation: "slideUp 0.25s ease" }}>
          <span style={{ fontSize: 14 }}>🗑️ "{pendingDelete.sub.name}" נמחק</span>
          <button onClick={undoDelete} style={{ background: SUB_GREEN, border: "none", borderRadius: 8, padding: "6px 14px", color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>ביטול</button>
        </div>
      )}

      {/* Edit Modal */}
      {editingSub && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={(e) => { if (e.target === e.currentTarget) closeEdit(); }}>
          <div dir="rtl" style={{ background: "#fff", borderRadius: "24px 24px 0 0", padding: 24, width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto", animation: "slideUp 0.3s ease" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: "#2D3436" }}>✏️ עריכת מנוי</h3>
              <button onClick={closeEdit} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#999", lineHeight: 1 }}>✕</button>
            </div>
            <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="שם המנוי *" autoFocus
              style={inputStyle} onFocus={(e) => (e.target.style.borderColor = SUB_GREEN)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <div style={{ flex: 1 }}>
                <p style={{ margin: "0 0 6px", fontSize: 13, color: "#888" }}>מחיר חודשי (₪)</p>
                <input value={editPrice} onChange={(e) => setEditPrice(e.target.value)} placeholder="0" type="number" min="0"
                  style={{ ...inputStyle, textAlign: "left" }} onFocus={(e) => (e.target.style.borderColor = SUB_GREEN)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: "0 0 6px", fontSize: 13, color: "#888" }}>תאריך חידוש</p>
                <input value={editRenewalDate} onChange={(e) => setEditRenewalDate(e.target.value)} type="date"
                  style={{ ...inputStyle, color: editRenewalDate ? "#2D3436" : "#CCC" }} onFocus={(e) => (e.target.style.borderColor = SUB_GREEN)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
              </div>
            </div>
            <FileArea preview={editFilePreview} f={editFile} inputRef={editFileInputRef} onChange={handleEditFileChange} onClear={() => { setEditFile(null); setEditFilePreview(null); }} error={editFileError} accentColor={SUB_GREEN} />
            <div style={{ display: "flex", gap: 8, marginTop: 16, paddingBottom: 8 }}>
              <button onClick={updateSub} disabled={!editName.trim() || editUploading}
                style={{ flex: 1, border: "none", background: editName.trim() && !editUploading ? `linear-gradient(135deg, ${SUB_GREEN}, ${SUB_DARK})` : "#ccc", color: "#fff", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 600, fontFamily: "inherit", cursor: editName.trim() && !editUploading ? "pointer" : "default" }}>
                {editUploading ? "שומר..." : "שמור שינויים ✓"}
              </button>
              <button onClick={closeEdit}
                style={{ border: "2px solid #E8E5E0", background: "#fff", color: "#999", borderRadius: 12, padding: "14px 20px", fontSize: 15, fontFamily: "inherit", cursor: "pointer" }}>✕</button>
            </div>
          </div>
        </div>
      )}

      <GlobalStyles />
    </div>
  );
}

// ─── BillsScreen ─────────────────────────────────────────────────────────────

const BILL_PRESETS = [
  { name: "חשמל",       icon: "⚡" }, { name: "מים",        icon: "💧" },
  { name: "גז",         icon: "🔥" }, { name: "ארנונה",     icon: "🏛️" },
  { name: "אינטרנט",   icon: "🌐" }, { name: "טלפון",      icon: "📞" },
  { name: "ביטוח רכב", icon: "🚗" }, { name: "ועד בית",    icon: "🏢" },
];

function getBillUrgency(bill) {
  if (bill.paid) return { tier: "paid", label: "שולם", color: "#AAA", bg: "#F5F5F5", border: "transparent" };
  const today = new Date(); today.setHours(0,0,0,0);
  const due   = new Date(bill.dueDate); due.setHours(0,0,0,0);
  const days  = Math.round((due - today) / 86400000);
  if (days < 0)  return { tier: "overdue", label: `פג ${Math.abs(days)} ימים`, color: "#E53935", bg: "#FFEBEE", border: "#E53935" };
  if (days <= 7) return { tier: "soon",    label: `${days} ימים`,              color: "#E65100", bg: "#FFF3E0", border: "#FF9800" };
  return { tier: "upcoming", label: `${days} ימים`, color: "#43A047", bg: "#E8F5E9", border: "transparent" };
}

function BillsScreen({ userName, householdId, onBack }) {
  const MAX_FILE_SIZE = 5 * 1024 * 1024;

  const [bills, setBills]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [showAdd, setShowAdd]         = useState(false);
  const [provider, setProvider]       = useState("");
  const [amount, setAmount]           = useState("");
  const [dueDate, setDueDate]         = useState("");
  const [notes, setNotes]             = useState("");
  const [file, setFile]               = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const [fileError, setFileError]     = useState(null);
  const [uploading, setUploading]     = useState(false);
  const fileInputRef                  = useRef(null);

  const [pendingDelete, setPendingDelete]         = useState(null);
  const [editingBill, setEditingBill]             = useState(null);
  const [editProvider, setEditProvider]           = useState("");
  const [editAmount, setEditAmount]               = useState("");
  const [editDueDate, setEditDueDate]             = useState("");
  const [editNotes, setEditNotes]                 = useState("");
  const [editFile, setEditFile]                   = useState(null);
  const [editFilePreview, setEditFilePreview]     = useState(null);
  const [editFileError, setEditFileError]         = useState(null);
  const [editUploading, setEditUploading]         = useState(false);
  const editFileInputRef                          = useRef(null);

  const [scanning, setScanning]       = useState(false);
  const [scanError, setScanError]     = useState(null);
  const [scanResults, setScanResults] = useState(null);

  useEffect(() => {
    const q = query(collection(db, "households", householdId, "bills"), orderBy("dueDate", "asc"));
    const unsub = onSnapshot(
      q,
      (snap) => { setBills(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); },
      (err)  => { console.error("bills listener error:", err); setLoading(false); }
    );
    return () => unsub();
  }, [householdId]);

  const handleFileChange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > MAX_FILE_SIZE) { setFileError("הקובץ גדול מדי — מקסימום 5MB"); e.target.value = ""; return; }
    setFileError(null); setFile(f);
    if (f.type.startsWith("image/")) { const r = new FileReader(); r.onload = (ev) => setFilePreview(ev.target.result); r.readAsDataURL(f); }
    else setFilePreview("pdf");
  };

  const handleEditFileChange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > MAX_FILE_SIZE) { setEditFileError("הקובץ גדול מדי — מקסימום 5MB"); e.target.value = ""; return; }
    setEditFileError(null); setEditFile(f);
    if (f.type.startsWith("image/")) { const r = new FileReader(); r.onload = (ev) => setEditFilePreview(ev.target.result); r.readAsDataURL(f); }
    else setEditFilePreview("pdf");
  };

  const resetForm = () => { setProvider(""); setAmount(""); setDueDate(""); setNotes(""); setFile(null); setFilePreview(null); setFileError(null); setShowAdd(false); };

  const addBill = async () => {
    if (!provider.trim() || !dueDate) return;
    setUploading(true);
    try {
      let fileUrl = "", filePath = "", fileType = "";
      if (file) {
        filePath = `households/${householdId}/bills/${Date.now()}_${file.name}`;
        const sRef = ref(storage, filePath);
        await uploadBytes(sRef, file, { contentType: file.type });
        fileUrl = await getDownloadURL(sRef);
        fileType = file.type;
      }
      await addDoc(collection(db, "households", householdId, "bills"), {
        provider: provider.trim(), amount: parseFloat(amount) || 0, currency: "ILS",
        dueDate, paid: false, paidAt: null, notes: notes.trim(),
        source: "manual", gmailMessageId: null,
        fileUrl, filePath, fileType, addedBy: userName, createdAt: new Date().toISOString(),
      });
      resetForm();
    } catch (e) { console.error(e); }
    setUploading(false);
  };

  const togglePaid = async (bill) => {
    const newPaid = !bill.paid;
    try {
      await updateDoc(doc(db, "households", householdId, "bills", bill.id), {
        paid: newPaid, paidAt: newPaid ? new Date().toISOString() : null,
      });
    } catch (e) { console.error(e); }
  };

  const removeBill = async (id, billData) => {
    if (pendingDelete) clearTimeout(pendingDelete.timerId);
    try { await deleteDoc(doc(db, "households", householdId, "bills", id)); } catch (e) { console.error(e); return; }
    const timerId = setTimeout(() => setPendingDelete(null), 4500);
    setPendingDelete({ id, bill: billData, timerId });
  };

  const undoDelete = async () => {
    if (!pendingDelete) return;
    clearTimeout(pendingDelete.timerId);
    const { id, bill } = pendingDelete;
    setPendingDelete(null);
    try {
      const { id: _id, ...data } = bill;
      await setDoc(doc(db, "households", householdId, "bills", id), data);
    } catch (e) { console.error(e); }
  };

  const openEdit = (b) => {
    setEditingBill(b); setEditProvider(b.provider); setEditAmount(String(b.amount || ""));
    setEditDueDate(b.dueDate || ""); setEditNotes(b.notes || "");
    setEditFile(null); setEditFileError(null);
    setEditFilePreview(b.fileUrl ? (b.fileType?.startsWith("image/") ? b.fileUrl : "pdf") : null);
  };
  const closeEdit = () => { setEditingBill(null); setEditFile(null); setEditFilePreview(null); setEditFileError(null); };

  const updateBill = async () => {
    if (!editProvider.trim() || !editDueDate) return;
    setEditUploading(true);
    try {
      let fileUrl  = editingBill.fileUrl  || "";
      let filePath = editingBill.filePath || "";
      let fileType = editingBill.fileType || "";
      if (editFile) {
        filePath = `households/${householdId}/bills/${Date.now()}_${editFile.name}`;
        const sRef = ref(storage, filePath);
        await uploadBytes(sRef, editFile, { contentType: editFile.type });
        fileUrl = await getDownloadURL(sRef);
        fileType = editFile.type;
      }
      await updateDoc(doc(db, "households", householdId, "bills", editingBill.id), {
        provider: editProvider.trim(), amount: parseFloat(editAmount) || 0,
        dueDate: editDueDate, notes: editNotes.trim(), fileUrl, filePath, fileType,
      });
      closeEdit();
    } catch (e) { console.error(e); }
    setEditUploading(false);
  };

  const triggerGmailScan = async () => {
    setScanning(true); setScanError(null);
    try {
      const gmailProvider = new GoogleAuthProvider();
      gmailProvider.addScope("https://www.googleapis.com/auth/gmail.readonly");
      const result      = await signInWithPopup(auth, gmailProvider);
      const accessToken = GoogleAuthProvider.credentialFromResult(result).accessToken;
      const scanFn      = httpsCallable(functions, "scanGmailBills");
      const { data }    = await scanFn({ googleAccessToken: accessToken, householdId });
      const knownIds    = new Set(bills.map(b => b.gmailMessageId).filter(Boolean));
      setScanResults((data.bills || []).filter(b => !knownIds.has(b.gmailMessageId)));
    } catch (e) {
      console.error(e);
      setScanError("שגיאה בסריקה. נסה שוב.");
    }
    setScanning(false);
  };

  const acceptScanResult = async (extracted) => {
    try {
      await addDoc(collection(db, "households", householdId, "bills"), {
        provider: extracted.provider, amount: extracted.amount || 0, currency: "ILS",
        dueDate: extracted.dueDate, paid: false, paidAt: null, notes: "",
        source: "gmail", gmailMessageId: extracted.gmailMessageId,
        fileUrl: "", filePath: "", fileType: "", addedBy: userName, createdAt: new Date().toISOString(),
      });
      setScanResults(prev => prev.filter(r => r.gmailMessageId !== extracted.gmailMessageId));
    } catch (e) { console.error(e); }
  };

  const tierOrder = { overdue: 0, soon: 1, upcoming: 2 };
  const activeBills = bills
    .filter(b => !b.paid && b.id !== pendingDelete?.id)
    .sort((a, b) => {
      const ua = getBillUrgency(a), ub = getBillUrgency(b);
      const t = (tierOrder[ua.tier] ?? 3) - (tierOrder[ub.tier] ?? 3);
      return t !== 0 ? t : (a.dueDate || "").localeCompare(b.dueDate || "");
    });
  const paidBills = bills
    .filter(b => b.paid && b.id !== pendingDelete?.id)
    .sort((a, b) => (b.paidAt || "").localeCompare(a.paidAt || ""));

  const totalUnpaid = activeBills.reduce((s, b) => s + (b.amount || 0), 0);

  const BillFileArea = ({ preview, f, inputRef, onChange, onClear, error }) => (
    <div style={{ marginTop: 10 }}>
      <input ref={inputRef} type="file" accept="image/*,application/pdf" onChange={onChange} style={{ display: "none" }} />
      {preview ? (
        <div style={{ position: "relative" }}>
          {preview === "pdf"
            ? <div style={{ background: BILL_BG, borderRadius: 12, padding: 14, textAlign: "center", color: BILL_CYAN, fontSize: 14 }}>📄 {f?.name || "קובץ מצורף"}</div>
            : <img src={preview} alt="preview" style={{ width: "100%", borderRadius: 12, maxHeight: 160, objectFit: "cover" }} />
          }
          <button onClick={onClear} style={{ position: "absolute", top: 8, left: 8, background: "rgba(0,0,0,0.5)", color: "#fff", border: "none", borderRadius: "50%", width: 28, height: 28, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>
      ) : (
        <button onClick={() => inputRef.current.click()}
          style={{ width: "100%", border: `2px dashed ${error ? "#E53935" : "#E8E5E0"}`, background: error ? "#FFF5F5" : "#FAFAFA", borderRadius: 12, padding: 14, cursor: "pointer", fontSize: 14, color: error ? "#E53935" : "#AAA", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          📎 צרף חשבון / תמונה (אופציונלי)
        </button>
      )}
      {error && <p style={{ margin: "6px 0 0", fontSize: 12, color: "#E53935", fontWeight: 500 }}>⚠️ {error}</p>}
    </div>
  );

  if (loading) return <Loader />;

  return (
    <div dir="rtl" style={{ fontFamily: "'Rubik', sans-serif", maxWidth: 480, margin: "0 auto", minHeight: "100vh", background: "linear-gradient(165deg, #FAFAFA 0%, #F0EDE8 100%)" }}>
      {/* Header */}
      <div style={{ background: `linear-gradient(135deg, ${BILL_CYAN} 0%, ${BILL_DARK} 100%)`, padding: "28px 24px 20px", borderRadius: "0 0 28px 28px", boxShadow: "0 8px 32px rgba(0,172,193,0.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: "#fff" }}>💰 חשבונות</h1>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "rgba(255,255,255,0.7)", fontWeight: 300 }}>
              {activeBills.length} לתשלום{totalUnpaid > 0 ? ` · ₪${totalUnpaid.toLocaleString("he-IL")}` : ""}
            </p>
          </div>
          <BackButton onBack={onBack} light />
        </div>
      </div>

      <div style={{ padding: "16px 16px 100px" }}>
        {/* Add form */}
        {showAdd && (
          <div style={{ background: "#fff", borderRadius: 20, padding: 20, marginBottom: 16, boxShadow: "0 4px 20px rgba(0,0,0,0.08)", animation: "slideDown 0.3s ease" }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 600, color: "#2D3436" }}>חשבון חדש</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
              {BILL_PRESETS.map(p => (
                <button key={p.name} onClick={() => setProvider(p.name)}
                  style={{ border: provider === p.name ? `2px solid ${BILL_CYAN}` : "2px solid #E8E5E0", background: provider === p.name ? BILL_BG : "#FAFAFA", borderRadius: 10, padding: "6px 10px", cursor: "pointer", fontSize: 13, fontFamily: "inherit", fontWeight: provider === p.name ? 600 : 400, color: provider === p.name ? BILL_CYAN : "#666", display: "flex", alignItems: "center", gap: 4 }}>
                  {p.icon} {p.name}
                </button>
              ))}
            </div>
            <input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="שם הספק *"
              style={inputStyle} onFocus={(e) => (e.target.style.borderColor = BILL_CYAN)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <div style={{ flex: 1 }}>
                <p style={{ margin: "0 0 6px", fontSize: 13, color: "#888" }}>סכום (₪)</p>
                <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" type="number" min="0"
                  style={{ ...inputStyle, textAlign: "left" }} onFocus={(e) => (e.target.style.borderColor = BILL_CYAN)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: "0 0 6px", fontSize: 13, color: "#888" }}>תאריך לתשלום *</p>
                <input value={dueDate} onChange={(e) => setDueDate(e.target.value)} type="date"
                  style={{ ...inputStyle, color: dueDate ? "#2D3436" : "#CCC" }} onFocus={(e) => (e.target.style.borderColor = BILL_CYAN)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
              </div>
            </div>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="הערות (אופציונלי)"
              style={{ ...inputStyle, marginTop: 10 }} onFocus={(e) => (e.target.style.borderColor = BILL_CYAN)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
            <BillFileArea preview={filePreview} f={file} inputRef={fileInputRef} onChange={handleFileChange} onClear={() => { setFile(null); setFilePreview(null); }} error={fileError} />
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={addBill} disabled={!provider.trim() || !dueDate || uploading}
                style={{ flex: 1, border: "none", background: provider.trim() && dueDate && !uploading ? `linear-gradient(135deg, ${BILL_CYAN}, ${BILL_DARK})` : "#ccc", color: "#fff", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 600, fontFamily: "inherit", cursor: provider.trim() && dueDate && !uploading ? "pointer" : "default" }}>
                {uploading ? "מעלה..." : "שמור ✓"}
              </button>
              <button onClick={resetForm}
                style={{ border: "2px solid #E8E5E0", background: "#fff", color: "#999", borderRadius: 12, padding: "14px 20px", fontSize: 15, fontFamily: "inherit", cursor: "pointer" }}>✕</button>
            </div>
          </div>
        )}

        {activeBills.length === 0 && paidBills.length === 0 && !showAdd && (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>💰</div>
            <p style={{ fontSize: 18, color: "#999", fontWeight: 300 }}>אין חשבונות שמורים</p>
            <p style={{ fontSize: 14, color: "#CCC", fontWeight: 300, marginTop: 4 }}>לחצו על + להוספה ידנית</p>
          </div>
        )}

        {(activeBills.length > 0 || paidBills.length > 0) && <p style={{ textAlign: "center", fontSize: 12, color: "#BBB", margin: "8px 0 12px", fontWeight: 300 }}>עריכה → | ← מחיקה</p>}

        {/* Active bills */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {activeBills.map((b) => {
            const urg = getBillUrgency(b);
            return (
              <SwipeItem key={b.id} borderRadius={18} onSwipeLeft={() => removeBill(b.id, b)} onSwipeRight={() => openEdit(b)}>
                <div style={{ background: "#fff", borderRadius: 18, overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,0.06)", borderRight: `5px solid ${urg.border === "transparent" ? "#E8E5E0" : urg.border}` }}>
                  <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                    <input type="checkbox" checked={false} onChange={() => togglePaid(b)}
                      style={{ width: 20, height: 20, flexShrink: 0, cursor: "pointer", accentColor: BILL_CYAN }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 15, fontWeight: 600, color: "#2D3436" }}>{b.provider}</span>
                        {b.source === "gmail" && <span style={{ fontSize: 11, color: BILL_DARK, background: BILL_BG, padding: "2px 7px", borderRadius: 8, fontWeight: 500 }}>📧 Gmail</span>}
                      </div>
                      <div style={{ fontSize: 13, color: "#888", marginTop: 2 }}>
                        {b.amount > 0 ? `₪${b.amount.toLocaleString("he-IL")} · ` : ""}
                        לתשלום עד {b.dueDate ? new Date(b.dueDate).toLocaleDateString("he-IL") : "—"}
                      </div>
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 600, color: urg.color, background: urg.bg, padding: "4px 10px", borderRadius: 10, flexShrink: 0 }}>{urg.label}</span>
                  </div>
                </div>
              </SwipeItem>
            );
          })}
        </div>

        {/* Paid bills */}
        {paidBills.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <p style={{ fontSize: 12, color: "#BBB", fontWeight: 500, marginBottom: 10 }}>שולם</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, opacity: 0.55 }}>
              {paidBills.map((b) => (
                <SwipeItem key={b.id} borderRadius={18} onSwipeLeft={() => removeBill(b.id, b)} onSwipeRight={() => openEdit(b)}>
                  <div style={{ background: "#F5F5F5", borderRadius: 18, overflow: "hidden" }}>
                    <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                      <input type="checkbox" checked={true} onChange={() => togglePaid(b)}
                        style={{ width: 20, height: 20, flexShrink: 0, cursor: "pointer", accentColor: BILL_CYAN }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 14, fontWeight: 500, color: "#AAA", textDecoration: "line-through" }}>{b.provider}</span>
                        <div style={{ fontSize: 12, color: "#CCC", marginTop: 1 }}>
                          {b.amount > 0 ? `₪${b.amount.toLocaleString("he-IL")}` : ""}
                        </div>
                      </div>
                      <span style={{ fontSize: 12, color: "#AAA", background: "#EBEBEB", padding: "4px 10px", borderRadius: 10 }}>שולם</span>
                    </div>
                  </div>
                </SwipeItem>
              ))}
            </div>
          </div>
        )}
      </div>

      {!showAdd && <FAB onClick={() => setShowAdd(true)} color={`linear-gradient(135deg, ${BILL_CYAN}, ${BILL_DARK})`} shadow="rgba(0,172,193,0.4)" />}

      {/* Undo Delete Toast */}
      {pendingDelete && (
        <div style={{ position: "fixed", bottom: 104, left: "50%", transform: "translateX(-50%)", background: "#2D3436", color: "#fff", borderRadius: 14, padding: "12px 18px", display: "flex", alignItems: "center", gap: 14, zIndex: 60, boxShadow: "0 6px 24px rgba(0,0,0,0.3)", whiteSpace: "nowrap", animation: "slideUp 0.25s ease" }}>
          <span style={{ fontSize: 14 }}>🗑️ "{pendingDelete.bill.provider}" נמחק</span>
          <button onClick={undoDelete} style={{ background: BILL_CYAN, border: "none", borderRadius: 8, padding: "6px 14px", color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>ביטול</button>
        </div>
      )}

      {/* Edit Modal */}
      {editingBill && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={(e) => { if (e.target === e.currentTarget) closeEdit(); }}>
          <div dir="rtl" style={{ background: "#fff", borderRadius: "24px 24px 0 0", padding: 24, width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto", animation: "slideUp 0.3s ease" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: "#2D3436" }}>✏️ עריכת חשבון</h3>
              <button onClick={closeEdit} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#999", lineHeight: 1 }}>✕</button>
            </div>
            <input value={editProvider} onChange={(e) => setEditProvider(e.target.value)} placeholder="שם הספק *" autoFocus
              style={inputStyle} onFocus={(e) => (e.target.style.borderColor = BILL_CYAN)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <div style={{ flex: 1 }}>
                <p style={{ margin: "0 0 6px", fontSize: 13, color: "#888" }}>סכום (₪)</p>
                <input value={editAmount} onChange={(e) => setEditAmount(e.target.value)} placeholder="0" type="number" min="0"
                  style={{ ...inputStyle, textAlign: "left" }} onFocus={(e) => (e.target.style.borderColor = BILL_CYAN)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: "0 0 6px", fontSize: 13, color: "#888" }}>תאריך לתשלום *</p>
                <input value={editDueDate} onChange={(e) => setEditDueDate(e.target.value)} type="date"
                  style={{ ...inputStyle, color: editDueDate ? "#2D3436" : "#CCC" }} onFocus={(e) => (e.target.style.borderColor = BILL_CYAN)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
              </div>
            </div>
            <input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="הערות (אופציונלי)"
              style={{ ...inputStyle, marginTop: 10 }} onFocus={(e) => (e.target.style.borderColor = BILL_CYAN)} onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")} />
            <BillFileArea preview={editFilePreview} f={editFile} inputRef={editFileInputRef} onChange={handleEditFileChange} onClear={() => { setEditFile(null); setEditFilePreview(null); }} error={editFileError} />
            <div style={{ display: "flex", gap: 8, marginTop: 16, paddingBottom: 8 }}>
              <button onClick={updateBill} disabled={!editProvider.trim() || !editDueDate || editUploading}
                style={{ flex: 1, border: "none", background: editProvider.trim() && editDueDate && !editUploading ? `linear-gradient(135deg, ${BILL_CYAN}, ${BILL_DARK})` : "#ccc", color: "#fff", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 600, fontFamily: "inherit", cursor: editProvider.trim() && editDueDate && !editUploading ? "pointer" : "default" }}>
                {editUploading ? "שומר..." : "שמור שינויים ✓"}
              </button>
              <button onClick={closeEdit}
                style={{ border: "2px solid #E8E5E0", background: "#fff", color: "#999", borderRadius: 12, padding: "14px 20px", fontSize: 15, fontFamily: "inherit", cursor: "pointer" }}>✕</button>
            </div>
          </div>
        </div>
      )}

      <GlobalStyles />
    </div>
  );
}

// ─── ImageLightbox ────────────────────────────────────────────────────────────

function ImageLightbox({ src, onClose }) {
  if (!src) return null;
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.92)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <button onClick={onClose} style={{ position: "absolute", top: 20, left: 20, background: "rgba(255,255,255,0.15)", border: "none", borderRadius: "50%", width: 40, height: 40, fontSize: 20, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
      <img src={src} alt="" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "95vw", maxHeight: "90vh", borderRadius: 12, objectFit: "contain", boxShadow: "0 8px 40px rgba(0,0,0,0.6)" }} />
    </div>
  );
}

// ─── Shared micro-components ──────────────────────────────────────────────────

function Loader() {
  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", fontFamily: "'Rubik', sans-serif" }}>
      <p style={{ color: "#888", fontSize: 18 }}>טוען...</p>
    </div>
  );
}

function BackButton({ onBack, light }) {
  return (
    <button onClick={onBack}
      style={{ background: light ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.12)", border: "none", borderRadius: 10, padding: "8px 14px", fontSize: 13, color: light ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.8)", fontFamily: "inherit", cursor: "pointer" }}>
      ← בית
    </button>
  );
}

function FAB({ onClick, color, shadow }) {
  return (
    <button onClick={onClick}
      style={{ position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)", width: 60, height: 60, borderRadius: "50%", border: "none", background: color, color: "#fff", fontSize: 30, cursor: "pointer", boxShadow: `0 6px 24px ${shadow}`, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      +
    </button>
  );
}

function GlobalStyles() {
  return (
    <style>{`
      @keyframes slideDown { from { opacity: 0; transform: translateY(-12px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes slideUp   { from { opacity: 0; transform: translateY(40px);  } to { opacity: 1; transform: translateY(0); } }
      * { -webkit-tap-highlight-color: transparent; }
      input::placeholder { color: #CCC; }
    `}</style>
  );
}

// ─── SplitBillsScreen ─────────────────────────────────────────────────────────

function SplitBillsScreen({ userName, householdId, memberNames, currentUid, onBack }) {
  const PURPLE    = "#7B1FA2";
  const PURPLE_BG = "#F3E5F5";

  const [bills,      setBills]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [showAdd,    setShowAdd]    = useState(false);
  const [editBill,   setEditBill]   = useState(null);
  const [detailBill, setDetailBill] = useState(null);
  const [detailSplits, setDetailSplits] = useState([]);
  const [duplicateTarget, setDuplicateTarget] = useState(null);
  const [dupDate,    setDupDate]    = useState("");
  const [toast,      setToast]      = useState(null);
  const [uploading,  setUploading]  = useState(false);
  const [addError,   setAddError]   = useState("");

  // Add-form state
  const [company,  setCompany]  = useState("");
  const [amount,   setAmount]   = useState("");
  const [dueDate,  setDueDate]  = useState("");
  const [notes,    setNotes]    = useState("");
  const [formFile, setFormFile] = useState(null);

  // Edit-form state
  const [editCompany,         setEditCompany]         = useState("");
  const [editAmount,          setEditAmount]          = useState("");
  const [editDueDate,         setEditDueDate]         = useState("");
  const [editNotes,           setEditNotes]           = useState("");
  const [editPaidBy,          setEditPaidBy]          = useState("");
  const [editSelectedMembers, setEditSelectedMembers] = useState(new Set());

  // Payer tracking
  const [paidBy,           setPaidBy]           = useState(currentUid || "");
  const [detailPaidBy,     setDetailPaidBy]     = useState("");
  const [selectedMembers,  setSelectedMembers]  = useState(() => new Set(Object.keys(memberNames)));

  const COMPANY_PRESETS = ["חשמל", "מים", "גז", "ועד בית", "ארנונה", "אינטרנט", "שכירות"];

  // ── Load bills ──
  useEffect(() => {
    if (!householdId) return;
    setLoading(true);
    const q = collection(db, "households", householdId, "splitBills");
    const unsub = onSnapshot(q,
      (snap) => {
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        docs.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
        setBills(docs);
        setLoading(false);
      },
      (err)  => { console.error(err); setLoading(false); }
    );
    return () => unsub();
  }, [householdId]);

  // ── Directed net debts: who owes whom after netting mutual debts ──
  const netDebts = useMemo(() => {
    const debts = {}; // debts[debtor][creditor] = amount
    for (const bill of bills) {
      const payerUid = bill.paidBy;
      if (!payerUid) continue;
      for (const split of (bill.splits || [])) {
        if (split.uid === payerUid || split.paid) continue;
        if (!debts[split.uid]) debts[split.uid] = {};
        debts[split.uid][payerUid] = (debts[split.uid][payerUid] || 0) + (split.amount || 0);
      }
    }
    const result = [];
    const seen = new Set();
    for (const debtor of Object.keys(debts)) {
      for (const creditor of Object.keys(debts[debtor])) {
        const key = [debtor, creditor].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        const net = (debts[debtor]?.[creditor] || 0) - (debts[creditor]?.[debtor] || 0);
        if (Math.abs(net) > 0.01) {
          result.push(net > 0
            ? { from: debtor, to: creditor, amount: net }
            : { from: creditor, to: debtor, amount: -net });
        }
      }
    }
    return result; // [{ from: uid, to: uid, amount }]
  }, [bills]);

  // ── Urgency helpers ──
  const today = new Date().toISOString().slice(0, 10);
  const soon7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  const getBillStatus = (bill) => {
    const splits = bill.splits || [];
    const allPaid = splits.length > 0 && splits.every(s => s.paid);
    if (allPaid) return "paid";
    if (!bill.dueDate) return "upcoming";
    if (bill.dueDate < today) return "overdue";
    if (bill.dueDate <= soon7) return "soon";
    return "upcoming";
  };

  const urgencyOrder = { overdue: 0, soon: 1, upcoming: 2, paid: 3 };
  const sortedBills  = [...bills].sort((a, b) => {
    const ao = urgencyOrder[getBillStatus(a)];
    const bo = urgencyOrder[getBillStatus(b)];
    if (ao !== bo) return ao - bo;
    return (a.dueDate || "").localeCompare(b.dueDate || "");
  });
  const activeBills = sortedBills.filter(b => getBillStatus(b) !== "paid");
  const paidBills   = sortedBills.filter(b => getBillStatus(b) === "paid");

  const getBorderColor = (status) =>
    status === "overdue" ? "#E53935" : status === "soon" ? "#F9A825" : status === "paid" ? "#BDBDBD" : "#43A047";

  // ── Equal split helper ──
  const makeEqualSplits = (totalAmt, members) => {
    const uids = Object.keys(members);
    if (!uids.length) return [];
    const perPerson = Math.round((parseFloat(totalAmt) || 0) / uids.length * 100) / 100;
    const splits = uids.map(uid => ({ uid, name: members[uid], amount: perPerson, paid: false, paidAt: null }));
    const diff = Math.round(((parseFloat(totalAmt) || 0) - splits.reduce((s, sp) => s + sp.amount, 0)) * 100) / 100;
    if (splits.length) splits[0].amount = Math.round((splits[0].amount + diff) * 100) / 100;
    return splits;
  };

  // ── CRUD ──
  const addBill = async () => {
    if (!company.trim() || !amount || !dueDate) return;
    setUploading(true);
    setAddError("");
    try {
      let fileUrl = "", filePath = "", fileType = "";
      if (formFile) {
        filePath = `households/${householdId}/split_bills/${Date.now()}_${formFile.name}`;
        const sRef = ref(storage, filePath);
        await uploadBytes(sRef, formFile, { contentType: formFile.type });
        fileUrl  = await getDownloadURL(sRef);
        fileType = formFile.type;
      }
      const nowIso = new Date().toISOString();
      const filteredMembers = Object.fromEntries(
        Object.entries(memberNames).filter(([uid]) => selectedMembers.has(uid))
      );
      const splits = makeEqualSplits(amount, filteredMembers);
      await addDoc(collection(db, "households", householdId, "splitBills"), {
        company: company.trim(), amount: parseFloat(amount) || 0, dueDate,
        notes: notes.trim(), fileUrl, filePath, fileType,
        addedBy: userName, createdAt: nowIso,
        paidBy: paidBy || null,
        splits,
      });
      setCompany(""); setAmount(""); setDueDate(""); setNotes(""); setFormFile(null);
      setPaidBy(currentUid || "");
      setSelectedMembers(new Set(Object.keys(memberNames)));
      setAddError("");
      setShowAdd(false);
    } catch (e) {
      console.error(e);
      setAddError(e?.code === "permission-denied" ? "אין הרשאה — פרוס את כללי Firestore ושנה בשוב" : `שגיאה: ${e?.message || e?.code || "נסה שוב"}`);
    }
    setUploading(false);
  };

  const deleteBill = async (bill) => {
    try {
      await deleteDoc(doc(db, "households", householdId, "splitBills", bill.id));
      setToast({ msg: `חשבון "${bill.company}" נמחק`, undo: () => restoreBill(bill) });
      setTimeout(() => setToast(null), 4500);
    } catch (e) { console.error(e); }
  };

  const restoreBill = async (bill) => {
    try { const { id, ...data } = bill; await setDoc(doc(db, "households", householdId, "splitBills", id), data); }
    catch (e) { console.error(e); }
    setToast(null);
  };

  const openEdit = (bill) => {
    setEditBill(bill);
    setEditCompany(bill.company || "");
    setEditAmount(String(bill.amount || ""));
    setEditDueDate(bill.dueDate || "");
    setEditNotes(bill.notes || "");
    setEditPaidBy(bill.paidBy || "");
    setEditSelectedMembers(new Set((bill.splits || []).map(s => s.uid)));
  };

  const saveEdit = async () => {
    if (!editBill) return;
    try {
      const newAmount = parseFloat(editAmount) || 0;
      const filteredMemberMap = Object.fromEntries(
        [...editSelectedMembers].map(uid => [uid, memberNames[uid] || ""])
      );
      const existingSplits = editBill.splits || [];
      const newSplits = makeEqualSplits(newAmount, filteredMemberMap).map(s => {
        const existing = existingSplits.find(e => e.uid === s.uid);
        return existing ? { ...s, paid: existing.paid, paidAt: existing.paidAt } : s;
      });
      await updateDoc(doc(db, "households", householdId, "splitBills", editBill.id), {
        company: editCompany.trim(), amount: newAmount,
        dueDate: editDueDate, notes: editNotes.trim(),
        paidBy: editPaidBy || null,
        splits: newSplits,
      });
      setEditBill(null);
    } catch (e) { console.error(e); }
  };

  // ── Bill detail sheet ──
  const openDetail = (bill) => {
    setDetailBill(bill);
    setDetailSplits((bill.splits || []).map(s => ({ ...s })));
    setDetailPaidBy(bill.paidBy || "");
  };
  const closeDetail = () => { setDetailBill(null); setDetailSplits([]); setDetailPaidBy(""); };

  const updateSplitAmount = (uid, val) =>
    setDetailSplits(prev => prev.map(s => s.uid === uid ? { ...s, amount: parseFloat(val) || 0 } : s));

  const togglePaid = (uid) => {
    setDetailSplits(prev => prev.map(s => {
      if (s.uid !== uid) return s;
      const nowPaid = !s.paid;
      return { ...s, paid: nowPaid, paidAt: nowPaid ? new Date().toISOString() : null };
    }));
  };

  const changeDetailPayer = (newPayerUid) => {
    setDetailPaidBy(newPayerUid);
  };

  const equalSplitDetail = () => {
    if (!detailBill) return;
    const memberMap = Object.fromEntries(detailSplits.map(s => [s.uid, s.name]));
    const eq = makeEqualSplits(detailBill.amount, memberMap);
    setDetailSplits(prev => prev.map(s => {
      const found = eq.find(e => e.uid === s.uid);
      return found ? { ...s, amount: found.amount } : s;
    }));
  };

  const saveSplits = async () => {
    if (!detailBill || !splitValid) return;
    try {
      await updateDoc(doc(db, "households", householdId, "splitBills", detailBill.id), {
        splits: detailSplits,
        paidBy: detailPaidBy || null,
      });
      closeDetail();
    } catch (e) { console.error(e); }
  };

  const splitSum   = detailSplits.reduce((s, sp) => s + (sp.amount || 0), 0);
  const splitValid = detailBill ? Math.abs(splitSum - detailBill.amount) < 0.01 : true;

  // ── WhatsApp share ──
  const shareWhatsApp = () => {
    if (!detailBill) return;
    const fmt = (d) => { if (!d) return ""; const [y,m,day]=d.split("-"); return `${day}/${m}/${y}`; };
    const payerName = detailPaidBy ? memberNames[detailPaidBy] || "" : "";
    const text = [
      `חשבון: ${detailBill.company} — ₪${detailBill.amount}`,
      `תאריך לתשלום: ${fmt(detailBill.dueDate)}`,
      payerName ? `שילם: ${payerName}` : "",
      "",
      ...detailSplits.map(s => {
        const isPayer = s.uid === detailPaidBy;
        return `${s.name}: ₪${s.amount} ${isPayer ? "💳 שילם" : s.paid ? "✓ החזיר" : "✗ חייב"}`;
      }),
    ].filter(l => l !== "").join("\n");
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  };

  // ── Duplicate bill ──
  const duplicateBill = async () => {
    if (!duplicateTarget || !dupDate) return;
    try {
      const { id, createdAt, ...rest } = duplicateTarget;
      const newSplits = (rest.splits || []).map(s => ({ ...s, paid: false, paidAt: null }));
      await addDoc(collection(db, "households", householdId, "splitBills"), {
        ...rest, dueDate: dupDate, splits: newSplits, createdAt: new Date().toISOString(),
      });
      setDuplicateTarget(null); setDupDate("");
    } catch (e) { console.error(e); }
  };

  const fmtDate = (d) => { if (!d) return ""; const [y,m,day]=d.split("-"); return `${day}/${m}/${y}`; };

  // ─── Render ───────────────────────────────────────────────────────────────
  const BillCard = ({ bill }) => {
    const status     = getBillStatus(bill);
    const isPaid     = status === "paid";
    const paidCount  = (bill.splits || []).filter(s => s.paid).length;
    const totalCount = (bill.splits || []).length;
    return (
      <div style={{ marginBottom: 10 }}>
      <SwipeItem onSwipeLeft={() => deleteBill(bill)} onSwipeRight={() => openEdit(bill)}>
        <div
          onClick={() => openDetail(bill)}
          style={{
            background: isPaid ? "#F7F7F7" : "#fff",
            borderRadius: 16, padding: "14px 16px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
            borderRight: `4px solid ${getBorderColor(status)}`,
            cursor: "pointer",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: isPaid ? 400 : 600, color: isPaid ? "#888" : "#2D3436", display: "flex", alignItems: "center", gap: 6 }}>
                {isPaid && <span style={{ fontSize: 14 }}>✅</span>}
                {bill.company}
              </div>
              <div style={{ fontSize: 13, color: "#AAA", marginTop: 2 }}>
                {bill.dueDate ? (isPaid ? `שולם • ${fmtDate(bill.dueDate)}` : `עד ${fmtDate(bill.dueDate)}`) : ""}
                {status === "overdue" && <span style={{ color: "#E53935", fontWeight: 600, marginRight: 6 }}>⚠️ באיחור</span>}
              </div>
              {totalCount > 0 && (
                <div style={{ fontSize: 12, marginTop: 4, color: isPaid ? "#BDBDBD" : "#AAA" }}>
                  {isPaid ? "הכל סולק ✓" : `${paidCount}/${totalCount} סילקו`}
                </div>
              )}
              {bill.paidBy && memberNames[bill.paidBy] && (
                <div style={{ fontSize: 12, marginTop: 2, color: isPaid ? "#BDBDBD" : "#9C27B0", fontWeight: 500 }}>
                  💳 משלם: {memberNames[bill.paidBy]}
                </div>
              )}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: isPaid ? "#BDBDBD" : PURPLE }}>₪{bill.amount}</div>
          </div>
        </div>
      </SwipeItem>
      </div>
    );
  };

  return (
    <div dir="rtl" style={{ fontFamily: "'Rubik', sans-serif", maxWidth: 480, margin: "0 auto", minHeight: "100vh", background: "linear-gradient(165deg, #FAFAFA 0%, #F0EDE8 100%)" }}>

      {/* ── Header ── */}
      <div style={{ background: `linear-gradient(135deg, ${PURPLE} 0%, #4A148C 100%)`, padding: "36px 24px 24px", borderRadius: "0 0 32px 32px", boxShadow: "0 8px 32px rgba(123,31,162,0.25)", marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <BackButton onBack={onBack} />
            <h1 style={{ margin: "12px 0 4px", fontSize: 26, fontWeight: 700, color: "#fff" }}>🤝 חלוקת חשבונות</h1>
          </div>
        </div>

        {/* Net debt summary */}
        <div style={{ marginTop: 16 }}>
          {netDebts.length === 0 ? (
            <div style={{
              borderRadius: 12, padding: "10px 16px", textAlign: "center",
              background: "rgba(67,160,71,0.25)", border: "1px solid rgba(67,160,71,0.5)",
            }}>
              <div style={{ fontSize: 13, color: "#fff", fontWeight: 600 }}>✓ הכל מסולק</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {netDebts.map((d, i) => (
                <div key={i} style={{
                  borderRadius: 12, padding: "10px 16px",
                  background: "rgba(229,57,53,0.2)", border: "1px solid rgba(229,57,53,0.4)",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                }}>
                  <div style={{ fontSize: 13, color: "#fff" }}>
                    <span style={{ fontWeight: 700 }}>{memberNames[d.from] || d.from}</span>
                    <span style={{ opacity: 0.8 }}> חייב ל-</span>
                    <span style={{ fontWeight: 700 }}>{memberNames[d.to] || d.to}</span>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "#fff" }}>₪{d.amount.toFixed(0)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Bill list ── */}
      <div style={{ padding: "0 16px 100px" }}>
        {loading && <p style={{ textAlign: "center", color: "#888" }}>טוען...</p>}

        {activeBills.map(bill => <BillCard key={bill.id} bill={bill} />)}

        {!loading && activeBills.length === 0 && paidBills.length === 0 && (
          <div style={{ textAlign: "center", padding: "48px 0", color: "#AAA" }}>
            <div style={{ fontSize: 52, marginBottom: 12 }}>🤝</div>
            <p style={{ fontWeight: 600, color: "#888" }}>אין חשבונות עדיין</p>
            <p style={{ fontSize: 13 }}>לחץ + להוספת חשבון ראשון</p>
          </div>
        )}

        {/* Archive */}
        {paidBills.length > 0 && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "16px 0 8px" }}>
              <div style={{ flex: 1, height: 1, background: "#E0E0E0" }} />
              <span style={{ fontSize: 13, color: "#AAA", whiteSpace: "nowrap" }}>✅ שולמו ({paidBills.length})</span>
              <div style={{ flex: 1, height: 1, background: "#E0E0E0" }} />
            </div>
            {paidBills.map(bill => <BillCard key={bill.id} bill={bill} />)}
          </>
        )}
      </div>

      {/* ── FAB ── */}
      <FAB onClick={() => setShowAdd(true)} color={PURPLE} shadow="rgba(123,31,162,0.4)" />

      {/* ── Add form sheet ── */}
      {showAdd && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={(e) => { if (e.target === e.currentTarget) setShowAdd(false); }}>
          <div dir="rtl" style={{ background: "#fff", borderRadius: "24px 24px 0 0", padding: 24, width: "100%", maxWidth: 480, animation: "slideUp 0.3s ease", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>הוספת חשבון</h3>
              <button onClick={() => setShowAdd(false)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#999" }}>✕</button>
            </div>

            {/* Company presets */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
              {COMPANY_PRESETS.map(p => (
                <button key={p} onClick={() => setCompany(p)} style={{
                  padding: "6px 14px", borderRadius: 20, border: "none", fontSize: 13, cursor: "pointer", fontFamily: "inherit",
                  background: company === p ? PURPLE : "#F5F2EF", color: company === p ? "#fff" : "#555",
                }}>{p}</button>
              ))}
            </div>

            <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="שם חברה / ספק" style={{ ...inputStyle, marginBottom: 12 }} />
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="סכום (₪)" style={{ ...inputStyle, marginBottom: 12 }} />
            <label style={{ display: "block", fontSize: 13, color: "#888", marginBottom: 6, fontWeight: 500 }}>תאריך תשלום</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={{ ...inputStyle, marginBottom: 12 }} />
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="הערות (אופציונלי)" style={{ ...inputStyle, marginBottom: 12 }} />

            {/* Member selection */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, color: "#888", fontWeight: 500, marginBottom: 8 }}>מי משתתף בחשבון?</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {Object.entries(memberNames).map(([uid, name]) => {
                  const selected = selectedMembers.has(uid);
                  return (
                    <button key={uid} onClick={() => {
                      setSelectedMembers(prev => {
                        const next = new Set(prev);
                        if (next.has(uid)) {
                          if (next.size <= 1) return prev; // keep at least 1
                          next.delete(uid);
                          if (paidBy === uid) setPaidBy([...next][0] || "");
                        } else {
                          next.add(uid);
                        }
                        return next;
                      });
                    }} style={{
                      padding: "8px 16px", borderRadius: 20, border: "none", fontSize: 13,
                      cursor: "pointer", fontFamily: "inherit", fontWeight: selected ? 600 : 400,
                      background: selected ? "#E8F5E9" : "#F5F2EF",
                      color: selected ? "#2E7D32" : "#AAA",
                    }}>{selected ? `✓ ${name}` : name}</button>
                  );
                })}
              </div>
            </div>

            {/* Who fronts the payment? */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: "#888", fontWeight: 500, marginBottom: 8 }}>מי משלם מהכיס?</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {Object.entries(memberNames).filter(([uid]) => selectedMembers.has(uid)).map(([uid, name]) => (
                  <button key={uid} onClick={() => setPaidBy(uid)} style={{
                    padding: "8px 16px", borderRadius: 20, border: "none", fontSize: 13,
                    cursor: "pointer", fontFamily: "inherit", fontWeight: paidBy === uid ? 700 : 400,
                    background: paidBy === uid ? PURPLE : "#F5F2EF",
                    color: paidBy === uid ? "#fff" : "#555",
                  }}>{paidBy === uid ? `✓ ${name}` : name}</button>
                ))}
              </div>
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", marginBottom: 16, padding: "10px 14px", background: "#F5F2EF", borderRadius: 12 }}>
              <span style={{ fontSize: 20 }}>📎</span>
              <span style={{ fontSize: 14, color: "#555" }}>{formFile ? formFile.name : "צרף קובץ (אופציונלי)"}</span>
              <input type="file" accept="image/*,application/pdf" onChange={(e) => setFormFile(e.target.files[0] || null)} style={{ display: "none" }} />
            </label>

            {addError && (
              <div style={{ background: "#FFEBEE", color: "#C62828", borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 12 }}>
                ⚠️ {addError}
              </div>
            )}

            <button onClick={addBill} disabled={!company.trim() || !amount || !dueDate || uploading} style={{
              width: "100%", padding: "14px", borderRadius: 14, border: "none",
              background: company.trim() && amount && dueDate && !uploading ? PURPLE : "#CCC",
              color: "#fff", fontSize: 16, fontWeight: 600, fontFamily: "inherit",
              cursor: company.trim() && amount && dueDate && !uploading ? "pointer" : "not-allowed",
            }}>
              {uploading ? "שומר..." : "הוסף חשבון ✓"}
            </button>
          </div>
        </div>
      )}

      {/* ── Bill detail sheet ── */}
      {detailBill && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={(e) => { if (e.target === e.currentTarget) closeDetail(); }}>
          <div dir="rtl" style={{ background: "#fff", borderRadius: "24px 24px 0 0", padding: 24, width: "100%", maxWidth: 480, animation: "slideUp 0.3s ease", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700 }}>{detailBill.company}</h3>
                <div style={{ fontSize: 13, color: "#888" }}>₪{detailBill.amount} • {fmtDate(detailBill.dueDate)}</div>
              </div>
              <button onClick={closeDetail} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#999" }}>✕</button>
            </div>

            {/* Who paid — editable in detail */}
            {detailSplits.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, color: "#888", fontWeight: 500, marginBottom: 6 }}>מי משלם מהכיס?</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {detailSplits.map(s => (
                    <button key={s.uid} onClick={() => changeDetailPayer(s.uid)} style={{
                      padding: "6px 14px", borderRadius: 20, border: "none", fontSize: 13,
                      cursor: "pointer", fontFamily: "inherit", fontWeight: detailPaidBy === s.uid ? 700 : 400,
                      background: detailPaidBy === s.uid ? PURPLE : "#F5F2EF",
                      color: detailPaidBy === s.uid ? "#fff" : "#555",
                    }}>{detailPaidBy === s.uid ? `✓ ${s.name}` : s.name}</button>
                  ))}
                </div>
              </div>
            )}

            {/* Equal split button */}
            <button onClick={equalSplitDetail} style={{
              width: "100%", padding: "10px", borderRadius: 12, border: `1px solid ${PURPLE}`,
              background: "#fff", color: PURPLE, fontSize: 14, fontWeight: 600, fontFamily: "inherit",
              cursor: "pointer", marginBottom: 14,
            }}>
              ⚖️ חלוקה שווה — ₪{(detailBill.amount / (detailSplits.length || 1)).toFixed(2)} לאדם
            </button>

            {/* Per-member rows */}
            {detailSplits.map(split => {
              const isPayer = split.uid === detailPaidBy;
              return (
              <div key={split.uid} style={{
                display: "flex", alignItems: "center", gap: 10, marginBottom: 10,
                padding: "12px 14px", borderRadius: 12,
                background: isPayer ? "#EDE7F6" : split.paid ? "#E8F5E9" : "#FFF8E1",
                border: `1px solid ${isPayer ? "#B39DDB" : split.paid ? "#A5D6A7" : "#FFE082"}`,
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: "#2D3436" }}>{split.name}</div>
                  {isPayer && <div style={{ fontSize: 11, color: "#7B1FA2", fontWeight: 500 }}>משלם מהכיס</div>}
                </div>
                <input
                  type="number"
                  value={split.amount}
                  onChange={(e) => updateSplitAmount(split.uid, e.target.value)}
                  style={{ ...inputStyle, width: 86, padding: "8px 10px", direction: "ltr", textAlign: "right", fontSize: 14 }}
                />
                <button onClick={() => togglePaid(split.uid)} style={{
                  padding: "8px 12px", borderRadius: 10, border: "none", flexShrink: 0,
                  background: split.paid ? (isPayer ? "#7B1FA2" : "#43A047") : "#E0E0E0",
                  color: split.paid ? "#fff" : "#666",
                  fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
                }}>
                  {isPayer
                    ? (split.paid ? "✓ שילם" : "טרם שילם")
                    : (split.paid ? "✓ החזיר" : "חייב")}
                </button>
                <button
                  onClick={() => setDetailSplits(prev => prev.filter(s => s.uid !== split.uid))}
                  title="הסר מהחשבון"
                  style={{ padding: "8px 10px", borderRadius: 10, border: "none", flexShrink: 0, background: "#FFEBEE", color: "#E53935", fontSize: 14, fontFamily: "inherit", cursor: "pointer" }}
                >✕</button>
              </div>
              );
            })}

            {/* Validation warning */}
            {!splitValid && detailSplits.length > 0 && (
              <div style={{ background: "#FFEBEE", color: "#C62828", borderRadius: 10, padding: "8px 12px", fontSize: 13, marginBottom: 12 }}>
                סכום השותפים (₪{splitSum.toFixed(2)}) ≠ סכום החשבונית (₪{detailBill.amount})
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={saveSplits} disabled={!splitValid} style={{
                flex: 1, padding: "12px", borderRadius: 12, border: "none",
                background: splitValid ? PURPLE : "#CCC", color: "#fff",
                fontSize: 15, fontWeight: 600, fontFamily: "inherit",
                cursor: splitValid ? "pointer" : "not-allowed",
              }}>שמור</button>
              <button onClick={shareWhatsApp} style={{
                padding: "12px 16px", borderRadius: 12, border: "none",
                background: "#25D366", color: "#fff", fontSize: 15, fontFamily: "inherit", cursor: "pointer",
              }}>💬</button>
              <button onClick={() => { setDuplicateTarget(detailBill); setDupDate(""); closeDetail(); }} style={{
                padding: "12px 16px", borderRadius: 12, border: "none",
                background: "#F5F2EF", color: "#555", fontSize: 15, fontFamily: "inherit", cursor: "pointer",
              }}>📋</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Duplicate date picker ── */}
      {duplicateTarget && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={(e) => { if (e.target === e.currentTarget) setDuplicateTarget(null); }}>
          <div dir="rtl" style={{ background: "#fff", borderRadius: "24px 24px 0 0", padding: 24, width: "100%", maxWidth: 480, animation: "slideUp 0.3s ease" }}>
            <h3 style={{ margin: "0 0 8px", fontSize: 17, fontWeight: 700 }}>📋 שכפל — {duplicateTarget.company}</h3>
            <p style={{ margin: "0 0 14px", fontSize: 14, color: "#888" }}>בחר תאריך לתשלום עבור החשבון החדש</p>
            <input type="date" value={dupDate} onChange={(e) => setDupDate(e.target.value)} style={{ ...inputStyle, marginBottom: 16 }} />
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={duplicateBill} disabled={!dupDate} style={{
                flex: 1, padding: "12px", borderRadius: 12, border: "none",
                background: dupDate ? PURPLE : "#CCC", color: "#fff",
                fontSize: 15, fontWeight: 600, fontFamily: "inherit",
                cursor: dupDate ? "pointer" : "not-allowed",
              }}>📋 שכפל חשבון</button>
              <button onClick={() => setDuplicateTarget(null)} style={{
                padding: "12px 16px", borderRadius: 12, border: "1px solid #DDD",
                background: "#fff", color: "#888", fontFamily: "inherit", cursor: "pointer",
              }}>✕</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit sheet ── */}
      {editBill && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={(e) => { if (e.target === e.currentTarget) setEditBill(null); }}>
          <div dir="rtl" style={{ background: "#fff", borderRadius: "24px 24px 0 0", padding: 24, width: "100%", maxWidth: 480, animation: "slideUp 0.3s ease", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>עריכת חשבון</h3>
              <button onClick={() => setEditBill(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#999" }}>✕</button>
            </div>
            <input value={editCompany} onChange={(e) => setEditCompany(e.target.value)} placeholder="שם חברה" style={{ ...inputStyle, marginBottom: 12 }} />
            <input type="number" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} placeholder="סכום (₪)" style={{ ...inputStyle, marginBottom: 12 }} />
            <input type="date" value={editDueDate} onChange={(e) => setEditDueDate(e.target.value)} style={{ ...inputStyle, marginBottom: 12 }} />
            <input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="הערות" style={{ ...inputStyle, marginBottom: 14 }} />

            {/* Member selection */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, color: "#888", fontWeight: 500, marginBottom: 8 }}>מי משתתף בחשבון?</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {Object.entries(memberNames).map(([uid, name]) => {
                  const selected = editSelectedMembers.has(uid);
                  return (
                    <button key={uid} onClick={() => {
                      setEditSelectedMembers(prev => {
                        const next = new Set(prev);
                        if (next.has(uid)) {
                          if (next.size <= 1) return prev;
                          next.delete(uid);
                          if (editPaidBy === uid) setEditPaidBy([...next][0] || "");
                        } else {
                          next.add(uid);
                        }
                        return next;
                      });
                    }} style={{
                      padding: "8px 16px", borderRadius: 20, border: "none", fontSize: 13,
                      cursor: "pointer", fontFamily: "inherit", fontWeight: selected ? 600 : 400,
                      background: selected ? "#E8F5E9" : "#F5F2EF",
                      color: selected ? "#2E7D32" : "#AAA",
                    }}>{selected ? `✓ ${name}` : name}</button>
                  );
                })}
              </div>
            </div>

            {/* Who fronts the payment? */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: "#888", fontWeight: 500, marginBottom: 8 }}>מי משלם מהכיס?</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {Object.entries(memberNames).filter(([uid]) => editSelectedMembers.has(uid)).map(([uid, name]) => (
                  <button key={uid} onClick={() => setEditPaidBy(uid)} style={{
                    padding: "8px 16px", borderRadius: 20, border: "none", fontSize: 13,
                    cursor: "pointer", fontFamily: "inherit", fontWeight: editPaidBy === uid ? 700 : 400,
                    background: editPaidBy === uid ? PURPLE : "#F5F2EF",
                    color: editPaidBy === uid ? "#fff" : "#555",
                  }}>{editPaidBy === uid ? `✓ ${name}` : name}</button>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={saveEdit} disabled={!editCompany.trim()} style={{
                flex: 1, padding: "12px", borderRadius: 12, border: "none",
                background: editCompany.trim() ? PURPLE : "#CCC", color: "#fff",
                fontSize: 15, fontWeight: 600, fontFamily: "inherit",
                cursor: editCompany.trim() ? "pointer" : "not-allowed",
              }}>שמור ✓</button>
              <button onClick={() => setEditBill(null)} style={{
                padding: "12px 16px", borderRadius: 12, border: "1px solid #DDD",
                background: "#fff", color: "#888", fontFamily: "inherit", cursor: "pointer",
              }}>✕</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div style={{ position: "fixed", bottom: 100, left: "50%", transform: "translateX(-50%)", background: "#323232", color: "#fff", borderRadius: 12, padding: "12px 20px", fontSize: 14, zIndex: 200, display: "flex", alignItems: "center", gap: 12, boxShadow: "0 4px 16px rgba(0,0,0,0.25)", whiteSpace: "nowrap" }}>
          <span>{toast.msg}</span>
          {toast.undo && <button onClick={toast.undo} style={{ background: "none", border: "none", color: "#81D4FA", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>בטל</button>}
        </div>
      )}

      <GlobalStyles />
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

async function migrateExistingData(householdId) {
  if (localStorage.getItem("grocery-migrated-v1")) return;
  try {
    for (const coll of ["items", "coupons", "insurance"]) {
      const snap = await getDocs(collection(db, coll));
      for (const docSnap of snap.docs) {
        await setDoc(doc(db, "households", householdId, coll, docSnap.id), docSnap.data());
      }
    }
    localStorage.setItem("grocery-migrated-v1", "true");
  } catch (e) { console.error("Migration error:", e); }
}

export default function GroceryApp() {
  const [userName,      setUserName]  = useState(() => localStorage.getItem("grocery-username") || "");
  const [authReady,     setAuthReady] = useState(false);
  const [authUser,      setAuthUser]  = useState(null);
  const [signInLoading, setSignInLoading] = useState(false);
  const [signInError,   setSignInError]   = useState("");
  const [screen,        setScreen]   = useState("home");
  const [showAddHousehold, setShowAddHousehold] = useState(false);

  const navigateTo = (screenName) => {
    window.history.pushState({ screen: screenName }, "");
    setScreen(screenName);
  };
  const goBack = () => window.history.back();

  useEffect(() => {
    // Chrome PWA exits when the user navigates back to the very first history
    // entry (position 0 = the initial app URL).  To prevent that, we seed the
    // stack with TWO floor entries so the user is always at position ≥ 1:
    //   0: __floor__ (initial navigation – never reached by the user)
    //   1: __floor__ (guard – this is as far back as back-presses ever go)
    //   2: home      (starting position for the user)
    // When back is pressed from position 2 we land on position 1 (guard),
    // popstate fires, and we immediately push home back to position 2.
    // Chrome never sees us leave position 1+, so it never closes the PWA.
    window.history.replaceState({ screen: "__floor__" }, "");
    window.history.pushState({ screen: "__floor__" }, "");
    window.history.pushState({ screen: "home" }, "");

    const handlePopState = (e) => {
      const target = e.state?.screen;
      if (!target || target === "__floor__") {
        setScreen("home");
        window.history.pushState({ screen: "home" }, "");
      } else {
        setScreen(target);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // ── Deep-link join: read ?join=CODE from the URL on first render. ──
  // The code is stripped from the URL immediately so it doesn't linger in
  // browser history, share screenshots, or get re-applied on reload.
  // sessionStorage holds it across the auth/name onboarding screens in case
  // the user reloads mid-onboarding.
  const [pendingJoinCode, setPendingJoinCode] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const fromUrl = params.get("join");
      if (fromUrl) {
        const url = new URL(window.location.href);
        url.searchParams.delete("join");
        window.history.replaceState({}, "", url.toString());
        const code = fromUrl.trim().toUpperCase();
        sessionStorage.setItem("grocery-pending-join", code);
        return code;
      }
      return sessionStorage.getItem("grocery-pending-join") || null;
    } catch { return null; }
  });
  const clearPendingJoin = () => {
    try { sessionStorage.removeItem("grocery-pending-join"); } catch {}
    setPendingJoinCode(null);
  };

  // ── Active household (session-only — not restored from localStorage) ──
  const [householdId,        setHouseholdId]        = useState("");
  const [householdName,      setHouseholdName]      = useState("");
  const [inviteCode,         setInviteCode]         = useState("");
  const [inviteCodeExpiry,   setInviteCodeExpiry]   = useState("");
  const [memberNames,        setMemberNames]        = useState({});
  const [enabledModules,     setEnabledModules]     = useState([]);

  // ── Persistent list of all households this user belongs to ──
  const [households, setHouseholds] = useState(() => {
    try {
      const saved = localStorage.getItem("grocery-households");
      if (saved) return JSON.parse(saved);
      // Migrate: if the user had a single household before, carry it over
      const id   = localStorage.getItem("grocery-householdId");
      const name = localStorage.getItem("grocery-householdName");
      if (id && name) {
        const list = [{ id, name }];
        localStorage.setItem("grocery-households", JSON.stringify(list));
        return list;
      }
      return [];
    } catch { return []; }
  });

  const saveName = (name) => { localStorage.setItem("grocery-username", name); setUserName(name); };

  // ── Called after creating or joining a household ──
  const saveHousehold = async (id, name) => {
    // Add to persistent list if this household is new
    setHouseholds(prev => {
      if (prev.find(h => h.id === id)) return prev;
      const updated = [...prev, { id, name }];
      localStorage.setItem("grocery-households", JSON.stringify(updated));
      return updated;
    });
    // Make it the active household for this session
    setHouseholdId(id);
    setHouseholdName(name);
    setShowAddHousehold(false);
    clearPendingJoin();
    try {
      const snap = await getDoc(doc(db, "households", id));
      if (snap.exists()) {
        setInviteCode(snap.data().inviteCode || "");
        setInviteCodeExpiry(snap.data().inviteCodeExpiry || "");
      }
    } catch (e) { console.error("Failed to load invite code:", e); }
  };

  // ── Rotate the active household's invite code ──
  const rotateInvite = async () => {
    if (!householdId) return;
    const newCode = generateCode();
    const newExpiry = expiryFromNow();
    try {
      await updateDoc(doc(db, "households", householdId), {
        inviteCode: newCode,
        inviteCodeExpiry: newExpiry,
      });
      setInviteCode(newCode);
      setInviteCodeExpiry(newExpiry);
    } catch (e) {
      console.error("Failed to rotate invite code:", e);
      alert("שגיאה ברענון הקוד. נסה שוב.");
    }
  };

  // ── Toggle an optional module on/off for this household ──
  const toggleModule = async (moduleId, enable) => {
    if (!householdId) return;
    const updated = enable
      ? [...enabledModules.filter(id => id !== moduleId), moduleId]
      : enabledModules.filter(id => id !== moduleId);
    try {
      await updateDoc(doc(db, "households", householdId), { enabledModules: updated });
    } catch (e) { console.error("Failed to toggle module:", e); }
  };

  // ── Select an existing household from the picker ──
  const selectHousehold = async (id, name) => {
    setHouseholdId(id);
    setHouseholdName(name);
    try {
      // Self-heal membership: ensures the current uid is in the household's
      // members array. Necessary for legacy households created before the
      // membership model existed, and harmless otherwise (arrayUnion is
      // idempotent). Without this, Firestore rules will reject subcollection
      // reads for households that were created before members tracking.
      if (auth.currentUser) {
        try {
          await updateDoc(doc(db, "households", id), {
            members: arrayUnion(auth.currentUser.uid),
            [`memberNames.${auth.currentUser.uid}`]: userName,
          });
        } catch (e) {
          console.error("Failed to ensure membership:", e);
        }
      }
      const snap = await getDoc(doc(db, "households", id));
      if (snap.exists()) {
        setInviteCode(snap.data().inviteCode || "");
        setInviteCodeExpiry(snap.data().inviteCodeExpiry || "");
      }
    } catch (e) { console.error("Failed to load invite code:", e); }
    setScreen("home");
  };

  // ── Delete a household from the picker list ──
  const deleteHousehold = (id) => {
    setHouseholds(prev => {
      const updated = prev.filter(h => h.id !== id);
      localStorage.setItem("grocery-households", JSON.stringify(updated));
      return updated;
    });
  };

  // ── Switch: clears active household → back to picker ──
  const switchHousehold = () => {
    setHouseholdId("");
    setHouseholdName("");
    setInviteCode("");
    setInviteCodeExpiry("");
    setScreen("home");
  };

  // ── Auth state listener ──
  // Only non-anonymous users are considered "signed in" for the app's
  // purposes. When a Google user arrives (on first login, on a new device,
  // or after clearing storage), we pull their household membership directly
  // from Firestore via an array-contains query on `members`, which makes
  // cross-device access automatic — no manual re-join needed.
  useEffect(() => {
    // Safety timeout — if onAuthStateChanged never fires, unblock the UI
    const timeout = setTimeout(() => setAuthReady(true), 5000);
    const unsub = onAuthStateChanged(auth, async (user) => {
      clearTimeout(timeout);
      if (user && !user.isAnonymous) {
        setAuthUser(user);
        // Deliberately do NOT auto-fill userName from Google displayName —
        // users pick their own nickname via NameSetup on first sign-in,
        // which is what shows up in memberNames and all "added by" labels.
        // Pull household membership from Firestore (cross-device sync).
        // Merges with any localStorage entries so we don't lose households
        // the user just created in this session before the query runs.
        try {
          const q = query(
            collection(db, "households"),
            where("members", "array-contains", user.uid),
            limit(20)
          );
          const snap = await getDocs(q);
          const fromFirestore = snap.docs.map(d => ({ id: d.id, name: d.data().name }));
          setHouseholds(prev => {
            const merged = [...fromFirestore];
            for (const h of prev) {
              if (!merged.find(m => m.id === h.id)) merged.push(h);
            }
            localStorage.setItem("grocery-households", JSON.stringify(merged));
            return merged;
          });
        } catch (e) {
          console.error("Failed to load households from Firestore:", e);
        }
      } else {
        // Signed out, or still holding a legacy anonymous session — treat
        // as unauthenticated so the LoginScreen gate appears.
        setAuthUser(null);
      }
      setAuthReady(true);
    });
    // Mobile fallback path: if we started a redirect sign-in earlier, this
    // resolves with the result on return. onAuthStateChanged above will also
    // fire, so we only need this to surface errors from the redirect.
    getRedirectResult(auth).catch((e) => {
      if (e?.code) {
        console.error("Redirect sign-in error:", e);
        setSignInError("שגיאה בהתחברות. נסה שוב.");
      }
    });
    return () => { clearTimeout(timeout); unsub(); };
  }, []);

  // ── Google sign-in handler ──
  // 1. If there is a lingering anonymous session, try linkWithPopup first.
  //    On success the anonymous UID is preserved and upgraded to a Google
  //    account, so any households the user already created in this browser
  //    stay attached to them.
  // 2. If the Google account is already linked to a different Firebase user
  //    (auth/credential-already-in-use), sign in with the returned credential
  //    instead — the anonymous UID is abandoned, and the Firestore
  //    array-contains query picks up the user's existing households from
  //    their other devices.
  // 3. If popup is blocked or unsupported (iOS Safari, some PWAs), fall back
  //    to a redirect flow.
  const handleSignIn = async () => {
    setSignInLoading(true);
    setSignInError("");
    const provider = new GoogleAuthProvider();
    try {
      if (auth.currentUser && auth.currentUser.isAnonymous) {
        try {
          await linkWithPopup(auth.currentUser, provider);
        } catch (e) {
          if (e?.code === "auth/credential-already-in-use") {
            const credential = GoogleAuthProvider.credentialFromError(e);
            if (credential) {
              await signInWithCredential(auth, credential);
            } else {
              throw e;
            }
          } else {
            throw e;
          }
        }
      } else {
        await signInWithPopup(auth, provider);
      }
    } catch (e) {
      if (
        e?.code === "auth/popup-blocked" ||
        e?.code === "auth/popup-closed-by-user" ||
        e?.code === "auth/cancelled-popup-request" ||
        e?.code === "auth/operation-not-supported-in-this-environment"
      ) {
        if (e.code === "auth/popup-closed-by-user" || e.code === "auth/cancelled-popup-request") {
          // User cancelled — silent, just reset the spinner
        } else {
          // Popup unavailable — switch to redirect
          try {
            if (auth.currentUser && auth.currentUser.isAnonymous) {
              await linkWithRedirect(auth.currentUser, provider);
            } else {
              await signInWithRedirect(auth, provider);
            }
            return; // page navigates away
          } catch (re) {
            console.error("Redirect sign-in error:", re);
            setSignInError("שגיאה בהתחברות. נסה שוב.");
          }
        }
      } else {
        console.error("Sign in error:", e);
        setSignInError("שגיאה בהתחברות. נסה שוב.");
      }
    } finally {
      setSignInLoading(false);
    }
  };

  // ── Sign out handler ──
  // Clears both Firebase auth and the client-side household cache so the
  // next user on the same device starts from a clean LoginScreen.
  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.error("Sign out error:", e);
    }
    setAuthUser(null);
    setUserName("");
    setHouseholds([]);
    setHouseholdId("");
    setHouseholdName("");
    setInviteCode("");
    setInviteCodeExpiry("");
    setMemberNames({});
    try {
      localStorage.removeItem("grocery-username");
      localStorage.removeItem("grocery-households");
      localStorage.removeItem("grocery-householdId");
      localStorage.removeItem("grocery-householdName");
    } catch {}
  };

  // ── Live listener on the active household doc ──
  // Keeps inviteCode, inviteCodeExpiry and memberNames in sync across
  // devices so that when a new member joins, their name appears for
  // everyone else without a manual refresh.
  useEffect(() => {
    if (!householdId) { setMemberNames({}); return; }
    const unsub = onSnapshot(
      doc(db, "households", householdId),
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        // Auto-rotate the invite code if it has expired OR if it was generated
        // with a longer expiry than INVITE_EXPIRY_DAYS (e.g. old 7-day codes).
        // The first member to open the app each day triggers the update for
        // the whole household via the real-time listener.
        const codeNeedsRotation = (iso) => {
          if (!iso || isInviteExpired(iso)) return true;
          // Rotate if the remaining time exceeds our daily window (+ 5 min grace)
          const maxAllowed = Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000 + 5 * 60 * 1000;
          return Date.parse(iso) > maxAllowed;
        };
        if (codeNeedsRotation(data.inviteCodeExpiry)) {
          const newCode   = generateCode();
          const newExpiry = expiryFromNow();
          updateDoc(doc(db, "households", snap.id), {
            inviteCode:       newCode,
            inviteCodeExpiry: newExpiry,
          }).catch((e) => console.error("Failed to auto-rotate invite code:", e));
          // Optimistically update local state; the listener will confirm
          setInviteCode(newCode);
          setInviteCodeExpiry(newExpiry);
        } else {
          setInviteCode(data.inviteCode || "");
          setInviteCodeExpiry(data.inviteCodeExpiry || "");
        }
        setMemberNames(data.memberNames || {});
        setEnabledModules(data.enabledModules || []);
      },
      (err) => console.error("household listener error:", err)
    );
    return () => unsub();
  }, [householdId]);

  if (!authReady) return <Loader />;

  // Screen 0: Not signed in → Google login gate. Everything downstream
  // assumes a real (non-anonymous) user so sign-in is mandatory.
  if (!authUser) {
    return <LoginScreen onSignIn={handleSignIn} loading={signInLoading} error={signInError} />;
  }

  // Screen 1: Pick a nickname. Shown once per Google account (until the
  // user clears their storage) — deliberately independent of the Google
  // displayName so users can go by a short family nickname rather than
  // their full Google profile name.
  if (!userName) return <NameSetup onSave={saveName} />;

  // Screen 2a: No households yet, or explicitly adding a new one,
  // or arrived via deep link (?join=CODE) — go straight to HouseholdSetup
  // with the code prefilled so it can auto-join.
  if (households.length === 0 || showAddHousehold || pendingJoinCode) {
    return (
      <HouseholdSetup
        userName={userName}
        onDone={saveHousehold}
        onCancel={households.length > 0 && !pendingJoinCode ? () => setShowAddHousehold(false) : undefined}
        initialJoinCode={pendingJoinCode}
      />
    );
  }

  // Screen 2b: Has households → picker (shown every session until one is chosen)
  if (!householdId) {
    return (
      <HouseholdPickerScreen
        userName={userName}
        households={households}
        onSelect={selectHousehold}
        onAddHousehold={() => setShowAddHousehold(true)}
        onDelete={deleteHousehold}
        onSignOut={handleSignOut}
      />
    );
  }

  // Screen 3+: Main app
  if (screen === "shopping")   return <ShoppingScreen   userName={userName} householdId={householdId} onBack={goBack} />;
  if (screen === "coupons")    return <CouponsScreen    userName={userName} householdId={householdId} onBack={goBack} />;
  if (screen === "insurance")  return <InsuranceScreen  userName={userName} householdId={householdId} onBack={goBack} />;
  if (screen === "birthdays")      return <BirthdaysScreen      userName={userName} householdId={householdId} onBack={goBack} />;
  if (screen === "subscriptions")  return <SubscriptionsScreen  userName={userName} householdId={householdId} onBack={goBack} />;
  if (screen === "personal_docs")  return <PersonalDocsScreen   userName={userName} householdId={householdId} onBack={goBack} />;
  if (screen === "service_providers") return <ServiceProvidersScreen userName={userName} householdId={householdId} onBack={goBack} />;
  if (screen === "bills")             return <BillsScreen             userName={userName} householdId={householdId} onBack={goBack} />;
  if (screen === "split_bills")       return <SplitBillsScreen        userName={userName} householdId={householdId} memberNames={memberNames} currentUid={auth.currentUser?.uid || ""} onBack={goBack} />;
  return (
    <HomeScreen
      userName={userName}
      householdName={householdName}
      inviteCode={inviteCode}
      inviteCodeExpiry={inviteCodeExpiry}
      onRotateInvite={rotateInvite}
      onNavigate={navigateTo}
      onSwitchHousehold={switchHousehold}
      householdId={householdId}
      memberNames={memberNames}
      currentUid={auth.currentUser?.uid || ""}
      enabledModules={enabledModules}
      onToggleModule={toggleModule}
    />
  );
}
