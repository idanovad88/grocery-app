import { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, deleteDoc, updateDoc, doc, onSnapshot, query, orderBy } from "firebase/firestore";
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
  { id: "shopping", icon: "🛒", label: "רשימת קניות",      desc: "ניהול קניות משותף",          color: "#2D3436", bg: "#F0EDED", available: true  },
  { id: "coupons",  icon: "🎟️", label: "שוברים",           desc: "שמירת שוברים והטבות",        color: "#8E44AD", bg: "#F5EEF8", available: true  },
  { id: "receipts", icon: "🧾", label: "קבלות",            desc: "ארגון קבלות ותשלומים",       color: "#2980B9", bg: "#EBF5FB", available: false },
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

// ─── HomeScreen ───────────────────────────────────────────────────────────────

function HomeScreen({ userName, onNavigate }) {
  return (
    <div dir="rtl" style={{ fontFamily: "'Rubik', sans-serif", maxWidth: 480, margin: "0 auto", minHeight: "100vh", background: "linear-gradient(165deg, #FAFAFA 0%, #F0EDE8 100%)" }}>
      <div style={{ background: "linear-gradient(135deg, #2D3436 0%, #636E72 100%)", padding: "36px 24px 28px", borderRadius: "0 0 32px 32px", boxShadow: "0 8px 32px rgba(0,0,0,0.12)", marginBottom: 24 }}>
        <p style={{ margin: "0 0 6px", fontSize: 14, color: "rgba(255,255,255,0.55)", fontWeight: 300 }}>👋 שלום, {userName}</p>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#fff" }}>מה נפתח?</h1>
      </div>

      <div style={{ padding: "0 16px 32px", display: "flex", flexDirection: "column", gap: 12 }}>
        {MODULES.map((mod) => (
          <button
            key={mod.id}
            onClick={() => mod.available && onNavigate(mod.id)}
            style={{ display: "flex", alignItems: "center", gap: 16, background: "#fff", border: "none", borderRadius: 20, padding: "20px", textAlign: "right", cursor: mod.available ? "pointer" : "default", boxShadow: "0 2px 12px rgba(0,0,0,0.06)", opacity: mod.available ? 1 : 0.5, transition: "transform 0.15s, box-shadow 0.15s", fontFamily: "inherit", width: "100%" }}
            onMouseEnter={(e) => { if (mod.available) { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 6px 20px rgba(0,0,0,0.1)"; } }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.06)"; }}
          >
            <div style={{ width: 58, height: 58, borderRadius: 16, background: mod.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, flexShrink: 0 }}>
              {mod.icon}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 17, fontWeight: 600, color: "#2D3436", marginBottom: 3 }}>{mod.label}</div>
              <div style={{ fontSize: 13, color: "#AAA", fontWeight: 300 }}>{mod.available ? mod.desc : "בקרוב..."}</div>
            </div>
            {mod.available && <div style={{ color: "#CCC", fontSize: 20, marginLeft: 4 }}>‹</div>}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── ShoppingScreen ───────────────────────────────────────────────────────────

function ShoppingScreen({ userName, onBack }) {
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
    const q = query(collection(db, "items"), orderBy("date", "desc"));
    const unsub = onSnapshot(q, (snap) => { setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); setLoading(false); });
    return () => unsub();
  }, []);

  useEffect(() => { localStorage.setItem("grocery-history", JSON.stringify(history)); }, [history]);
  useEffect(() => { if (showAdd && inputRef.current) inputRef.current.focus(); }, [showAdd]);

  const addItem = async () => {
    const name = inputValue.trim();
    if (!name) return;
    try {
      await addDoc(collection(db, "items"), { name, priority, addedBy: userName, date: new Date().toISOString() });
      if (!history.includes(name)) setHistory((p) => [...p, name]);
    } catch (e) { console.error("Error adding item:", e); }
    setInputValue(""); setPriority("yellow"); setShowAdd(false); setShowSuggestions(false);
  };

  const removeItem = (id, itemData) => {
    const timerId = setTimeout(async () => {
      try { await deleteDoc(doc(db, "items", id)); } catch (e) { console.error(e); }
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
    try { await updateDoc(doc(db, "items", editingItem.id), { name: editItemName.trim(), priority: editItemPriority }); closeEditItem(); }
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

function CouponsScreen({ userName, onBack }) {
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
    const q = query(collection(db, "coupons"), orderBy("date", "desc"));
    const unsub = onSnapshot(q, (snap) => { setCoupons(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); setLoading(false); });
    return () => unsub();
  }, []);

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
      await addDoc(collection(db, "coupons"), { title: title.trim(), code: code.trim(), url: url.trim(), expiryDate, imageUrl, imagePath, fileType: file ? file.type : "", addedBy: userName, date: new Date().toISOString() });
      resetForm();
    } catch (e) { console.error("Error adding coupon:", e); }
    setUploading(false);
  };

  const removeCoupon = (id, couponData) => {
    const timerId = setTimeout(async () => {
      try { await deleteDoc(doc(db, "coupons", id)); } catch (e) { console.error(e); }
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
      await updateDoc(doc(db, "coupons", editingCoupon.id), {
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

export default function GroceryApp() {
  const [userName, setUserName] = useState(() => localStorage.getItem("grocery-username") || "");
  const [authReady, setAuthReady] = useState(false);
  const [screen, setScreen] = useState("home");

  const saveName = (name) => { localStorage.setItem("grocery-username", name); setUserName(name); };

  useEffect(() => {
    auth.authStateReady()
      .then(() => { if (!auth.currentUser) return signInAnonymously(auth); })
      .then(() => setAuthReady(true))
      .catch((e) => console.error("Auth error:", e));
  }, []);

  if (!authReady) return <Loader />;
  if (!userName)  return <NameSetup onSave={saveName} />;

  if (screen === "shopping") return <ShoppingScreen userName={userName} onBack={() => setScreen("home")} />;
  if (screen === "coupons")  return <CouponsScreen  userName={userName} onBack={() => setScreen("home")} />;
  return <HomeScreen userName={userName} onNavigate={setScreen} />;
}
