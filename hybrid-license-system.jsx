import { useState, useEffect, useCallback, useMemo } from "react";

// ═══════════════════════════════════════════
// CRYPTO ENGINE — Hybrid ID + AES Simulation
// ═══════════════════════════════════════════
const CRYPTO = {
  SECRET: "CMPNY-AES256-PROD-KEY-2026",

  // Opaque Primary Key: CUS-{12 hex from crypto}
  generatePrimaryId() {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    return "CUS-" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("").toLowerCase();
  },

  // Display Code: {CC}-{PRD}-{SEQ}-{YY}
  generateDisplayCode(countryCode, productCode, seq) {
    const yy = new Date().getFullYear().toString().slice(-2);
    return `${countryCode}-${productCode}-${String(seq).padStart(4, "0")}-${yy}`;
  },

  // Luhn check char
  checkChar(str) {
    const clean = str.replace(/[^A-Z0-9]/gi, "").toUpperCase();
    let sum = 0;
    for (let i = 0; i < clean.length; i++) {
      const val = parseInt(clean[i], 36);
      sum += i % 2 === 0 ? val : val * 2;
    }
    return (sum % 36).toString(36).toUpperCase();
  },

  // XOR encrypt for license payload
  xorEncrypt(text, key) {
    let r = "";
    for (let i = 0; i < text.length; i++)
      r += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    return r;
  },

  hashCode(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 3266489909);
    return ((h1 ^ h2) >>> 0).toString(16).padStart(8, "0").toUpperCase();
  },

  generateLicenseKey(primaryId, productCode, tier, expiry, hwid) {
    const payload = JSON.stringify({
      pid: primaryId, // ← uses PRIMARY KEY, not display code
      prd: productCode,
      tier,
      exp: expiry,
      hwid: hwid || "ANY",
      iat: Date.now(),
      nonce: Array.from(crypto.getRandomValues(new Uint8Array(4)))
        .map(b => b.toString(16).padStart(2, "0")).join(""),
    });
    const enc = this.xorEncrypt(payload, this.SECRET);
    const encoded = btoa(
      Array.from(enc).map(c => c.charCodeAt(0).toString(16).padStart(2, "0")).join("")
    );
    const clean = encoded.replace(/[^A-Z0-9]/gi, "").toUpperCase();
    const blocks = [];
    for (let i = 0; i < clean.length && blocks.length < 5; i += 5)
      blocks.push(clean.substring(i, i + 5));
    while (blocks.length < 5)
      blocks.push(
        Array.from(crypto.getRandomValues(new Uint8Array(3)))
          .map(b => b.toString(36)).join("").toUpperCase().substring(0, 5)
      );
    const checksum = this.hashCode(payload + this.SECRET);
    return `${blocks.slice(0, 5).join("-")}-${checksum}`;
  },

  verifyLicenseKey(licenseKey) {
    try {
      const parts = licenseKey.trim().split("-");
      if (parts.length < 6) return { valid: false, reason: "تنسيق غير صالح / Invalid format" };
      const checksum = parts[parts.length - 1];
      const encoded = parts.slice(0, -1).join("");
      const hex = atob(encoded);
      let encStr = "";
      for (let i = 0; i < hex.length; i += 2)
        encStr += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
      const payload = this.xorEncrypt(encStr, this.SECRET);
      const data = JSON.parse(payload);
      const expected = this.hashCode(payload + this.SECRET);
      if (checksum !== expected) return { valid: false, reason: "الرمز محرّف / Tampered key" };
      if (data.exp && data.exp !== "PERMANENT" && new Date(data.exp) < new Date())
        return { valid: false, reason: "منتهي الصلاحية / Expired", data };
      return { valid: true, data };
    } catch {
      return { valid: false, reason: "مفتاح غير صالح / Invalid key" };
    }
  },

  generateDongleFile(license) {
    return JSON.stringify({
      version: "2.0",
      schema: "hybrid",
      primary_id: license.customerId,
      display_code: license.displayCode,
      license_id: license.id,
      license_key: license.key,
      product: license.productCode,
      product_name: license.productName,
      tier: license.tier,
      dongle_type: license.dongleType,
      hwid: license.hwid,
      issued_at: license.issuedAt,
      expires_at: license.expiry,
      activation_limit: license.activationLimit,
      signature: CRYPTO.hashCode(
        JSON.stringify({ key: license.key, pid: license.customerId, prd: license.productCode }) + CRYPTO.SECRET
      ),
    }, null, 2);
  },
};

// ═══════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════
const COUNTRIES = [
  { code: "QA", name: "قطر / Qatar" },
  { code: "SA", name: "السعودية / Saudi Arabia" },
  { code: "AE", name: "الإمارات / UAE" },
  { code: "KW", name: "الكويت / Kuwait" },
  { code: "BH", name: "البحرين / Bahrain" },
  { code: "OM", name: "عُمان / Oman" },
  { code: "EG", name: "مصر / Egypt" },
  { code: "JO", name: "الأردن / Jordan" },
  { code: "IQ", name: "العراق / Iraq" },
  { code: "US", name: "أمريكا / USA" },
  { code: "DE", name: "ألمانيا / Germany" },
  { code: "CN", name: "الصين / China" },
];

