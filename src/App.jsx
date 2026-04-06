import { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, deleteDoc, updateDoc, doc, getDoc, onSnapshot, query, orderBy, getDocs, where, setDoc } from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";

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

const MODULES = [
  { id: "shopping",  icon: "🛒", label: "רשימת קניות",   desc: "ניהול קניות משותף",        color: "#2D3436", bg: "#F0EDED", available: true  },
  { id: "coupons",   icon: "🎟️", label: "שוברים",        desc: "שמירת שוברים והטבות",      color: "#8E44AD", bg: "#F5EEF8", available: true  },
  { id: "insurance", icon: "🛡️", label: "מסמכי ביטוח",  desc: "ניהול פוליסות וביטוחים",   color: "#1565C0", bg: "#E3F2FD", available: true  },
  { id: "receipts",  icon: "🧾", label: "קבלות",         desc: "ארגון קבלות ותשלומים",     color: "#2980B9", bg: "#EBF5FB", available: false },
];

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
  const startX   = useRef(0);
  const currentX = useRef(0);
  const swiping  = useRef(false);
  const [offset, setOffset]     = useState(0);
  const [removing, setRemoving] = useState(false);

  const onStart = (e) => { startX.current = e.touches ? e.touches[0].clientX : e.clientX; swiping.current = true; };
  const onMove  = (e) => {
    if (!swiping.current) return;
    const diff = (e.touches ? e.touches[0].clientX : e.clientX) - startX.current;
    currentX.current = diff;
    setOffset(diff);
  };
  const onEnd = () => {
    swiping.current = false;
    if (currentX.current < -80) {
      setRemoving(true); setOffset(-500); setTimeout(onSwipeLeft, 300);
    } else if (currentX.current > 80 && onSwipeRight) {
      currentX.current = 0; setOffset(0);
      onSwipeRight();
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
        onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd}
        onMouseDown={onStart}  onMouseMove={onMove} onMouseUp={onEnd}
        onMouseLeave={() => { if (swiping.current) onEnd(); }}
        style={{ transform: `translateX(${offset}px)`, transition: swiping.current ? "none" : "transform 0.3s ease", opacity: removing ? 0 : 1, cursor: "grab", userSelect: "none" }}
      >
        {children}
      </div>
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

function HouseholdSetup({ userName, onDone }) {
  const [mode, setMode]         = useState(null); // "create" | "join"
  const [name, setName]         = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [createdCode, setCreatedCode] = useState(null); // after creation, show code
  const [createdId, setCreatedId]     = useState(null);
  const [createdName, setCreatedName] = useState(null);

  const createHousehold = async () => {
    if (!name.trim()) return;
    setLoading(true); setError("");
    try {
      const inviteCode = generateCode();
      const newRef = doc(collection(db, "households"));
      await setDoc(newRef, { name: name.trim(), inviteCode, createdBy: userName, createdAt: new Date().toISOString() });
      setCreatedCode(inviteCode);
      setCreatedId(newRef.id);
      setCreatedName(name.trim());
    } catch (e) { setError("שגיאה ביצירת משק הבית. נסה שוב."); console.error(e); }
    setLoading(false);
  };

  const finishCreate = () => {
    localStorage.setItem("grocery-householdId", createdId);
    localStorage.setItem("grocery-householdName", createdName);
    onDone(createdId, createdName);
  };

  const joinHousehold = async () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 6) { setError("הזן קוד בן 6 תווים"); return; }
    setLoading(true); setError("");
    try {
      const q = query(collection(db, "households"), where("inviteCode", "==", code));
      const snap = await getDocs(q);
      if (snap.empty) { setError("קוד לא נמצא. בדוק שוב."); setLoading(false); return; }
      const hDoc = snap.docs[0];
      localStorage.setItem("grocery-householdId", hDoc.id);
      localStorage.setItem("grocery-householdName", hDoc.data().name);
      onDone(hDoc.id, hDoc.data().name);
    } catch (e) { setError("שגיאה בחיבור. נסה שוב."); console.error(e); }
    setLoading(false);
  };

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

// ─── HomeScreen ───────────────────────────────────────────────────────────────

