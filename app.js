"use strict";
/* Cliente mínimo del contrato /v1 (ADR 0007). Sin dependencias ni compilación.
   El token vive solo en memoria y solo se envía a un origen loopback (esta fase es solo local).
   Modo demostración: API simulada en la página, sin red. */
const $ = (id) => document.getElementById(id);
let creating = false;
const state = { real: false, planHash: null, preparedSha: null, creatingToken: 0, api: null, drawingId: null, jobId: null, demo: false, gen: 0, poll: 0 };
const REVIEW_TEXT = {
  multiple_figures: "Hay más de una figura.", figure_touches_edge: "La figura toca el borde.",
  low_resolution: "La resolución es baja.", black_border_in_crop: "Quedó un borde negro.",
  noisy_background: "El fondo tiene mucho ruido.", ink_outside_crop: "Hay trazo fuera del recorte.",
  no_color_figure_generic_crop: "No se detectó la figura; el recorte es genérico.",
};
const ERROR_TEXT = {
  UNAUTHORIZED: "El token no es válido.", INVALID_UPLOAD: "La imagen no es válida (PNG o JPEG, hasta 8 MiB y 4000 px).",
  SERVER_BUSY: "El servidor está ocupado. Intenta en unos minutos.", STATE_CONFLICT: "Ese paso no se puede hacer ahora.",
  JOB_NOT_FOUND: "No se encontró el trabajo.", REAL_MODE_DISABLED: "El modo real está apagado en el servidor.",
  API_UNREACHABLE: "No se pudo conectar con el servidor. Revisa que siga encendido (la ventana de PowerShell con uvicorn) y que la dirección sea la correcta. Una corrida real en marcha no se pierde: cuando vuelva el servidor, pulsa Actualizar estado.",
  BUDGET_AUTH_CONFIRMATION_REQUIRED: "El servidor no aceptó la confirmación (el plan o la imagen cambió). Actualiza el estado e inténtalo de nuevo.", BAD_ADDRESS: "Solo se permite una dirección local: http://127.0.0.1:PUERTO o http://localhost:PUERTO.",
};
const urls = {};
function setUrl(el, id, value) {
  const old = urls[id]; urls[id] = value.startsWith("blob:") ? value : null;
  el[id === "model-link" || id === "stl-link" ? "href" : "src"] = value;
  if (old && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(old);
}
/* Oculta un enlace de descarga, revoca su blob y lo vacía: nunca debe quedar utilizable el archivo de otro dibujo/trabajo. */
function clearDownload(id, noteId) {
  const el = $(id); el.hidden = true; el.href = "#";
  try { if (urls[id] && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(urls[id]); } catch (_) {}
  urls[id] = null;
  if (noteId) $(noteId).textContent = "";
}
const show = (id, on = true) => { $(id).hidden = !on; };
/* Los códigos BUDGET_* son un vocabulario fijo del servidor; se muestran tal cual para saber qué rechazó el control de gasto. */
const fail = (e) => {
  const c = e && e.code;
  $("error").textContent = ERROR_TEXT[c] || (typeof c === "string" && /^BUDGET_[A-Z_]+$/.test(c) ? "El control de gasto rechazó la operación: " + c : "No se pudo completar. Revisa la conexión.");
};
const ok = () => { $("error").textContent = ""; };

/* Solo orígenes loopback explícitos; sin credenciales, ruta, query ni fragmento. Devuelve el origen o null. */
function loopbackOrigin(text) {
  let u;
  try { u = new URL(String(text)); } catch (_) { return null; }
  if (u.protocol !== "http:") return null;
  if (!["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) return null;
  if (u.username || u.password || u.search || u.hash || u.pathname !== "/") return null;
  if (/[?#@]/.test(String(text).replace(/^http:\/\//, ""))) return null;
  return u.origin;
}

function realApi(origin, token, realToken) {
  const url = (p) => origin + "/v1" + p;
  /* El token real solo viaja a los endpoints /real/ de este mismo origen loopback; nunca a /drawings ni a /jobs. */
  const authFor = (path) => (realToken && path.startsWith("/real/") ? { Authorization: "Bearer " + token, "X-MM3D-Real-Token": realToken } : { Authorization: "Bearer " + token });
  async function call(method, path, body, raw) {
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    const auth = authFor(path);
    let r;
    try {
      r = await fetch(url(path), { method, headers: body && !isForm ? { ...auth, "Content-Type": "application/json" } : auth,
        body: isForm ? body : body ? JSON.stringify(body) : undefined });
    } catch (_) { throw { code: "API_UNREACHABLE" }; } /* fallo de red: el servidor no responde, distinto de un rechazo con código */
    if (!r.ok) { let code = "ERROR"; try { code = (await r.json()).code || code; } catch (_) {} throw { code }; }
    return raw ? r.blob() : r.json();
  }
  return {
    upload: (file) => { const f = new FormData(); f.append("file", file); return call("POST", "/drawings", f); },
    blob: (path) => call("GET", path, null, true),
    createJob: (drawing_id, profile, prepared_sha256) => call("POST", "/jobs", { drawing_id, profile, prepared_sha256 }),
    job: (id) => call("GET", "/jobs/" + id), start: (id) => call("POST", "/jobs/" + id + "/start"),
    approve: (id, step, sha256) => call("POST", "/jobs/" + id + "/approve-" + step, { sha256 }),
    remove: async (jid, did) => { if (jid) await call("DELETE", "/jobs/" + jid); await call("DELETE", "/drawings/" + did); },
    /* Modo real (ADR 0008): mismas operaciones sobre /v1/real/runs. El servidor valida el hash, el máximo y `EJECUTAR` que la web envía tras la ventana de confirmación. */
    real: !!realToken,
    realPlan: (drawing_id, profile, prepared_sha256) => call("POST", "/real/runs", { drawing_id, profile, prepared_sha256 }),
    realJob: (id) => call("GET", "/real/runs/" + id),
    realAuthorize: (id, plan_sha256, typed_plan_sha256, max_usd) => call("POST", "/real/runs/" + id + "/authorize", { plan_sha256, typed_plan_sha256, max_usd }),
    realExecute: (id, plan_sha256, confirmation, expected_state, expected_launches) => call("POST", "/real/runs/" + id + "/execute", { plan_sha256, confirmation, expected_state, expected_launches }),
    realGenerateStl: (id, plan_sha256) => call("POST", "/real/runs/" + id + "/generate-stl", { plan_sha256 }),
    realApprove: (id, plan_sha256, sha256) => call("POST", "/real/runs/" + id + "/approve-2d", { plan_sha256, sha256 }),
  };
}

/* Adapta la API real a la interfaz que usa la pantalla (upload/blob/createJob/job/approve/remove). */
function operatorApi(base) {
  return {
    ...base,
    blob: (path) => base.blob(path.replace(/^\/jobs\//, "/real/runs/")),
    createJob: (did, profile, sha) => base.realPlan(did, profile, sha),
    job: (id) => base.realJob(id),
    approve: async (id, step, sha) => { if (step !== "2d") throw { code: "STATE_CONFLICT" }; return base.realApprove(id, state.planHash, sha); },
    start: async () => { throw { code: "STATE_CONFLICT" }; },
    authorize: (id, typed, max) => base.realAuthorize(id, state.planHash, typed, max),
    execute: (id, confirmation, expectedState, expectedLaunches) => base.realExecute(id, state.planHash, confirmation, expectedState, expectedLaunches),
    generateStl: (id) => base.realGenerateStl(id, state.planHash), /* local y sin costo: no pide teclear nada */
  };
}

function demoApi() {
  const svg = (body) => "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#fff"/>' + body + "</svg>");
  const draw = svg('<circle cx="128" cy="110" r="50" fill="#e8b04a"/><rect x="98" y="150" width="60" height="70" fill="#4a7ee8"/>');
  let step = 0;
  const states = ["PLANNED", "AWAITING_2D_APPROVAL", "AWAITING_3D_REVIEW", "DONE"];
  return {
    upload: async () => ({ id: "demo-d1", sha256: "demo-prepared-hash", image_url: draw, needs_review: true, review_reasons: ["noisy_background"] }),
    blob: async (p) => ({ simulated: true, path: p }),
    createJob: async (did, profile, sha) => { if (sha !== "demo-prepared-hash") throw { code: "STATE_CONFLICT" }; step = 0; return { id: "demo-j1", state: "PLANNED" }; },
    job: async () => ({ id: "demo-j1", state: states[step], reference_2d_sha256: "demo-2d-hash", model_sha256: "demo-3d-hash" }),
    start: async () => { step = 1; return {}; },
    approve: async (id, s, h) => { if (h !== (s === "2d" ? "demo-2d-hash" : "demo-3d-hash")) throw { code: "STATE_CONFLICT" }; step = s === "2d" ? 2 : 3; return {}; },
    remove: async () => {},
  };
}


/* Visor 3D (three.js local, sin CDN). Muestra el GLB con sus colores; si no hay WebGL, avisa y deja la descarga.
   Seguridad: el GLB solo se muestra si todos sus recursos van embebidos (data:); el loader además bloquea cualquier
   URL que no sea data: o blob:, para que un modelo no pueda disparar peticiones fuera de la API local. */
let viewerState = null, loadToken = 0;

function glbIsSafe(buf) {
  /* Valida el mismo documento que interpreta el loader: cabecera v2 con longitud total exacta, un solo bloque JSON
     (el primero) y solo bloques BIN después, todos alineados a 4 bytes y dentro del archivo. */
  try {
    const dv = new DataView(buf);
    if (buf.byteLength < 20 || dv.getUint32(0, true) !== 0x46546C67) return false; /* "glTF" */
    if (dv.getUint32(4, true) !== 2 || dv.getUint32(8, true) !== buf.byteLength) return false;
    let off = 12, json = null, n = 0;
    while (off < buf.byteLength) {
      if (off + 8 > buf.byteLength) return false;
      const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true), start = off + 8;
      if (len % 4 !== 0 || start + len > buf.byteLength) return false;
      if (n === 0) { if (type !== 0x4E4F534A) return false; json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, start, len))); }
      else if (type !== 0x004E4942) return false; /* solo "BIN" tras el JSON: un segundo JSON se rechaza */
      off = start + len; n += 1;
    }
    if (json === null || off !== buf.byteLength) return false;
    let ok = true;
    (function walk(v) {
      if (!ok || v === null || typeof v !== "object") return;
      for (const k of Object.keys(v)) {
        if (k === "uri" && !(typeof v[k] === "string" && /^data:/i.test(v[k]))) { ok = false; return; }
        walk(v[k]);
      }
    })(json);
    return ok;
  } catch (_) { return false; }
}

function freeObject(root) {
  if (!root || typeof root.traverse !== "function") return;
  root.traverse((o) => {
    if (o.geometry && o.geometry.dispose) o.geometry.dispose();
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
      if (!m) return;
      for (const k in m) if (m[k] && m[k].isTexture && m[k].dispose) m[k].dispose();
      if (m.dispose) m.dispose();
    });
  });
}

/* Caras y vértices del modelo mostrado (el GLB original de fal, no el STL reparado). */
function modelStats(root) {
  let faces = 0, vertices = 0;
  if (root && typeof root.traverse === "function") {
    root.traverse((o) => {
      const g = o && o.geometry; if (!g || !g.attributes || !g.attributes.position) return;
      const n = g.attributes.position.count || 0; vertices += n;
      faces += g.index ? Math.floor((g.index.count || 0) / 3) : Math.floor(n / 3);
    });
  }
  return { faces, vertices };
}
function showStats(object3d) {
  const s = modelStats(object3d), fmt = (n) => n.toLocaleString("es");
  $("model-info").textContent = s.faces || s.vertices ? "Modelo original · Caras: " + fmt(s.faces) + " · Vértices: " + fmt(s.vertices) : "";
  $("model-info").hidden = !($("model-info").textContent);
}
function disposeViewer() {
  $("model-info").textContent = ""; $("model-info").hidden = true; /* nada del modelo anterior */
  if (!viewerState) return;
  const v = viewerState; viewerState = null; v.stop = true;
  try { if (typeof cancelAnimationFrame === "function" && v.raf) cancelAnimationFrame(v.raf); } catch (_) {}
  try { if (v.controls && v.controls.dispose) v.controls.dispose(); } catch (_) {}
  try { freeObject(v.object); } catch (_) {}
  try { v.renderer.dispose(); v.canvas.remove(); } catch (_) {}
}

function startViewer(object3d) {
  const box = $("viewer"); disposeViewer();
  showStats(object3d); /* después de disposeViewer, que borra los datos del modelo anterior */
  if (typeof THREE === "undefined") { $("viewer-note").textContent = "No se pudo cargar el visor 3D; usa la descarga."; return; }
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch (_) { $("viewer-note").textContent = "Este navegador no tiene WebGL; usa la descarga."; return; }
  const rect = box.getBoundingClientRect(), w = Math.round(rect.width) || 360, h = Math.round(rect.height) || 360;
  renderer.setSize(w, h, false); renderer.setPixelRatio(Math.min((typeof window !== "undefined" && window.devicePixelRatio) || 1, 2));
  box.appendChild(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xc9cfc8);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 1.0));
  const sun = new THREE.DirectionalLight(0xffffff, 0.8); sun.position.set(2, 3, 4); scene.add(sun);
  /* glTF sin material usa metal=1 y se ve negro sin mapa de entorno: ponemos metal=0 donde no hay textura de metal. */
  object3d.traverse((o) => { if (o.isMesh && o.material && !o.material.metalnessMap && o.material.metalness !== undefined) o.material.metalness = 0; });
  const bounds = new THREE.Box3().setFromObject(object3d), size = bounds.getSize(new THREE.Vector3()), mid = bounds.getCenter(new THREE.Vector3());
  object3d.position.sub(mid); scene.add(object3d);
  const radius = Math.max(size.x, size.y, size.z) || 1;
  const camera = new THREE.PerspectiveCamera(40, w / h, radius / 100, radius * 100);
  camera.position.set(0, 0, radius * 2.2);
  const controls = new THREE.OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
  const state = { stop: false, raf: 0, renderer, canvas: renderer.domElement, controls, object: object3d }; viewerState = state;
  (function loop() { if (state.stop) return; controls.update(); renderer.render(scene, camera); state.raf = requestAnimationFrame(loop); })();
  $("viewer-note").textContent = "Arrastra para girar. Los colores salen del modelo; el STL que se imprime no lleva color.";
}