const PRODUCTS = [
  { code: "CNC", name: "ماكينة CNC / CNC Machine" },
  { code: "PLC", name: "متحكم PLC / PLC Controller" },
  { code: "IOT", name: "نظام IoT / IoT System" },
  { code: "ERP", name: "نظام ERP / ERP System" },
  { code: "CAD", name: "نظام تصميم / CAD System" },
  { code: "DRV", name: "محرك صناعي / Industrial Drive" },
];

const TIERS = [
  { code: "TRIAL", name: "تجريبي / Trial", color: "#64748b", days: 30 },
  { code: "BASIC", name: "أساسي / Basic", color: "#0ea5e9", days: 365 },
  { code: "PRO", name: "احترافي / Pro", color: "#8b5cf6", days: 365 },
  { code: "ENT", name: "مؤسسي / Enterprise", color: "#f59e0b", days: null },
  { code: "OEM", name: "تصنيعي / OEM", color: "#10b981", days: null },
];

const DONGLE_TYPES = [
  { code: "SOFT", name: "برمجي / Software", icon: "🔑" },
  { code: "USB", name: "USB Dongle", icon: "🔌" },
  { code: "CLOUD", name: "سحابي / Cloud", icon: "☁️" },
  { code: "NODE", name: "مربوط بجهاز / Node-Locked", icon: "🖥️" },
];

const CUST_FIELDS = [
  { key: "name", label: "اسم العميل", en: "Name", type: "text", req: true },
  { key: "company", label: "الشركة", en: "Company", type: "text", req: true },
  { key: "email", label: "البريد", en: "Email", type: "email", req: true },
  { key: "phone", label: "الهاتف", en: "Phone", type: "tel", req: true },
  { key: "city", label: "المدينة", en: "City", type: "text", req: false },
];

const STATUS = {
  active: { bg: "#059669", label: "نشط / Active" },
  pending: { bg: "#d97706", label: "معلق / Pending" },
  inactive: { bg: "#6b7280", label: "غير نشط / Inactive" },
};

const LIC_STATUS = {
  active: { bg: "#059669", label: "فعّال / Active" },
  revoked: { bg: "#dc2626", label: "ملغي / Revoked" },
  expired: { bg: "#6b7280", label: "منتهي / Expired" },
};