function HomeScreen({ userName, householdName, inviteCode, onNavigate, onSwitchHousehold }) {
  const [moduleOrder, setModuleOrder] = useState(() => {
    try {
      const saved = localStorage.getItem("module-order");
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

  const orderedModules = moduleOrder.map(id => MODULES.find(m => m.id === id)).filter(Boolean);

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
      localStorage.setItem("module-order", JSON.stringify(newOrder));
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
              <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, color: "rgba(255,255,255,0.75)", fontWeight: 400 }}>🏠 {householdName}</span>
                {inviteCode && <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.1)", borderRadius: 6, padding: "2px 8px", letterSpacing: 2, fontWeight: 600 }}>{inviteCode}</span>}
              </div>
            )}
          </div>
          {onSwitchHousehold && (
            <button onClick={onSwitchHousehold} style={{ background: "rgba(255,255,255,0.12)", border: "none", borderRadius: 10, padding: "8px 12px", fontSize: 12, color: "rgba(255,255,255,0.75)", fontFamily: "inherit", cursor: "pointer", marginTop: 4 }}>
              החלף 🔄
            </button>
          )}
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
      </div>
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
  const [editItemPriority, setEditItemPriority] = useState("yellow");

  // Undo-delete state
  const [pendingDelete, setPendingDelete] = useState(null);

  useEffect(() => {
    const q = query(collection(db, "households", householdId, "items"), orderBy("date", "desc"));
    const unsub = onSnapshot(q, (snap) => { setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); setLoading(false); });
    return () => unsub();
  }, [householdId]);

  useEffect(() => { localStorage.setItem("grocery-history", JSON.stringify(history)); }, [history]);
  useEffect(() => { if (showAdd && inputRef.current) inputRef.current.focus(); }, [showAdd]);

  const addItem = async () => {
    const name = inputValue.trim();
    if (!name) return;
    try {
      await addDoc(collection(db, "households", householdId, "items"), { name, priority, addedBy: userName, date: new Date().toISOString() });
      if (!history.includes(name)) setHistory((p) => [...p, name]);
    } catch (e) { console.error("Error adding item:", e); }
    setInputValue(""); setPriority("yellow"); setShowAdd(false); setShowSuggestions(false);
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
          <BackButton onBack={onBack} />
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
    const unsub = onSnapshot(q, (snap) => { setCoupons(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); setLoading(false); });
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
        imagePath = `coupons/${Date.now()}_${file.name}`;
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
        imagePath = `coupons/${Date.now()}_${editFile.name}`;
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
          <BackButton onBack={onBack} light />
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
                      <img src={coupon.imageUrl} alt={coupon.title} style={{ width: "100%", height: 140, objectFit: "cover" }} />
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
    const unsub = onSnapshot(q, (snap) => { setDocs(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); setLoading(false); });
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
        filePath = `insurance/${Date.now()}_${file.name}`;
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
        filePath = `insurance/${Date.now()}_${editFile.name}`;
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
          <BackButton onBack={onBack} light />
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
                      <img src={insDoc.fileUrl} alt={insDoc.title} style={{ width: "100%", height: 120, objectFit: "cover" }} />
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

      <GlobalStyles />
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
  const [userName,      setUserName]      = useState(() => localStorage.getItem("grocery-username")    || "");
  const [householdId,   setHouseholdId]   = useState(() => localStorage.getItem("grocery-householdId") || "");
  const [householdName, setHouseholdName] = useState(() => localStorage.getItem("grocery-householdName") || "");
  const [inviteCode,    setInviteCode]    = useState("");
  const [authReady,     setAuthReady]     = useState(false);
  const [screen,        setScreen]        = useState("home");

  const saveName = (name) => { localStorage.setItem("grocery-username", name); setUserName(name); };

  const saveHousehold = async (id, name) => {
    setHouseholdId(id);
    setHouseholdName(name);
    // Fetch invite code to display in HomeScreen header
    try {
      const snap = await getDoc(doc(db, "households", id));
      if (snap.exists()) setInviteCode(snap.data().inviteCode || "");
    } catch {}
    // Migrate existing flat data into the household (only runs once)
    await migrateExistingData(id);
  };

  const switchHousehold = () => {
    localStorage.removeItem("grocery-householdId");
    localStorage.removeItem("grocery-householdName");
    setHouseholdId("");
    setHouseholdName("");
    setInviteCode("");
    setScreen("home");
  };

  useEffect(() => {
    auth.authStateReady()
      .then(() => { if (!auth.currentUser) return signInAnonymously(auth); })
      .then(() => setAuthReady(true))
      .catch((e) => console.error("Auth error:", e));
  }, []);

  // Load invite code on startup if household already set
  useEffect(() => {
    if (!householdId) return;
    getDoc(doc(db, "households", householdId))
      .then((snap) => { if (snap.exists()) setInviteCode(snap.data().inviteCode || ""); })
      .catch(() => {});
  }, [householdId]);

  if (!authReady)    return <Loader />;
  if (!userName)     return <NameSetup onSave={saveName} />;
  if (!householdId)  return <HouseholdSetup userName={userName} onDone={saveHousehold} />;

  if (screen === "shopping")  return <ShoppingScreen  userName={userName} householdId={householdId} onBack={() => setScreen("home")} />;
  if (screen === "coupons")   return <CouponsScreen   userName={userName} householdId={householdId} onBack={() => setScreen("home")} />;
  if (screen === "insurance") return <InsuranceScreen userName={userName} householdId={householdId} onBack={() => setScreen("home")} />;
  return (
    <HomeScreen
      userName={userName}
      householdName={householdName}
      inviteCode={inviteCode}
      onNavigate={setScreen}
      onSwitchHousehold={switchHousehold}
    />
  );
}