function demoFigure() {
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 1.0, 24), mat(0x4a7ee8)); body.position.y = 0;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.4, 24, 24), mat(0xe8b04a)); head.position.y = 0.85;
  g.add(body, head); return g;
}

/* gen: dibujo actual al pedir la carga; token: carga más reciente. Una respuesta tardía nunca toca el visor actual. */
async function showModel(b, gen) {
  const token = ++loadToken, stale = () => gen !== state.gen || token !== loadToken;
  if (typeof THREE === "undefined") { $("viewer-note").textContent = "No se pudo cargar el visor 3D; usa la descarga."; return; }
  if (b && b.simulated) { if (stale()) return; startViewer(demoFigure()); $("viewer-note").textContent = "Figura de demostración (simulada)."; return; }
  const data = await b.arrayBuffer();
  if (stale()) return;
  if (!glbIsSafe(data)) { $("viewer-note").textContent = "El modelo no se muestra porque referencia archivos externos o no es un GLB válido. Usa la descarga."; return; }
  await new Promise((resolve) => {
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((u) => (/^(data|blob):/i.test(String(u)) ? u : "data:,"));
    new THREE.GLTFLoader(manager).parse(data, "",
      (gltf) => { if (stale()) freeObject(gltf.scene); else startViewer(gltf.scene); resolve(); },
      () => { if (!stale()) $("viewer-note").textContent = "No se pudo mostrar el modelo; usa la descarga."; resolve(); });
  });
}

