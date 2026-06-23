const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const APP_VERSION = "1.0.7";
const CONFIG = window.SMART_CARE_CONFIG || {};
const cloudEnabled = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
let supabaseClient = null;
let cameraStream = null;
let pendingImage = null;

const state = {
  tab: "scan",
  authMode: "login",
  calcMode: "medicine",
  scanStage: "upload",
  extracted: null,
  selectedDrug: null,
  user: null,
};

const db = {
  get history() { return JSON.parse(localStorage.getItem("scc_history") || "[]"); },
  set history(value) { localStorage.setItem("scc_history", JSON.stringify(value)); },
  get favorites() { return JSON.parse(localStorage.getItem("scc_favorites") || "[]"); },
  set favorites(value) { localStorage.setItem("scc_favorites", JSON.stringify(value)); },
  get demoUser() { return JSON.parse(localStorage.getItem("scc_user") || "null"); },
  set demoUser(value) { value ? localStorage.setItem("scc_user", JSON.stringify(value)) : localStorage.removeItem("scc_user"); },
};

const drugs = [
  { name:"Penicillin G", generic:"Benzylpenicillin", group:"Penicillin antibiotic", routes:["IV","IM"], max:null, unit:"unit/kg/dose", warning:"ตรวจสอบชนิดเกลือและข้อบ่งใช้ก่อนคำนวณ", nursing:"ซักประวัติแพ้ penicillin เฝ้าระวัง anaphylaxis หลังฉีด และบันทึกวันเวลาหลังผสมยา", source:"Antibiotics.pdf หน้า 1-2" },
  { name:"Cefazolin", generic:"Cefazolin sodium", group:"1st generation cephalosporin", routes:["IV","IM"], max:100, unit:"mg/kg/day", warning:"ปรับตามไตและข้อบ่งใช้", nursing:"ซักประวัติแพ้ยา สังเกตอาการแพ้ ปริมาณปัสสาวะ และการติดเชื้อแทรกซ้อน", source:"Antibiotics.pdf หน้า 3-4" },
  { name:"Vancomycin", generic:"Vancomycin hydrochloride", group:"Glycopeptide antibiotic", routes:["IV","PO"], max:null, unit:"mg/kg/dose", warning:"ต้องใช้ protocol และติดตามระดับยา/ไต", nursing:"ติดตาม CBC, BUN, creatinine, การได้ยิน และเฝ้าระวัง infusion reaction", source:"Antibiotics.pdf หน้า 5-6" },
  { name:"Ceftriaxone", generic:"Ceftriaxone sodium", group:"3rd generation cephalosporin", routes:["IV","IM"], max:100, unit:"mg/kg/day", warning:"ขนาดสูงสุดขึ้นกับข้อบ่งใช้", nursing:"ตรวจประวัติแพ้ cephalosporin/penicillin และตรวจความเข้ากันได้ของสารละลาย", source:"Antibiotics.pdf หน้า 7-8" },
  { name:"Metronidazole", generic:"Metronidazole", group:"Nitroimidazole antimicrobial", routes:["IV","PO"], max:null, unit:"mg/kg/day", warning:"งดแอลกอฮอล์และประเมินระบบประสาท", nursing:"เฝ้าระวังอาการทาง CNS คลื่นไส้ และให้คำแนะนำเรื่องแอลกอฮอล์", source:"Antibiotics.pdf หน้า 9-10" },
  { name:"Piperacillin/Tazobactam", generic:"Piperacillin + Tazobactam", group:"Extended-spectrum penicillin", routes:["IV"], max:null, unit:"mg/kg/dose", warning:"ปรับขนาดตามการทำงานของไต", nursing:"ตรวจประวัติแพ้ beta-lactam ติดตามไต อิเล็กโทรไลต์ และอาการเลือดออก", source:"Antibiotics.pdf หน้า 11-12" },
  { name:"Meropenem", generic:"Meropenem", group:"Carbapenem antibiotic", routes:["IV"], max:null, unit:"mg/kg/dose", warning:"ปรับตามไตและเฝ้าระวังชัก", nursing:"ประเมินอาการแพ้ ติดตามไต ระบบประสาท และการติดเชื้อซ้ำซ้อน", source:"Antibiotics.pdf หน้า 14-15" },
  { name:"Clindamycin", generic:"Clindamycin", group:"Lincosamide antibiotic", routes:["IV","PO"], max:null, unit:"mg/kg/day", warning:"ข้อมูลหน้าที่ 16 ในเอกสารต้นฉบับไม่ตรงชื่อยา ต้องให้เภสัชกรตรวจทาน", nursing:"ใช้ข้อมูลตาม protocol โรงพยาบาลที่ผ่านการอนุมัติเท่านั้น", source:"Antibiotics.pdf หน้า 16-17 (ต้องตรวจทาน)" },
  { name:"Levofloxacin", generic:"Levofloxacin", group:"Fluoroquinolone antibiotic", routes:["IV","PO"], max:null, unit:"mg/kg/day", warning:"ปรับตามไต ระวัง QT prolongation และ tendon injury", nursing:"ห้าม IV push ให้ infusion ตาม protocol และแยกจากยาลดกรด/แร่ธาตุเมื่อรับประทาน", source:"Antibiotics.pdf หน้า 17-19" },
  { name:"Amoxicillin", generic:"Amoxicillin", group:"Aminopenicillin", routes:["PO"], max:90, unit:"mg/kg/day", warning:"ค่าสูงสุดนี้เป็นค่า demo ต้องยืนยันตามข้อบ่งใช้", nursing:"ตรวจประวัติแพ้ penicillin และติดตามผื่น/ท้องเสีย", source:"Demo dataset - ต้องตรวจสอบโดยเภสัชกร" },
];

