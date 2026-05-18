/**
 * Testes — Previsão do Tempo
 * Cobre: utilitários, alertas, geolocalização por IP e chamadas à API
 */

const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

global.fetch = jest.fn();

const {
  getWMO, degToCompass, formatDate, formatHour, clamp, getTempClass,
  detectAlerts, getLocationByIP, fetchWeather, searchCity,
} = require('../app');

// ===== Helpers =====
function mockFetchJson(data, ok = true) {
  global.fetch.mockResolvedValueOnce({ ok, json: async () => data });
}

function mockFetchFail() {
  global.fetch.mockRejectedValueOnce(new Error('Network error'));
}

// ===== Mock Data =====
const MOCK_IPAPI_OK = {
  city: 'São Paulo', region: 'São Paulo',
  country_name: 'Brazil', latitude: -23.5505, longitude: -46.6333,
};

const MOCK_FREEIPAPI_OK = {
  cityName: 'São Paulo', regionName: 'São Paulo',
  countryName: 'Brazil', latitude: -23.5505, longitude: -46.6333,
};

const MOCK_GEOCODING = {
  results: [{ name: 'Rio de Janeiro', admin1: 'Rio de Janeiro', country: 'Brazil', latitude: -22.9068, longitude: -43.1729 }],
};

const MOCK_WEATHER = {
  current: {
    time: '2026-05-18T14:00',
    temperature_2m: 25.3, apparent_temperature: 27.1,
    weather_code: 2, relative_humidity_2m: 68,
    wind_speed_10m: 15.4, wind_direction_10m: 135,
    precipitation: 0.0, surface_pressure: 1013.2, visibility: 10000,
  },
  hourly: {
    time: Array.from({ length: 48 }, (_, i) => `2026-05-18T${String(i % 24).padStart(2,'0')}:00`),
    temperature_2m: Array(48).fill(22),
    weather_code: Array(48).fill(2),
    precipitation_probability: Array(48).fill(10),
    precipitation: Array(48).fill(0),
    wind_speed_10m: Array(48).fill(12),
  },
  daily: {
    time:                       ['2026-05-18','2026-05-19','2026-05-20','2026-05-21','2026-05-22','2026-05-23','2026-05-24'],
    weather_code:               [2,  63, 95, 61,  0,  1,  3],
    temperature_2m_max:         [28, 24, 22, 26, 30, 29, 27],
    temperature_2m_min:         [18, 17, 16, 18, 20, 19, 17],
    precipitation_sum:          [0,  12, 55,  8,  0,  0,  2],
    precipitation_probability_max: [5, 80, 95, 60, 5, 10, 20],
    wind_speed_10m_max:         [20, 35, 65, 25, 15, 18, 22],
    wind_gusts_10m_max:         [30, 50, 95, 40, 20, 25, 35],
    wind_direction_10m_dominant:[90,135,180, 90, 45, 60,120],
  },
};

