/**
 * Testes para o site de Previsão do Tempo
 * Cobre: utilitários, detecção de alertas, chamadas de API e parsing de dados
 */

// ===== Mock fetch global =====
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

global.fetch = jest.fn();

// ===== Mock module=====
// Simula o ambiente do browser para o módulo não lançar erro
global.module = global.module || {};
const {
  getWMO,
  degToCompass,
  formatDate,
  formatHour,
  clamp,
  detectAlerts,
  fetchIPLocation,
  fetchWeather,
  searchCity,
} = require('../app');

// ===== Helpers =====
function mockFetchJson(data, ok = true) {
  global.fetch.mockResolvedValueOnce({
    ok,
    json: async () => data,
  });
}

function mockFetchFail() {
  global.fetch.mockRejectedValueOnce(new Error('Network error'));
}

// ===== Dados de mock realistas =====
const MOCK_IP_RESPONSE = {
  status: 'success',
  city: 'São Paulo',
  regionName: 'São Paulo',
  country: 'Brazil',
  countryCode: 'BR',
  lat: -23.5505,
  lon: -46.6333,
};

const MOCK_GEOCODING_RESPONSE = {
  results: [
    {
      name: 'Rio de Janeiro',
      admin1: 'Rio de Janeiro',
      country: 'Brazil',
      latitude: -22.9068,
      longitude: -43.1729,
    },
  ],
};

const MOCK_WEATHER_RESPONSE = {
  current: {
    time: '2026-05-18T14:00',
    temperature_2m: 25.3,
    apparent_temperature: 27.1,
    weather_code: 2,
    relative_humidity_2m: 68,
    wind_speed_10m: 15.4,
    wind_direction_10m: 135,
    precipitation: 0.0,
    surface_pressure: 1013.2,
    visibility: 10000,
  },
  hourly: {
    time: Array.from({ length: 48 }, (_, i) => `2026-05-18T${String(i % 24).padStart(2, '0')}:00`),
    temperature_2m: Array(48).fill(22),
    weather_code: Array(48).fill(2),
    precipitation_probability: Array(48).fill(10),
    precipitation: Array(48).fill(0),
    wind_speed_10m: Array(48).fill(12),
  },
  daily: {
    time: ['2026-05-18', '2026-05-19', '2026-05-20', '2026-05-21', '2026-05-22', '2026-05-23', '2026-05-24'],
    weather_code:               [2,  63, 95, 61,  0,  1,  3],
    temperature_2m_max:         [28, 24, 22, 26, 30, 29, 27],
    temperature_2m_min:         [18, 17, 16, 18, 20, 19, 17],
    precipitation_sum:          [0,  12, 55, 8,  0,  0,  2],
    precipitation_probability_max: [5, 80, 95, 60, 5, 10, 20],
    wind_speed_10m_max:         [20, 35, 65, 25, 15, 18, 22],
    wind_gusts_10m_max:         [30, 50, 95, 40, 20, 25, 35],
    wind_direction_10m_dominant:[90, 135, 180, 90, 45, 60, 120],
  },
};