function esc(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

async function boot() {
  setupServiceWorker();
  state.user = db.demoUser;
  render();

  if (!cloudEnabled || !window.supabase) return;

  try {
    supabaseClient = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    state.user = data.session?.user || db.demoUser;
  } catch (error) {
    console.warn("Supabase init failed, continuing in local mode", error);
    supabaseClient = null;
  }
  render();
}

function setupServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  let refreshed = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshed) return;
    refreshed = true;
    window.location.reload();
  });

  navigator.serviceWorker.register(`./sw.js?v=${APP_VERSION}`).then(registration => {
    registration.update().catch(() => {});
    if (registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          worker.postMessage({ type: "SKIP_WAITING" });
        }
      });
    });
  }).catch(() => {});
}

function render() {
  if (!state.user) return renderAuth();
  renderShell();
}

function renderAuth() {
  const register = state.authMode === "register";
  $("#app").innerHTML = `
    <main class="auth">
      <section class="auth-layout auth-simple">
        <form class="auth-panel" id="authForm">
          <div class="login-brand">
            <div class="pill-logo" aria-hidden="true">
              <svg viewBox="0 0 32 32" role="img">
                <path d="M11 21 21 11a5.2 5.2 0 1 1 7.4 7.4l-10 10A5.2 5.2 0 1 1 11 21Z" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
                <path d="m16 16 7 7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
              </svg>
            </div>
            <div>
              <h1>Smart Care Calculator</h1>
              <p>CLINICAL DOSE CALCULATOR</p>
            </div>
          </div>
          <div class="segmented">
            <button type="button" class="${!register ? "active" : ""}" data-auth="login">เข้าสู่ระบบ</button>
            <button type="button" class="${register ? "active" : ""}" data-auth="register">สมัครสมาชิก</button>
          </div>
          ${register ? `<label>ชื่อที่แสดง<input name="name" required placeholder="เช่น พยาบาลสมหญิง"></label>` : ""}
          <label>อีเมล<input name="email" type="email" required autocomplete="email" placeholder="name@hospital.org"></label>
          <label>รหัสผ่าน<input name="password" type="password" minlength="6" required autocomplete="${register ? "new-password" : "current-password"}"></label>
          ${!register ? `<label class="check"><input name="remember" type="checkbox"> จดจำการเข้าสู่ระบบบนอุปกรณ์นี้</label>` : ""}
          <button class="primary wide">${register ? "สมัครสมาชิก" : "เข้าสู่ระบบ"}</button>
        </form>
      </section>
    </main>`;
  $$("[data-auth]").forEach(button => button.onclick = () => { state.authMode = button.dataset.auth; renderAuth(); });
  $("#authForm").onsubmit = submitAuth;
}

async function submitAuth(event) {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  setBusy(event.submitter, true, "กำลังดำเนินการ...");
  try {
    if (supabaseClient) {
      const request = state.authMode === "register"
        ? supabaseClient.auth.signUp({ email: values.email, password: values.password, options: { data: { display_name: values.name } } })
        : supabaseClient.auth.signInWithPassword({ email: values.email, password: values.password });
      const { data, error } = await request;
      if (error) throw error;
      state.user = data.user;
    } else {
      state.user = { id:"demo-user", email:values.email, user_metadata:{ display_name:values.name || "ผู้ใช้งานเดโม" } };
      db.demoUser = state.user;
    }
    render();
  } catch (error) {
    toast(error.message || "เข้าสู่ระบบไม่สำเร็จ", "error");
    setBusy(event.submitter, false);
  }
}