// ============================================================
// BLOCO 1: Utilitários
// ============================================================
describe('Utilitários', () => {
  describe('getWMO', () => {
    test('código 0 → céu limpo / ☀️',    () => { const r = getWMO(0);   expect(r.desc).toBe('Céu limpo');  expect(r.icon).toBe('☀️'); });
    test('código 95 → tempestade / ⛈️',  () => { const r = getWMO(95);  expect(r.desc).toBe('Tempestade'); expect(r.icon).toBe('⛈️'); });
    test('código desconhecido → fallback', () => { const r = getWMO(999); expect(r.desc).toBe('Desconhecido'); expect(r.icon).toBe('🌡️'); });

    test('todos os códigos principais retornam desc válida', () => {
      [0,1,2,3,45,48,51,53,55,61,63,65,71,73,75,77,80,81,82,85,86,95,96,99].forEach(c => {
        expect(getWMO(c).desc).not.toBe('Desconhecido');
      });
    });
  });

  describe('degToCompass', () => {
    test.each([
      [0,   'N'],  [45,  'NE'], [90,  'L'],
      [135, 'SE'], [180, 'S'],  [225, 'SO'],
      [270, 'O'],  [315, 'NO'], [360, 'N'],
    ])('%i° → %s', (deg, expected) => expect(degToCompass(deg)).toBe(expected));
  });

  describe('clamp', () => {
    test.each([
      [50,  0, 100, 50],
      [-5,  0, 100,  0],
      [200, 0, 100, 100],
      [0,   0, 100,  0],
      [100, 0, 100, 100],
    ])('clamp(%i,%i,%i) = %i', (v,min,max,exp) => expect(clamp(v,min,max)).toBe(exp));
  });

  describe('getTempClass', () => {
    test.each([
      [-5,  'temp-frozen'],
      [3,   'temp-frozen'],
      [10,  'temp-cold'],
      [18,  'temp-cool'],
      [26,  'temp-warm'],
      [35,  'temp-hot'],
    ])('%i°C → %s', (t, cls) => expect(getTempClass(t)).toBe(cls));
  });

  describe('formatDate', () => {
    test('formata data em pt-BR', () => {
      const r = formatDate('2026-05-18', { day: 'numeric', month: 'long' });
      expect(r).toMatch(/18/);
    });
    test('retorna string não vazia', () => {
      expect(formatDate('2026-05-18', { weekday: 'long' }).length).toBeGreaterThan(0);
    });
  });

  describe('formatHour', () => {
    test('retorna HH:MM', () => expect(formatHour('2026-05-18T14:30:00')).toMatch(/\d{2}:\d{2}/));
  });
});

// ============================================================
// BLOCO 2: detectAlerts
// ============================================================
describe('detectAlerts', () => {
  const base = { time: ['2026-05-18'], weather_code: [2], precipitation_sum: [0], wind_gusts_10m_max: [20] };

  test('sem alertas com condições normais', () => expect(detectAlerts(base)).toHaveLength(0));

  test('alerta warn de vento forte (≥60 km/h)', () => {
    const d = { ...base, wind_gusts_10m_max: [65] };
    const a = detectAlerts(d);
    expect(a.some(x => x.type === 'warn' && x.icon === '💨')).toBe(true);
  });

  test('alerta danger de rajadas extremas (≥90 km/h)', () => {
    const d = { ...base, wind_gusts_10m_max: [95] };
    expect(detectAlerts(d).some(x => x.type === 'danger' && x.icon === '🌪️')).toBe(true);
  });

  test('alerta warn de chuva intensa (≥20 mm)', () => {
    const d = { ...base, precipitation_sum: [25] };
    expect(detectAlerts(d).some(x => x.icon === '🌧️')).toBe(true);
  });

  test('alerta danger de chuva muito intensa (≥50 mm)', () => {
    const d = { ...base, precipitation_sum: [60] };
    expect(detectAlerts(d).some(x => x.type === 'danger' && x.icon === '🌊')).toBe(true);
  });

  test('alerta danger de tempestade (código 95)', () => {
    const d = { ...base, weather_code: [95] };
    expect(detectAlerts(d).some(x => x.type === 'danger' && x.icon === '⛈️')).toBe(true);
  });

  test('tempestade com granizo (código 96 e 99)', () => {
    [96, 99].forEach(code => {
      const d = { ...base, weather_code: [code] };
      expect(detectAlerts(d).some(x => x.icon === '⛈️')).toBe(true);
    });
  });

  test('múltiplos alertas em 7 dias (mock realista)', () => {
    expect(detectAlerts(MOCK_WEATHER.daily).length).toBeGreaterThanOrEqual(3);
  });

  test('mensagem do alerta contém valor numérico', () => {
    const d = { ...base, wind_gusts_10m_max: [95] };
    expect(detectAlerts(d)[0].msg).toMatch(/\d+/);
  });

  test('alerta contém campos obrigatórios (type, icon, title, msg)', () => {
    const d = { ...base, wind_gusts_10m_max: [95] };
    const a = detectAlerts(d)[0];
    expect(a).toHaveProperty('type');
    expect(a).toHaveProperty('icon');
    expect(a).toHaveProperty('title');
    expect(a).toHaveProperty('msg');
  });
});

