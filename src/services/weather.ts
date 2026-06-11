import { createChildLogger } from '../logging/logger.js';

const logger = createChildLogger({ component: 'weather' });

export interface WeatherData {
  temperatureCelsius: number;
  condition: string;
  windSpeedKmh: number;
  isDay: boolean;
  fetchedAt: Date;
}

export interface WeatherServiceOptions {
  latitude?: number;
  longitude?: number;
  city?: string;
}

// WMO weather codes → human condition labels
const WMO_CONDITIONS: Record<number, string> = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Foggy', 48: 'Icy fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Rain showers', 81: 'Heavy rain showers', 82: 'Violent rain showers',
  85: 'Snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with heavy hail',
};

/**
 * Fetches current weather from Open-Meteo (free, no API key).
 * Geocodes city names via Nominatim (OpenStreetMap, free, no key).
 * Results are cached for 15 minutes.
 */
export class WeatherService {
  private cache: WeatherData | null = null;
  private cacheExpiresAt = 0;
  private static readonly CACHE_TTL_MS = 15 * 60 * 1000;

  constructor(private readonly options: WeatherServiceOptions) {}

  async getCurrentWeather(): Promise<WeatherData | null> {
    if (this.cache && Date.now() < this.cacheExpiresAt) {
      return this.cache;
    }

    try {
      const coords = await this.resolveCoords();
      if (!coords) return null;

      const data = await this.fetchFromOpenMeteo(coords.lat, coords.lon);
      this.cache = data;
      this.cacheExpiresAt = Date.now() + WeatherService.CACHE_TTL_MS;
      logger.debug({ temp: data.temperatureCelsius, condition: data.condition }, 'Weather fetched');
      return data;
    } catch (err) {
      logger.warn({ err: String(err) }, 'Weather fetch failed — proceeding without weather context');
      return null;
    }
  }

  private async resolveCoords(): Promise<{ lat: number; lon: number } | null> {
    if (this.options.latitude !== undefined && this.options.longitude !== undefined) {
      return { lat: this.options.latitude, lon: this.options.longitude };
    }
    if (this.options.city) {
      return this.geocodeCity(this.options.city);
    }
    return null;
  }

  private async geocodeCity(city: string): Promise<{ lat: number; lon: number } | null> {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'merry-telegram-bot/1.0 (https://github.com/PrateekDahiya/Merry)' },
    });

    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    const data = await res.json() as Array<{ lat: string; lon: string }>;
    if (!data[0]) return null;

    return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
  }

  private async fetchFromOpenMeteo(lat: number, lon: number): Promise<WeatherData> {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m,is_day&wind_speed_unit=kmh`;
    const res = await fetch(url);

    if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);

    const json = await res.json() as {
      current: {
        temperature_2m: number;
        weather_code: number;
        wind_speed_10m: number;
        is_day: number;
      };
    };

    const current = json.current;
    return {
      temperatureCelsius: Math.round(current.temperature_2m),
      condition: WMO_CONDITIONS[current.weather_code] ?? 'Unknown',
      windSpeedKmh: Math.round(current.wind_speed_10m),
      isDay: current.is_day === 1,
      fetchedAt: new Date(),
    };
  }
}
