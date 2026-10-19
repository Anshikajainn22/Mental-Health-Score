
'use strict';
 
/* ---------- Config ---------- */
const DEFAULT_API_URL = 'http://127.0.0.1:8000';  // uvicorn default; editable on the page
let API_BASE_URL = DEFAULT_API_URL;
try { API_BASE_URL = localStorage.getItem('apiUrl') || DEFAULT_API_URL; } catch { /* storage unavailable */ }
const REQUEST_TIMEOUT_MS = 15000;
 
// Same list the backend uses for "top_countries", plus a few extras.
const COUNTRIES = ['India', 'USA', 'Canada', 'Australia', 'UK', 'Germany', 'Mexico', 'Turkey', 'France', 'Other'];
const PLATFORMS = ['Facebook', 'LinkedIn', 'Instagram', 'Snapchat', 'Twitter', 'YouTube',
                   'TikTok', 'LINE', 'KakaoTalk', 'VKontakte', 'WhatsApp', 'WeChat'];
 
/* ---------- Elements ---------- */
const form        = document.getElementById('predict-form');
const submitBtn   = document.getElementById('submit-btn');
const globalError = document.getElementById('global-error');
const placeholder = document.getElementById('placeholder');
const loader      = document.getElementById('loader');
const resultBox   = document.getElementById('result');
const gaugeBar    = document.getElementById('gauge-bar');
const scoreValue  = document.getElementById('score-value');
const scoreLabel  = document.getElementById('score-label');
const scoreMsg    = document.getElementById('score-msg');
const apiInput    = document.getElementById('api-url');
const apiCheck    = document.getElementById('api-check');
const apiStatus   = document.getElementById('api-status');
 
/* ---------- Server address bar ---------- */
apiInput.value = API_BASE_URL;
apiInput.addEventListener('change', () => {
  API_BASE_URL = apiInput.value.trim().replace(/\/+$/, '') || DEFAULT_API_URL;
  apiInput.value = API_BASE_URL;
  apiStatus.textContent = '';
  try { localStorage.setItem('apiUrl', API_BASE_URL); } catch { /* ignore */ }
});
apiCheck.addEventListener('click', async () => {
  apiInput.dispatchEvent(new Event('change'));
  apiStatus.className = 'api-status'; apiStatus.textContent = 'Checking…';
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(`${API_BASE_URL}/openapi.json`, { signal: ctrl.signal });
    const spec = await res.json();
    if (spec?.paths?.['/predict']) { apiStatus.textContent = '✅ FastAPI /predict found'; apiStatus.classList.add('ok'); }
    else { apiStatus.textContent = '❌ Server reachable but no /predict (is this Streamlit?)'; apiStatus.classList.add('bad'); }
  } catch {
    apiStatus.textContent = '❌ Not reachable (or not a FastAPI server)'; apiStatus.classList.add('bad');
  } finally { clearTimeout(t); }
});
 
const NUMERIC_RULES = {
  age:                     { int: true,  min: 10, max: 100, name: 'Age' },
  avg_daily_usage_hours:   { int: false, min: 0,  max: 24,  name: 'Daily usage' },
  daily_unlocks:           { int: true,  min: 0,  max: Infinity, name: 'Daily unlocks' },
  study_hours:             { int: false, min: 0,  max: 24,  name: 'Study hours' },
  physical_activity_hours: { int: false, min: 0,  max: 24,  name: 'Physical activity' },
  sleep_hours_per_night:   { int: false, min: 0,  max: 24,  name: 'Sleep hours' },
};
 
/* ---------- Populate selects ---------- */
function fillSelect(id, items) {
  const el = document.getElementById(id);
  items.forEach(v => el.add(new Option(v, v)));
}
fillSelect('country', COUNTRIES);
fillSelect('most_used_platform', PLATFORMS);
 