// ============================================================
// BLOCO 1: Funções Utilitárias
// ============================================================
describe('Utilitários', () => {
  describe('getWMO', () => {
    test('retorna código 0 (céu limpo)', () => {
      const r = getWMO(0);
      expect(r.desc).toBe('Céu limpo');
      expect(r.icon).toBe('☀️');
    });

    test('retorna código 95 (tempestade)', () => {
      const r = getWMO(95);
      expect(r.desc).toBe('Tempestade');
      expect(r.icon).toBe('⛈️');
    });

    test('retorna fallback para código desconhecido', () => {
      const r = getWMO(999);
      expect(r.desc).toBe('Desconhecido');
      expect(r.icon).toBe('🌡️');
    });

    test('cobre todos os códigos principais', () => {
      [0, 1, 2, 3, 45, 48, 51, 53, 55, 61, 63, 65, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99].forEach(code => {
        const r = getWMO(code);
        expect(r.desc).not.toBe('Desconhecido');
      });
    });
  });

  describe('degToCompass', () => {
    test('0° = N', ()  => expect(degToCompass(0)).toBe('N'));
    test('90° = L',   () => expect(degToCompass(90)).toBe('L'));
    test('180° = S',  () => expect(degToCompass(180)).toBe('S'));
    test('270° = O',  () => expect(degToCompass(270)).toBe('O'));
    test('45° = NE',  () => expect(degToCompass(45)).toBe('NE'));
    test('360° = N',  () => expect(degToCompass(360)).toBe('N'));
    test('315° = NO', () => expect(degToCompass(315)).toBe('NO'));
  });

  describe('clamp', () => {
    test('valor dentro do range inalterado', () => expect(clamp(50, 0, 100)).toBe(50));
    test('valor abaixo do mínimo → mínimo',   () => expect(clamp(-5, 0, 100)).toBe(0));
    test('valor acima do máximo → máximo',    () => expect(clamp(200, 0, 100)).toBe(100));
    test('valor exatamente no mínimo',        () => expect(clamp(0, 0, 100)).toBe(0));
    test('valor exatamente no máximo',        () => expect(clamp(100, 0, 100)).toBe(100));
  });

  describe('formatDate', () => {
    test('formata data para pt-BR', () => {
      const r = formatDate('2026-05-18', { day: 'numeric', month: 'long' });
      expect(r).toMatch(/18/);
    });

    test('retorna dia da semana quando solicitado', () => {
      const r = formatDate('2026-05-18', { weekday: 'long' });
      expect(typeof r).toBe('string');
      expect(r.length).toBeGreaterThan(0);
    });
  });

  describe('formatHour', () => {
    test('retorna string no formato HH:MM', () => {
      const r = formatHour('2026-05-18T14:00:00');
      expect(r).toMatch(/\d{2}:\d{2}/);
    });
  });
});

// ============================================================
// BLOCO 2: Detecção de Alertas
// ============================================================
describe('detectAlerts', () => {
  test('sem alertas quando condições normais', () => {
    const daily = {
      time: ['2026-05-18'],
      weather_code: [2],
      precipitation_sum: [0],
      wind_gusts_10m_max: [25],
    };
    expect(detectAlerts(daily)).toHaveLength(0);
  });

  test('alerta de vento forte (≥60 km/h)', () => {
    const daily = {
      time: ['2026-05-18'],
      weather_code: [2],
      precipitation_sum: [0],
      wind_gusts_10m_max: [65],
    };
    const alerts = detectAlerts(daily);
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(alerts.some(a => a.icon === '💨')).toBe(true);
  });

  test('alerta DANGER de vento muito forte (≥90 km/h)', () => {
    const daily = {
      time: ['2026-05-18'],
      weather_code: [2],
      precipitation_sum: [0],
      wind_gusts_10m_max: [95],
    };
    const alerts = detectAlerts(daily);
    const dangerAlert = alerts.find(a => a.type === 'danger' && a.icon === '🌪️');
    expect(dangerAlert).toBeDefined();
  });

  test('alerta de chuva intensa (≥20 mm)', () => {
    const daily = {
      time: ['2026-05-18'],
      weather_code: [63],
      precipitation_sum: [25],
      wind_gusts_10m_max: [20],
    };
    const alerts = detectAlerts(daily);
    expect(alerts.some(a => a.icon === '🌧️')).toBe(true);
  });

  test('alerta DANGER de chuva muito intensa (≥50 mm)', () => {
    const daily = {
      time: ['2026-05-18'],
      weather_code: [63],
      precipitation_sum: [60],
      wind_gusts_10m_max: [20],
    };
    const alerts = detectAlerts(daily);
    const dangerAlert = alerts.find(a => a.type === 'danger' && a.icon === '🌊');
    expect(dangerAlert).toBeDefined();
  });

  test('alerta de tempestade (código 95)', () => {
    const daily = {
      time: ['2026-05-18'],
      weather_code: [95],
      precipitation_sum: [0],
      wind_gusts_10m_max: [20],
    };
    const alerts = detectAlerts(daily);
    expect(alerts.some(a => a.icon === '⛈️')).toBe(true);
  });

  test('múltiplos alertas em múltiplos dias', () => {
    const alerts = detectAlerts(MOCK_WEATHER_RESPONSE.daily);
    expect(alerts.length).toBeGreaterThanOrEqual(3);
  });

  test('mensagem do alerta contém valor numérico', () => {
    const daily = {
      time: ['2026-05-18'],
      weather_code: [2],
      precipitation_sum: [0],
      wind_gusts_10m_max: [95],
    };
    const alerts = detectAlerts(daily);
    expect(alerts[0].msg).toMatch(/\d+/);
  });
});