function connected(api, demo, real) {
  state.api = api; state.demo = demo; state.real = !!real;
  $("mode").textContent = demo ? "Modo demostración: nada sale de esta página." : real ? "MODO REAL: lo que ejecutes gasta dinero de verdad." : "Conectado a la API local (simulación).";
  show("connect", false); show("upload"); renderNextStep();
}

/* «Código de conexión» que imprime/copia scripts/start_beta.py: mm3d:<token> o mm3d:<token>:<token real>. Solo se usa en memoria. */
function parseConnectionCode(text) {
  const m = /^mm3d:([A-Za-z0-9_-]{32,})(?::([A-Za-z0-9_-]{32,}))?$/.exec(String(text || "").trim());
  return m ? { token: m[1], realToken: m[2] || "" } : null;
}
$("btn-connect").onclick = () => {
  if (isPublicHost()) return; /* defensa en profundidad: la ocultación del formulario es solo de presentación */
  const codeText = $("code").value.trim(), code = parseConnectionCode(codeText);
  if (codeText && !code) { $("connect-msg").textContent = "Ese código no es válido. Copia el código completo que mostró la ventana de arranque (empieza con mm3d:)."; return; }
  if (code) { $("token").value = code.token; $("real-token").value = code.realToken; $("real-mode").checked = !!code.realToken; }
  const token = $("token").value.trim();
  const origin = loopbackOrigin($("base").value.trim());
  if (!origin) { fail({ code: "BAD_ADDRESS" }); return; }
  if (!token) { $("connect-msg").textContent = "Pega el código de conexión (lo copia solo la ventana de arranque)."; return; }
  const wantsReal = $("real-mode").checked, realToken = $("real-token").value.trim();
  if (wantsReal && !realToken) { $("connect-msg").textContent = "El modo real necesita el token real."; return; }
  $("connect-msg").textContent = ""; ok();
  const base = realApi(origin, token, wantsReal ? realToken : "");
  connected(wantsReal ? operatorApi(base) : base, false, wantsReal);
  $("token").value = ""; $("real-token").value = ""; $("code").value = "";
};
$("real-mode").onchange = () => { show("real-token-label", $("real-mode").checked); };
$("btn-demo").onclick = () => { ok(); connected(demoApi(), true); };
/* En una página pública (no loopback) solo existe la demostración: sin formulario de API ni tokens, y sin conexión automática. */
function isPublicHost() {
  const loc = typeof location !== "undefined" ? location : null, host = loc && loc.hostname;
  if (!host) return false;
  const local = ["127.0.0.1", "localhost", "[::1]", "::1"].includes(host) || host.endsWith(".localhost") || /^127(\.\d{1,3}){3}$/.test(host);
  return !!host && /^https?:$/.test(loc.protocol || "") && !local;
}
if (isPublicHost()) { show("connect-local", false); show("public-note"); }

