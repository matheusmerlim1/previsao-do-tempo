// ===== Weather Code Mappings =====
const WMO_CODES = {
  0:  { desc: 'Céu limpo',              icon: '☀️' },
  1:  { desc: 'Majoritariamente limpo', icon: '🌤️' },
  2:  { desc: 'Parcialmente nublado',   icon: '⛅' },
  3:  { desc: 'Nublado',                icon: '☁️' },
  45: { desc: 'Neblina',                icon: '🌫️' },
  48: { desc: 'Neblina com geada',      icon: '🌫️' },
  51: { desc: 'Chuvisco leve',          icon: '🌦️' },
  53: { desc: 'Chuvisco moderado',      icon: '🌦️' },
  55: { desc: 'Chuvisco intenso',       icon: '🌧️' },
  61: { desc: 'Chuva leve',             icon: '🌧️' },
  63: { desc: 'Chuva moderada',         icon: '🌧️' },
  65: { desc: 'Chuva forte',            icon: '🌧️' },
  71: { desc: 'Neve leve',              icon: '🌨️' },
  73: { desc: 'Neve moderada',          icon: '❄️' },
  75: { desc: 'Neve forte',             icon: '❄️' },
  77: { desc: 'Granizo',                icon: '🌨️' },
  80: { desc: 'Pancadas leves',         icon: '🌦️' },
  81: { desc: 'Pancadas moderadas',     icon: '⛈️' },
  82: { desc: 'Pancadas fortes',        icon: '⛈️' },
  85: { desc: 'Neve em pancadas',       icon: '🌨️' },
  86: { desc: 'Neve forte em pancadas', icon: '❄️' },
  95: { desc: 'Tempestade',             icon: '⛈️' },
  96: { desc: 'Tempestade c/ granizo',  icon: '⛈️' },
  99: { desc: 'Tempestade c/ granizo forte', icon: '⛈️' },
};

const WIND_DIRECTIONS = ['N','NNE','NE','ENE','L','ESE','SE','SSE','S','SSO','SO','OSO','O','ONO','NO','NNO'];

// ===== Utilities =====
function getWMO(code) {
  return WMO_CODES[code] || { desc: 'Desconhecido', icon: '🌡️' };
}

function degToCompass(deg) {
  return WIND_DIRECTIONS[Math.round(deg / 22.5) % 16];
}

function formatDate(dateStr, opts = {}) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('pt-BR', opts);
}