// ============================================================
// BLOCO 3: fetchIPLocation
// ============================================================
describe('fetchIPLocation', () => {
  beforeEach(() => global.fetch.mockClear());

  test('retorna localização correta em resposta bem-sucedida', async () => {
    mockFetchJson(MOCK_IP_RESPONSE);
    const loc = await fetchIPLocation();
    expect(loc.city).toBe('São Paulo');
    expect(loc.lat).toBe(-23.5505);
    expect(loc.lon).toBe(-46.6333);
    expect(loc.country).toBe('Brazil');
  });

  test('lança erro quando status não é success', async () => {
    mockFetchJson({ status: 'fail', message: 'reserved range' });
    await expect(fetchIPLocation()).rejects.toThrow('reserved range');
  });

  test('lança erro quando fetch falha (rede)', async () => {
    mockFetchFail();
    await expect(fetchIPLocation()).rejects.toThrow('Network error');
  });

  test('lança erro quando resposta HTTP não OK', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    await expect(fetchIPLocation()).rejects.toThrow('Falha ao obter localização pelo IP');
  });

  test('URL chamada contém os campos esperados', async () => {
    mockFetchJson(MOCK_IP_RESPONSE);
    await fetchIPLocation();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('ip-api.com')
    );
  });
});

// ============================================================
// BLOCO 4: searchCity
// ============================================================
describe('searchCity', () => {
  beforeEach(() => global.fetch.mockClear());

  test('retorna cidade encontrada com coordenadas', async () => {
    mockFetchJson(MOCK_GEOCODING_RESPONSE);
    const loc = await searchCity('Rio de Janeiro');
    expect(loc.city).toBe('Rio de Janeiro');
    expect(loc.lat).toBe(-22.9068);
    expect(loc.lon).toBe(-43.1729);
  });

  test('lança erro quando nenhum resultado', async () => {
    mockFetchJson({ results: [] });
    await expect(searchCity('xyzxyz')).rejects.toThrow('não encontrada');
  });

  test('lança erro quando results está ausente', async () => {
    mockFetchJson({});
    await expect(searchCity('teste')).rejects.toThrow('não encontrada');
  });

  test('lança erro quando fetch falha', async () => {
    mockFetchFail();
    await expect(searchCity('Curitiba')).rejects.toThrow('Network error');
  });

  test('URL contém query encodada', async () => {
    mockFetchJson(MOCK_GEOCODING_RESPONSE);
    await searchCity('São Paulo');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('geocoding-api.open-meteo.com')
    );
  });
});