/* ---------- Helpers ---------- */
function setFieldError(name, message) {
  const small = form.querySelector(`.err[data-for="${name}"]`);
  const field = form.elements[name]?.closest('.field');
  if (!small || !field) return false;
  small.textContent = message || '';
  field.classList.toggle('invalid', !!message);
  return true;
}
function clearErrors() {
  form.querySelectorAll('.err').forEach(e => (e.textContent = ''));
  form.querySelectorAll('.field.invalid').forEach(f => f.classList.remove('invalid'));
  showGlobalError(null);
}
function showGlobalError(messages) {
  if (!messages || !messages.length) { globalError.hidden = true; globalError.innerHTML = ''; return; }
  const list = Array.isArray(messages) ? messages : [messages];
  globalError.innerHTML = list.length === 1
    ? `⚠️ ${escapeHtml(list[0])}`
    : `⚠️ Please fix the following:<ul>${list.map(m => `<li>${escapeHtml(m)}</li>`).join('')}</ul>`;
  globalError.hidden = false;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function setView(view) {            // 'placeholder' | 'loading' | 'result'
  placeholder.hidden = view !== 'placeholder';
  loader.hidden      = view !== 'loading';
  resultBox.hidden   = view !== 'result';
}
function setLoading(on) {
  submitBtn.disabled = on;
  submitBtn.classList.toggle('loading', on);
  submitBtn.querySelector('.btn-label').textContent = on ? 'Predicting…' : 'Predict score';
}
 
/* ---------- Client-side validation (mirrors backend rules) ---------- */
function collectAndValidate() {
  const data = {};
  let valid = true;
 
  for (const el of form.elements) {
    if (!el.name) continue;
    const raw = el.value.trim();
    const rule = NUMERIC_RULES[el.name];
 
    if (raw === '') { setFieldError(el.name, 'This field is required'); valid = false; continue; }
 
    if (rule) {
      const num = Number(raw);
      if (Number.isNaN(num))                      { setFieldError(el.name, 'Enter a valid number'); valid = false; continue; }
      if (rule.int && !Number.isInteger(num))     { setFieldError(el.name, 'Must be a whole number'); valid = false; continue; }
      if (num < rule.min || num > rule.max) {
        const range = rule.max === Infinity ? `at least ${rule.min}` : `between ${rule.min} and ${rule.max}`;
        setFieldError(el.name, `Must be ${range}`); valid = false; continue;
      }
      data[el.name] = num;
    } else {
      data[el.name] = raw;
    }
  }
  return valid ? data : null;
}
 
/* ---------- Parse FastAPI errors ---------- */
function handleApiError(status, body) {
  // FastAPI/Pydantic validation error: { detail: [ { loc: ['body','age'], msg: '...' } ] }
  if (status === 422 && Array.isArray(body?.detail)) {
    const unmatched = [];
    body.detail.forEach(d => {
      const field = d.loc?.[d.loc.length - 1];
      if (!setFieldError(field, d.msg)) unmatched.push(`${field}: ${d.msg}`);
    });
    if (unmatched.length) showGlobalError(unmatched);
    else showGlobalError('Some inputs were rejected by the server. Please check the highlighted fields.');
    return;
  }
  if (status >= 500) { showGlobalError('The server hit an error while predicting. Please try again shortly.'); return; }
  const detail = typeof body?.detail === 'string' ? body.detail : `Request failed (HTTP ${status}).`;
  showGlobalError(detail);
}
 
/* ---------- Result card ---------- */
function scoreInfo(score) {
  // Assumes a 1–10 scale where higher = better mental health.
  if (score >= 8) return { label: 'Excellent', color: '#22c55e', msg: 'Great balance — keep up the healthy habits!' };
  if (score >= 6) return { label: 'Good',      color: '#84cc16', msg: 'Doing well overall, with a little room to improve.' };
  if (score >= 4) return { label: 'Moderate',  color: '#f59e0b', msg: 'Consider more sleep, activity and less screen time.' };
  return            { label: 'Needs attention', color: '#ef4444', msg: 'Reaching out to a counsellor or trusted person could help.' };
}
function showResult(score) {
  const info = scoreInfo(score);
  const pct = Math.max(0, Math.min(score / 10, 1));
  const circumference = 2 * Math.PI * 52;
 
  resultBox.style.setProperty('--gauge-color', info.color);
  scoreLabel.textContent = info.label;
  scoreMsg.textContent = info.msg;
  setView('result');
 
  gaugeBar.style.strokeDashoffset = circumference;           // reset, then animate
  requestAnimationFrame(() => requestAnimationFrame(() => {
    gaugeBar.style.strokeDashoffset = circumference * (1 - pct);
  }));
 
  // count-up animation
  const start = performance.now(), duration = 1200;
  (function tick(now) {
    const t = Math.min((now - start) / duration, 1);
    scoreValue.textContent = (score * (1 - Math.pow(1 - t, 3))).toFixed(2);
    if (t < 1) requestAnimationFrame(tick);
  })(start);
}
 
/* ---------- Submit ---------- */
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors();
 
  const payload = collectAndValidate();
  if (!payload) {
    showGlobalError('Please correct the highlighted fields.');
    form.querySelector('.invalid input, .invalid select')?.focus();
    return;
  }
 
  apiInput.dispatchEvent(new Event('change'));   // pick up the address typed in the footer
  setLoading(true);
  setView('loading');
 
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
 
  try {
    const res = await fetch(`${API_BASE_URL}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
 
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON response */ }
 
    if (!res.ok) { handleApiError(res.status, body); setView('placeholder'); return; }
 
    const score = Number(body?.predicted_mental_health_score);
    if (Number.isNaN(score)) throw new Error('Unexpected response from server.');
    showResult(score);
  } catch (err) {
    setView('placeholder');
    if (err.name === 'AbortError') {
      showGlobalError(`No response from ${API_BASE_URL}. Run the backend with: uvicorn smhapp:app --host 0.0.0.0 --port 8501 (not streamlit), then use "Test connection".`);
    } else if (err instanceof TypeError) {
      showGlobalError(`Cannot reach the server at ${API_BASE_URL}. Make sure uvicorn is running and you're on the same network.`);
    } else {
      showGlobalError(err.message || 'Something went wrong. Please try again.');
    }
  } finally {
    clearTimeout(timer);
    setLoading(false);
  }
});
 
form.addEventListener('reset', () => { clearErrors(); setView('placeholder'); });
 
// Clear a field's error as soon as the user edits it
form.addEventListener('input', (e) => { if (e.target.name) setFieldError(e.target.name, ''); });
 