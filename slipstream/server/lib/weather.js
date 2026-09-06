/**
 * Open-Meteo, chosen for the same reason as Leaflet+OSM and the routing in
 * geo.js: free, keyless, no billing account. Two different endpoints cover
 * the two situations a ride plan can be in:
 *
 *   - the trip date is within Open-Meteo's ~16-day forecast horizon: use the
 *     real forecast.
 *   - it's further out (most rides planned more than two weeks ahead): there
 *     is no real forecast yet, so this averages the same calendar week from
 *     the last two years of the Archive API into a "typically" reading —
 *     labelled as such, never presented as this year's actual forecast.
 */

const FORECAST_BASE = 'https://api.open-meteo.com/v1/forecast'
const ARCHIVE_BASE = 'https://archive-api.open-meteo.com/v1/archive'
const FORECAST_HORIZON_DAYS = 16
const DAILY_FIELDS = 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode'
const ARCHIVE_FIELDS = 'temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode'

// WMO weather codes, as used by Open-Meteo's `weathercode` field.
const CODE_LABELS = [
  [[0], '☀️', 'Clear'],
  [[1, 2], '🌤️', 'Partly cloudy'],
  [[3], '☁️', 'Overcast'],
  [[45, 48], '🌫️', 'Fog'],
  [[51, 53, 55, 56, 57], '🌦️', 'Drizzle'],
  [[61, 63, 65, 66, 67], '🌧️', 'Rain'],
  [[71, 73, 75, 77, 85, 86], '🌨️', 'Snow'],
  [[80, 81, 82], '🌧️', 'Showers'],
  [[95, 96, 99], '⛈️', 'Thunderstorms'],
]
function describeCode(code) {
  const match = CODE_LABELS.find(([codes]) => codes.includes(code))
  return match ? { emoji: match[1], condition: match[2] } : { emoji: '🌡️', condition: 'Mixed' }
}

const toISODate = (ms) => new Date(ms).toISOString().slice(0, 10)
const round = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null)
const avg = (nums) => {
  const clean = nums.filter(Number.isFinite)
  return clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : null
}

async function fetchDaily(base, params) {
  const url = `${base}?${new URLSearchParams(params)}`
  const res = await fetch(url)
  if (!res.ok) return null
  const data = await res.json()
  return data.daily ?? null
}

async function forecastFor(lat, lng, dateMs) {
  const date = toISODate(dateMs)
  const daily = await fetchDaily(FORECAST_BASE, {
    latitude: lat, longitude: lng, timezone: 'auto',
    daily: DAILY_FIELDS, start_date: date, end_date: date,
  })
  if (!daily?.time?.length) return null
  const { emoji, condition } = describeCode(daily.weathercode[0])
  return {
    isForecast: true,
    tempMinC: round(daily.temperature_2m_min[0]),
    tempMaxC: round(daily.temperature_2m_max[0]),
    precipitationChance: daily.precipitation_probability_max?.[0] ?? null,
    condition, emoji,
  }
}

/** Same calendar week, ±3 days, averaged across the last two full years. */
async function seasonalFor(lat, lng, dateMs) {
  const target = new Date(dateMs)
  const years = [target.getUTCFullYear() - 1, target.getUTCFullYear() - 2]

  const windows = await Promise.all(years.map(async (year) => {
    const center = new Date(Date.UTC(year, target.getUTCMonth(), target.getUTCDate()))
    const start = new Date(center); start.setUTCDate(start.getUTCDate() - 3)
    const end = new Date(center); end.setUTCDate(end.getUTCDate() + 3)
    return fetchDaily(ARCHIVE_BASE, {
      latitude: lat, longitude: lng, timezone: 'auto',
      daily: ARCHIVE_FIELDS,
      start_date: toISODate(start.getTime()), end_date: toISODate(end.getTime()),
    })
  }))

  const maxes = [], mins = [], precs = [], codes = []
  for (const w of windows) {
    if (!w?.time?.length) continue
    maxes.push(...w.temperature_2m_max ?? [])
    mins.push(...w.temperature_2m_min ?? [])
    precs.push(...w.precipitation_sum ?? [])
    codes.push(...w.weathercode ?? [])
  }
  if (!maxes.length) return null

  // The modal code across the window reads better than an averaged one,
  // which can land on a code that never actually occurred (e.g. "drizzle"
  // from averaging "clear" and "rain" days that never happened together).
  const counts = new Map()
  for (const c of codes) counts.set(c, (counts.get(c) ?? 0) + 1)
  const modalCode = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  const { emoji, condition } = describeCode(modalCode)

  return {
    isForecast: false,
    tempMinC: round(avg(mins)),
    tempMaxC: round(avg(maxes)),
    precipitationChance: precs.some((p) => p > 1) ? Math.round(100 * precs.filter((p) => p > 1).length / precs.length) : 0,
    condition, emoji,
    basedOnYears: years,
  }
}

/**
 * The single entry point a ride-day plan calls: picks forecast vs seasonal
 * by how far dateMs is from today, and never throws — a rider's own route
 * plan shouldn't fail to save because one weather call had a hiccup.
 */
export async function dayWeather(lat, lng, dateMs) {
  try {
    const daysOut = (dateMs - Date.now()) / 86400000
    const result = daysOut >= 0 && daysOut <= FORECAST_HORIZON_DAYS
      ? await forecastFor(lat, lng, dateMs)
      : await seasonalFor(lat, lng, dateMs)
    return result
  } catch {
    return null
  }
}