// ============================================================
// BLOCO 5: fetchWeather
// ============================================================
describe('fetchWeather', () => {
  beforeEach(() => global.fetch.mockClear());

  test('retorna dados meteorológicos válidos', async () => {
    mockFetchJson(MOCK_WEATHER_RESPONSE);
    const data = await fetchWeather(-23.55, -46.63);
    expect(data.current).toBeDefined();
    expect(data.daily).toBeDefined();
    expect(data.hourly).toBeDefined();
  });

  test('dados current contêm campos obrigatórios', async () => {
    mockFetchJson(MOCK_WEATHER_RESPONSE);
    const data = await fetchWeather(-23.55, -46.63);
    const c = data.current;
    expect(c.temperature_2m).toBeDefined();
    expect(c.weather_code).toBeDefined();
    expect(c.wind_speed_10m).toBeDefined();
    expect(c.relative_humidity_2m).toBeDefined();
  });

  test('dados daily contêm 7 dias', async () => {
    mockFetchJson(MOCK_WEATHER_RESPONSE);
    const data = await fetchWeather(-23.55, -46.63);
    expect(data.daily.time).toHaveLength(7);
  });

  test('dados daily contêm precipitação', async () => {
    mockFetchJson(MOCK_WEATHER_RESPONSE);
    const data = await fetchWeather(-23.55, -46.63);
    expect(data.daily.precipitation_sum).toBeDefined();
    expect(data.daily.precipitation_probability_max).toBeDefined();
  });

  test('dados daily contêm vento', async () => {
    mockFetchJson(MOCK_WEATHER_RESPONSE);
    const data = await fetchWeather(-23.55, -46.63);
    expect(data.daily.wind_speed_10m_max).toBeDefined();
    expect(data.daily.wind_gusts_10m_max).toBeDefined();
    expect(data.daily.wind_direction_10m_dominant).toBeDefined();
  });

  test('lança erro quando HTTP não OK', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    await expect(fetchWeather(0, 0)).rejects.toThrow('Falha ao obter dados meteorológicos');
  });

  test('lança erro quando fetch falha', async () => {
    mockFetchFail();
    await expect(fetchWeather(0, 0)).rejects.toThrow('Network error');
  });

  test('URL contém coordenadas passadas', async () => {
    mockFetchJson(MOCK_WEATHER_RESPONSE);
    await fetchWeather(-23.55, -46.63);
    const url = global.fetch.mock.calls[0][0];
    expect(url).toContain('open-meteo.com');
    expect(url).toContain('latitude=-23.55');
    expect(url).toContain('longitude=-46.63');
  });

  test('temperatura max maior que min em todos os dias', async () => {
    mockFetchJson(MOCK_WEATHER_RESPONSE);
    const data = await fetchWeather(-23.55, -46.63);
    data.daily.time.forEach((_, i) => {
      expect(data.daily.temperature_2m_max[i]).toBeGreaterThan(data.daily.temperature_2m_min[i]);
    });
  });
});

// ============================================================
// BLOCO 6: Consistência dos Dados Mock
// ============================================================
describe('Consistência dos dados mock', () => {
  test('temperatura atual está dentro de um range plausível (-50 a 60°C)', () => {
    const t = MOCK_WEATHER_RESPONSE.current.temperature_2m;
    expect(t).toBeGreaterThan(-50);
    expect(t).toBeLessThan(60);
  });

  test('umidade está entre 0 e 100%', () => {
    const h = MOCK_WEATHER_RESPONSE.current.relative_humidity_2m;
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(100);
  });

  test('direção do vento está entre 0 e 360°', () => {
    const d = MOCK_WEATHER_RESPONSE.current.wind_direction_10m;
    expect(d).toBeGreaterThanOrEqual(0);
    expect(d).toBeLessThanOrEqual(360);
  });

  test('visibilidade em metros é positiva', () => {
    expect(MOCK_WEATHER_RESPONSE.current.visibility).toBeGreaterThan(0);
  });

  test('diário tem mesmo tamanho em todos os arrays', () => {
    const daily = MOCK_WEATHER_RESPONSE.daily;
    const len = daily.time.length;
    expect(daily.weather_code).toHaveLength(len);
    expect(daily.temperature_2m_max).toHaveLength(len);
    expect(daily.temperature_2m_min).toHaveLength(len);
    expect(daily.precipitation_sum).toHaveLength(len);
    expect(daily.wind_speed_10m_max).toHaveLength(len);
    expect(daily.wind_gusts_10m_max).toHaveLength(len);
    expect(daily.wind_direction_10m_dominant).toHaveLength(len);
  });

  test('horário tem 48 entradas', () => {
    expect(MOCK_WEATHER_RESPONSE.hourly.time).toHaveLength(48);
  });
});