// ═══════════════════════════════════════════
// APP
// ═══════════════════════════════════════════
export default function App() {
  const [customers, setCustomers] = useState([]);
  const [licenses, setLicenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("register");
  const [toast, setToast] = useState(null);

  // Customer form
  const [cf, setCf] = useState({});
  const [cfCountry, setCfCountry] = useState("QA");
  const [cfProduct, setCfProduct] = useState("CNC");
  const [cfStatus, setCfStatus] = useState("active");
  const [editId, setEditId] = useState(null);

  // License form
  const [lf, setLf] = useState({ customerId: "", productCode: "", tier: "BASIC", dongleType: "SOFT", hwid: "", activationLimit: 1 });
  const [genResult, setGenResult] = useState(null);

  // Verify
  const [verifyInput, setVerifyInput] = useState("");
  const [verifyResult, setVerifyResult] = useState(null);

  // Search & expand
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(null);

  // Load
  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("hybrid-customers-v3");
        if (r?.value) setCustomers(JSON.parse(r.value));
      } catch {}
      try {
        const r = await window.storage.get("hybrid-licenses-v3");
        if (r?.value) setLicenses(JSON.parse(r.value));
      } catch {}
      setLoading(false);
    })();
  }, []);

  const save = useCallback(async (c, l) => {
    try { await window.storage.set("hybrid-customers-v3", JSON.stringify(c)); } catch {}
    try { await window.storage.set("hybrid-licenses-v3", JSON.stringify(l)); } catch {}
  }, []);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(null), 3000); };

  // Sequence per product category
  const getNextSeq = useCallback((productCode, existingCustomers) => {
    const existing = existingCustomers.filter(c => c.productCode === productCode);
    if (existing.length === 0) return 1;
    const maxSeq = Math.max(...existing.map(c => c.seq || 0));
    return maxSeq + 1;
  }, []);

  // ── Save Customer ──
  const saveCustomer = async () => {
    const missing = CUST_FIELDS.filter(f => f.req && !cf[f.key]?.trim());
    if (missing.length) return flash("⚠ أكمل الحقول المطلوبة");

    let upd;
    if (editId) {
      upd = customers.map(c => {
        if (c.id !== editId) return c;
        const newDisplay = CRYPTO.generateDisplayCode(cfCountry, cfProduct, c.seq);
        return { ...c, ...cf, countryCode: cfCountry, productCode: cfProduct, displayCode: newDisplay, status: cfStatus, updatedAt: new Date().toISOString() };
      });
      flash(`✓ تم التحديث / Updated`);
      setEditId(null);
    } else {
      const seq = getNextSeq(cfProduct, customers);
      const primaryId = CRYPTO.generatePrimaryId();
      const displayCode = CRYPTO.generateDisplayCode(cfCountry, cfProduct, seq);
      const nc = {
        id: primaryId,
        displayCode,
        seq,
        ...cf,
        countryCode: cfCountry,
        productCode: cfProduct,
        status: cfStatus,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      upd = [nc, ...customers];
      flash(`✓ تم التسجيل / ${primaryId}`);
    }
    setCustomers(upd);
    await save(upd, licenses);
    setCf({});
    setCfCountry("QA");
    setCfProduct("CNC");
    setCfStatus("active");
  };

  const editCustomer = (c) => {
    setEditId(c.id);
    const d = {};
    CUST_FIELDS.forEach(f => (d[f.key] = c[f.key] || ""));
    setCf(d);
    setCfCountry(c.countryCode || "QA");
    setCfProduct(c.productCode || "CNC");
    setCfStatus(c.status || "active");
    setView("register");
  };

  const deleteCustomer = async (id) => {
    const upd = customers.filter(c => c.id !== id);
    setCustomers(upd);
    await save(upd, licenses);
    flash("✓ تم الحذف / Deleted");
  };

  // ── License ──
  const generateLicense = async () => {
    if (!lf.customerId || !lf.productCode) return flash("⚠ اختر العميل والمنتج");
    const cust = customers.find(c => c.id === lf.customerId);
    if (!cust) return flash("⚠ عميل غير موجود");
    const tierInfo = TIERS.find(t => t.code === lf.tier);
    const expiry = tierInfo?.days ? new Date(Date.now() + tierInfo.days * 86400000).toISOString().split("T")[0] : "PERMANENT";
    // License key binds to PRIMARY ID — never display code
    const key = CRYPTO.generateLicenseKey(cust.id, lf.productCode, lf.tier, expiry, lf.hwid);
    const product = PRODUCTS.find(p => p.code === lf.productCode);
    const nl = {
      id: `LIC-${Date.now().toString(36).toUpperCase().slice(-6)}`,
      key,
      customerId: cust.id,
      displayCode: cust.displayCode,
      customerName: cust.name,
      productCode: lf.productCode,
      productName: product?.name || lf.productCode,
      tier: lf.tier,
      dongleType: lf.dongleType,
      hwid: lf.hwid || "ANY",
      activationLimit: lf.activationLimit,
      activations: 0,
      expiry,
      status: "active",
      issuedAt: new Date().toISOString(),
    };
    const updLics = [nl, ...licenses];
    setLicenses(updLics);
    await save(customers, updLics);
    setGenResult(nl);
    flash(`✓ رخصة جديدة / ${nl.id}`);
  };

  const revokeLicense = async (id) => {
    const upd = licenses.map(l => (l.id === id ? { ...l, status: "revoked" } : l));
    setLicenses(upd);
    await save(customers, upd);
    flash("✓ تم الإلغاء / Revoked");
  };

  const verifyKey = () => {
    if (!verifyInput.trim()) return;
    const result = CRYPTO.verifyLicenseKey(verifyInput.trim());
    if (result.valid) {
      const lic = licenses.find(l => l.key === verifyInput.trim());
      if (lic) {
        result.license = lic;
        const cust = customers.find(c => c.id === lic.customerId);
        result.customer = cust;
        if (lic.status === "revoked") {
          result.valid = false;
          result.reason = "الرخصة ملغية / Revoked";
        }
      }
    }
    setVerifyResult(result);
  };

  const downloadDongle = (lic) => {
    const cust = customers.find(c => c.id === lic.customerId);
    const content = CRYPTO.generateDongleFile({ ...lic, displayCode: cust?.displayCode || "" });
    const blob = new Blob([content], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${lic.dongleType}_${lic.customerId}_${lic.productCode}.lic`;
    a.click();
  };

  const exportCSV = () => {
    const h = ["Primary ID", "Display Code", "Customer", "Product", "Tier", "Dongle", "Key", "HWID", "Expiry", "Status"];
    const rows = licenses.map(l => [l.customerId, l.displayCode, l.customerName, l.productCode, l.tier, l.dongleType, l.key, l.hwid, l.expiry, l.status]);
    const csv = [h, ...rows].map(r => r.map(v => `"${v || ""}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `licenses_hybrid_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
  };

  const filteredLics = useMemo(() => {
    if (!search) return licenses;
    const q = search.toLowerCase();
    return licenses.filter(l =>
      l.id?.toLowerCase().includes(q) || l.customerName?.toLowerCase().includes(q) ||
      l.customerId?.toLowerCase().includes(q) || l.displayCode?.toLowerCase().includes(q) ||
      l.productCode?.toLowerCase().includes(q) || l.key?.toLowerCase().includes(q)
    );
  }, [licenses, search]);

  if (loading) return (
    <div style={S.root}>
      <div style={{ textAlign: "center", padding: 80 }}>
        <div style={{ width: 32, height: 32, border: "3px solid #1e293b", borderTopColor: "#06b6d4", borderRadius: "50%", animation: "spin .7s linear infinite", margin: "0 auto" }} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </div>
  );

  const TABS = [
    { k: "register", ic: "📝", ar: "تسجيل", en: "Register" },
    { k: "customers", ic: "👥", ar: "العملاء", en: "Customers" },
    { k: "generate", ic: "🔐", ar: "إنشاء رخصة", en: "License" },
    { k: "licenses", ic: "📋", ar: "السجل", en: "Registry" },
    { k: "verify", ic: "✓", ar: "تحقق", en: "Verify" },
  ];

  const activeCustomers = customers.filter(c => c.status === "active");

  return (
    <div style={S.root}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        input:focus,textarea:focus,select:focus{border-color:#06b6d4!important;outline:none}
        ::selection{background:#06b6d4;color:#020617}
        *{box-sizing:border-box}
      `}</style>
      {toast && <div style={S.toast}>{toast}</div>}

      {/* Header */}
      <div style={S.hdr}>
        <div>
          <h1 style={S.title}>نظام Hybrid — العملاء والتراخيص</h1>
          <p style={S.sub}>Hybrid Customer & License System</p>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[
            { n: customers.length, l: "عملاء", c: "#06b6d4" },
            { n: licenses.filter(l => l.status === "active").length, l: "رخص", c: "#10b981" },
          ].map((s, i) => (
            <div key={i} style={S.stat}>
              <span style={{ fontSize: 20, fontWeight: 800, color: s.c }}>{s.n}</span>
              <span style={{ fontSize: 9, color: "#64748b" }}>{s.l}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={S.nav}>
        {TABS.map(t => (
          <button key={t.k} onClick={() => { setView(t.k); setExpanded(null); setGenResult(null); }}
            style={{ ...S.tab, ...(view === t.k ? S.tabA : {}) }}>
            <span style={{ fontSize: 14 }}>{t.ic}</span>
            <span style={{ fontSize: 11 }}>{t.ar}</span>
            <span style={{ fontSize: 9, opacity: .5 }}>{t.en}</span>
          </button>
        ))}
      </div>

      {/* ══════ REGISTER ══════ */}
      {view === "register" && (
        <div style={S.card}>
          <h2 style={S.cT}>{editId ? `تعديل / Edit` : "تسجيل عميل جديد / New Customer"}</h2>

          {/* ID Preview */}
          {!editId && (
            <div style={S.idPreview}>
              <div style={S.idRow}>
                <div style={S.idBlock}>
                  <span style={S.idLabel}>Primary key (مُعتم / opaque)</span>
                  <span style={{ ...S.idVal, color: "#06b6d4" }}>CUS-••••••••••••</span>
                </div>
                <span style={{ color: "#334155", fontSize: 18 }}>+</span>
                <div style={S.idBlock}>
                  <span style={S.idLabel}>Display code (مقروء / readable)</span>
                  <span style={{ ...S.idVal, color: "#f59e0b" }}>{cfCountry}-{cfProduct}-{String(getNextSeq(cfProduct, customers)).padStart(4, "0")}-{new Date().getFullYear().toString().slice(-2)}</span>
                </div>
              </div>
            </div>
          )}

          <div style={S.grid}>
            {CUST_FIELDS.map(f => (
              <div key={f.key}>
                <label style={S.lbl}>{f.label} / {f.en}{f.req && <span style={{ color: "#ef4444" }}> *</span>}</label>
                <input type={f.type} value={cf[f.key] || ""} onChange={e => setCf({ ...cf, [f.key]: e.target.value })} style={S.inp} placeholder={f.en} />
              </div>
            ))}

            <div>
              <label style={S.lbl}>الدولة / Country *</label>
              <select value={cfCountry} onChange={e => setCfCountry(e.target.value)} style={S.inp}>
                {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            </div>

            <div>
              <label style={S.lbl}>فئة المنتج / Product *</label>
              <select value={cfProduct} onChange={e => setCfProduct(e.target.value)} style={S.inp}>
                {PRODUCTS.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}
              </select>
            </div>
          </div>

          <div style={{ margin: "12px 0" }}>
            <label style={S.lbl}>الحالة / Status</label>
            <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
              {Object.entries(STATUS).map(([k, v]) => (
                <button key={k} onClick={() => setCfStatus(k)}
                  style={{ ...S.sBtn, background: cfStatus === k ? v.bg : "transparent", color: cfStatus === k ? "#fff" : "#64748b", border: `1.5px solid ${cfStatus === k ? v.bg : "#334155"}` }}>
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={saveCustomer} style={{ ...S.mainBtn, flex: 1 }}>
              {editId ? "حفظ التعديلات / Save" : "تسجيل / Register"}
            </button>
            {editId && (
              <button onClick={() => { setEditId(null); setCf({}); }} style={S.secBtn}>إلغاء</button>
            )}
          </div>
        </div>
      )}

      {/* ══════ CUSTOMERS LIST ══════ */}
      {view === "customers" && (
        <div style={S.card}>
          <h2 style={S.cT}>قائمة العملاء / Customers ({customers.length})</h2>
          {customers.length === 0 ? (
            <p style={{ color: "#64748b", textAlign: "center", padding: 32 }}>لا يوجد عملاء / No customers</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>
                    {["Primary ID", "Display Code", "الاسم", "الشركة", "الدولة", "المنتج", "الحالة", ""].map((h, i) => (
                      <th key={i} style={S.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {customers.map(c => (
                    <tr key={c.id}>
                      <td style={{ ...S.td, fontFamily: "monospace", color: "#06b6d4", fontSize: 11 }}>{c.id}</td>
                      <td style={{ ...S.td, fontFamily: "monospace", color: "#f59e0b", fontSize: 11 }}>{c.displayCode}</td>
                      <td style={S.td}>{c.name}</td>
                      <td style={S.td}>{c.company}</td>
                      <td style={S.td}>{c.countryCode}</td>
                      <td style={S.td}>{c.productCode}</td>
                      <td style={S.td}>
                        <span style={{ ...S.badge, background: STATUS[c.status]?.bg }}>{STATUS[c.status]?.label}</span>
                      </td>
                      <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                        <button onClick={() => editCustomer(c)} style={S.actBtn}>✎</button>
                        <button onClick={() => deleteCustomer(c.id)} style={{ ...S.actBtn, color: "#ef4444" }}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ══════ GENERATE LICENSE ══════ */}
      {view === "generate" && (
        <div style={S.card}>
          <h2 style={S.cT}>إنشاء رخصة / Generate License</h2>

          {/* Hybrid ID binding notice */}
          <div style={S.notice}>
            <span style={{ fontSize: 14 }}>🔗</span>
            <span>الرخصة ترتبط بالـ Primary Key المُعتم فقط — وليس بالـ Display Code</span>
          </div>

          <div style={S.grid}>
            <div>
              <label style={S.lbl}>العميل / Customer *</label>
              <select value={lf.customerId} onChange={e => setLf({ ...lf, customerId: e.target.value })} style={S.inp}>
                <option value="">— اختر —</option>
                {activeCustomers.map(c => (
                  <option key={c.id} value={c.id}>{c.name} — {c.displayCode}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={S.lbl}>المنتج / Product *</label>
              <select value={lf.productCode} onChange={e => setLf({ ...lf, productCode: e.target.value })} style={S.inp}>
                <option value="">— اختر —</option>
                {PRODUCTS.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label style={S.lbl}>المستوى / Tier</label>
              <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginTop: 4 }}>
                {TIERS.map(t => (
                  <button key={t.code} onClick={() => setLf({ ...lf, tier: t.code })}
                    style={{ ...S.sBtn, fontSize: 10, padding: "4px 8px", background: lf.tier === t.code ? t.color : "transparent", color: lf.tier === t.code ? "#fff" : "#64748b", border: `1.5px solid ${lf.tier === t.code ? t.color : "#334155"}` }}>
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label style={S.lbl}>نوع الحماية / Dongle</label>
              <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginTop: 4 }}>
                {DONGLE_TYPES.map(d => (
                  <button key={d.code} onClick={() => setLf({ ...lf, dongleType: d.code })}
                    style={{ ...S.sBtn, fontSize: 10, padding: "4px 8px", background: lf.dongleType === d.code ? "#1e40af" : "transparent", color: lf.dongleType === d.code ? "#fff" : "#64748b", border: `1.5px solid ${lf.dongleType === d.code ? "#3b82f6" : "#334155"}` }}>
                    {d.icon} {d.name}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label style={S.lbl}>HWID (اختياري)</label>
              <input value={lf.hwid} onChange={e => setLf({ ...lf, hwid: e.target.value })} style={S.inp} placeholder="ANY if empty" />
            </div>
            <div>
              <label style={S.lbl}>حد التفعيل / Limit</label>
              <input type="number" min={1} max={999} value={lf.activationLimit} onChange={e => setLf({ ...lf, activationLimit: parseInt(e.target.value) || 1 })} style={S.inp} />
            </div>
          </div>

          <button onClick={generateLicense} style={{ ...S.mainBtn, marginTop: 14 }}>
            🔐 إنشاء الرخصة المشفرة / Generate Encrypted License
          </button>

          {genResult && (
            <div style={{ ...S.resultBox, borderColor: "#10b981", animation: "fadeUp .3s ease" }}>
              <h3 style={{ margin: "0 0 10px", color: "#10b981", fontSize: 14 }}>✅ تم إنشاء الرخصة بنجاح</h3>

              <div style={S.idPreview}>
                <div style={S.idRow}>
                  <div style={S.idBlock}>
                    <span style={S.idLabel}>مرتبط بـ / Bound to Primary Key</span>
                    <span style={{ ...S.idVal, color: "#06b6d4" }}>{genResult.customerId}</span>
                  </div>
                  <span style={{ color: "#334155", fontSize: 12 }}>≠</span>
                  <div style={S.idBlock}>
                    <span style={S.idLabel}>Display Code (مرجع فقط)</span>
                    <span style={{ ...S.idVal, color: "#f59e0b" }}>{genResult.displayCode}</span>
                  </div>
                </div>
              </div>

              <div style={{ background: "#020617", borderRadius: 8, padding: 10, margin: "10px 0" }}>
                <div style={{ fontSize: 10, color: "#475569", marginBottom: 4, letterSpacing: 1 }}>ENCRYPTED LICENSE KEY</div>
                <div style={{ fontFamily: "monospace", fontSize: 13, color: "#22d3ee", wordBreak: "break-all", lineHeight: 1.7, letterSpacing: .5 }}>{genResult.key}</div>
              </div>

              {[
                ["License ID", genResult.id],
                ["Product", genResult.productName],
                ["Tier", genResult.tier],
                ["Dongle", DONGLE_TYPES.find(d => d.code === genResult.dongleType)?.name],
                ["HWID", genResult.hwid],
                ["Expiry", genResult.expiry === "PERMANENT" ? "∞ Permanent" : genResult.expiry],
              ].map(([k, v], i) => (
                <div key={i} style={S.dRow}>
                  <span style={{ color: "#64748b", fontSize: 11 }}>{k}</span>
                  <span style={{ color: "#e2e8f0", fontSize: 11, direction: "ltr" }}>{v}</span>
                </div>
              ))}

              <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
                <button onClick={() => { navigator.clipboard.writeText(genResult.key); flash("✓ تم النسخ"); }}
                  style={{ ...S.secBtn, flex: 1, borderColor: "#22d3ee", color: "#22d3ee" }}>📋 نسخ المفتاح</button>
                <button onClick={() => downloadDongle(genResult)}
                  style={{ ...S.secBtn, flex: 1, borderColor: "#10b981", color: "#10b981" }}>⤓ تحميل .lic</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════ LICENSES LIST ══════ */}
      {view === "licenses" && (
        <div style={S.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            <h2 style={S.cT}>سجل التراخيص / Licenses ({licenses.length})</h2>
            {licenses.length > 0 && <button onClick={exportCSV} style={S.secBtn}>⤓ CSV</button>}
          </div>
          <input value={search} onChange={e => { setSearch(e.target.value); setExpanded(null); }}
            style={{ ...S.inp, marginBottom: 10 }} placeholder="بحث بـ Primary ID, Display Code, اسم, مفتاح..." />

          {filteredLics.length === 0 ? (
            <p style={{ color: "#64748b", textAlign: "center", padding: 24 }}>
              {licenses.length === 0 ? "لا توجد تراخيص" : "لا نتائج"}
            </p>
          ) : filteredLics.map(l => (
            <div key={l.id} onClick={() => setExpanded(expanded === l.id ? null : l.id)}
              style={{ ...S.licCard, borderColor: expanded === l.id ? "#06b6d4" : "#1e293b" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
                <div>
                  <span style={{ fontFamily: "monospace", color: "#8b5cf6", fontSize: 11 }}>{l.id}</span>
                  <span style={{ color: "#334155", margin: "0 4px" }}>|</span>
                  <span style={{ color: "#e2e8f0", fontWeight: 600, fontSize: 12 }}>{l.customerName}</span>
                </div>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <span style={{ ...S.badge, background: TIERS.find(t => t.code === l.tier)?.color, fontSize: 9 }}>{l.tier}</span>
                  <span style={{ ...S.badge, background: LIC_STATUS[l.status]?.bg, fontSize: 9 }}>{LIC_STATUS[l.status]?.label}</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 4, fontSize: 10, color: "#475569", fontFamily: "monospace" }}>
                <span style={{ color: "#06b6d4" }}>{l.customerId}</span>
                <span style={{ color: "#f59e0b" }}>{l.displayCode}</span>
                <span>{l.productCode}</span>
                <span>{l.expiry === "PERMANENT" ? "∞" : `⏳${l.expiry}`}</span>
              </div>

              {expanded === l.id && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #1e293b", animation: "fadeUp .2s ease" }}>
                  <div style={{ background: "#020617", borderRadius: 6, padding: 8, marginBottom: 10 }}>
                    <div style={{ fontSize: 9, color: "#475569", letterSpacing: 1, marginBottom: 2 }}>LICENSE KEY</div>
                    <div style={{ fontFamily: "monospace", fontSize: 11, color: "#22d3ee", wordBreak: "break-all", lineHeight: 1.6 }}>{l.key}</div>
                  </div>
                  <div style={S.dRow}>
                    <span style={{ color: "#06b6d4", fontSize: 10 }}>🔗 Primary Key (immutable)</span>
                    <span style={{ fontFamily: "monospace", color: "#06b6d4", fontSize: 11 }}>{l.customerId}</span>
                  </div>
                  <div style={S.dRow}>
                    <span style={{ color: "#f59e0b", fontSize: 10 }}>📋 Display Code (mutable)</span>
                    <span style={{ fontFamily: "monospace", color: "#f59e0b", fontSize: 11 }}>{l.displayCode}</span>
                  </div>
                  {[
                    ["Product", l.productName],
                    ["Dongle", DONGLE_TYPES.find(d => d.code === l.dongleType)?.name],
                    ["HWID", l.hwid],
                    ["Issued", l.issuedAt?.split("T")[0]],
                    ["Expiry", l.expiry === "PERMANENT" ? "∞" : l.expiry],
                  ].map(([k, v], i) => (
                    <div key={i} style={S.dRow}>
                      <span style={{ color: "#64748b", fontSize: 10 }}>{k}</span>
                      <span style={{ color: "#cbd5e1", fontSize: 11 }}>{v}</span>
                    </div>
                  ))}
                  <div style={{ display: "flex", gap: 4, marginTop: 10, flexWrap: "wrap" }}>
                    <button onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(l.key); flash("✓ تم النسخ"); }}
                      style={{ ...S.secBtn, flex: 1, fontSize: 10 }}>📋 نسخ</button>
                    <button onClick={e => { e.stopPropagation(); downloadDongle(l); }}
                      style={{ ...S.secBtn, flex: 1, fontSize: 10, borderColor: "#10b981", color: "#10b981" }}>⤓ .lic</button>
                    {l.status === "active" && (
                      <button onClick={e => { e.stopPropagation(); revokeLicense(l.id); }}
                        style={{ ...S.secBtn, fontSize: 10, borderColor: "#ef4444", color: "#ef4444" }}>⊘ إلغاء</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ══════ VERIFY ══════ */}
      {view === "verify" && (
        <div style={S.card}>
          <h2 style={S.cT}>التحقق من الرخصة / Verify License</h2>
          <div style={S.notice}>
            <span style={{ fontSize: 14 }}>🔍</span>
            <span>التحقق يتم عبر Primary Key المشفر داخل المفتاح — وليس عبر Display Code</span>
          </div>
          <textarea value={verifyInput} onChange={e => { setVerifyInput(e.target.value); setVerifyResult(null); }}
            style={{ ...S.inp, minHeight: 70, fontFamily: "monospace", fontSize: 12, resize: "vertical" }}
            placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-CHECKSUM" />
          <button onClick={verifyKey} style={{ ...S.mainBtn, marginTop: 8, background: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}>
            🔍 تحقق / Verify
          </button>

          {verifyResult && (
            <div style={{ ...S.resultBox, borderColor: verifyResult.valid ? "#10b981" : "#ef4444", animation: "fadeUp .3s ease" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 24 }}>{verifyResult.valid ? "✅" : "❌"}</span>
                <div>
                  <h3 style={{ margin: 0, color: verifyResult.valid ? "#10b981" : "#ef4444", fontSize: 15 }}>
                    {verifyResult.valid ? "رخصة صالحة / Valid" : "غير صالحة / Invalid"}
                  </h3>
                  {!verifyResult.valid && <p style={{ margin: "2px 0 0", color: "#ef4444", fontSize: 11 }}>{verifyResult.reason}</p>}
                </div>
              </div>

              {verifyResult.valid && verifyResult.data && (
                <>
                  <div style={S.idPreview}>
                    <div style={S.idRow}>
                      <div style={S.idBlock}>
                        <span style={S.idLabel}>Primary Key (من التشفير)</span>
                        <span style={{ ...S.idVal, color: "#06b6d4" }}>{verifyResult.data.pid}</span>
                      </div>
                      {verifyResult.customer && (
                        <>
                          <span style={{ color: "#334155", fontSize: 12 }}>→</span>
                          <div style={S.idBlock}>
                            <span style={S.idLabel}>Display Code (من Database)</span>
                            <span style={{ ...S.idVal, color: "#f59e0b" }}>{verifyResult.customer.displayCode}</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {[
                    ["Product", verifyResult.data.prd],
                    ["Tier", verifyResult.data.tier],
                    ["HWID", verifyResult.data.hwid],
                    ["Expiry", verifyResult.data.exp === "PERMANENT" ? "∞" : verifyResult.data.exp],
                  ].map(([k, v], i) => (
                    <div key={i} style={S.dRow}>
                      <span style={{ color: "#64748b", fontSize: 11 }}>{k}</span>
                      <span style={{ color: "#e2e8f0", fontSize: 11 }}>{v}</span>
                    </div>
                  ))}

                  {verifyResult.customer && (
                    <div style={{ marginTop: 10, padding: 10, background: "#020617", borderRadius: 8 }}>
                      <div style={{ fontSize: 10, color: "#475569", marginBottom: 6 }}>بيانات العميل / Customer record</div>
                      {CUST_FIELDS.map(f => (
                        <div key={f.key} style={S.dRow}>
                          <span style={{ color: "#64748b", fontSize: 10 }}>{f.label}</span>
                          <span style={{ color: "#e2e8f0", fontSize: 10 }}>{verifyResult.customer[f.key] || "—"}</span>
                        </div>
                      ))}
                      <div style={S.dRow}>
                        <span style={{ color: "#64748b", fontSize: 10 }}>الدولة</span>
                        <span style={{ color: "#e2e8f0", fontSize: 10 }}>{verifyResult.customer.countryCode}</span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════
const S = {
  root: { fontFamily: "'IBM Plex Sans Arabic','IBM Plex Sans',system-ui,sans-serif", background: "#020617", minHeight: "100vh", color: "#e2e8f0", padding: "14px 10px", maxWidth: 760, margin: "0 auto" },
  hdr: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, flexWrap: "wrap", gap: 8 },
  title: { fontSize: 20, fontWeight: 800, margin: 0, background: "linear-gradient(135deg,#06b6d4,#8b5cf6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" },
  sub: { fontSize: 10, color: "#475569", margin: "2px 0 0", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: 1 },
  stat: { background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, padding: "6px 12px", display: "flex", flexDirection: "column", alignItems: "center" },
  nav: { display: "flex", gap: 3, marginBottom: 12, flexWrap: "wrap" },
  tab: { flex: 1, minWidth: 60, padding: "6px 4px", border: "1px solid #1e293b", borderRadius: 7, background: "#0f172a", color: "#94a3b8", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 0, fontFamily: "inherit", transition: "all .15s" },
  tabA: { background: "#1e293b", color: "#06b6d4", borderColor: "#06b6d4" },
  card: { background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: 14, marginBottom: 10 },
  cT: { fontSize: 14, fontWeight: 700, margin: "0 0 10px", color: "#e2e8f0" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 },
  lbl: { display: "block", fontSize: 10, color: "#94a3b8", marginBottom: 3, fontWeight: 600 },
  inp: { width: "100%", padding: "8px 9px", background: "#020617", border: "1.5px solid #1e293b", borderRadius: 6, color: "#e2e8f0", fontSize: 12, fontFamily: "inherit", boxSizing: "border-box", transition: "border-color .2s" },
  sBtn: { padding: "4px 10px", borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", transition: "all .15s" },
  mainBtn: { width: "100%", padding: "10px", background: "linear-gradient(135deg,#0891b2,#06b6d4)", border: "none", borderRadius: 8, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" },
  secBtn: { padding: "5px 10px", background: "transparent", border: "1.5px solid #06b6d4", borderRadius: 5, color: "#06b6d4", fontSize: 11, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 },
  th: { textAlign: "right", padding: "7px 8px", borderBottom: "1px solid #1e293b", color: "#475569", fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: .5 },
  td: { padding: "7px 8px", borderBottom: "1px solid #0f172a", color: "#cbd5e1", fontSize: 11 },
  badge: { padding: "2px 7px", borderRadius: 20, fontSize: 9, fontWeight: 600, color: "#fff", whiteSpace: "nowrap" },
  actBtn: { background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 14, padding: "2px 4px" },
  licCard: { background: "#020617", border: "1.5px solid #1e293b", borderRadius: 8, padding: 10, marginBottom: 5, cursor: "pointer", transition: "border-color .2s" },
  dRow: { display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid #0f172a", fontSize: 11 },
  resultBox: { marginTop: 14, padding: 14, borderRadius: 10, background: "#020617", border: "1.5px solid" },
  toast: { position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", background: "#0f172a", border: "1px solid #06b6d4", borderRadius: 8, padding: "7px 18px", color: "#06b6d4", fontSize: 12, fontWeight: 600, zIndex: 999, boxShadow: "0 8px 24px rgba(0,0,0,.5)", fontFamily: "inherit" },
  notice: { display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#020617", borderRadius: 6, border: "1px solid #1e293b", marginBottom: 12, fontSize: 11, color: "#94a3b8" },
  idPreview: { background: "#020617", borderRadius: 8, padding: 10, marginBottom: 12, border: "1px solid #1e293b" },
  idRow: { display: "flex", alignItems: "center", justifyContent: "center", gap: 10, flexWrap: "wrap" },
  idBlock: { display: "flex", flexDirection: "column", alignItems: "center", gap: 2 },
  idLabel: { fontSize: 9, color: "#475569" },
  idVal: { fontFamily: "monospace", fontSize: 13, fontWeight: 600, letterSpacing: .5 },
};