// ============================================================
// BLOCO 3: getLocationByIP  (ipapi.co + fallback freeipapi.com)
// ============================================================
describe('getLocationByIP', () => {
  beforeEach(() => global.fetch.mockClear());

  test('retorna localização correta via ipapi.co', async () => {
    mockFetchJson(MOCK_IPAPI_OK);
    const loc = await getLocationByIP();
    expect(loc.city).toBe('São Paulo');
    expect(loc.lat).toBe(-23.5505);
    expect(loc.lon).toBe(-46.6333);
    expect(loc.country).toBe('Brazil');
  });

  test('cai para freeipapi.com quando ipapi.co falha (HTTP não-OK)', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_FREEIPAPI_OK });
    const loc = await getLocationByIP();
    expect(loc.city).toBe('São Paulo');
    expect(loc.lat).toBe(-23.5505);
  });

  test('cai para freeipapi.com quando ipapi.co retorna erro JSON', async () => {
    mockFetchJson({ error: true, reason: 'RateLimited' });
    mockFetchJson(MOCK_FREEIPAPI_OK);
    const loc = await getLocationByIP();
    expect(loc.lat).toBe(-23.5505);
  });

  test('cai para freeipapi.com quando ipapi.co lança erro de rede', async () => {
    mockFetchFail();
    mockFetchJson(MOCK_FREEIPAPI_OK);
    const loc = await getLocationByIP();
    expect(loc.city).toBe('São Paulo');
  });

  test('lança erro quando ambos os provedores falham (HTTP)', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    await expect(getLocationByIP()).rejects.toThrow('Falha ao obter localização pelo IP');
  });

  test('lança erro quando freeipapi retorna sem latitude', async () => {
    mockFetchJson({ error: true });
    mockFetchJson({ countryName: 'Brazil' });
    await expect(getLocationByIP()).rejects.toThrow('Localização não encontrada via IP');
  });

  test('URL da primeira chamada contém ipapi.co', async () => {
    mockFetchJson(MOCK_IPAPI_OK);
    await getLocationByIP();
    expect(global.fetch.mock.calls[0][0]).toContain('ipapi.co');
  });

  test('substitui cityName "Not Available" por "Desconhecida"', async () => {
    mockFetchFail();
    mockFetchJson({ cityName: 'Not Available', regionName: 'Not Available', countryName: 'Brazil', latitude: -23.5, longitude: -46.6 });
    const loc = await getLocationByIP();
    expect(loc.city).toBe('Desconhecida');
    expect(loc.region).toBe('');
  });
});

// ============================================================
// BLOCO 4: searchCity
// ============================================================
describe('searchCity', () => {
  beforeEach(() => global.fetch.mockClear());

  test('retorna cidade com coordenadas corretas', async () => {
    mockFetchJson(MOCK_GEOCODING);
    const loc = await searchCity('Rio de Janeiro');
    expect(loc.city).toBe('Rio de Janeiro');
    expect(loc.lat).toBe(-22.9068);
    expect(loc.lon).toBe(-43.1729);
  });

  test('lança erro quando resultados vazios', async () => {
    mockFetchJson({ results: [] });
    await expect(searchCity('xyzxyz')).rejects.toThrow('não encontrada');
  });

  test('lança erro quando results ausente', async () => {
    mockFetchJson({});
    await expect(searchCity('teste')).rejects.toThrow('não encontrada');
  });

  test('lança erro de rede', async () => {
    mockFetchFail();
    await expect(searchCity('Curitiba')).rejects.toThrow('Network error');
  });

  test('lança erro HTTP não-OK', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    await expect(searchCity('Fortaleza')).rejects.toThrow('Falha na busca por cidade');
  });

  test('URL contém geocoding-api.open-meteo.com', async () => {
    mockFetchJson(MOCK_GEOCODING);
    await searchCity('São Paulo');
    expect(global.fetch.mock.calls[0][0]).toContain('geocoding-api.open-meteo.com');
  });
});