function renderShell() {
  const tabs = [
    ["scan","⌗","AI สแกน"], ["home","▦","คำนวณ"], ["history","↺","ประวัติ"],
    ["favorites","☆","ยาโปรด"], ["drugs","◇","คลังยา"], ["profile","○","โปรไฟล์"]
  ];
  $("#app").innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="header-inner">
          <button class="brand-button" data-tab="scan"><span class="mini-mark">+</span><span><b>Smart Care</b><small>CLINICAL CALCULATOR</small></span></button>
          <div class="status ${cloudEnabled ? "online" : ""}"><i></i>${cloudEnabled ? "Cloud connected" : "Demo mode"}</div>
          <button class="icon-button" id="signOut" title="ออกจากระบบ">↪</button>
        </div>
        <nav class="tabs">${tabs.map(([id,icon,label]) => `<button data-tab="${id}" class="${state.tab === id ? "active" : ""}"><span>${icon}</span>${label}</button>`).join("")}</nav>
      </header>
      <main class="content">
        <div class="clinical-warning"><b>ข้อมูลสนับสนุนการตัดสินใจเท่านั้น</b><span>ต้องตรวจสอบคำสั่งแพทย์ หน่วย ความเข้มข้น ข้อบ่งใช้ และ protocol ของหน่วยงานก่อนบริหารยาทุกครั้ง</span></div>
        <div id="view"></div>
      </main>
    </div>`;
  $$("[data-tab]").forEach(button => button.onclick = () => { stopCamera(); state.tab = button.dataset.tab; renderShell(); });
  $("#signOut").onclick = signOut;
  renderView();
}

function renderView() {
  const views = { home:viewHome, scan:viewScan, history:viewHistory, favorites:() => viewDrugs(true), drugs:() => viewDrugs(false), profile:viewProfile };
  $("#view").innerHTML = views[state.tab]();
  bindView();
}

function viewHome() {
  return `
    <section class="mode-switch" aria-label="ประเภทการคำนวณ">
      <button class="${state.calcMode === "medicine" ? "active" : ""}" data-mode="medicine"><b>ยา</b><span>คำนวณปริมาตรและขนาดยา</span></button>
      <button class="${state.calcMode === "fluid" ? "active" : ""}" data-mode="fluid"><b>สารน้ำ</b><span>คำนวณ mL/hr และหยดต่อนาที</span></button>
    </section>
    ${state.calcMode === "medicine" ? medicineCalculator() : fluidCalculator()}`;
}

function patientFields() {
  return `
    <div class="section-heading"><span>01</span><div><h2>ข้อมูลผู้ป่วย</h2><p>ใช้สำหรับบันทึกและตรวจสอบย้อนหลัง</p></div></div>
    <div class="form-grid">
      <label>ชื่อผู้ป่วย<input id="patientName" placeholder="ชื่อ-นามสกุล หรือ HN"></label>
      <label>หมายเลขเตียง<input id="bed" placeholder="เช่น 12A"></label>
      <label>น้ำหนัก <span class="unit">kg</span><input id="weight" type="number" inputmode="decimal" min="0" step="0.01"></label>
      <label>อายุ<input id="age" placeholder="เช่น 5 ปี 3 เดือน"></label>
    </div>`;
}

function medicineCalculator() {
  return `
    <div class="workspace">
      <section class="surface">
        ${patientFields()}
        <hr>
        <div class="section-heading"><span>02</span><div><h2>คำสั่งยา</h2><p>ระบุจำนวนยาที่ต้องการต่อครั้งหรือ dose ที่แพทย์สั่ง</p></div></div>
        <div class="form-grid">
          <label class="span-2">ชื่อยา<input id="drug" list="drugList" placeholder="ค้นหาชื่อสามัญหรือชื่อยา"><datalist id="drugList">${drugs.map(d => `<option value="${d.name}">${d.generic}</option>`).join("")}</datalist></label>
          <label>จำนวนยาที่ต้องการ<input id="orderedDose" type="number" min="0" step="any" inputmode="decimal"></label>
          <label>หน่วย<select id="orderedUnit"><option>mg</option><option>mcg</option><option>g</option><option>unit</option></select></label>
          <label>จำนวนครั้งต่อวัน<select id="frequency"><option value="1">OD - วันละ 1 ครั้ง</option><option value="2">BID - วันละ 2 ครั้ง</option><option value="3">TID - วันละ 3 ครั้ง</option><option value="4">QID - วันละ 4 ครั้ง</option><option value="6">ทุก 4 ชั่วโมง</option></select></label>
          <label>Route<select id="route"><option>PO</option><option>IV</option><option>IM</option><option>SC</option></select></label>
        </div>
        <hr>
        <div class="section-heading"><span>03</span><div><h2>ยาที่มี / สารละลาย</h2><p>ใส่ค่าบนฉลาก เช่น 125 mg ต่อ 5 mL</p></div></div>
        <div class="ratio-input">
          <label>ตัวยาที่มี<input id="stockDrug" type="number" min="0" step="any" inputmode="decimal" placeholder="125"></label>
          <label>หน่วย<select id="stockUnit"><option>mg</option><option>mcg</option><option>g</option><option>unit</option></select></label>
          <div class="ratio-symbol">ต่อ</div>
          <label>ปริมาตร<input id="stockVolume" type="number" min="0" step="any" inputmode="decimal" placeholder="5"></label>
          <label>หน่วย<select id="volumeUnit"><option>mL</option><option>L</option></select></label>
        </div>
        <details class="advanced"><summary>การให้ IV และ drop factor</summary>
          <div class="form-grid">
            <label>เวลาหยด (นาที)<input id="minutes" type="number" min="0" step="any"></label>
            <label>Drop factor<select id="dropFactor"><option value="10">10 gtt/mL</option><option value="15">15 gtt/mL</option><option value="20">20 gtt/mL</option><option value="60">60 gtt/mL (microdrip)</option></select></label>
          </div>
        </details>
        <button class="primary wide" id="calculateMedicine">คำนวณและตรวจสอบ</button>
      </section>
      <aside class="result-panel" id="resultPanel">
        <div class="result-empty"><span>∑</span><h2>พร้อมคำนวณ</h2><p>ผลลัพธ์จะแสดงสูตร หน่วย และจุดที่ต้องตรวจทานอย่างชัดเจน</p></div>
      </aside>
    </div>`;
}

function fluidCalculator() {
  return `
    <div class="workspace">
      <section class="surface">
        ${patientFields()}
        <hr>
        <div class="section-heading"><span>02</span><div><h2>คำสั่งสารน้ำ</h2><p>คำนวณจากปริมาตรรวมและเวลาที่ต้องให้</p></div></div>
        <div class="form-grid">
          <label>ชนิดสารน้ำ<input id="fluidName" placeholder="เช่น 0.9% NSS"></label>
          <label>ปริมาตรรวม <span class="unit">mL</span><input id="fluidVolume" type="number" min="0" step="any"></label>
          <label>เวลาให้ <span class="unit">ชั่วโมง</span><input id="fluidHours" type="number" min="0" step="any"></label>
          <label>Drop factor<select id="fluidDrop"><option value="10">10 gtt/mL</option><option value="15">15 gtt/mL</option><option value="20">20 gtt/mL</option><option value="60">60 gtt/mL</option></select></label>
        </div>
        <button class="primary wide" id="calculateFluid">คำนวณอัตราสารน้ำ</button>
      </section>
      <aside class="result-panel" id="resultPanel"><div class="result-empty"><span>≈</span><h2>อัตราสารน้ำ</h2><p>กรอกปริมาตรและเวลาเพื่อคำนวณ mL/hr และ gtt/min</p></div></aside>
    </div>`;
}

function viewScan() {
  const steps = [["upload","1","นำเข้า"],["review","2","ตรวจ OCR"],["confirm","3","ยืนยันข้อมูล"]];
  return `
    <div class="scan-steps">${steps.map(([id,n,label]) => `<div class="${state.scanStage === id ? "active" : ""} ${state.extracted && id !== "upload" ? "done" : ""}"><span>${n}</span>${label}</div>`).join("")}</div>
    <div class="workspace scan-layout">
      <section class="surface">
        <div class="section-heading"><span>⌗</span><div><h2>OCR</h2></div></div>
        <video id="camera" class="media hidden" autoplay playsinline muted></video>
        <canvas id="captureCanvas" class="media hidden"></canvas>
        <div class="upload-zone" id="dropZone"><span>⇧</span><b>ลากไฟล์มาวาง หรือเลือกไฟล์</b><small>JPG, PNG, PDF, CSV, XLSX</small><button class="secondary" id="chooseFile">เลือกไฟล์</button></div>
        <div class="button-row"><button class="secondary" id="openCamera">เปิดกล้อง</button><button class="secondary hidden" id="capturePhoto">ถ่ายภาพ</button><button class="ghost hidden" id="closeCamera">ปิดกล้อง</button></div>
        <div id="previewArea"></div>
        <button class="primary wide" id="runOcr" ${pendingImage ? "" : "disabled"}>อ่านเอกสารด้วย OCR</button>
      </section>
      <aside class="surface">
        <div class="section-heading"><span>✓</span><div><h2>ตรวจทานก่อนคำนวณ</h2><p>แก้ไขข้อความ OCR หรือค่าที่ AI แยกได้ก่อนยืนยัน</p></div></div>
        <label>ข้อความจาก OCR<textarea id="ocrText" rows="8" placeholder="ผล OCR จะแสดงที่นี่">${esc(state.extracted?.raw_text || "")}</textarea></label>
        <div class="form-grid review-fields">
          <label>ชื่อผู้ป่วย<input id="reviewPatient" value="${esc(state.extracted?.patient_name || "")}"></label>
          <label>เตียง<input id="reviewBed" value="${esc(state.extracted?.bed || "")}"></label>
          <label>น้ำหนัก (kg)<input id="reviewWeight" type="number" value="${esc(state.extracted?.weight_kg || "")}"></label>
          <label>อายุ<input id="reviewAge" value="${esc(state.extracted?.age || "")}"></label>
          <label>ชื่อยา<input id="reviewDrug" value="${esc(state.extracted?.drug_name || "")}"></label>
          <label>ขนาดยา<input id="reviewDose" type="number" value="${esc(state.extracted?.dose || "")}"></label>
          <label>หน่วย<input id="reviewUnit" value="${esc(state.extracted?.dose_unit || "mg")}"></label>
          <label>ความถี่<input id="reviewFrequency" value="${esc(state.extracted?.frequency || "")}"></label>
          <label>ตัวยาที่มี<input id="reviewStock" type="number" value="${esc(state.extracted?.stock_drug || "")}"></label>
          <label>ปริมาตร (mL)<input id="reviewVolume" type="number" value="${esc(state.extracted?.stock_volume_ml || "")}"></label>
        </div>
        <div class="confidence"><span>AI confidence</span><b>${Math.round((state.extracted?.confidence || 0) * 100)}%</b></div>
        <button class="primary wide" id="confirmScan" ${state.extracted ? "" : "disabled"}>ยืนยันและส่งไปคำนวณ</button>
      </aside>
    </div>`;
}

function viewHistory() {
  const rows = db.history;
  return `
    <section class="surface">
      <div class="toolbar"><div><p class="eyebrow">AUDIT TRAIL</p><h2>ประวัติการคำนวณ</h2></div><button class="danger-text" id="clearHistory">ล้างทั้งหมด</button></div>
      <div class="filter-grid">
        <label>ค้นหาผู้ป่วย/ยา<input id="historySearch" placeholder="ชื่อผู้ป่วย เตียง หรือชื่อยา"></label>
        <label>ตั้งแต่วันที่<input id="dateFrom" type="date"></label>
        <label>ถึงวันที่<input id="dateTo" type="date"></label>
      </div>
      <div id="historyList">${historyRows(rows)}</div>
    </section>`;
}

function historyRows(rows) {
  if (!rows.length) return `<div class="empty-state"><span>↺</span><h3>ยังไม่มีประวัติ</h3><p>รายการที่คำนวณและยืนยันแล้วจะแสดงที่นี่</p></div>`;
  return `<div class="history-table">${rows.map(row => `<article data-search="${esc([row.patient,row.bed,row.drug].join(" ").toLowerCase())}" data-date="${row.iso}">
    <div><b>${esc(row.patient || "ไม่ระบุผู้ป่วย")}</b><span>เตียง ${esc(row.bed || "-")} · ${new Date(row.iso).toLocaleString("th-TH")}</span></div>
    <div><b>${esc(row.drug)}</b><span>${esc(row.input || "")}</span></div>
    <strong>${esc(row.result)}</strong>
  </article>`).join("")}</div>`;
}

function viewDrugs(favoritesOnly) {
  const list = favoritesOnly ? drugs.filter(d => db.favorites.includes(d.name)) : drugs;
  return `
    <div class="drug-layout">
      <section class="surface drug-browser">
        <div class="toolbar"><div><p class="eyebrow">VERIFIED REFERENCE REQUIRED</p><h2>${favoritesOnly ? "ยาโปรด" : "คลังข้อมูลยา"}</h2></div><span class="count">${list.length} รายการ</span></div>
        <input class="search" id="drugSearch" placeholder="ค้นหาชื่อยา กลุ่มยา หรือชื่อสามัญ">
        <div id="drugList">${drugRows(list)}</div>
      </section>
      <aside class="surface drug-detail" id="drugDetail">${state.selectedDrug ? drugDetail(state.selectedDrug) : `<div class="empty-state"><span>◇</span><h3>เลือกยาเพื่อดูรายละเอียด</h3><p>ข้อมูลจากเอกสารต้องได้รับการตรวจสอบกับเอกสารอ้างอิงและ protocol ล่าสุดของหน่วยงาน</p></div>`}</aside>
    </div>`;
}

function drugRows(list) {
  return list.map(drug => `<button class="drug-row" data-drug="${drug.name}">
    <span><b>${drug.name}</b><small>${drug.generic} · ${drug.group}</small><i>${drug.routes.join(" / ")}</i></span>
    <span class="dose-limit">${drug.max ?? "Protocol"}<small>${drug.max ? drug.unit : ""}</small></span><em>›</em>
  </button>`).join("") || `<div class="empty-state"><span>☆</span><h3>ยังไม่มียาโปรด</h3></div>`;
}

function drugDetail(drug) {
  const favorite = db.favorites.includes(drug.name);
  return `<div class="detail-head"><div><p class="eyebrow">${esc(drug.group)}</p><h2>${esc(drug.name)}</h2><p>${esc(drug.generic)}</p></div><button class="favorite-button" data-favorite="${drug.name}">${favorite ? "★" : "☆"}</button></div>
    <div class="detail-section"><b>Route</b><div class="chips">${drug.routes.map(r => `<span>${r}</span>`).join("")}</div></div>
    <div class="alert-card"><b>ข้อควรระวัง</b><p>${esc(drug.warning)}</p></div>
    <div class="detail-section"><b>แนวทางการพยาบาลจากเอกสาร</b><p>${esc(drug.nursing)}</p></div>
    <div class="source-note"><b>แหล่งข้อมูล:</b> ${esc(drug.source)}<br>ยังไม่ถือเป็นฐานข้อมูลยาที่ผ่านการรับรองสำหรับการสั่งหรือบริหารยา</div>
    <button class="primary wide" data-use-drug="${drug.name}">ใช้ยานี้ในเครื่องคำนวณ</button>`;
}

function viewProfile() {
  const name = state.user.user_metadata?.display_name || "ผู้ใช้งาน";
  return `
    <div class="profile-grid">
      <section class="surface profile-card"><div class="avatar">${esc(name.slice(0,1))}</div><h2>${esc(name)}</h2><p>${esc(state.user.email || "")}</p><span class="status ${cloudEnabled ? "online" : ""}"><i></i>${cloudEnabled ? "Supabase account" : "Demo account"}</span></section>
      <section class="surface"><div class="section-heading"><span>⚙</span><div><h2>การเชื่อมต่อระบบ</h2><p>สถานะ backend และ AI services</p></div></div>
        <div class="connection-list">
          <div><span><b>Supabase</b><small>Auth, Database, Storage</small></span><strong class="${cloudEnabled ? "ok" : "warn"}">${cloudEnabled ? "พร้อมใช้" : "ยังไม่ตั้งค่า"}</strong></div>
          <div><span><b>OCR</b><small>ผ่าน Edge Function /ocr</small></span><strong class="${cloudEnabled ? "ok" : "warn"}">${cloudEnabled ? "พร้อมทดสอบ" : "Demo parser"}</strong></div>
          <div><span><b>LLM</b><small>แยกข้อมูลเป็น structured JSON</small></span><strong class="${cloudEnabled ? "ok" : "warn"}">${cloudEnabled ? "พร้อมทดสอบ" : "Demo parser"}</strong></div>
          <div><span><b>App version</b><small>ใช้ตรวจสอบหลังอัปเดต</small></span><strong>v${APP_VERSION}</strong></div>
        </div>
      </section>
      <section class="surface"><div class="section-heading"><span>▤</span><div><h2>ข้อมูลในอุปกรณ์</h2><p>${db.history.length} รายการประวัติ · ${db.favorites.length} ยาโปรด</p></div></div><button class="danger wide" id="clearLocal">ล้างข้อมูลในอุปกรณ์</button></section>
    </div>`;
}

function bindView() {
  $$("[data-mode]").forEach(button => button.onclick = () => { state.calcMode = button.dataset.mode; renderView(); });
  $("#calculateMedicine")?.addEventListener("click", calculateMedicine);
  $("#calculateFluid")?.addEventListener("click", calculateFluid);
  $("#chooseFile")?.addEventListener("click", () => $("#hiddenFile").click());
  $("#hiddenFile").onchange = event => handleFile(event.target.files[0]);
  $("#openCamera")?.addEventListener("click", openCamera);
  $("#capturePhoto")?.addEventListener("click", capturePhoto);
  $("#closeCamera")?.addEventListener("click", stopCamera);
  $("#runOcr")?.addEventListener("click", runOcr);
  $("#confirmScan")?.addEventListener("click", confirmScan);
  const zone = $("#dropZone");
  if (zone) {
    zone.ondragover = event => { event.preventDefault(); zone.classList.add("dragging"); };
    zone.ondragleave = () => zone.classList.remove("dragging");
    zone.ondrop = event => { event.preventDefault(); zone.classList.remove("dragging"); handleFile(event.dataTransfer.files[0]); };
  }
  $("#historySearch")?.addEventListener("input", filterHistory);
  $("#dateFrom")?.addEventListener("change", filterHistory);
  $("#dateTo")?.addEventListener("change", filterHistory);
  $("#clearHistory")?.addEventListener("click", () => { if (confirm("ล้างประวัติทั้งหมดในอุปกรณ์นี้?")) { db.history = []; renderView(); } });
  $("#drugSearch")?.addEventListener("input", event => {
    const query = event.target.value.toLowerCase();
    $("#drugList").innerHTML = drugRows(drugs.filter(d => [d.name,d.generic,d.group].join(" ").toLowerCase().includes(query)));
    bindDrugActions();
  });
  bindDrugActions();
  $("#clearLocal")?.addEventListener("click", () => { if (confirm("ล้างประวัติและยาโปรดในอุปกรณ์นี้?")) { db.history=[]; db.favorites=[]; renderView(); } });
}

function bindDrugActions() {
  $$("[data-drug]").forEach(button => button.onclick = () => { state.selectedDrug = drugs.find(d => d.name === button.dataset.drug); $("#drugDetail").innerHTML = drugDetail(state.selectedDrug); bindDrugActions(); });
  $$("[data-favorite]").forEach(button => button.onclick = () => {
    const set = new Set(db.favorites); set.has(button.dataset.favorite) ? set.delete(button.dataset.favorite) : set.add(button.dataset.favorite);
    db.favorites = [...set]; renderView();
  });
  $$("[data-use-drug]").forEach(button => button.onclick = () => { state.tab = "home"; state.calcMode = "medicine"; renderShell(); $("#drug").value = button.dataset.useDrug; });
}

function convert(value, from, to) {
  const scale = { mcg:0.001, mg:1, g:1000, unit:null };
  if (from === to) return value;
  if (scale[from] == null || scale[to] == null) throw new Error("หน่วย unit ไม่สามารถแปลงกับหน่วยมวลได้");
  return value * scale[from] / scale[to];
}

function calculateMedicine() {
  try {
    const ordered = +$("#orderedDose").value, stock = +$("#stockDrug").value, volume = +$("#stockVolume").value;
    if (!(ordered > 0 && stock > 0 && volume > 0)) throw new Error("กรอกจำนวนยาที่สั่ง ตัวยาที่มี และปริมาตรให้ครบ");
    const orderedInStockUnit = convert(ordered, $("#orderedUnit").value, $("#stockUnit").value);
    const answer = (orderedInStockUnit * volume) / stock;
    const weight = +$("#weight").value || 0, frequency = +$("#frequency").value || 1;
    const orderedMg = ["mcg","mg","g"].includes($("#orderedUnit").value) ? convert(ordered, $("#orderedUnit").value, "mg") : null;
    const dailyMgKg = weight && orderedMg != null ? orderedMg * frequency / weight : null;
    const minutes = +$("#minutes").value || 0, factor = +$("#dropFactor").value || 20;
    const drops = minutes ? answer * factor / minutes : null;
    const drug = drugs.find(d => d.name.toLowerCase() === $("#drug").value.trim().toLowerCase());
    const overLimit = drug?.max && dailyMgKg != null && dailyMgKg > drug.max;
    $("#resultPanel").innerHTML = `
      <p class="eyebrow">CALCULATION RESULT</p><h2>${esc($("#drug").value || "ยาที่คำนวณ")}</h2>
      <div class="answer"><span>ปริมาตรต่อครั้ง</span><b>${format(answer)} mL</b></div>
      <div class="formula"><b>สูตร</b><code>(${orderedInStockUnit} ${$("#stockUnit").value} × ${volume} mL) ÷ ${stock} ${$("#stockUnit").value}</code></div>
      ${dailyMgKg != null ? `<div class="metric"><span>ขนาดรวมต่อวัน</span><b>${format(dailyMgKg)} mg/kg/day</b></div>` : ""}
      ${drops != null ? `<div class="metric"><span>อัตราหยดโดยประมาณ</span><b>${format(drops)} gtt/min</b></div>` : ""}
      <div class="review-box ${overLimit ? "critical" : ""}"><b>${overLimit ? "เกิน reference limit ที่ตั้งไว้" : "รายการตรวจทานก่อนให้ยา"}</b>
        <ul><li>ยืนยันผู้ป่วยและคำสั่งแพทย์</li><li>ยืนยันหน่วยและความเข้มข้นบนฉลาก</li><li>ตรวจ route, allergy, renal/hepatic function และ protocol</li></ul>
      </div>
      <button class="primary wide" id="saveCalculation">ยืนยันและบันทึกประวัติ</button>`;
    $("#saveCalculation").onclick = () => saveCalculation({
      patient:$("#patientName").value, bed:$("#bed").value, drug:$("#drug").value || "ไม่ระบุยา",
      input:`${ordered} ${$("#orderedUnit").value} จาก ${stock} ${$("#stockUnit").value}/${volume} mL`, result:`${format(answer)} mL`
    });
  } catch (error) { toast(error.message, "error"); }
}

function calculateFluid() {
  const volume = +$("#fluidVolume").value, hours = +$("#fluidHours").value, factor = +$("#fluidDrop").value;
  if (!(volume > 0 && hours > 0)) return toast("กรอกปริมาตรและเวลาให้ครบ", "error");
  const mlHr = volume / hours, drops = volume * factor / (hours * 60);
  $("#resultPanel").innerHTML = `<p class="eyebrow">FLUID RATE</p><h2>${esc($("#fluidName").value || "สารน้ำ")}</h2>
    <div class="answer"><span>อัตราการไหล</span><b>${format(mlHr)} mL/hr</b></div>
    <div class="metric"><span>อัตราหยด</span><b>${format(drops)} gtt/min</b></div>
    <div class="formula"><b>สูตร</b><code>${volume} mL ÷ ${hours} hr</code></div>
    <div class="review-box"><b>ตรวจทาน</b><ul><li>ชนิดสารน้ำและปริมาตรตามคำสั่ง</li><li>ข้อจำกัดสารน้ำและภาวะหัวใจ/ไต</li><li>ตั้ง infusion pump และตรวจเส้น IV</li></ul></div>
    <button class="primary wide" id="saveCalculation">ยืนยันและบันทึกประวัติ</button>`;
  $("#saveCalculation").onclick = () => saveCalculation({ patient:$("#patientName").value, bed:$("#bed").value, drug:$("#fluidName").value || "สารน้ำ", input:`${volume} mL ใน ${hours} ชั่วโมง`, result:`${format(mlHr)} mL/hr` });
}

async function saveCalculation(item) {
  const record = { ...item, iso:new Date().toISOString() };
  db.history = [record, ...db.history].slice(0, 200);
  if (supabaseClient) {
    const { error } = await supabaseClient.from("calculations").insert({ user_id:state.user.id, patient_name:item.patient, bed:item.bed, medication_name:item.drug, input_summary:item.input, result_summary:item.result });
    if (error) toast("บันทึกในเครื่องแล้ว แต่ Supabase ไม่สำเร็จ", "error");
  }
  toast("บันทึกประวัติแล้ว");
}

function handleFile(file) {
  if (!file) return;
  pendingImage = file;
  state.scanStage = "upload";
  const preview = $("#previewArea");
  if (file.type.startsWith("image/")) {
    const url = URL.createObjectURL(file);
    preview.innerHTML = `<img class="media" src="${url}" alt="ภาพใบสั่งยา"><div class="file-meta"><b>${esc(file.name)}</b><span>${Math.ceil(file.size/1024)} KB</span></div>`;
  } else {
    preview.innerHTML = `<div class="file-card"><span>▤</span><div><b>${esc(file.name)}</b><small>${Math.ceil(file.size/1024)} KB</small></div></div>`;
  }
  $("#runOcr").disabled = false;
}

async function openCamera() {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:"environment" }, audio:false });
    $("#camera").srcObject = cameraStream;
    $("#camera").classList.remove("hidden"); $("#capturePhoto").classList.remove("hidden"); $("#closeCamera").classList.remove("hidden");
  } catch { toast("เปิดกล้องไม่ได้ กรุณาอนุญาตกล้องและใช้งานผ่าน HTTPS หรือ localhost", "error"); }
}

function capturePhoto() {
  const video = $("#camera"), canvas = $("#captureCanvas");
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  canvas.toBlob(blob => {
    pendingImage = new File([blob], `prescription-${Date.now()}.jpg`, { type:"image/jpeg" });
    handleFile(pendingImage); stopCamera();
  }, "image/jpeg", .88);
}

function stopCamera() {
  cameraStream?.getTracks().forEach(track => track.stop()); cameraStream = null;
}

async function runOcr(event) {
  if (!pendingImage) return;
  setBusy(event.currentTarget, true, "กำลังอ่านและแยกข้อมูล...");
  try {
    let result;
    if (supabaseClient) {
      const base64 = await fileToBase64(pendingImage);
      const { data, error } = await supabaseClient.functions.invoke("process-prescription", { body:{ file_name:pendingImage.name, mime_type:pendingImage.type, file_base64:base64 } });
      if (error) throw error;
      result = data;
    } else {
      result = demoExtract($("#ocrText").value || pendingImage.name);
      await new Promise(resolve => setTimeout(resolve, 700));
    }
    state.extracted = result; state.scanStage = "review"; renderView();
    toast("อ่านเอกสารแล้ว กรุณาตรวจทานทุกช่อง");
  } catch (error) {
    toast(error.message || "OCR ไม่สำเร็จ", "error"); setBusy(event.currentTarget, false);
  }
}

function demoExtract(text) {
  const drug = drugs.find(d => text.toLowerCase().includes(d.name.toLowerCase()));
  const weight = text.match(/(\d+(?:\.\d+)?)\s*kg/i);
  const dose = text.match(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|unit)/i);
  const stock = text.match(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|unit)\s*\/\s*(\d+(?:\.\d+)?)\s*mL/i);
  return { raw_text:text, patient_name:"", bed:"", weight_kg:weight?.[1] || "", age:"", drug_name:drug?.name || "", dose:dose?.[1] || "", dose_unit:dose?.[2] || "mg", frequency:"", stock_drug:stock?.[1] || "", stock_volume_ml:stock?.[3] || "", confidence:.35 };
}

function confirmScan() {
  state.extracted = {
    raw_text:$("#ocrText").value, patient_name:$("#reviewPatient").value, bed:$("#reviewBed").value,
    weight_kg:$("#reviewWeight").value, age:$("#reviewAge").value, drug_name:$("#reviewDrug").value,
    dose:$("#reviewDose").value, dose_unit:$("#reviewUnit").value, frequency:$("#reviewFrequency").value,
    stock_drug:$("#reviewStock").value, stock_volume_ml:$("#reviewVolume").value, confidence:state.extracted.confidence
  };
  state.scanStage = "confirm"; state.tab = "home"; state.calcMode = "medicine"; renderShell();
  $("#patientName").value = state.extracted.patient_name; $("#bed").value = state.extracted.bed; $("#weight").value = state.extracted.weight_kg;
  $("#age").value = state.extracted.age; $("#drug").value = state.extracted.drug_name; $("#orderedDose").value = state.extracted.dose;
  $("#orderedUnit").value = ["mg","mcg","g","unit"].includes(state.extracted.dose_unit) ? state.extracted.dose_unit : "mg";
  $("#stockDrug").value = state.extracted.stock_drug; $("#stockVolume").value = state.extracted.stock_volume_ml;
  toast("ส่งข้อมูลที่ตรวจทานแล้วไปหน้าเครื่องคำนวณ");
}

function filterHistory() {
  const query = $("#historySearch").value.toLowerCase(), from = $("#dateFrom").value, to = $("#dateTo").value;
  $$(".history-table article").forEach(row => {
    const date = row.dataset.date.slice(0,10);
    row.hidden = !row.dataset.search.includes(query) || (from && date < from) || (to && date > to);
  });
}

async function signOut() {
  stopCamera();
  if (supabaseClient) await supabaseClient.auth.signOut();
  db.demoUser = null; state.user = null; state.tab = "home"; render();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject; reader.readAsDataURL(file);
  });
}

function setBusy(button, busy, label) {
  if (!button) return;
  if (!button.dataset.label) button.dataset.label = button.textContent;
  button.disabled = busy; button.textContent = busy ? label : button.dataset.label;
}

function format(number) {
  return Number(number).toLocaleString("th-TH", { maximumFractionDigits:2 });
}

function toast(message, type = "success") {
  const node = document.createElement("div");
  node.className = `toast ${type}`; node.textContent = message; document.body.appendChild(node);
  setTimeout(() => node.remove(), 3200);
}

boot();
