/* Sunwise – 14-day weather + UV index + sun-safety calculator
 * Data: Open-Meteo (https://open-meteo.com) – free, no API key, CORS-enabled.
 */
(() => {
  'use strict';

  const FORECAST_DAYS = 14;
  const DEFAULT_LOC = { name: 'Glasgow', admin1: 'Scotland', country: 'United Kingdom', latitude: 55.8651, longitude: -4.2576 };

  // ---------- State ----------
  const store = {
    get(k, fallback) { try { const v = localStorage.getItem('sunwise:' + k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem('sunwise:' + k, JSON.stringify(v)); } catch { /* ignore */ } },
  };

  const state = {
    loc: store.get('loc', DEFAULT_LOC),
    skin: store.get('skin', null),
    view: 'weather',
    dayIdx: 0,
    data: null,
  };

  // ---------- Helpers ----------
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const round = (n) => (n == null ? '–' : Math.round(n));

  // WMO weather codes → [day icon, night icon, description]
  const WMO = {
    0: ['☀️', '🌙', 'Clear sky'], 1: ['🌤️', '🌙', 'Mainly clear'], 2: ['⛅', '☁️', 'Partly cloudy'], 3: ['☁️', '☁️', 'Overcast'],
    45: ['🌫️', '🌫️', 'Fog'], 48: ['🌫️', '🌫️', 'Freezing fog'],
    51: ['🌦️', '🌧️', 'Light drizzle'], 53: ['🌦️', '🌧️', 'Drizzle'], 55: ['🌧️', '🌧️', 'Heavy drizzle'],
    56: ['🌧️', '🌧️', 'Freezing drizzle'], 57: ['🌧️', '🌧️', 'Heavy freezing drizzle'],
    61: ['🌦️', '🌧️', 'Light rain'], 63: ['🌧️', '🌧️', 'Rain'], 65: ['🌧️', '🌧️', 'Heavy rain'],
    66: ['🌧️', '🌧️', 'Freezing rain'], 67: ['🌧️', '🌧️', 'Heavy freezing rain'],
    71: ['🌨️', '🌨️', 'Light snow'], 73: ['🌨️', '🌨️', 'Snow'], 75: ['❄️', '❄️', 'Heavy snow'], 77: ['🌨️', '🌨️', 'Snow grains'],
    80: ['🌦️', '🌧️', 'Light showers'], 81: ['🌧️', '🌧️', 'Showers'], 82: ['⛈️', '⛈️', 'Violent showers'],
    85: ['🌨️', '🌨️', 'Snow showers'], 86: ['❄️', '❄️', 'Heavy snow showers'],
    95: ['⛈️', '⛈️', 'Thunderstorm'], 96: ['⛈️', '⛈️', 'Thunderstorm with hail'], 99: ['⛈️', '⛈️', 'Severe thunderstorm with hail'],
  };
  const wx = (code, isDay = 1) => { const w = WMO[code] || ['❔', '❔', 'Unknown']; return { icon: isDay ? w[0] : w[1], desc: w[2] }; };

  // UV bands (WHO)
  const UV_BANDS = [
    { max: 2.5, key: 'low', label: 'Low', color: 'var(--low)' },
    { max: 5.5, key: 'mod', label: 'Moderate', color: 'var(--mod)' },
    { max: 7.5, key: 'high', label: 'High', color: 'var(--high)' },
    { max: 10.5, key: 'vhigh', label: 'Very high', color: 'var(--vhigh)' },
    { max: Infinity, key: 'ext', label: 'Extreme', color: 'var(--ext)' },
  ];
  const uvBand = (uv) => UV_BANDS.find((b) => (uv ?? 0) < b.max);

  const compass = (deg) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((deg % 360) / 45)) % 8];
  const dayName = (iso, i) => {
    if (i === 0) return 'Today';
    if (i === 1) return 'Tomorrow';
    return new Date(iso + 'T12:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
  };
  const longDate = (iso) => new Date(iso + 'T12:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const hhmm = (isoLocal) => isoLocal.slice(11, 16);
  const locLabel = (l) => [l.name, l.admin1 && l.admin1 !== l.name ? l.admin1 : null].filter(Boolean).join(', ');

  // ---------- Skin types (Fitzpatrick) ----------
  // MED = minimal erythemal dose in J/m² (erythemally weighted) – typical published values.
  const SKIN = [
    { id: 1, name: 'Type I', desc: 'Very fair, often freckled, red or fair hair. Always burns, never tans.', swatch: '#f7ddd0', med: 200 },
    { id: 2, name: 'Type II', desc: 'Fair skin. Usually burns, tans with difficulty.', swatch: '#efc9a8', med: 250 },
    { id: 3, name: 'Type III', desc: 'Medium / light olive. Sometimes burns, tans gradually.', swatch: '#d9a77e', med: 350 },
    { id: 4, name: 'Type IV', desc: 'Olive or light brown. Rarely burns, tans easily.', swatch: '#b27a50', med: 450 },
    { id: 5, name: 'Type V', desc: 'Brown. Very rarely burns, tans very easily.', swatch: '#7d4e2d', med: 600 },
    { id: 6, name: 'Type VI', desc: 'Dark brown or black. Almost never burns.', swatch: '#4a2c1b', med: 1000 },
  ];

  // UV index 1 = 0.025 W/m² erythemally weighted irradiance
  function burnMinutes(uv, med) {
    if (!uv || uv < 0.5) return Infinity;
    return med / (uv * 0.025) / 60;
  }
  function fmtMins(m) {
    if (!isFinite(m) || m > 300) return '5h+';
    if (m >= 60) { const h = Math.floor(m / 60), r = Math.round(m % 60 / 5) * 5; return r ? `${h}h ${r}m` : `${h}h`; }
    return `${Math.max(5, Math.round(m / 5) * 5)} min`;
  }

  // ---------- API ----------
  async function fetchForecast(loc) {
    const p = new URLSearchParams({
      latitude: loc.latitude,
      longitude: loc.longitude,
      timezone: 'auto',
      forecast_days: FORECAST_DAYS,
      wind_speed_unit: 'mph',
      current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,is_day',
      hourly: 'temperature_2m,weather_code,precipitation_probability,uv_index,uv_index_clear_sky,is_day',
      daily: [
        'weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_probability_max', 'precipitation_sum',
        'wind_speed_10m_max', 'wind_gusts_10m_max', 'wind_direction_10m_dominant', 'uv_index_max', 'uv_index_clear_sky_max',
        'sunrise', 'sunset',
      ].join(','),
    });
    const res = await fetch('https://api.open-meteo.com/v1/forecast?' + p);
    if (!res.ok) throw new Error('Forecast request failed (' + res.status + ')');
    return res.json();
  }

  async function searchPlaces(q) {
    const p = new URLSearchParams({ name: q, count: 8, language: 'en', format: 'json' });
    const res = await fetch('https://geocoding-api.open-meteo.com/v1/search?' + p);
    if (!res.ok) throw new Error('Search failed');
    return (await res.json()).results || [];
  }

  // Slice hourly arrays into one bucket per day
  function hoursForDay(data, dateIso) {
    const h = data.hourly, out = [];
    for (let i = 0; i < h.time.length; i++) {
      if (h.time[i].startsWith(dateIso)) {
        out.push({ time: h.time[i], temp: h.temperature_2m[i], code: h.weather_code[i], rain: h.precipitation_probability[i],
          uv: h.uv_index[i], uvClear: h.uv_index_clear_sky[i], isDay: h.is_day[i] });
      }
    }
    return out;
  }
  function currentUv(data) {
    const hourKey = data.current.time.slice(0, 13);
    const i = data.hourly.time.findIndex((t) => t.startsWith(hourKey));
    return i >= 0 ? data.hourly.uv_index[i] : null;
  }

  // ---------- Rendering ----------
  function renderDayStrip() {
    const d = state.data.daily;
    $('#dayStrip').innerHTML = d.time.map((t, i) => {
      const w = wx(d.weather_code[i]);
      const uv = d.uv_index_max[i], b = uvBand(uv);
      return `<button class="day ${i === state.dayIdx ? 'active' : ''}" data-i="${i}" role="tab" aria-selected="${i === state.dayIdx}">
        <div class="dname">${esc(dayName(t, i))}</div>
        <div class="dico" title="${esc(w.desc)}">${w.icon}</div>
        <div class="dtemp">${round(d.temperature_2m_max[i])}° <span class="lo">${round(d.temperature_2m_min[i])}°</span></div>
        <div class="duv ${b.key}" title="Max UV">UV ${uv == null ? '–' : Math.round(uv)}</div>
      </button>`;
    }).join('');
  }

  function renderWeather() {
    const { data, dayIdx } = state, d = data.daily, c = data.current;

    if (dayIdx === 0) {
      const w = wx(c.weather_code, c.is_day);
      $('#weatherNow').classList.remove('hidden');
      $('#weatherNow').innerHTML = `
        <div class="big-ico">${w.icon}</div>
        <div>
          <div class="big-temp">${round(c.temperature_2m)}°C</div>
          <div class="desc">${esc(w.desc)} · feels like ${round(c.apparent_temperature)}°</div>
          <div class="desc">Wind ${round(c.wind_speed_10m)} mph ${compass(c.wind_direction_10m)} · Humidity ${round(c.relative_humidity_2m)}%</div>
        </div>`;
    } else {
      $('#weatherNow').classList.add('hidden');
    }

    const w = wx(d.weather_code[dayIdx]);
    const farOut = dayIdx >= 7 ? '<p class="muted" style="margin-top:10px">⚠️ More than a week ahead – treat this as a rough guide.</p>' : '';
    $('#weatherDay').innerHTML = `
      <h2>${esc(longDate(d.time[dayIdx]))}</h2>
      <div class="muted">${w.icon} ${esc(w.desc)}</div>
      <div class="stats">
        <div class="stat"><div class="k">High / Low</div><div class="v">${round(d.temperature_2m_max[dayIdx])}° / ${round(d.temperature_2m_min[dayIdx])}°</div></div>
        <div class="stat"><div class="k">Chance of rain</div><div class="v">${round(d.precipitation_probability_max[dayIdx])}%</div></div>
        <div class="stat"><div class="k">Rainfall</div><div class="v">${(d.precipitation_sum[dayIdx] ?? 0).toFixed(1)} mm</div></div>
        <div class="stat"><div class="k">Wind (gusts)</div><div class="v">${round(d.wind_speed_10m_max[dayIdx])} (${round(d.wind_gusts_10m_max[dayIdx])}) mph ${compass(d.wind_direction_10m_dominant[dayIdx])}</div></div>
        <div class="stat"><div class="k">Sunrise</div><div class="v">${hhmm(d.sunrise[dayIdx])}</div></div>
        <div class="stat"><div class="k">Sunset</div><div class="v">${hhmm(d.sunset[dayIdx])}</div></div>
        <div class="stat"><div class="k">Max UV</div><div class="v">${d.uv_index_max[dayIdx] == null ? '–' : d.uv_index_max[dayIdx].toFixed(1)} (${uvBand(d.uv_index_max[dayIdx]).label})</div></div>
      </div>${farOut}`;

    let hours = hoursForDay(data, d.time[dayIdx]);
    if (dayIdx === 0) hours = hours.filter((h) => h.time.slice(0, 13) >= c.time.slice(0, 13));
    $('#weatherHours').innerHTML = hours.map((h) => {
      const hw = wx(h.code, h.isDay);
      return `<div class="hour"><div>${hhmm(h.time)}</div><div class="hico" title="${esc(hw.desc)}">${hw.icon}</div>
        <div><b>${round(h.temp)}°</b></div><div class="hrain">💧${round(h.rain)}%</div></div>`;
    }).join('');
  }

  function renderUv() {
    const { data, dayIdx } = state, d = data.daily;
    const maxUv = d.uv_index_max[dayIdx], clear = d.uv_index_clear_sky_max[dayIdx];
    const b = uvBand(maxUv);
    const hours = hoursForDay(data, d.time[dayIdx]);
    const nowUv = dayIdx === 0 ? currentUv(data) : null;

    // Find the window where UV ≥ 3 (when protection is recommended)
    const protect = hours.filter((h) => (h.uv ?? 0) >= 2.5);
    const protectWindow = protect.length ? `${hhmm(protect[0].time)}–${String(+hhmm(protect[protect.length - 1].time).slice(0, 2) + 1).padStart(2, '0')}:00` : null;

    $('#uvSummary').innerHTML = `
      <div class="uv-hero">
        <div class="uv-badge ${b.key}">${maxUv == null ? '–' : Math.round(maxUv)}</div>
        <div>
          <div class="muted" style="margin:0">${esc(longDate(d.time[dayIdx]))} · peak UV</div>
          <div class="uv-band">${b.label}</div>
          ${nowUv != null ? `<div class="muted" style="margin:2px 0 0">Right now: UV ${nowUv.toFixed(1)} (${uvBand(nowUv).label})</div>` : ''}
        </div>
      </div>
      <div class="stats">
        <div class="stat"><div class="k">Peak (with clouds)</div><div class="v">${maxUv == null ? '–' : maxUv.toFixed(1)}</div></div>
        <div class="stat"><div class="k">Peak if skies clear</div><div class="v">${clear == null ? '–' : clear.toFixed(1)}</div></div>
        <div class="stat"><div class="k">Protection needed</div><div class="v">${protectWindow || 'Not needed'}</div></div>
      </div>
      ${dayIdx >= 7 ? '<p class="muted" style="margin-top:10px">⚠️ UV this far ahead is a rough guide – check again closer to the day.</p>' : ''}`;

    renderUvChart(hours);
  }

  function renderUvChart(hours) {
    // Show 05:00–22:00 only – UV is zero overnight
    const hs = hours.filter((h) => { const hr = +h.time.slice(11, 13); return hr >= 5 && hr <= 21; });
    const W = 680, H = 220, padL = 28, padB = 26, padT = 18;
    const maxY = Math.max(8, Math.ceil(Math.max(...hs.map((h) => Math.max(h.uv ?? 0, h.uvClear ?? 0))) + 1));
    const bw = (W - padL) / hs.length;
    const y = (v) => H - padB - (v / maxY) * (H - padB - padT);

    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Hourly UV index">`;
    for (let g = 0; g <= maxY; g += 2) {
      svg += `<line x1="${padL}" x2="${W}" y1="${y(g)}" y2="${y(g)}" stroke="var(--line)" stroke-width="1"/>`;
      svg += `<text x="${padL - 6}" y="${y(g) + 4}" text-anchor="end">${g}</text>`;
    }
    hs.forEach((h, i) => {
      const x = padL + i * bw + 3, w = bw - 6, uv = h.uv ?? 0;
      const clearUv = h.uvClear ?? 0;
      if (clearUv > uv) svg += `<rect x="${x}" y="${y(clearUv)}" width="${w}" height="${y(0) - y(clearUv)}" rx="4" fill="none" stroke="var(--line)" stroke-dasharray="3 3"/>`;
      svg += `<rect x="${x}" y="${y(uv)}" width="${w}" height="${Math.max(0, y(0) - y(uv))}" rx="4" fill="${uvBand(uv).color}"><title>${hhmm(h.time)} – UV ${uv.toFixed(1)}</title></rect>`;
      if (uv >= 0.5) svg += `<text class="val" x="${x + w / 2}" y="${y(uv) - 4}" text-anchor="middle">${Math.round(uv)}</text>`;
      if (i % 2 === 0) svg += `<text x="${x + w / 2}" y="${H - 8}" text-anchor="middle">${h.time.slice(11, 13)}</text>`;
    });
    svg += '</svg><p class="muted" style="margin:8px 0 0;font-size:.78rem">Dashed outline = UV if the sky were clear.</p>';
    $('#uvChart').innerHTML = svg;
  }

  function renderSkinPicker() {
    $('#skinTypes').innerHTML = SKIN.map((s) => `
      <button class="skin ${state.skin === s.id ? 'active' : ''}" data-skin="${s.id}">
        <span class="swatch" style="background:${s.swatch}"></span>
        <span><div class="t">${s.name}</div><div class="d">${esc(s.desc)}</div></span>
      </button>`).join('');
  }

  function adviceFor(uv, skin) {
    const b = uvBand(uv).key, tips = [];
    if (b === 'low') {
      tips.push('Minimal protection needed for most people.');
      tips.push('Wear sunglasses on bright days. Snow and water reflect UV, so take care there.');
      if (skin <= 2) tips.push('Very fair skin can still burn over a long day outdoors – use SPF 30 if you\'ll be out for hours.');
    } else {
      tips.push('Apply broad-spectrum sunscreen, <b>SPF 30 or higher</b> with 4–5 star UVA rating, 15–30 minutes before going out.');
      tips.push('Use plenty (about 2 teaspoons for head, arms and neck) and <b>reapply every 2 hours</b> and after swimming, sweating or towelling.');
      tips.push('Wear a wide-brimmed hat and UV-protective (UV400) sunglasses.');
      if (b !== 'mod' || skin <= 2) tips.push('Seek shade between <b>11am and 3pm</b>, when UV is strongest.');
      if (b === 'high' || b === 'vhigh' || b === 'ext') tips.push('Cover up with loose clothing that has a close weave – a T-shirt alone isn\'t enough at these levels.');
      if (b === 'vhigh' || b === 'ext') tips.push('Avoid being out in the midday sun where you can. Unprotected skin can burn quickly.');
      if (b === 'ext') tips.push('Take every precaution – stay indoors or in deep shade around midday.');
      if (skin >= 5) tips.push('Darker skin has more natural protection but still gets UV damage and skin cancer – protect yourself at high UV.');
      tips.push('Keep babies under 6 months out of direct sun. Children burn faster than adults.');
    }
    tips.push('Drink plenty of water – hot sunny days dehydrate you faster than you think.');
    return tips;
  }

  function renderSafety() {
    renderSkinPicker();
    const out = $('#safetyResult');
    if (!state.skin) { out.innerHTML = '<div class="card muted">Choose a skin type above to see how long you can stay in the sun.</div>'; return; }
    if (!state.data) { out.innerHTML = ''; return; }

    const s = SKIN.find((k) => k.id === state.skin);
    const d = state.data.daily, i = state.dayIdx;
    const peak = d.uv_index_max[i];
    const nowUv = i === 0 ? currentUv(state.data) : null;
    const peakMins = burnMinutes(peak, s.med);
    const nowMins = nowUv != null ? burnMinutes(nowUv, s.med) : null;
    const b = uvBand(peak);

    out.innerHTML = `
      <div class="card">
        <h2>${esc(longDate(d.time[i]))} · ${esc(locLabel(state.loc))}</h2>
        <div class="muted">Skin ${s.name} · Peak UV ${peak == null ? '–' : peak.toFixed(1)} <span class="uv-legend"><span class="b ${b.key}">${b.label}</span></span></div>
        <div class="burn">
          <div class="box"><div class="k">Time to burn at peak UV (no protection)</div><div class="v">${fmtMins(peakMins)}</div></div>
          ${nowMins != null
            ? `<div class="box"><div class="k">Time to burn right now (UV ${nowUv.toFixed(1)})</div><div class="v">${fmtMins(nowMins)}</div></div>`
            : `<div class="box"><div class="k">Sunscreen</div><div class="v" style="font-size:1rem">${peak >= 2.5 ? 'Needed' : 'Optional'}</div></div>`}
        </div>
        <h3 style="margin:16px 0 4px;font-size:1rem">What you should do</h3>
        <ul class="advice">${adviceFor(peak, s.id).map((t) => `<li>${t}</li>`).join('')}</ul>
        <p class="muted" style="margin-top:12px;font-size:.8rem">Sunscreen extends this time, but most people apply too little to get the label SPF. Don't use sunscreen as a reason to stay out longer.</p>
      </div>`;
    // Tip: the day strip at the top lets you check other days
  }

  function render() {
    if (!state.data) return;
    $('#locName').textContent = locLabel(state.loc);
    renderDayStrip();
    if (state.view === 'weather') renderWeather();
    if (state.view === 'uv') renderUv();
    if (state.view === 'safety') renderSafety();
  }

  function setStatus(msg) {
    const el = $('#status');
    if (!msg) { el.classList.add('hidden'); return; }
    el.textContent = msg; el.classList.remove('hidden');
  }

  async function load() {
    $('#locName').textContent = locLabel(state.loc);
    setStatus('Loading forecast…');
    try {
      state.data = await fetchForecast(state.loc);
      state.dayIdx = Math.min(state.dayIdx, state.data.daily.time.length - 1);
      setStatus('');
      render();
    } catch (e) {
      console.error(e);
      setStatus('Couldn\'t load the forecast. Check your connection and try again.');
    }
  }

  // ---------- Events ----------
  function switchView(v) {
    state.view = v;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === v));
    ['weather', 'uv', 'safety'].forEach((k) => $('#view-' + k).classList.toggle('hidden', k !== v));
    render();
    window.scrollTo({ top: 0 });
  }

  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchView(t.dataset.view)));

  $('#dayStrip').addEventListener('click', (e) => {
    const btn = e.target.closest('.day'); if (!btn) return;
    state.dayIdx = +btn.dataset.i; render();
  });

  $('#skinTypes').addEventListener('click', (e) => {
    const btn = e.target.closest('.skin'); if (!btn) return;
    state.skin = +btn.dataset.skin; store.set('skin', state.skin); renderSafety();
  });

  // Location sheet
  const sheet = $('#locSheet'), input = $('#locInput'), results = $('#locResults');
  let lastResults = [], timer;
  const openSheet = () => { sheet.classList.remove('hidden'); input.value = ''; results.innerHTML = ''; setTimeout(() => input.focus(), 50); };
  const closeSheet = () => sheet.classList.add('hidden');
  const chooseLoc = (loc) => { state.loc = loc; store.set('loc', loc); state.dayIdx = 0; closeSheet(); load(); };

  $('#locChip').addEventListener('click', openSheet);
  $('#locClose').addEventListener('click', closeSheet);
  sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { results.innerHTML = ''; return; }
    timer = setTimeout(async () => {
      try {
        lastResults = await searchPlaces(q);
        results.innerHTML = lastResults.length
          ? lastResults.map((r, i) => `<li><button data-i="${i}"><b>${esc(r.name)}</b><br><small>${esc([r.admin1, r.country].filter(Boolean).join(', '))}</small></button></li>`).join('')
          : '<li class="muted" style="padding:12px 6px">No places found.</li>';
      } catch { results.innerHTML = '<li class="muted" style="padding:12px 6px">Search failed – try again.</li>'; }
    }, 300);
  });
  results.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-i]'); if (!btn) return;
    const r = lastResults[+btn.dataset.i];
    chooseLoc({ name: r.name, admin1: r.admin1, country: r.country, latitude: r.latitude, longitude: r.longitude });
  });

  $('#geoBtn').addEventListener('click', () => {
    if (!navigator.geolocation) { alert('Location isn\'t available on this device.'); return; }
    $('#geoBtn').textContent = '📍 Finding you…';
    navigator.geolocation.getCurrentPosition(
      (pos) => { $('#geoBtn').textContent = '📍 Use my current location'; chooseLoc({ name: 'My location', latitude: +pos.coords.latitude.toFixed(4), longitude: +pos.coords.longitude.toFixed(4) }); },
      () => { $('#geoBtn').textContent = '📍 Use my current location'; alert('Couldn\'t get your location – search for a place instead.'); },
      { timeout: 10000 },
    );
  });

  load();
})();