function resetFromUpload() {
  disposeViewer(); clearDownload("stl-link", "stl-note"); clearDownload("model-link", "model-note");
  creating = false; state.creatingToken += 1; state.preparedSha = null; state.gen += 1; state.poll += 1; state.drawingId = null; state.jobId = null; state.shownState = null; state.shownLaunches = null;
  $("seen").checked = false; $("btn-job").disabled = true;
  ["prepared", "job", "approve2d", "approve3d", "done", "btn-start", "btn-refresh", "real-authorize", "real-execute", "real-done-note", "real-stl"].forEach((id) => show(id, false));
  state.planHash = null; clear2d();
  clearInterval(workTimer); workTimer = null; workStart = null; show("progress", false); /* nada del trabajo anterior */
  setStage("3d");
  $("job-state").textContent = ""; state.bound = null; state.refHash = null; state.modelHash = null; state.lastJob = null; renderNextStep();
}

$("btn-upload").onclick = async () => {
  const file = $("file").files[0]; if (!file) { $("error").textContent = "Elige una imagen."; return; }
  resetFromUpload(); const gen = state.gen;
  try {
    const d = await state.api.upload(file); if (gen !== state.gen) return;
    ok(); state.drawingId = d.id; state.preparedSha = d.sha256 || null; renderNextStep();
    const src = d.image_url && d.image_url.startsWith("data:") ? d.image_url : URL.createObjectURL(await state.api.blob("/drawings/" + d.id + "/prepared"));
    if (gen !== state.gen) { if (src.startsWith("blob:")) URL.revokeObjectURL(src); return; }
    setUrl($("prepared-img"), "prepared-img", src);
    $("review").textContent = d.needs_review ? "Revisa con cuidado: " + (d.review_reasons || []).map((r) => REVIEW_TEXT[r] || "Hay algo que revisar.").join(" ") : "Sin alertas automáticas. Igual mira la imagen.";
    show("prepared"); show("job");
  } catch (e) { if (gen === state.gen) fail(e); }
};
$("seen").onchange = () => { $("btn-job").disabled = !(state.drawingId && $("seen").checked); };

/* Estados en los que el trabajo espera una acción tuya o terminó: la consulta periódica se detiene. */
const STABLE = ["PLANNED", "AUTHORIZATION_PENDING", "AUTHORIZED", "APPROVED_2D", "RECOVERY_REQUIRED", "AWAITING_2D_APPROVAL", "AWAITING_STL",
  "AWAITING_3D_REVIEW", "NEEDS_REVIEW", "DONE", "FAILED", "CANCELLED"];
