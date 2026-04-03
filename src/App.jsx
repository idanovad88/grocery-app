import { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, deleteDoc, doc, onSnapshot, query, orderBy } from "firebase/firestore";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";

// Firebase configuration
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

const PRIORITY_CONFIG = {
  red: { label: "דחוף", color: "#E53935", bg: "#FFEBEE", icon: "🔴" },
  yellow: { label: "חשוב", color: "#F9A825", bg: "#FFF8E1", icon: "🟡" },
  green: { label: "עדיפות נמוכה", color: "#43A047", bg: "#E8F5E9", icon: "🟢" },
};

function formatDate(iso) {
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}/${month} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function SwipeItem({ children, onSwipe }) {
  const ref = useRef(null);
  const startX = useRef(0);
  const currentX = useRef(0);
  const swiping = useRef(false);
  const [offset, setOffset] = useState(0);
  const [removing, setRemoving] = useState(false);

  const onStart = (e) => {
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    startX.current = x;
    swiping.current = true;
  };

  const onMove = (e) => {
    if (!swiping.current) return;
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    const diff = x - startX.current;
    if (diff < 0) {
      currentX.current = diff;
      setOffset(diff);
    }
  };

  const onEnd = () => {
    swiping.current = false;
    if (currentX.current < -100) {
      setRemoving(true);
      setOffset(-500);
      setTimeout(() => onSwipe(), 300);
    } else {
      currentX.current = 0;
      setOffset(0);
    }
  };

  return (
    <div
      ref={ref}
      onTouchStart={onStart}
      onTouchMove={onMove}
      onTouchEnd={onEnd}
      onMouseDown={onStart}
      onMouseMove={onMove}
      onMouseUp={onEnd}
      onMouseLeave={() => {
        if (swiping.current) onEnd();
      }}
      style={{
        transform: `translateX(${offset}px)`,
        transition: swiping.current ? "none" : "transform 0.3s ease",
        opacity: removing ? 0 : 1,
        position: "relative",
        cursor: "grab",
        userSelect: "none",
      }}
    >
      {children}
    </div>
  );
}