// ============================================================
// BLOCO 5: fetchWeather
// ============================================================
describe('fetchWeather', () => {
  beforeEach(() => global.fetch.mockClear());

  test('retorna objeto com current, hourly e daily', async () => {
    mockFetchJson(MOCK_WEATHER);
    const d = await fetchWeather(-23.55, -46.63);
    expect(d.current).toBeDefined();
    expect(d.hourly).toBeDefined();
    expect(d.daily).toBeDefined();
  });

  test('current contém campos obrigatórios', async () => {
    mockFetchJson(MOCK_WEATHER);
    const { current: c } = await fetchWeather(-23.55, -46.63);
    ['temperature_2m','weather_code','wind_speed_10m','relative_humidity_2m'].forEach(f => {
      expect(c[f]).toBeDefined();
    });
  });

  test('daily contém 7 dias', async () => {
    mockFetchJson(MOCK_WEATHER);
    const d = await fetchWeather(-23.55, -46.63);
    expect(d.daily.time).toHaveLength(7);
  });

  test('daily contém campos de precipitação e vento', async () => {
    mockFetchJson(MOCK_WEATHER);
    const { daily } = await fetchWeather(-23.55, -46.63);
    ['precipitation_sum','precipitation_probability_max',
     'wind_speed_10m_max','wind_gusts_10m_max','wind_direction_10m_dominant'].forEach(f => {
      expect(daily[f]).toBeDefined();
    });
  });

  test('lança erro HTTP não-OK', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    await expect(fetchWeather(0, 0)).rejects.toThrow('Falha ao obter dados meteorológicos');
  });

  test('lança erro de rede', async () => {
    mockFetchFail();
    await expect(fetchWeather(0, 0)).rejects.toThrow('Network error');
  });

  test('URL contém coordenadas corretas', async () => {
    mockFetchJson(MOCK_WEATHER);
    await fetchWeather(-23.55, -46.63);
    const url = global.fetch.mock.calls[0][0];
    expect(url).toContain('open-meteo.com');
    expect(url).toContain('latitude=-23.55');
    expect(url).toContain('longitude=-46.63');
  });

  test('temperatura max sempre maior que min em todos os dias', async () => {
    mockFetchJson(MOCK_WEATHER);
    const { daily } = await fetchWeather(-23.55, -46.63);
    daily.time.forEach((_, i) => {
      expect(daily.temperature_2m_max[i]).toBeGreaterThan(daily.temperature_2m_min[i]);
    });
  });
});

// ============================================================
// BLOCO 6: Consistência dos dados mock
// ============================================================
describe('Consistência dos dados mock', () => {
  test('temperatura atual entre -50 e 60°C', () => {
    const t = MOCK_WEATHER.current.temperature_2m;
    expect(t).toBeGreaterThan(-50);
    expect(t).toBeLessThan(60);
  });

  test('umidade entre 0 e 100%', () => {
    const h = MOCK_WEATHER.current.relative_humidity_2m;
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(100);
  });

  test('direção do vento entre 0° e 360°', () => {
    const d = MOCK_WEATHER.current.wind_direction_10m;
    expect(d).toBeGreaterThanOrEqual(0);
    expect(d).toBeLessThanOrEqual(360);
  });

  test('visibilidade positiva', () => expect(MOCK_WEATHER.current.visibility).toBeGreaterThan(0));

  test('todos os arrays daily têm o mesmo tamanho', () => {
    const { daily } = MOCK_WEATHER;
    const len = daily.time.length;
    ['weather_code','temperature_2m_max','temperature_2m_min',
     'precipitation_sum','wind_speed_10m_max','wind_gusts_10m_max',
     'wind_direction_10m_dominant'].forEach(k => {
      expect(daily[k]).toHaveLength(len);
    });
  });

  test('hourly tem 48 entradas', () => {
    expect(MOCK_WEATHER.hourly.time).toHaveLength(48);
  });

  test('pressão atmosférica plausível (800–1100 hPa)', () => {
    const p = MOCK_WEATHER.current.surface_pressure;
    expect(p).toBeGreaterThan(800);
    expect(p).toBeLessThan(1100);
  });
});