/* Vista principal estilo visor: 3D por defecto; las miniaturas cambian a dibujo original o referencia 2D (la vista 3D sigue debajo, sin recargar). */
let stageView = "3d";
function setStage(view) {
  const src = view === "orig" ? $("prepared-img").src : view === "2d" ? $("ref2d").src : "";
  if (view !== "3d" && !src) view = "3d"; /* sin imagen que mostrar, se queda en 3D */
  stageView = view;
  $("stage-img").hidden = view === "3d"; $("stage-img").src = view === "3d" ? "" : src;
  $("stage-img").alt = view === "orig" ? "Dibujo original" : view === "2d" ? "Referencia 2D aprobada" : "";
  [["orig", "thumb-orig"], ["2d", "thumb-2d"], ["3d", "thumb-3d"]].forEach(([v, id]) => $(id).setAttribute("aria-pressed", String(v === view)));
}
function syncThumbs() {
  $("thumb-orig-img").src = $("prepared-img").src || ""; $("thumb-2d-img").src = $("ref2d").src || "";
  $("thumb-orig").disabled = !$("prepared-img").src; $("thumb-2d").disabled = !$("ref2d").src;
}
$("thumb-orig").onclick = () => setStage("orig"); $("thumb-2d").onclick = () => setStage("2d"); $("thumb-3d").onclick = () => setStage("3d");
setStage("3d");
let refreshSeq = 0, ref2dKey = null, workStart = null, workTimer = null;
function clear2d() {
  ref2dKey = null; $("ref2d").src = ""; show("approve2d-controls", false);
  try { if (urls.ref2d && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(urls.ref2d); } catch (_) {}
  urls.ref2d = null;
}
async function refresh() {
  const gen = state.gen, jid = state.jobId, seq = ++refreshSeq; /* un refresh más nuevo invalida las peticiones pendientes de los anteriores */
  const j = await state.api.job(jid); if (gen !== state.gen || jid !== state.jobId || seq !== refreshSeq) return null; /* una consulta más nueva invalida también respuestas de estado viejas */
  const R0 = state.real, runTag = R0 && j.id ? " · run " + j.id : "";
  state.lastJob = j; $("job-state").textContent = "Estado: " + (STATE_FRIENDLY[j.state] || j.state) + " (" + j.state + ")" + runTag;
  updateProgress(j);
  if (j.plan_sha256) state.planHash = j.plan_sha256;
  /* En modo real el modelo 3D (ya pagado) se ve en AWAITING_STL; si el STL falló (FAILED con modelo) se reintenta sin gasto. */
  const R = state.real, stlRetry = R && j.state === "FAILED" && !!j.model_sha256, awaitingStl = R && (j.state === "AWAITING_STL" || stlRetry);
  const reviewing = j.state === "AWAITING_3D_REVIEW" || (R && (j.state === "DONE" || j.state === "NEEDS_REVIEW" || awaitingStl));
  show("btn-start", !R && j.state === "PLANNED");
  show("real-authorize", R && (j.state === "PLANNED" || j.state === "AUTHORIZATION_PENDING"));
  show("real-execute", R && !stlRetry && ["AUTHORIZED", "APPROVED_2D", "RECOVERY_REQUIRED", "FAILED"].includes(j.state));
  show("real-stl", awaitingStl);
  state.refHash = j.reference_2d_sha256 || null; state.modelHash = j.model_sha256 || null; state.shownState = j.state; state.shownLaunches = j.launches;
  if (R && j.plan) {
    state.bound = String(j.plan.total_upper_bound_usd || ""); state.stageBound = stageBoundFor(j);
    $("real-bound").textContent = state.bound ? fmtUsd(state.bound) : "?"; $("real-plan-hash").textContent = j.plan_sha256 || "";
    $("btn-authorize").textContent = "Autorizar el gasto (hasta " + (state.bound ? fmtUsd(state.bound) : "?") + " USD)";
    $("btn-execute").textContent = "Ejecutar en fal (gasta hasta " + fmtUsd(state.stageBound || state.bound || "?") + " USD)";
  }
  /* La referencia 2D aprobada sigue visible mientras se genera el 3D; los controles de aprobación solo cuando toca aprobar. */
  const awaiting2d = j.state === "AWAITING_2D_APPROVAL", keep2d = !awaiting2d && !!j.reference_2d_sha256 && ["APPROVED_2D", "QUEUED", "RUNNING"].includes(j.state);
  const key2d = jid + ":" + (j.reference_2d_sha256 || "");
  /* Los controles de aprobación solo existen cuando la imagen mostrada es la de ESTE trabajo y hash. */
  show("approve2d", awaiting2d || keep2d); show("approve2d-controls", awaiting2d && key2d === ref2dKey);
  show("approve3d", reviewing); show("approve3d-controls", !R);
  if (reviewing) syncThumbs(); else setStage("3d");
  if (!reviewing) { loadToken += 1; disposeViewer(); } /* invalida también la carga pendiente del mismo dibujo */
  const finished = j.state === "DONE" || (R && j.state === "NEEDS_REVIEW");
  show("done", finished); show("btn-delete", !R); show("real-done-note", R);
  show("btn-refresh", !STABLE.includes(j.state) || j.state === "UPLOADED" || j.state === "PREPARED");
  if (awaiting2d || keep2d) {
    $("shown2d").textContent = j.reference_2d_sha256 || "";
    const key = key2d; /* la imagen del mismo trabajo y hash no se vuelve a pedir */
    if (key !== ref2dKey) {
      clear2d(); /* nunca queda a la vista la imagen de otro dibujo mientras llega la correcta */
      let b = null;
      try { b = await state.api.blob("/jobs/" + jid + "/artifacts/reference_2d"); } catch (e) { if (awaiting2d) throw e; } /* en QUEUED/RUNNING el servidor responde 409: se sigue consultando el estado */
      if (gen !== state.gen || seq !== refreshSeq) return null;
      if (b) {
        setUrl($("ref2d"), "ref2d", b && b.simulated ? "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#fff"/><circle cx="128" cy="110" r="50" fill="#e8b04a"/><text x="128" y="240" text-anchor="middle" font-size="14">referencia simulada</text></svg>') : URL.createObjectURL(b));
        ref2dKey = key;
        show("approve2d-controls", awaiting2d);
      }
    }
  }
  if (reviewing) {
    $("shown3d").textContent = j.model_sha256 || "";
    clearDownload("model-link", "model-note"); /* nada del trabajo anterior mientras llega el nuevo */
    const b = await state.api.blob("/jobs/" + jid + "/artifacts/model"); if (gen !== state.gen || seq !== refreshSeq) return null;
    if (b && b.simulated) { $("model-link").hidden = true; $("model-note").textContent = "Modelo simulado: en la demostración no hay archivo que descargar."; }
    else { setUrl($("model-link"), "model-link", URL.createObjectURL(b)); $("model-link").hidden = false; $("model-note").textContent = ""; }
    try { await showModel(b, gen); } catch (_) { if (gen === state.gen) $("viewer-note").textContent = "No se pudo mostrar el modelo; usa la descarga."; }
    if (gen !== state.gen || seq !== refreshSeq) return null;
  }
  if (j.state === "AWAITING_STL") $("job-state").textContent = "Estado: AWAITING_STL" + runTag + ". El modelo 3D está listo y guardado. Generar el STL es local y no gasta.";
  if (stlRetry) $("job-state").textContent = "Estado: FAILED" + (j.error_code ? " (" + j.error_code + ")" : "") + runTag + ". Falló la preparación del STL; el modelo 3D sigue guardado y puedes reintentar sin gasto.";
  else if (j.state === "FAILED") $("job-state").textContent = R ? "Estado: FAILED" + (j.error_code ? " (" + j.error_code + ")" : "") + runTag + ". No se reintenta solo; si el control de gasto lo permite puedes volver a ejecutar. Esto no promete que no hubo cargo." : "Estado: FAILED. La simulación no terminó; borra y vuelve a intentar.";
  if (j.state === "NEEDS_REVIEW") $("job-state").textContent = "Estado: NEEDS_REVIEW" + runTag + ". Revisa el modelo con cuidado antes de imprimir.";
  if (finished) {
    $("done-msg").textContent = j.state === "NEEDS_REVIEW"
      ? "El modelo necesita revisión manual. La descarga del STL no significa que esté aprobado ni que sea imprimible: revisa geometría, grosor, escala y estabilidad."
      : state.demo ? "El trabajo terminó (simulado). No se gastó dinero." : R ? "El trabajo real terminó. Revisa en el panel de fal el cargo real." : "El trabajo terminó (simulado).";
    try {
      clearDownload("stl-link", "stl-note");
      const s = await state.api.blob("/jobs/" + jid + "/artifacts/stl"); if (gen !== state.gen || seq !== refreshSeq) return null;
      if (s && s.simulated) { $("stl-link").hidden = true; $("stl-note").textContent = "En la demostración no hay STL que descargar."; }
      else { setUrl($("stl-link"), "stl-link", URL.createObjectURL(s)); $("stl-link").hidden = false; $("stl-note").textContent = ""; }
    } catch (_) { if (gen === state.gen && seq === refreshSeq) $("stl-note").textContent = "No se pudo preparar la descarga del STL."; }
  }
  renderNextStep();
  return j;
}

/* Tiempo y etapa visibles mientras el servidor trabaja, para que no parezca colgado. */
const WORKING = ["QUEUED", "RUNNING"];
function stageText(j) {
  if (!state.real) return "Simulando…";
  if (j.model_sha256) return "Preparando el STL (reparación local, sin costo)…";
  return j.reference_2d_sha256 ? "Generando el modelo 3D (suele tardar entre 1 y 3 minutos)…" : "Generando la referencia 2D (suele tardar unos 30 segundos)…";
}
function updateProgress(j) {
  if (!WORKING.includes(j.state)) { clearInterval(workTimer); workTimer = null; workStart = null; show("progress", false); return; }
  if (workStart === null) workStart = Date.now();
  const render = () => { const s = Math.floor((Date.now() - workStart) / 1000); $("progress").textContent = stageText(j) + " Llevamos " + Math.floor(s / 60) + " min " + (s % 60) + " s. No cierres esta pestaña ni el servidor."; };
  render(); show("progress", true);
  clearInterval(workTimer); workTimer = setInterval(render, 1000);
}
/* Consulta acotada: hasta 10 minutos (cada 2 s el primer minuto, luego cada 5 s) mientras el trabajo no espere una acción tuya.
   Un fallo de conexión se tolera unas veces seguidas antes de rendirse. */
const WATCH_LIMIT_MS = 10 * 60 * 1000;
async function watch() {
  const my = ++state.poll, t0 = Date.now();
  let misses = 0;
  while (my === state.poll && Date.now() - t0 < WATCH_LIMIT_MS) {
    let j;
    try { j = await refresh(); misses = 0; if (j) ok(); } catch (e) {
      if (e && e.code === "API_UNREACHABLE" && ++misses < 5) { fail(e); await new Promise((r) => setTimeout(r, 3000)); continue; }
      fail(e); show("btn-refresh"); return;
    }
    if (!j || STABLE.includes(j.state)) return;
    await new Promise((r) => setTimeout(r, Date.now() - t0 < 60000 ? 2000 : 5000));
  }
  if (my === state.poll) { show("btn-refresh"); $("error").textContent = "Sigue en marcha. Pulsa Actualizar estado para consultar de nuevo."; }
}

$("btn-job").onclick = async () => {
  if (creating || state.jobId) return;
  creating = true; $("btn-job").disabled = true;
  const gen = state.gen, mine = ++state.creatingToken;
  try {
    const j = await state.api.createJob(state.drawingId, $("profile").value, state.preparedSha);
    if (gen !== state.gen) return;
    state.jobId = j.id; renderNextStep(); ok(); await watch();
  } catch (e) {
    if (gen === state.gen) { fail(e); $("btn-job").disabled = !($("seen").checked && state.drawingId); }
  } finally { if (mine === state.creatingToken) creating = false; }
};
$("btn-start").onclick = async () => { const gen = state.gen; try { await state.api.start(state.jobId); if (gen !== state.gen) return; ok(); await watch(); } catch (e) { if (gen === state.gen) fail(e); } };
$("btn-refresh").onclick = () => { watch(); };
const USD_RE = /^[0-9]{1,6}(\.[0-9]{1,6})?$/; /* mismo formato que acepta el servidor para max_usd */
/* «Qué hacer ahora»: una frase en español sencillo según dónde vas (no decide nada; solo guía). */
const STATE_FRIENDLY = {
  PLANNED: "Plan listo", AUTHORIZATION_PENDING: "Autorizando", AUTHORIZED: "Gasto autorizado", QUEUED: "En cola", RUNNING: "Trabajando",
  AWAITING_2D_APPROVAL: "Esperando que apruebes la imagen 2D", APPROVED_2D: "Imagen 2D aprobada", AWAITING_STL: "Modelo 3D listo; falta el STL",
  AWAITING_3D_REVIEW: "Esperando que revises el modelo 3D", DONE: "Terminado", NEEDS_REVIEW: "Terminado: revísalo antes de imprimir",
  FAILED: "Algo falló", RECOVERY_REQUIRED: "Hay que recuperar el trabajo", CANCELLED: "Cancelado",
};
function nextStep({ connected, drawing, job, real, stageBound, bound }) {
  const usd = (v) => (v ? fmtUsd(v) + " USD" : "el costo que verás");
  if (!connected) return "Paso 1 de 6 · Conecta: pega el código de conexión que copió la ventana de arranque (o prueba la demostración).";
  if (!drawing) return "Paso 2 de 6 · Sube el dibujo (una foto o escaneo con buena luz, de frente).";
  if (!job) return "Paso 3 de 6 · Mira que la figura se vea completa y bien recortada, marca la casilla y crea el trabajo.";
  switch (job.state) {
    case "PLANNED": case "AUTHORIZATION_PENDING": return real ? "Paso 4 de 6 · Autoriza el gasto: verás el costo máximo antes de confirmar." : "Paso 4 de 6 · Pulsa «Iniciar (simulado)».";
    case "AUTHORIZED": return "Paso 4 de 6 · Pulsa «Ejecutar» para crear la imagen 2D. Se cobra hasta " + usd(stageBound || bound) + ".";
    case "QUEUED": case "RUNNING": return "Paso 4 de 6 · Esperando a fal. No cierres esta pestaña ni la ventana de arranque.";
    case "AWAITING_2D_APPROVAL": return "Paso 5 de 6 · Mira la imagen 2D. Si es la figura correcta, apruébala (aprobar no cobra).";
    case "APPROVED_2D": return "Paso 5 de 6 · Imagen aprobada. Pulsa «Ejecutar» para crear el modelo 3D. Se cobra hasta " + usd(stageBound || bound) + ".";
    case "AWAITING_STL": return "Paso 6 de 6 · Gira el modelo 3D. Si te gusta, pulsa «Generar STL» (no gasta).";
    case "AWAITING_3D_REVIEW": return "Paso 6 de 6 · Revisa el modelo 3D y apruébalo.";
    case "DONE": return "Listo · Descarga el STL y revísalo antes de imprimir.";
    case "NEEDS_REVIEW": return "Listo, pero hay avisos · Descarga el STL y revisa con cuidado antes de imprimir.";
    case "FAILED": return "Algo falló. Lee el mensaje de abajo; nada se vuelve a cobrar solo.";
    case "RECOVERY_REQUIRED": return "El servidor se reinició durante un paso. Revisa el costo y pulsa «Ejecutar» para recuperarlo.";
    default: return "Sigue las instrucciones de abajo.";
  }
}
/* Asistente de una sola vista: de las secciones que existen en este momento, solo se ve la del paso actual (más la que hace falta
   para actuar). Es solo presentación: no cambia qué botones existen ni qué confirma cada uno. Sin estado conocido no se oculta nada. */
const WIZARD_SECTIONS = ["connect", "upload", "job", "real-authorize", "real-execute", "approve2d", "approve3d", "done"];
function wizardVisible() {
  if (!state.api) return ["connect"];
  if (!state.drawingId) return ["upload"];
  if (!state.jobId) return ["upload", "job"]; /* la casilla «ya miré la imagen» vive en «upload» y habilita «Crear trabajo» */
  const j = state.lastJob; if (!j) return ["job"];
  switch (j.state) {
    case "PLANNED": case "AUTHORIZATION_PENDING": return state.real ? ["real-authorize", "job"] : ["job"];
    case "AUTHORIZED": case "APPROVED_2D": case "RECOVERY_REQUIRED": return ["real-execute", "job"];
    case "FAILED": return j.model_sha256 ? ["approve3d"] : ["real-execute", "job"];
    case "QUEUED": case "RUNNING": return ["job"];
    case "AWAITING_2D_APPROVAL": return ["approve2d"];
    case "AWAITING_STL": case "AWAITING_3D_REVIEW": return ["approve3d"];
    case "DONE": case "NEEDS_REVIEW": return ["approve3d", "done"];
    default: return null;
  }
}
function applyWizard() {
  const allowed = wizardVisible();
  for (const id of WIZARD_SECTIONS) { const el = $(id); if (el && el.classList) el.classList.toggle("step-hidden", !!allowed && !allowed.includes(id)); }
  const key = allowed ? allowed.join(",") : "";
  if (key !== state.wizardKey) { state.wizardKey = key; if (typeof window !== "undefined" && typeof window.scrollTo === "function") window.scrollTo(0, 0); }
}
function renderNextStep() {
  applyWizard();
  $("next-step").textContent = nextStep({ connected: !!state.api, drawing: !!state.drawingId, job: state.jobId ? state.lastJob : null,
    real: state.real, stageBound: state.stageBound, bound: state.bound });
}
/* Solo para mostrar: 0.372000 -> 0.372, 0.300000 -> 0.30 (al servidor se envía la cadena exacta del plan). */
function fmtUsd(s) {
  const m = /^([0-9]+)(?:\.([0-9]+))?$/.exec(String(s)); if (!m) return String(s);
  let frac = (m[2] || "").replace(/0+$/, ""); while (frac.length < 2) frac += "0";
  return m[1] + "." + frac;
}
/* Confirmación por ventana (sin teclear códigos). Cada paso que gasta o compromete pasa por aquí; por defecto el foco está en «Cancelar». */
let confirming = false;
function confirmDialog({ title, message, okLabel, danger }) {
  if (confirming) return Promise.resolve(false); /* una sola ventana a la vez */
  const d = $("confirm-dialog");
  if (!d || typeof d.showModal !== "function") return Promise.resolve(typeof confirm === "function" ? !!confirm(title + "\n\n" + message) : false);
  confirming = true;
  $("confirm-title").textContent = title; $("confirm-msg").textContent = message; $("confirm-ok").textContent = okLabel || "Continuar";
  d.classList.toggle("danger", !!danger); $("confirm-ok").classList.toggle("danger", !!danger);
  return new Promise((resolve) => {
    const finish = (answer) => { confirming = false; $("confirm-ok").onclick = $("confirm-cancel").onclick = null; d.oncancel = d.onclose = null; try { d.close(); } catch (_) {} resolve(answer); };
    $("confirm-ok").onclick = () => finish(true); $("confirm-cancel").onclick = () => finish(false);
    d.oncancel = (ev) => { if (ev && ev.preventDefault) ev.preventDefault(); finish(false); }; /* Esc cancela */
    d.showModal(); try { $("confirm-cancel").focus(); } catch (_) {}
  });
}
/* Tope de la etapa que se va a enviar, si se conoce (2D antes de aprobar; 3D después), para el aviso. */
function stageBoundFor(j) {
  const stages = (j.plan && j.plan.stages) || {};
  const pick = (k) => stages[k] && stages[k].upper_bound_usd ? String(stages[k].upper_bound_usd) : null;
  if (j.state === "AUTHORIZED") return pick("2d");
  if (j.state === "APPROVED_2D") return pick("3d");
  return null;
}
$("btn-authorize").onclick = async () => {
  const gen = state.gen, bound = state.bound, shown = bound ? fmtUsd(bound) : "?";
  if (!state.planHash || !bound || !USD_RE.test(bound)) { $("error").textContent = "No hay un plan con costo máximo para autorizar. Actualiza el estado."; return; }
  const yes = await confirmDialog({ title: "¿Autorizar el gasto?", okLabel: "Sí, autorizar hasta " + shown + " USD", danger: true,
    message: "Vas a permitir que este trabajo gaste como máximo " + shown + " USD en fal (imagen 2D y modelo 3D). Todavía no se cobra nada: el cobro ocurre cuando pulses «Ejecutar» en cada paso." });
  if (!yes || gen !== state.gen) return;
  try { await state.api.authorize(state.jobId, state.planHash, bound); if (gen !== state.gen) return; ok(); await watch(); } catch (e) { if (gen === state.gen) fail(e); }
};
$("btn-generate-stl").onclick = async () => {
  const gen = state.gen; $("btn-generate-stl").disabled = true;
  try { await state.api.generateStl(state.jobId); if (gen !== state.gen) return; ok(); await watch(); } catch (e) { if (gen === state.gen) fail(e); }
  finally { $("btn-generate-stl").disabled = false; }
};
$("btn-execute").onclick = async () => {
  const gen = state.gen, raw = state.stageBound || state.bound;
  /* Un paso que gasta no avanza si la alerta no puede mostrar un tope decimal válido (falla cerrado). */
  if (!raw || !USD_RE.test(String(raw))) { $("error").textContent = "No hay un costo máximo válido para este paso, así que no se envía nada. Actualiza el estado."; return; }
  /* La confirmación vale solo para la etapa que se está viendo: se manda ese estado y el servidor rechaza si ya cambió (auditoría #76). */
  const shown = state.shownState, launches = state.shownLaunches;
  if (!["AUTHORIZED", "APPROVED_2D", "RECOVERY_REQUIRED", "FAILED"].includes(shown) || !Number.isInteger(launches) || launches < 0) { $("error").textContent = "No se conoce el paso actual, así que no se envía nada. Actualiza el estado."; return; }
  const bound = fmtUsd(raw);
  const yes = await confirmDialog({ title: "¿Enviar a fal y gastar dinero?", okLabel: "Sí, enviar y gastar hasta " + bound + " USD", danger: true,
    message: "Este paso se envía a fal y se cobrará hasta " + bound + " USD. Una vez enviado no se puede deshacer ni cancelar. Si tienes dudas, pulsa «Cancelar»." });
  if (!yes || gen !== state.gen) return;
  $("btn-execute").disabled = true;
  try { await state.api.execute(state.jobId, "EJECUTAR", shown, launches); if (gen !== state.gen) return; ok(); await watch(); }
  catch (e) {
    if (gen !== state.gen) return;
    /* Otro paso avanzó la corrida: se refresca y se avisa; nunca se reintenta solo con otro estado. */
    if (e && e.code === "STATE_CONFLICT") { try { await refresh(); } catch (_) { /* el estado se vuelve a consultar con Actualizar */ }
      $("error").textContent = "La corrida cambió mientras confirmabas (por ejemplo en otra pestaña). No se envió nada: revisa el paso actual y vuelve a confirmar."; }
    else fail(e);
  }
  finally { $("btn-execute").disabled = false; }
};
/* Aprobar usa el código de lo que se está viendo (se envía solo) y, en modo real, pide confirmación por ventana. */
function approver(step) {
  return async () => {
    const gen = state.gen, hash = step === "2d" ? state.refHash : state.modelHash;
    if (!hash) { $("error").textContent = "Todavía no hay nada que aprobar. Actualiza el estado."; return; }
    if (state.real) {
      const yes = await confirmDialog({ title: "¿Aprobar esta imagen?", okLabel: "Sí, aprobar esta imagen",
        message: "Estás aprobando la imagen que ves como referencia para crear el modelo 3D. Aprobar no cobra nada; el siguiente paso («Ejecutar») sí. Mira bien que sea la correcta." });
      if (!yes || gen !== state.gen) return;
    }
    try { await state.api.approve(state.jobId, step, hash); if (gen !== state.gen) return; ok(); await watch(); } catch (e) { if (gen === state.gen) fail(e); }
  };
}
$("btn-approve2d").onclick = approver("2d");
$("btn-approve3d").onclick = approver("3d");
$("btn-another").onclick = () => {
  resetFromUpload(); $("file").value = ""; state.drawingId = null; state.jobId = null; ok(); renderNextStep();
  if (typeof $("upload").scrollIntoView === "function") $("upload").scrollIntoView({ behavior: "smooth", block: "start" });
};
$("btn-delete").onclick = async () => { try { await state.api.remove(state.jobId, state.drawingId); location.reload(); } catch (e) { fail(e); } };
/* Conexión automática: si la página la sirve scripts/start_beta.py, /session.json trae el código (solo para esta página). Sin él, todo sigue igual. */
async function autoConnect() {
  try {
    if (state.api || typeof fetch !== "function" || typeof location === "undefined" || !/^https?:$/.test(location.protocol || "")) return false;
    if (!loopbackOrigin(location.origin)) return false;
    const r = await fetch("/session.json", { cache: "no-store", credentials: "omit" });
    if (!r || !r.ok) return false;
    const j = await r.json(), code = parseConnectionCode(j && j.code), origin = loopbackOrigin(j && j.api);
    if (!code || !origin || state.api) return false;
    if (code.realToken) return false; /* el servidor nunca debe mandar el token real: si llega, no se conecta sola */
    if (j.real === true) { /* modo real: el token de operador llega solo, el token real lo pega George (queda copiado) */
      $("base").value = origin; $("token").value = code.token; $("real-mode").checked = true; show("real-token-label", true);
      $("connect-msg").textContent = "Modo real: pega el token real (ya está copiado; Ctrl+V) en «Token real» y pulsa Conectar.";
      return true;
    }
    $("base").value = origin; $("code").value = j.code; $("btn-connect").onclick();
    return true;
  } catch (_) { return false; } /* sin /session.json (otro servidor, file://): se conecta a mano */
}
renderNextStep();
const autoConnecting = autoConnect();
if (typeof module !== "undefined") module.exports = { loopbackOrigin, state, glbIsSafe, showModel, refresh, resetFromUpload, realApi, operatorApi, fail, watch, setStage, modelStats, confirmDialog, fmtUsd, isPublicHost, parseConnectionCode, autoConnect, autoConnecting, nextStep, renderNextStep, wizardVisible, applyWizard };