// Name setup screen
function NameSetup({ onSave }) {
  const [name, setName] = useState("");
  return (
    <div dir="rtl" style={{
      fontFamily: "'Rubik', sans-serif",
      maxWidth: 480,
      margin: "0 auto",
      minHeight: "100vh",
      background: "linear-gradient(165deg, #FAFAFA 0%, #F0EDE8 100%)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Rubik:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      <div style={{ fontSize: 64, marginBottom: 20 }}>🛒</div>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: "#2D3436", marginBottom: 8 }}>רשימת קניות</h1>
      <p style={{ fontSize: 15, color: "#888", marginBottom: 32, fontWeight: 300 }}>איך קוראים לך?</p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && name.trim() && onSave(name.trim())}
        placeholder="הכנס את השם שלך"
        autoFocus
        style={{
          width: "100%",
          maxWidth: 280,
          padding: "14px 16px",
          border: "2px solid #E8E5E0",
          borderRadius: 14,
          fontSize: 18,
          fontFamily: "inherit",
          outline: "none",
          textAlign: "center",
          direction: "rtl",
          marginBottom: 16,
        }}
      />
      <button
        onClick={() => name.trim() && onSave(name.trim())}
        disabled={!name.trim()}
        style={{
          width: "100%",
          maxWidth: 280,
          border: "none",
          background: name.trim() ? "linear-gradient(135deg, #2D3436, #636E72)" : "#ccc",
          color: "#fff",
          borderRadius: 14,
          padding: "14px",
          fontSize: 16,
          fontWeight: 600,
          fontFamily: "inherit",
          cursor: name.trim() ? "pointer" : "default",
        }}
      >
        בואו נתחיל ✓
      </button>
    </div>
  );
}

export default function GroceryApp() {
  const [userName, setUserName] = useState(() => {
    return localStorage.getItem("grocery-username") || "";
  });
  const [items, setItems] = useState([]);
  const [history, setHistory] = useState(() => {
    try {
      const raw = localStorage.getItem("grocery-history");
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [showAdd, setShowAdd] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [priority, setPriority] = useState("yellow");
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authReady, setAuthReady] = useState(false);
  const inputRef = useRef(null);

  // Sign in anonymously — transparent to the user
  useEffect(() => {
    signInAnonymously(auth).catch((e) => console.error("Auth error:", e));
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (user) setAuthReady(true);
    });
    return () => unsubscribeAuth();
  }, []);

  const saveName = (name) => {
    localStorage.setItem("grocery-username", name);
    setUserName(name);
  };

  // Listen to Firestore in real-time — only after auth is ready
  useEffect(() => {
    if (!authReady) return;
    const q = query(collection(db, "items"), orderBy("date", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newItems = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setItems(newItems);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [authReady]);

  // Save history to localStorage
  useEffect(() => {
    localStorage.setItem("grocery-history", JSON.stringify(history));
  }, [history]);

  const addItem = async () => {
    const name = inputValue.trim();
    if (!name) return;
    try {
      await addDoc(collection(db, "items"), {
        name,
        priority,
        addedBy: userName,
        date: new Date().toISOString(),
      });
      if (!history.includes(name)) {
        setHistory((prev) => [...prev, name]);
      }
    } catch (e) {
      console.error("Error adding item:", e);
    }
    setInputValue("");
    setPriority("yellow");
    setShowAdd(false);
    setShowSuggestions(false);
  };

  const removeItem = async (id) => {
    try {
      await deleteDoc(doc(db, "items", id));
    } catch (e) {
      console.error("Error removing item:", e);
    }
  };

  const onInput = (val) => {
    setInputValue(val);
    if (val.trim().length > 0) {
      const filtered = history.filter(
        (h) => h.includes(val.trim()) && h !== val.trim()
      );
      setSuggestions(filtered.slice(0, 5));
      setShowSuggestions(filtered.length > 0);
    } else {
      setShowSuggestions(false);
    }
  };

  const selectSuggestion = (s) => {
    setInputValue(s);
    setShowSuggestions(false);
  };

  useEffect(() => {
    if (showAdd && inputRef.current) inputRef.current.focus();
  }, [showAdd]);

  // Show name setup if no name saved
  if (!userName) {
    return <NameSetup onSave={saveName} />;
  }

  const sorted = [...items].sort((a, b) => {
    const order = { red: 0, yellow: 1, green: 2 };
    return order[a.priority] - order[b.priority];
  });

  if (loading)
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", fontFamily: "'Rubik', sans-serif" }}>
        <p style={{ color: "#888", fontSize: 18 }}>טוען...</p>
      </div>
    );

  return (
    <div
      dir="rtl"
      style={{
        fontFamily: "'Rubik', sans-serif",
        maxWidth: 480,
        margin: "0 auto",
        minHeight: "100vh",
        background: "linear-gradient(165deg, #FAFAFA 0%, #F0EDE8 100%)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <link href="https://fonts.googleapis.com/css2?family=Rubik:wght@300;400;500;600;700&display=swap" rel="stylesheet" />

      {/* Header */}
      <div
        style={{
          background: "linear-gradient(135deg, #2D3436 0%, #636E72 100%)",
          padding: "28px 24px 20px",
          borderRadius: "0 0 28px 28px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: "#fff", letterSpacing: -0.5 }}>
              🛒 רשימת קניות
            </h1>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "rgba(255,255,255,0.6)", fontWeight: 300 }}>
              {items.length} פריטים ברשימה
            </p>
          </div>
          <div style={{
            background: "rgba(255,255,255,0.12)",
            borderRadius: 10,
            padding: "8px 14px",
            fontSize: 13,
            color: "rgba(255,255,255,0.8)",
            fontWeight: 400,
          }}>
            👋 {userName}
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: "16px 16px 100px" }}>
        {/* Add Form */}
        {showAdd && (
          <div
            style={{
              background: "#fff",
              borderRadius: 20,
              padding: 20,
              marginBottom: 16,
              boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
              animation: "slideDown 0.3s ease",
            }}
          >
            <div style={{ position: "relative" }}>
              <input
                ref={inputRef}
                value={inputValue}
                onChange={(e) => onInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addItem()}
                placeholder="מה צריך לקנות?"
                style={{
                  width: "100%",
                  padding: "14px 16px",
                  border: "2px solid #E8E5E0",
                  borderRadius: 14,
                  fontSize: 16,
                  fontFamily: "inherit",
                  outline: "none",
                  boxSizing: "border-box",
                  transition: "border-color 0.2s",
                  direction: "rtl",
                }}
                onFocus={(e) => (e.target.style.borderColor = "#636E72")}
                onBlur={(e) => (e.target.style.borderColor = "#E8E5E0")}
              />
              {showSuggestions && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    right: 0,
                    left: 0,
                    background: "#fff",
                    borderRadius: 12,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.1)",
                    zIndex: 10,
                    marginTop: 4,
                    overflow: "hidden",
                  }}
                >
                  {suggestions.map((s, i) => (
                    <div
                      key={i}
                      onClick={() => selectSuggestion(s)}
                      style={{
                        padding: "12px 16px",
                        cursor: "pointer",
                        fontSize: 15,
                        borderBottom: i < suggestions.length - 1 ? "1px solid #f0f0f0" : "none",
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={(e) => (e.target.style.background = "#F5F3F0")}
                      onMouseLeave={(e) => (e.target.style.background = "transparent")}
                    >
                      🔄 {s}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Priority */}
            <div style={{ marginTop: 14 }}>
              <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 500, color: "#888" }}>
                רמת דחיפות:
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                {Object.entries(PRIORITY_CONFIG).map(([key, cfg]) => (
                  <button
                    key={key}
                    onClick={() => setPriority(key)}
                    style={{
                      flex: 1,
                      border: priority === key ? `2px solid ${cfg.color}` : "2px solid #E8E5E0",
                      background: priority === key ? cfg.bg : "#FAFAFA",
                      borderRadius: 12,
                      padding: "10px 8px",
                      cursor: "pointer",
                      fontSize: 13,
                      fontFamily: "inherit",
                      fontWeight: priority === key ? 600 : 400,
                      color: priority === key ? cfg.color : "#999",
                      transition: "all 0.2s",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 4,
                    }}
                  >
                    {cfg.icon} {cfg.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button
                onClick={addItem}
                disabled={!inputValue.trim()}
                style={{
                  flex: 1,
                  border: "none",
                  background: inputValue.trim() ? "linear-gradient(135deg, #2D3436, #636E72)" : "#ccc",
                  color: "#fff",
                  borderRadius: 12,
                  padding: "14px",
                  fontSize: 15,
                  fontWeight: 600,
                  fontFamily: "inherit",
                  cursor: inputValue.trim() ? "pointer" : "default",
                  transition: "all 0.2s",
                }}
              >
                הוסף לרשימה ✓
              </button>
              <button
                onClick={() => { setShowAdd(false); setInputValue(""); setShowSuggestions(false); }}
                style={{
                  border: "2px solid #E8E5E0",
                  background: "#fff",
                  color: "#999",
                  borderRadius: 12,
                  padding: "14px 20px",
                  fontSize: 15,
                  fontFamily: "inherit",
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Swipe hint */}
        {items.length > 0 && (
          <p style={{ textAlign: "center", fontSize: 12, color: "#BBB", margin: "8px 0 12px", fontWeight: 300 }}>
            ← החלק שמאלה למחיקה
          </p>
        )}

        {/* List */}
        {sorted.length === 0 && !showAdd && (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>🛒</div>
            <p style={{ fontSize: 18, color: "#999", fontWeight: 300 }}>הרשימה ריקה</p>
            <p style={{ fontSize: 14, color: "#CCC", fontWeight: 300, marginTop: 4 }}>
              לחצו על + כדי להוסיף פריטים
            </p>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sorted.map((item) => {
            const cfg = PRIORITY_CONFIG[item.priority];
            return (
              <div key={item.id} style={{ position: "relative", overflow: "hidden", borderRadius: 16 }}>
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "#E53935",
                    borderRadius: 16,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-start",
                    paddingLeft: 24,
                    color: "#fff",
                    fontSize: 14,
                    fontWeight: 600,
                    fontFamily: "inherit",
                  }}
                >
                  🗑️ מחיקה
                </div>
                <SwipeItem onSwipe={() => removeItem(item.id)}>
                  <div
                    style={{
                      background: "#fff",
                      borderRadius: 16,
                      padding: "16px 18px",
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
                      borderRight: `4px solid ${cfg.color}`,
                    }}
                  >
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 12,
                        background: cfg.bg,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 18,
                        flexShrink: 0,
                      }}
                    >
                      {cfg.icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 16, fontWeight: 500, color: "#2D3436" }}>
                        {item.name}
                      </p>
                      <div style={{ display: "flex", gap: 12, marginTop: 4, alignItems: "center" }}>
                        <span style={{ fontSize: 12, color: "#AAA", fontWeight: 300 }}>
                          📅 {formatDate(item.date)}
                        </span>
                        <span style={{ fontSize: 12, color: "#AAA", fontWeight: 300 }}>
                          👤 {item.addedBy}
                        </span>
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: cfg.color,
                        background: cfg.bg,
                        padding: "4px 10px",
                        borderRadius: 8,
                        flexShrink: 0,
                      }}
                    >
                      {cfg.label}
                    </div>
                  </div>
                </SwipeItem>
              </div>
            );
          })}
        </div>
      </div>

      {/* FAB */}
      {!showAdd && (
        <button
          onClick={() => setShowAdd(true)}
          style={{
            position: "fixed",
            bottom: 28,
            left: "50%",
            transform: "translateX(-50%)",
            width: 60,
            height: 60,
            borderRadius: "50%",
            border: "none",
            background: "linear-gradient(135deg, #2D3436, #636E72)",
            color: "#fff",
            fontSize: 30,
            fontWeight: 300,
            cursor: "pointer",
            boxShadow: "0 6px 24px rgba(45,52,54,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "transform 0.2s, box-shadow 0.2s",
            zIndex: 50,
          }}
          onMouseEnter={(e) => {
            e.target.style.transform = "translateX(-50%) scale(1.1)";
            e.target.style.boxShadow = "0 8px 32px rgba(45,52,54,0.45)";
          }}
          onMouseLeave={(e) => {
            e.target.style.transform = "translateX(-50%) scale(1)";
            e.target.style.boxShadow = "0 6px 24px rgba(45,52,54,0.35)";
          }}
        >
          +
        </button>
      )}

      <style>{`
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        * { -webkit-tap-highlight-color: transparent; }
        input::placeholder { color: #CCC; }
      `}</style>
    </div>
  );
}