function formatHour(isoStr) {
  return new Date(isoStr).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function getTempClass(temp) {
  if (temp < 5)  return 'temp-frozen';
  if (temp < 15) return 'temp-cold';
  if (temp < 25) return 'temp-cool';
  if (temp < 32) return 'temp-warm';
  return 'temp-hot';
}

// ===== Geolocation =====

// Tries browser GPS first, then reverse-geocodes via Nominatim
async function getLocationByBrowser() {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Geolocalização não suportada'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async pos => {
        const { latitude: lat, longitude: lon } = pos.coords;
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=pt`
          );
          const data = await res.json();
          const addr = data.address || {};
          resolve({
            city: addr.city || addr.town || addr.village || addr.county || 'Minha Localização',
            region: addr.state || '',
            country: addr.country || '',
            lat, lon,
          });
        } catch {
          resolve({ city: 'Minha Localização', region: '', country: '', lat, lon });
        }
      },
      () => reject(new Error('Permissão de localização negada')),
      { timeout: 8000, maximumAge: 300000 }
    );
  });
}

// HTTPS-only IP geolocation with two-provider fallback
async function getLocationByIP() {
  // Primary: ipapi.co — HTTPS, sem chave
  try {
    const res = await fetch('https://ipapi.co/json/');
    if (res.ok) {
      const d = await res.json();
      if (d.latitude && d.longitude && !d.error) {
        return {
          city:    d.city         || 'Desconhecida',
          region:  d.region       || '',
          country: d.country_name || '',
          lat: d.latitude,
          lon: d.longitude,
        };
      }
    }
  } catch { /* segue para fallback */ }

  // Fallback: freeipapi.com — HTTPS, sem chave
  const res2 = await fetch('https://freeipapi.com/api/json/');
  if (!res2.ok) throw new Error('Falha ao obter localização pelo IP');
  const d2 = await res2.json();
  if (!d2.latitude) throw new Error('Localização não encontrada via IP');
  return {
    city:    (d2.cityName   && d2.cityName   !== 'Not Available') ? d2.cityName   : 'Desconhecida',
    region:  (d2.regionName && d2.regionName !== 'Not Available') ? d2.regionName : '',
    country: d2.countryName || '',
    lat: d2.latitude,
    lon: d2.longitude,
  };
}

async function searchCity(query) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=pt&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Falha na busca por cidade');
  const data = await res.json();
  if (!data.results || data.results.length === 0) throw new Error(`Cidade "${query}" não encontrada`);
  const r = data.results[0];
  return { city: r.name, region: r.admin1 || '', country: r.country || '', lat: r.latitude, lon: r.longitude };
}

async function fetchWeather(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat, longitude: lon,
    current: [
      'temperature_2m','apparent_temperature','weather_code',
      'relative_humidity_2m','wind_speed_10m','wind_direction_10m',
      'precipitation','surface_pressure','visibility',
    ].join(','),
    hourly: [
      'temperature_2m','weather_code','precipitation_probability',
      'precipitation','wind_speed_10m',
    ].join(','),
    daily: [
      'weather_code','temperature_2m_max','temperature_2m_min',
      'precipitation_sum','precipitation_probability_max',
      'wind_speed_10m_max','wind_gusts_10m_max','wind_direction_10m_dominant',
    ].join(','),
    timezone: 'auto',
    forecast_days: 7,
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error('Falha ao obter dados meteorológicos');
  return res.json();
}

// ===== Alert Detection =====
function detectAlerts(daily) {
  const alerts = [];
  for (let i = 0; i < daily.time.length; i++) {
    const date  = formatDate(daily.time[i], { weekday: 'long', day: 'numeric', month: 'long' });
    const gust  = daily.wind_gusts_10m_max[i];
    const precip = daily.precipitation_sum[i];
    const code  = daily.weather_code[i];
    const wmo   = getWMO(code);

    if (gust >= 90)
      alerts.push({ type: 'danger', icon: '🌪️', title: `Rajadas muito fortes — ${date}`, msg: `Rajadas de até ${gust.toFixed(0)} km/h previstas. Evite áreas abertas.` });
    else if (gust >= 60)
      alerts.push({ type: 'warn',   icon: '💨', title: `Vento forte — ${date}`,          msg: `Rajadas de até ${gust.toFixed(0)} km/h previstas.` });

    if (precip >= 50)
      alerts.push({ type: 'danger', icon: '🌊', title: `Chuva muito intensa — ${date}`,  msg: `${precip.toFixed(0)} mm acumulados previstos. Risco de alagamentos.` });
    else if (precip >= 20)
      alerts.push({ type: 'warn',   icon: '🌧️', title: `Chuva intensa — ${date}`,        msg: `${precip.toFixed(0)} mm acumulados previstos.` });

    if ([95, 96, 99].includes(code))
      alerts.push({ type: 'danger', icon: '⛈️', title: `Tempestade prevista — ${date}`,  msg: `${wmo.desc}. Evite áreas abertas.` });
  }
  return alerts;
}

// ===== Weather Theme =====
function setWeatherTheme(code) {
  if (typeof document === 'undefined') return;
  const themes = {
    clear:  [0, 1],
    cloudy: [2, 3],
    fog:    [45, 48],
    rain:   [51, 53, 55, 61, 63, 65, 80, 81, 82],
    storm:  [95, 96, 99],
    snow:   [71, 73, 75, 77, 85, 86],
  };
  let theme = 'default';
  for (const [name, codes] of Object.entries(themes)) {
    if (codes.includes(code)) { theme = name; break; }
  }
  document.body.setAttribute('data-weather', theme);
}

// ===== Render =====
function renderCurrent(location, weather) {
  const c = weather.current;
  const wmo = getWMO(c.weather_code);
  setWeatherTheme(c.weather_code);

  document.getElementById('cityName').textContent = location.city;
  document.getElementById('countryName').textContent = [location.region, location.country].filter(Boolean).join(', ');
  document.getElementById('lastUpdated').textContent =
    'Atualizado: ' + new Date(c.time).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  document.getElementById('weatherIcon').textContent = wmo.icon;
  const tempEl = document.getElementById('currentTemp');
  tempEl.textContent = `${Math.round(c.temperature_2m)}°C`;
  tempEl.className = `current-temp ${getTempClass(c.temperature_2m)}`;

  document.getElementById('feelsLike').textContent   = `Sensação ${Math.round(c.apparent_temperature)}°C`;
  document.getElementById('weatherDesc').textContent = wmo.desc;

  document.getElementById('humidity').textContent  = `${c.relative_humidity_2m}%`;
  document.getElementById('windSpeed').textContent = `${Math.round(c.wind_speed_10m)} km/h`;
  document.getElementById('windDir').textContent   = degToCompass(c.wind_direction_10m);
  document.getElementById('rainNow').textContent   = `${(c.precipitation || 0).toFixed(1)} mm`;
  document.getElementById('visibility').textContent = c.visibility != null
    ? `${(c.visibility / 1000).toFixed(1)} km` : '--';
  document.getElementById('pressure').textContent = c.surface_pressure != null
    ? `${Math.round(c.surface_pressure)} hPa` : '--';
}

function renderHourly(weather) {
  const now = new Date();
  const times = weather.hourly.time;
  const container = document.getElementById('hourlyForecast');
  container.innerHTML = '';
  let count = 0;
  for (let i = 0; i < times.length && count < 24; i++) {
    const t = new Date(times[i]);
    if (t < now - 30 * 60 * 1000) continue;
    count++;
    const wmo    = getWMO(weather.hourly.weather_code[i]);
    const isNow  = count === 1;
    const prob   = weather.hourly.precipitation_probability[i] || 0;
    const temp   = Math.round(weather.hourly.temperature_2m[i]);
    const el     = document.createElement('div');
    el.className = `hourly-item${isNow ? ' now' : ''}`;
    el.innerHTML = `
      <span class="h-time">${isNow ? 'Agora' : formatHour(times[i])}</span>
      <span class="h-icon">${wmo.icon}</span>
      <span class="h-temp ${getTempClass(temp)}">${temp}°</span>
      <span class="h-rain">${prob > 0 ? `💧${prob}%` : '—'}</span>
    `;
    container.appendChild(el);
  }
}

function renderRainChart(weather) {
  const daily = weather.daily;
  const container = document.getElementById('rainChart');
  container.innerHTML = '';
  const maxRain = Math.max(...daily.precipitation_sum, 1);
  daily.time.forEach((date, i) => {
    const rain = daily.precipitation_sum[i] || 0;
    const prob = daily.precipitation_probability_max[i] || 0;
    const pct  = clamp((rain / maxRain) * 100, 0, 100);
    const label = i === 0 ? 'Hoje' : formatDate(date, { weekday: 'short' });
    const row   = document.createElement('div');
    row.className = 'rain-bar-row';
    row.innerHTML = `
      <span class="rain-bar-label">${label}<span class="rain-prob">${prob}%</span></span>
      <div class="rain-bar-track">
        <div class="rain-bar-fill" style="width:${pct}%"></div>
      </div>
      <span class="rain-bar-value">${rain.toFixed(1)} mm</span>
    `;
    container.appendChild(row);
  });
}

function renderDaily(weather) {
  const daily = weather.daily;
  const container = document.getElementById('dailyForecast');
  container.innerHTML = '';
  daily.time.forEach((date, i) => {
    const wmo      = getWMO(daily.weather_code[i]);
    const dayLabel = i === 0 ? 'Hoje' : i === 1 ? 'Amanhã' : formatDate(date, { weekday: 'long' });
    const prob     = daily.precipitation_probability_max[i] || 0;
    const maxT     = Math.round(daily.temperature_2m_max[i]);
    const minT     = Math.round(daily.temperature_2m_min[i]);
    const el       = document.createElement('div');
    el.className   = 'daily-item';
    el.innerHTML   = `
      <span class="day-name">${dayLabel}</span>
      <span class="day-icon">${wmo.icon}</span>
      <span class="day-desc">${wmo.desc}${prob > 20 ? `<span class="day-prob">💧${prob}%</span>` : ''}</span>
      <div class="day-temps">
        <span class="day-max ${getTempClass(maxT)}">${maxT}°</span>
        <span class="day-min">${minT}°</span>
      </div>
    `;
    container.appendChild(el);
  });
}

function renderWind(weather) {
  const daily = weather.daily;
  const container = document.getElementById('windForecast');
  container.innerHTML = '';
  const maxWind = Math.max(...daily.wind_speed_10m_max, 1);
  daily.time.forEach((date, i) => {
    const speed    = daily.wind_speed_10m_max[i] || 0;
    const gusts    = daily.wind_gusts_10m_max[i] || 0;
    const dir      = daily.wind_direction_10m_dominant[i] || 0;
    const pct      = clamp((speed / maxWind) * 100, 0, 100);
    const dayLabel = i === 0 ? 'Hoje' : i === 1 ? 'Amanhã' : formatDate(date, { weekday: 'short', day: 'numeric' });
    const compass  = degToCompass(dir);
    const row      = document.createElement('div');
    row.className  = 'wind-row';
    row.innerHTML  = `
      <span class="wind-day">${dayLabel}</span>
      <span class="wind-arrow" style="transform:rotate(${dir}deg)" title="${compass}">↑</span>
      <div class="wind-bar-track">
        <div class="wind-bar-fill" style="width:${pct}%"></div>
      </div>
      <span class="wind-speed">${Math.round(speed)} km/h</span>
      <span class="wind-gusts">↑${Math.round(gusts)}</span>
    `;
    container.appendChild(row);
  });
}

function renderAlerts(alerts) {
  const section = document.getElementById('alertsSection');
  const list    = document.getElementById('alertsList');
  list.innerHTML = '';
  if (alerts.length === 0) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');
  alerts.forEach((a, idx) => {
    const el = document.createElement('div');
    el.className = `alert-card ${a.type}`;
    el.style.animationDelay = `${idx * 0.1}s`;
    el.innerHTML = `
      <span class="alert-icon">${a.icon}</span>
      <div class="alert-text">
        <strong>${a.title}</strong>
        <p>${a.msg}</p>
      </div>
    `;
    list.appendChild(el);
  });
}

// ===== UI State =====
function showLoading(msg = 'Carregando...') {
  document.getElementById('loadingState').classList.remove('hidden');
  document.getElementById('loadingState').querySelector('p').textContent = msg;
  document.getElementById('errorState').classList.add('hidden');
  document.getElementById('weatherContent').classList.add('hidden');
}

function showError(title, msg) {
  document.getElementById('loadingState').classList.add('hidden');
  document.getElementById('errorState').classList.remove('hidden');
  document.getElementById('weatherContent').classList.add('hidden');
  document.getElementById('errorTitle').textContent = title;
  document.getElementById('errorMsg').textContent   = msg;
}

function showWeather() {
  document.getElementById('loadingState').classList.add('hidden');
  document.getElementById('errorState').classList.add('hidden');
  const content = document.getElementById('weatherContent');
  content.classList.remove('hidden');
  content.classList.add('animate-in');
}

// ===== Main Load =====
async function loadWeather(location) {
  showLoading('Buscando previsão do tempo...');
  try {
    const weather = await fetchWeather(location.lat, location.lon);
    renderAlerts(detectAlerts(weather.daily));
    renderCurrent(location, weather);
    renderHourly(weather);
    renderRainChart(weather);
    renderDaily(weather);
    renderWind(weather);
    showWeather();
  } catch (err) {
    showError('Erro ao carregar previsão', err.message);
  }
}

async function loadFromIP() {
  showLoading('Detectando sua localização...');
  let location;

  // 1. Tenta GPS do browser (mais preciso)
  try {
    location = await getLocationByBrowser();
  } catch {
    // 2. Fallback: geolocalização por IP (HTTPS)
    try {
      location = await getLocationByIP();
    } catch (err) {
      showError('Localização não detectada', err.message + '. Use a barra de busca para encontrar sua cidade.');
      return;
    }
  }
  await loadWeather(location);
}

async function loadFromSearch(query) {
  if (!query.trim()) return;
  showLoading(`Buscando "${query}"...`);
  try {
    const location = await searchCity(query);
    await loadWeather(location);
  } catch (err) {
    showError('Cidade não encontrada', err.message);
  }
}

// ===== Browser Init =====
if (typeof document !== 'undefined') {
  document.getElementById('searchBtn').addEventListener('click', () => {
    loadFromSearch(document.getElementById('cityInput').value);
  });

  document.getElementById('cityInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') loadFromSearch(e.target.value);
  });

  document.getElementById('locationBtn').addEventListener('click', loadFromIP);
  document.getElementById('retryBtn').addEventListener('click', loadFromIP);

  loadFromIP();
}

// ===== Exports for tests =====
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getWMO, degToCompass, formatDate, formatHour, clamp, getTempClass,
    detectAlerts, getLocationByIP, fetchWeather, searchCity,
  };
}
