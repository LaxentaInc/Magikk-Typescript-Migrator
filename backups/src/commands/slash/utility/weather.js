const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { registerButton } = require('../../../handlers/buttonHandler.js');
const { logger } = require('../../../utils/logger');

const API_KEY = process.env.WEATHER_API_KEY;

// Weather icon SVG mappings
const weatherIcons = {
  'sunny': '☀️',
  'clear': '🌙',
  'partly cloudy': '⛅',
  'cloudy': '☁️',
  'overcast': '☁️',
  'mist': '🌫️',
  'fog': '🌫️',
  'light rain': '🌦️',
  'moderate rain': '🌧️',
  'heavy rain': '🌧️',
  'light snow': '🌨️',
  'moderate snow': '❄️',
  'heavy snow': '❄️',
  'sleet': '🌨️',
  'freezing rain': '🌨️',
  'thunderstorm': '⛈️',
  'thunder': '⛈️',
  'blizzard': '🌨️',
  default: '🌡️'
};

// Enhanced weather condition emojis
function getWeatherEmoji(condition) {
  if (!condition) return weatherIcons.default;
  const conditionLower = condition.toLowerCase();
  
  for (const [key, emoji] of Object.entries(weatherIcons)) {
    if (conditionLower.includes(key)) return emoji;
  }
  return weatherIcons.default;
}

// Temperature color based on value
function getTempColor(tempC) {
  if (tempC <= 0) return '#5DADE2'; // Freezing - Blue
  if (tempC <= 10) return '#3498DB'; // Cold - Light Blue
  if (tempC <= 20) return '#27AE60'; // Cool - Green
  if (tempC <= 30) return '#F39C12'; // Warm - Orange
  return '#E74C3C'; // Hot - Red
}

// Cache with TTL and auto-cleanup
class CacheManager {
  constructor(cleanupInterval = 30 * 60 * 1000) {
    this.cache = new Map();
    setInterval(() => this.cleanup(), cleanupInterval);
  }

  set(key, value, ttl = 15 * 60 * 1000) {
    this.cache.set(key, {
      value,
      expiry: Date.now() + ttl
    });
    return key;
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }
    return item.value;
  }

  cleanup() {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (now > item.expiry) this.cache.delete(key);
    }
  }
}

const weatherCache = new CacheManager();

// API Functions with axios
async function fetchCitySuggestions(query) {
  if (!query || query.trim().length < 2) return [];

  try {
    const url = `http://api.weatherapi.com/v1/search.json`;
    const response = await axios.get(url, {
      params: {
        key: API_KEY,
        q: query
      },
      timeout: 5000
    });
    
    return response.data.map(loc => `${loc.name}, ${loc.region || ''}, ${loc.country}`.replace(/, ,/g, ','));
  } catch (error) {
    logger.error(`City suggestion error: ${error.message}`);
    return [];
  }
}

async function fetchWeatherData(city, dataType = 'both') {
  const cacheKey = `${city}_${dataType}`;
  const cachedData = weatherCache.get(cacheKey);
  if (cachedData) return cachedData;

  try {
    let current, forecast;
    
    if (dataType === 'current' || dataType === 'both') {
      const currentResponse = await axios.get('http://api.weatherapi.com/v1/current.json', {
        params: {
          key: API_KEY,
          q: city,
          aqi: 'yes'
        },
        timeout: 8000
      });
      current = currentResponse.data;
    }
    
    if (dataType === 'forecast' || dataType === 'both') {
      const forecastResponse = await axios.get('http://api.weatherapi.com/v1/forecast.json', {
        params: {
          key: API_KEY,
          q: city,
          days: 2,
          aqi: 'yes',
          alerts: 'yes'
        },
        timeout: 8000
      });
      forecast = forecastResponse.data;
    }

    const result = { current, forecast };
    weatherCache.set(cacheKey, result);
    return result;
  } catch (error) {
    logger.error(`Weather fetch error for ${city}: ${error.message}`);
    throw new Error(`Couldn't fetch weather data for "${city}". ${error.response?.data?.error?.message || error.message}`);
  }
}

// Enhanced format functions
function getAQIDescription(aqi) {
  const pm25 = aqi && aqi.pm2_5 ? aqi.pm2_5 : null;
  
  if (pm25 === null) return null;
  
  if (pm25 <= 12) return { level: "Good", emoji: "🟢", color: "#2ECC71" };
  if (pm25 <= 35.4) return { level: "Moderate", emoji: "🟡", color: "#F39C12" };
  if (pm25 <= 55.4) return { level: "Unhealthy for Sensitive", emoji: "🟠", color: "#E67E22" };
  if (pm25 <= 150.4) return { level: "Unhealthy", emoji: "🔴", color: "#E74C3C" };
  if (pm25 <= 250.4) return { level: "Very Unhealthy", emoji: "🟣", color: "#9B59B6" };
  return { level: "Hazardous", emoji: "⚫", color: "#34495E" };
}

function formatTemperature(temp_c, temp_f, units = 'both') {
  if (units === 'metric') return `${temp_c}°C`;
  if (units === 'imperial') return `${temp_f}°F`;
  return `${temp_c}°C (${temp_f}°F)`;
}

function getWindDescription(speed_kph) {
  const descriptions = [
    { max: 1, desc: "Calm", emoji: "🍃" },
    { max: 6, desc: "Light air", emoji: "🍃" },
    { max: 12, desc: "Light breeze", emoji: "🌬️" },
    { max: 20, desc: "Gentle breeze", emoji: "🌬️" },
    { max: 29, desc: "Moderate breeze", emoji: "💨" },
    { max: 39, desc: "Fresh breeze", emoji: "💨" },
    { max: 50, desc: "Strong breeze", emoji: "💨" },
    { max: 62, desc: "High wind", emoji: "🌪️" },
    { max: 75, desc: "Gale", emoji: "🌪️" },
    { max: 89, desc: "Strong gale", emoji: "🌪️" },
    { max: 103, desc: "Storm", emoji: "🌀" },
    { max: 118, desc: "Violent storm", emoji: "🌀" },
    { max: Infinity, desc: "Hurricane", emoji: "🌀" }
  ];

  const wind = descriptions.find(d => speed_kph < d.max);
  return wind || descriptions[descriptions.length - 1];
}

function getUVDescription(uv) {
  if (uv <= 2) return { level: "Low", emoji: "🟢", advice: "No protection needed" };
  if (uv <= 5) return { level: "Moderate", emoji: "🟡", advice: "Wear sunscreen" };
  if (uv <= 7) return { level: "High", emoji: "🟠", advice: "Protection required" };
  if (uv <= 10) return { level: "Very High", emoji: "🔴", advice: "Extra protection needed" };
  return { level: "Extreme", emoji: "🟣", advice: "Avoid sun exposure" };
}

function formatLocalTime(datetime) {
  const date = new Date(datetime);
  return date.toLocaleString('en-US', { 
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

// Enhanced Embed Builders
function buildCurrentWeatherEmbed(state) {
  const embed = new EmbedBuilder();
  const primaryData = state.primary.current;
  const compareData = state.compare?.current;
  
  if (!primaryData) {
    return errorEmbed("Weather data unavailable");
  }
  
  const primaryLoc = primaryData.location;
  const primaryCur = primaryData.current;
  const weatherEmoji = getWeatherEmoji(primaryCur.condition.text);
  const tempColor = getTempColor(primaryCur.temp_c);
  
  embed.setTitle(`${weatherEmoji} Current Weather ${state.compare ? '• Comparison' : ''}`);
  embed.setColor(tempColor);
  embed.setTimestamp();
  
  // Primary location with enhanced formatting
  embed.addFields({
    name: `📍 ${primaryLoc.name}, ${primaryLoc.region || primaryLoc.country}`,
    value: `\`\`\`fix\n${primaryCur.condition.text}\n\`\`\``,
    inline: false
  });

  embed.addFields(
    {
      name: '🌡️ Temperature',
      value: `**${formatTemperature(primaryCur.temp_c, primaryCur.temp_f, state.units)}**\nFeels like ${formatTemperature(primaryCur.feelslike_c, primaryCur.feelslike_f, state.units)}`,
      inline: true
    },
    {
      name: '💧 Humidity',
      value: `**${primaryCur.humidity}%**\nDew point: ${primaryCur.dewpoint_c}°C`,
      inline: true
    },
    {
      name: '🌬️ Wind',
      value: `**${primaryCur.wind_kph} km/h ${primaryCur.wind_dir}**\n${getWindDescription(primaryCur.wind_kph).emoji} ${getWindDescription(primaryCur.wind_kph).desc}`,
      inline: true
    }
  );

  // Additional info row
  embed.addFields(
    {
      name: '🔘 Pressure',
      value: `**${primaryCur.pressure_mb} mb**`,
      inline: true
    },
    {
      name: '👁️ Visibility',
      value: `**${primaryCur.vis_km} km**`,
      inline: true
    },
    {
      name: '☔ Precipitation',
      value: `**${primaryCur.precip_mm} mm**`,
      inline: true
    }
  );

  // UV Index
  if (primaryCur.uv !== undefined) {
    const uvInfo = getUVDescription(primaryCur.uv);
    embed.addFields({
      name: '☀️ UV Index',
      value: `${uvInfo.emoji} **${primaryCur.uv}** (${uvInfo.level})\n*${uvInfo.advice}*`,
      inline: false
    });
  }

  // Air quality with visual indicator
  if (primaryCur.air_quality) {
    const aqiDesc = getAQIDescription(primaryCur.air_quality);
    if (aqiDesc) {
      embed.addFields({
        name: '🌫️ Air Quality',
        value: `${aqiDesc.emoji} **${aqiDesc.level}**\nPM2.5: ${primaryCur.air_quality.pm2_5.toFixed(1)} μg/m³`,
        inline: false
      });
    }
  }

  // Comparison data with visual separation
  if (compareData) {
    const compLoc = compareData.location;
    const compCur = compareData.current;
    const compEmoji = getWeatherEmoji(compCur.condition.text);
    
    embed.addFields({
      name: '\u200B',
      value: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      inline: false
    });

    embed.addFields({
      name: `📍 ${compLoc.name}, ${compLoc.region || compLoc.country}`,
      value: `\`\`\`fix\n${compCur.condition.text}\n\`\`\``,
      inline: false
    });

    embed.addFields(
      {
        name: '🌡️ Temperature',
        value: `**${formatTemperature(compCur.temp_c, compCur.temp_f, state.units)}**\nFeels like ${formatTemperature(compCur.feelslike_c, compCur.feelslike_f, state.units)}`,
        inline: true
      },
      {
        name: '💧 Humidity',
        value: `**${compCur.humidity}%**`,
        inline: true
      },
      {
        name: '🌬️ Wind',
        value: `**${compCur.wind_kph} km/h**\n${getWindDescription(compCur.wind_kph).emoji} ${getWindDescription(compCur.wind_kph).desc}`,
        inline: true
      }
    );

    // Temperature difference visualization
    const tempDiff = (primaryCur.temp_c - compCur.temp_c).toFixed(1);
    const diffEmoji = tempDiff > 0 ? '🔴' : '🔵';
    
    embed.addFields({
      name: '📊 Temperature Difference',
      value: `${diffEmoji} **${Math.abs(tempDiff)}°C** ${tempDiff > 0 ? 'warmer' : 'cooler'} in ${primaryLoc.name}`,
      inline: false
    });
  }

  embed.setThumbnail(`https:${primaryCur.condition.icon}`);
  embed.setFooter({ text: `Last updated: ${formatLocalTime(primaryLoc.localtime)}` });
  
  return embed;
}

function buildForecastEmbed(state) {
  const embed = new EmbedBuilder();
  const primaryData = state.primary.forecast;
  const compareData = state.compare?.forecast;
  
  if (!primaryData || !primaryData.forecast || !primaryData.forecast.forecastday.length) {
    return errorEmbed("Forecast data unavailable");
  }

  const primaryLoc = primaryData.location;
  
  embed.setTitle(`📅 Weather Forecast ${state.compare ? '• Comparison' : ''}`);
  embed.setColor('#3498DB');
  embed.setTimestamp();
  
  // Today's forecast
  const fcDay = primaryData.forecast.forecastday[0];
  const weatherEmoji = getWeatherEmoji(fcDay.day.condition.text);
  
  embed.addFields({
    name: `${weatherEmoji} ${primaryLoc.name} - ${new Date(fcDay.date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}`,
    value: `\`\`\`${fcDay.day.condition.text}\`\`\``,
    inline: false
  });

  embed.addFields(
    {
      name: '🌡️ Temperature Range',
      value: `High: **${fcDay.day.maxtemp_c}°C**\nLow: **${fcDay.day.mintemp_c}°C**\nAvg: **${fcDay.day.avgtemp_c}°C**`,
      inline: true
    },
    {
      name: '☔ Precipitation',
      value: `Total: **${fcDay.day.totalprecip_mm} mm**\nRain: **${fcDay.day.daily_chance_of_rain}%**\nSnow: **${fcDay.day.daily_chance_of_snow}%**`,
      inline: true
    },
    {
      name: '🌬️ Wind',
      value: `Max: **${fcDay.day.maxwind_kph} km/h**\n${getWindDescription(fcDay.day.maxwind_kph).emoji} ${getWindDescription(fcDay.day.maxwind_kph).desc}`,
      inline: true
    }
  );

  // Hourly forecast with visual timeline
  embed.addFields({
    name: '⏰ Hourly Forecast (Next 6 Hours)',
    value: '\u200B',
    inline: false
  });

  const currentHour = new Date(primaryLoc.localtime).getHours();
  let hourlyDesc = '';
  
  for (let i = 0; i < 6; i++) {
    const hourIndex = (currentHour + i) % 24;
    const isNextDay = currentHour + i >= 24;
    const dayData = isNextDay && primaryData.forecast.forecastday.length > 1 
      ? primaryData.forecast.forecastday[1] 
      : fcDay;
    
    if (dayData && dayData.hour && dayData.hour[hourIndex]) {
      const hour = dayData.hour[hourIndex];
      const time = new Date(hour.time).toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
      const emoji = getWeatherEmoji(hour.condition.text);
      
      hourlyDesc += `**${time}** ${emoji} ${hour.temp_c}°C • ${hour.condition.text} • 💧 ${hour.chance_of_rain}%\n`;
    }
  }
  
  embed.addFields({
    name: '\u200B',
    value: hourlyDesc || 'No hourly data available',
    inline: false
  });

  // Tomorrow's preview if available
  if (primaryData.forecast.forecastday.length > 1) {
    const tomorrow = primaryData.forecast.forecastday[1];
    const tomorrowEmoji = getWeatherEmoji(tomorrow.day.condition.text);
    
    embed.addFields({
      name: `${tomorrowEmoji} Tomorrow - ${new Date(tomorrow.date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}`,
      value: `${tomorrow.day.condition.text} • High: **${tomorrow.day.maxtemp_c}°C** Low: **${tomorrow.day.mintemp_c}°C** • 💧 ${tomorrow.day.daily_chance_of_rain}%`,
      inline: false
    });
  }

  // Comparison forecast
  if (compareData && compareData.forecast && compareData.forecast.forecastday.length) {
    const compLoc = compareData.location;
    const compFcDay = compareData.forecast.forecastday[0];
    const compEmoji = getWeatherEmoji(compFcDay.day.condition.text);
    
    embed.addFields({
      name: '\u200B',
      value: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      inline: false
    });

    embed.addFields({
      name: `${compEmoji} ${compLoc.name} - Today`,
      value: `${compFcDay.day.condition.text} • High: **${compFcDay.day.maxtemp_c}°C** Low: **${compFcDay.day.mintemp_c}°C** • 💧 ${compFcDay.day.daily_chance_of_rain}%`,
      inline: false
    });
  }

  embed.setThumbnail(`https:${fcDay.day.condition.icon}`);
  embed.setFooter({ text: 'Forecast data provided by WeatherAPI' });
  
  return embed;
}

function buildAstronomyEmbed(state) {
  const embed = new EmbedBuilder();
  const primaryData = state.primary.forecast;
  const compareData = state.compare?.forecast;
  
  if (!primaryData || !primaryData.forecast || !primaryData.forecast.forecastday.length) {
    return errorEmbed("Astronomy data unavailable");
  }

  const primaryLoc = primaryData.location;
  
  embed.setTitle(`🌙 Astronomy Information ${state.compare ? '• Comparison' : ''}`);
  embed.setColor('#9B59B6');
  embed.setTimestamp();
  
  const astro = primaryData.forecast.forecastday[0].astro;
  
  // Moon phase emoji
  const moonPhases = {
    'New Moon': '🌑',
    'Waxing Crescent': '🌒',
    'First Quarter': '🌓',
    'Waxing Gibbous': '🌔',
    'Full Moon': '🌕',
    'Waning Gibbous': '🌖',
    'Last Quarter': '🌗',
    'Waning Crescent': '🌘'
  };
  const moonEmoji = moonPhases[astro.moon_phase] || '🌙';
  
  embed.addFields({
    name: `📍 ${primaryLoc.name}, ${primaryLoc.region || primaryLoc.country}`,
    value: `Current time: ${formatLocalTime(primaryLoc.localtime)}`,
    inline: false
  });

  embed.addFields(
    {
      name: '☀️ Sun',
      value: `Sunrise: **${astro.sunrise}**\nSunset: **${astro.sunset}**`,
      inline: true
    },
    {
      name: `${moonEmoji} Moon`,
      value: `Moonrise: **${astro.moonrise}**\nMoonset: **${astro.moonset}**`,
      inline: true
    },
    {
      name: '🌙 Lunar Details',
      value: `Phase: **${astro.moon_phase}**\nIllumination: **${astro.moon_illumination}%**`,
      inline: true
    }
  );

  // Day length calculation with visual bar
  const sunriseTime = convertTo24Hour(astro.sunrise);
  const sunsetTime = convertTo24Hour(astro.sunset);
  const dayLengthMinutes = calculateTimeDifference(sunriseTime, sunsetTime);
  const hours = Math.floor(dayLengthMinutes / 60);
  const minutes = dayLengthMinutes % 60;
  
  const dayLengthBar = createProgressBar(dayLengthMinutes, 24 * 60, 20);
  
  embed.addFields({
    name: '📏 Day Length',
    value: `**${hours} hours ${minutes} minutes**\n${dayLengthBar}`,
    inline: false
  });

  // Comparison astronomy
  if (compareData && compareData.forecast && compareData.forecast.forecastday.length) {
    const compLoc = compareData.location;
    const compAstro = compareData.forecast.forecastday[0].astro;
    const compMoonEmoji = moonPhases[compAstro.moon_phase] || '🌙';
    
    embed.addFields({
      name: '\u200B',
      value: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      inline: false
    });

    embed.addFields({
      name: `📍 ${compLoc.name}, ${compLoc.region || compLoc.country}`,
      value: `Current time: ${formatLocalTime(compLoc.localtime)}`,
      inline: false
    });

    embed.addFields(
      {
        name: '☀️ Sun',
        value: `Sunrise: **${compAstro.sunrise}**\nSunset: **${compAstro.sunset}**`,
        inline: true
      },
      {
        name: `${compMoonEmoji} Moon`,
        value: `Moonrise: **${compAstro.moonrise}**\nMoonset: **${compAstro.moonset}**`,
        inline: true
      },
      {
        name: '🌙 Lunar Details',
        value: `Phase: **${compAstro.moon_phase}**\nIllumination: **${compAstro.moon_illumination}%**`,
        inline: true
      }
    );
  }

  embed.setThumbnail('https://img.freepik.com/free-vector/night-sky-with-moon-stars-clouds-background_1017-33777.jpg?semt=ais_hybrid&w=740'); // Moon/stars image
  embed.setFooter({ text: 'All times are in local timezone' });
  
  return embed;
}

function buildAlertsEmbed(state) {
  const embed = new EmbedBuilder();
  const primaryData = state.primary.forecast;
  const compareData = state.compare?.forecast;
  
  if (!primaryData) {
    return errorEmbed("Alert data unavailable");
  }

  const primaryLoc = primaryData.location;
  
  embed.setTitle(`⚠️ Weather Alerts ${state.compare ? '• Comparison' : ''}`);
  embed.setTimestamp();
  
  const hasAlertsForPrimary = primaryData.alerts && primaryData.alerts.alert && primaryData.alerts.alert.length > 0;
  
  if (hasAlertsForPrimary) {
    embed.setColor('#E74C3C'); // Red for active alerts
    
    embed.addFields({
      name: `📍 ${primaryLoc.name}, ${primaryLoc.region || primaryLoc.country}`,
      value: `**${primaryData.alerts.alert.length} Active Alert(s)**`,
      inline: false
    });
    
    primaryData.alerts.alert.slice(0, 3).forEach((alert, index) => {
      const severityEmoji = getSeverityEmoji(alert.severity);
      
      embed.addFields({
        name: `${severityEmoji} Alert ${index + 1}: ${alert.headline || alert.event || 'Weather Alert'}`,
        value: [
          `**Severity:** ${alert.severity || 'Unknown'}`,
          `**Certainty:** ${alert.certainty || 'Unknown'}`,
          `**Urgency:** ${alert.urgency || 'Unknown'}`,
          alert.effective && alert.expires ? `**Valid:** ${formatDate(alert.effective)} - ${formatDate(alert.expires)}` : '',
          `\n*${truncateText(alert.desc || alert.description || 'No description available', 300)}*`
        ].filter(Boolean).join('\n'),
        inline: false
      });
    });
    
    if (primaryData.alerts.alert.length > 3) {
      embed.addFields({
        name: '\u200B',
        value: `*+${primaryData.alerts.alert.length - 3} more alert(s)*`,
        inline: false
      });
    }
  } else {
    embed.setColor('#2ECC71'); // Green for no alerts
    embed.addFields({
      name: `✅ ${primaryLoc.name}, ${primaryLoc.region || primaryLoc.country}`,
      value: '**No active weather alerts**\nAll clear! No severe weather warnings in effect.',
      inline: false
    });
  }

  // Comparison alerts
  if (compareData) {
    const compLoc = compareData.location;
    const hasAlertsForCompare = compareData.alerts && compareData.alerts.alert && compareData.alerts.alert.length > 0;
    
    embed.addFields({
      name: '\u200B',
      value: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      inline: false
    });

    if (hasAlertsForCompare) {
      embed.addFields({
        name: `📍 ${compLoc.name}, ${compLoc.region || compLoc.country}`,
        value: `**${compareData.alerts.alert.length} Active Alert(s)**`,
        inline: false
      });
      
      compareData.alerts.alert.slice(0, 2).forEach((alert, index) => {
        const severityEmoji = getSeverityEmoji(alert.severity);
        
        embed.addFields({
          name: `${severityEmoji} ${alert.event || 'Weather Alert'}`,
          value: `**Severity:** ${alert.severity || 'Unknown'} • **Urgency:** ${alert.urgency || 'Unknown'}`,
          inline: false
        });
      });
    } else {
      embed.addFields({
        name: `✅ ${compLoc.name}, ${compLoc.region || compLoc.country}`,
        value: '**No active weather alerts**',
        inline: false
      });
    }
  }

  embed.setFooter({ text: 'Stay safe and monitor local weather services' });
  
  return embed;
}

function buildLocationEmbed(state) {
  const embed = new EmbedBuilder();
  const primaryData = state.primary.current;
  const compareData = state.compare?.current;
  
  if (!primaryData) {
    return errorEmbed("Location data unavailable");
  }

  const primaryLoc = primaryData.location;
  
  embed.setTitle(`📍 Location Information ${state.compare ? '• Comparison' : ''}`);
  embed.setColor('#F39C12');
  embed.setTimestamp();
  
  // Create a map URL
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${primaryLoc.lat},${primaryLoc.lon}`;
  
  embed.addFields({
    name: `🏙️ ${primaryLoc.name}`,
    value: [
      `**Region:** ${primaryLoc.region || 'N/A'}`,
      `**Country:** ${primaryLoc.country} :flag_${getCountryCode(primaryLoc.country)}:`,
      `**Timezone:** ${primaryLoc.tz_id}`,
      `**Local Time:** ${formatLocalTime(primaryLoc.localtime)}`
    ].join('\n'),
    inline: false
  });

  embed.addFields(
    {
      name: '🗺️ Coordinates',
      value: `Latitude: **${primaryLoc.lat}°**\nLongitude: **${primaryLoc.lon}°**\n[View on Map](${mapUrl})`,
      inline: true
    },
    {
      name: '🕐 Time Info',
      value: `UTC Offset: **${getUTCOffset(primaryLoc.tz_id)}**\nDaylight Saving: **${isDST(primaryLoc.localtime) ? 'Yes' : 'No'}**`,
      inline: true
    }
  );

  // Comparison location
  if (compareData) {
    const compLoc = compareData.location;
    const compMapUrl = `https://www.google.com/maps/search/?api=1&query=${compLoc.lat},${compLoc.lon}`;
    
    embed.addFields({
      name: '\u200B',
      value: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      inline: false
    });

    embed.addFields({
      name: `🏙️ ${compLoc.name}`,
      value: [
        `**Region:** ${compLoc.region || 'N/A'}`,
        `**Country:** ${compLoc.country} :flag_${getCountryCode(compLoc.country)}:`,
        `**Timezone:** ${compLoc.tz_id}`,
        `**Local Time:** ${formatLocalTime(compLoc.localtime)}`
      ].join('\n'),
      inline: false
    });

    // Distance and direction calculation
    const distance = calculateDistance(
      primaryLoc.lat, primaryLoc.lon,
      compLoc.lat, compLoc.lon
    );
    const direction = calculateDirection(
      primaryLoc.lat, primaryLoc.lon,
      compLoc.lat, compLoc.lon
    );
    
    embed.addFields({
      name: '📏 Distance & Direction',
      value: `**${distance.toFixed(0)} km** ${direction} from ${primaryLoc.name}`,
      inline: false
    });

    // Time difference with visual indicator
    const timeDiff = calculateTimezoneOffset(primaryLoc.tz_id, compLoc.tz_id);
    if (timeDiff !== null) {
      const hours = Math.abs(Math.floor(timeDiff));
      const minutes = Math.abs(Math.round((timeDiff % 1) * 60));
      const timeEmoji = timeDiff > 0 ? '⏩' : '⏪';
      
      embed.addFields({
        name: '🕐 Time Difference',
        value: `${timeEmoji} **${hours}h ${minutes}m** ${timeDiff >= 0 ? 'ahead' : 'behind'}`,
        inline: false
      });
    }
  }

  embed.setFooter({ text: 'Geographic data powered by WeatherAPI' });
  
  return embed;
}

// Helper functions
function errorEmbed(message) {
  return new EmbedBuilder()
    .setTitle('❌ Error')
    .setDescription(message || 'An unknown error occurred')
    .setColor('#E74C3C')
    .setTimestamp();
}

function createProgressBar(current, max, length = 10) {
  const filled = Math.round((current / max) * length);
  const empty = length - filled;
  return '▰'.repeat(filled) + '▱'.repeat(empty);
}

function truncateText(text, maxLength) {
  if (!text) return '';
  return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
}

function getSeverityEmoji(severity) {
  const severityMap = {
    'extreme': '🔴',
    'severe': '🟠',
    'moderate': '🟡',
    'minor': '🟢',
    'unknown': '⚪'
  };
  return severityMap[severity?.toLowerCase()] || '⚪';
}

function getCountryCode(country) {
  // Simple mapping for common countries - extend as needed
  const countryMap = {
    'United States': 'us',
    'United Kingdom': 'gb',
    'Canada': 'ca',
    'Australia': 'au',
    'Germany': 'de',
    'France': 'fr',
    'India': 'in',
    'China': 'cn',
    'Japan': 'jp',
    'Brazil': 'br',
    'Mexico': 'mx',
    'Spain': 'es',
    'Italy': 'it',
    'Russia': 'ru',
    'South Korea': 'kr',
    'Netherlands': 'nl',
    'Sweden': 'se',
    'Norway': 'no',
    'Denmark': 'dk',
    'Finland': 'fi'
  };
  return countryMap[country]?.toLowerCase() || 'un';
}

function getUTCOffset(timezone) {
  try {
    const now = new Date();
    const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
    const tzDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    const offset = (tzDate - utcDate) / (1000 * 60 * 60);
    return `UTC${offset >= 0 ? '+' : ''}${offset}`;
  } catch {
    return 'Unknown';
  }
}

function isDST(localtime) {
  const date = new Date(localtime);
  const jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
  return Math.max(jan, jul) !== date.getTimezoneOffset();
}

function convertTo24Hour(timeStr) {
  if (!timeStr) return null;
  
  let [time, modifier] = timeStr.split(' ');
  let [hours, minutes] = time.split(':');
  
  hours = parseInt(hours);
  minutes = parseInt(minutes);
  
  if (modifier === 'PM' && hours !== 12) {
    hours += 12;
  } else if (modifier === 'AM' && hours === 12) {
    hours = 0;
  }
  
  return { hours, minutes };
}

function calculateTimeDifference(time1, time2) {
  if (!time1 || !time2) return 0;
  
  const minutes1 = time1.hours * 60 + time1.minutes;
  const minutes2 = time2.hours * 60 + time2.minutes;
  
  return minutes2 - minutes1;
}

function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  try {
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  } catch (error) {
    return dateStr;
  }
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function calculateDirection(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
            Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
  
  const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(bearing / 45) % 8;
  
  return directions[index];
}

function calculateTimezoneOffset(tz1, tz2) {
  if (!tz1 || !tz2) return null;
  
  try {
    const date = new Date();
    const time1 = new Date(date.toLocaleString('en-US', { timeZone: tz1 }));
    const time2 = new Date(date.toLocaleString('en-US', { timeZone: tz2 }));
    
    const diffHours = (time1 - time2) / (1000 * 60 * 60);
    return diffHours;
  } catch (error) {
    return null;
  }
}

// Main function to build embed based on page number
function buildPageEmbed(state) {
  switch (state.currentPage) {
    case 1: return buildCurrentWeatherEmbed(state);
    case 2: return buildForecastEmbed(state);
    case 3: return buildAstronomyEmbed(state);
    case 4: return buildAlertsEmbed(state);
    case 5: return buildLocationEmbed(state);
    default: return errorEmbed('Invalid page');
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('weather')
    .setDescription('Advanced weather information with beautiful visualizations')
    .setIntegrationTypes(0, 1)
    .setContexts(0, 1, 2)
    .addStringOption(option =>
      option.setName('city')
        .setDescription('Enter city name, postal code, IP address, or coordinates')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption(option =>
      option.setName('compare')
        .setDescription('Optional: Enter another location to compare')
        .setRequired(false)
        .setAutocomplete(true)
    )
    .addStringOption(option =>
      option.setName('units')
        .setDescription('Choose temperature units')
        .setRequired(false)
        .addChoices(
          { name: 'Metric (°C)', value: 'metric' },
          { name: 'Imperial (°F)', value: 'imperial' },
          { name: 'Both', value: 'both' }
        )
    ),

  async autocomplete(interaction) {
    const focusedOption = interaction.options.getFocused(true);
    const query = focusedOption.value;
    
    try {
      const suggestions = await fetchCitySuggestions(query);
      await interaction.respond(
        suggestions.map(city => ({ name: city, value: city })).slice(0, 25)
      );
    } catch (error) {
      logger.error('Autocomplete error:', error);
      await interaction.respond([]);
    }
  },

  async execute(interaction) {
    await interaction.deferReply();
    
    const city = interaction.options.getString('city');
    const compareCity = interaction.options.getString('compare');
    const units = interaction.options.getString('units') || 'both';
    
    try {
      // Fetch primary location data
      const primaryData = await fetchWeatherData(city, 'both');
      
      // Fetch comparison data if provided
      let compareData = null;
      if (compareCity) {
        compareData = await fetchWeatherData(compareCity, 'both');
      }
      
      // Create state object for navigation
      const stateId = uuidv4();
      const state = {
        id: stateId,
        primary: primaryData,
        compare: compareData,
        currentPage: 1,
        totalPages: 5,
        units
      };
      
      // Build embed for current page
      const embed = buildPageEmbed(state);
      
      // Create navigation buttons with enhanced styling
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`weather_prev_${stateId}`)
            .setLabel('Previous')
            .setEmoji('⬅️')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(state.currentPage === 1),
          new ButtonBuilder()
            .setCustomId(`weather_page_${stateId}`)
            .setLabel(`Page ${state.currentPage}/${state.totalPages}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
          new ButtonBuilder()
            .setCustomId(`weather_next_${stateId}`)
            .setLabel('Next')
            .setEmoji('➡️')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(state.currentPage === state.totalPages),
          new ButtonBuilder()
            .setCustomId(`weather_refresh_${stateId}`)
            .setLabel('Refresh')
            .setEmoji('🔄')
            .setStyle(ButtonStyle.Success)
        );
      
      // Register button handlers
      registerButton(`weather_prev_${stateId}`, async (btnInt) => {
        try {
          if (btnInt.user.id !== interaction.user.id) {
            return await btnInt.reply({ 
              content: '❌ You cannot use these controls.', 
              ephemeral: true 
            });
          }
          
          await btnInt.deferUpdate();
          
          state.currentPage = Math.max(1, state.currentPage - 1);
          const newEmbed = buildPageEmbed(state);
          
          const newRow = new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId(`weather_prev_${stateId}`)
                .setLabel('Previous')
                .setEmoji('⬅️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(state.currentPage === 1),
              new ButtonBuilder()
                .setCustomId(`weather_page_${stateId}`)
                .setLabel(`Page ${state.currentPage}/${state.totalPages}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),
              new ButtonBuilder()
                .setCustomId(`weather_next_${stateId}`)
                .setLabel('Next')
                .setEmoji('➡️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(state.currentPage === state.totalPages),
              new ButtonBuilder()
                .setCustomId(`weather_refresh_${stateId}`)
                .setLabel('Refresh')
                .setEmoji('🔄')
                .setStyle(ButtonStyle.Success)
            );
          
          await btnInt.editReply({ 
            embeds: [newEmbed], 
            components: [newRow] 
          });
        } catch (error) {
          logger.error(`Previous button error: ${error.message}`);
        }
      });
      
      registerButton(`weather_next_${stateId}`, async (btnInt) => {
        try {
          if (btnInt.user.id !== interaction.user.id) {
            return await btnInt.reply({ 
              content: '❌ You cannot use these controls.', 
              ephemeral: true 
            });
          }
          
          await btnInt.deferUpdate();
          
          state.currentPage = Math.min(state.totalPages, state.currentPage + 1);
          const newEmbed = buildPageEmbed(state);
          
          const newRow = new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId(`weather_prev_${stateId}`)
                .setLabel('Previous')
                .setEmoji('⬅️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(state.currentPage === 1),
              new ButtonBuilder()
                .setCustomId(`weather_page_${stateId}`)
                .setLabel(`Page ${state.currentPage}/${state.totalPages}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),
              new ButtonBuilder()
                .setCustomId(`weather_next_${stateId}`)
                .setLabel('Next')
                .setEmoji('➡️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(state.currentPage === state.totalPages),
              new ButtonBuilder()
                .setCustomId(`weather_refresh_${stateId}`)
                .setLabel('Refresh')
                .setEmoji('🔄')
                .setStyle(ButtonStyle.Success)
            );
          
          await btnInt.editReply({ 
            embeds: [newEmbed], 
            components: [newRow] 
          });
        } catch (error) {
          logger.error(`Next button error: ${error.message}`);
        }
      });

      registerButton(`weather_refresh_${stateId}`, async (btnInt) => {
        try {
          if (btnInt.user.id !== interaction.user.id) {
            return await btnInt.reply({ 
              content: '❌ You cannot use these controls.', 
              ephemeral: true 
            });
          }

          await btnInt.deferUpdate();
          
          // Show loading message
          const loadingEmbed = new EmbedBuilder()
            .setTitle('🔄 Refreshing Weather Data...')
            .setDescription('Please wait while we fetch the latest information.')
            .setColor('#3498DB');
            
          await btnInt.editReply({ 
            embeds: [loadingEmbed], 
            components: [] 
          });
          
          // Fetch fresh data
          state.primary = await fetchWeatherData(city, 'both');
          if (compareCity) {
            state.compare = await fetchWeatherData(compareCity, 'both');
          }
          
          const newEmbed = buildPageEmbed(state);
          const newRow = new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId(`weather_prev_${stateId}`)
                .setLabel('Previous')
                .setEmoji('⬅️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(state.currentPage === 1),
              new ButtonBuilder()
                .setCustomId(`weather_page_${stateId}`)
                .setLabel(`Page ${state.currentPage}/${state.totalPages}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),
              new ButtonBuilder()
                .setCustomId(`weather_next_${stateId}`)
                .setLabel('Next')
                .setEmoji('➡️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(state.currentPage === state.totalPages),
              new ButtonBuilder()
                .setCustomId(`weather_refresh_${stateId}`)
                .setLabel('Refresh')
                .setEmoji('🔄')
                .setStyle(ButtonStyle.Success)
            );
          
          await btnInt.editReply({ 
            embeds: [newEmbed], 
            components: [newRow] 
          });
        } catch (error) {
          logger.error(`Refresh error: ${error.message}`);
          const errorEmbed = new EmbedBuilder()
            .setTitle('❌ Refresh Failed')
            .setDescription(`Could not refresh weather data: ${error.message}`)
            .setColor('#E74C3C');
          await btnInt.editReply({ 
            embeds: [errorEmbed], 
            components: [] 
          });
        }
      });

      // Send initial response
      await interaction.editReply({ 
        embeds: [embed], 
        components: [row] 
      });
      
    } catch (error) {
      logger.error(`Weather command error: ${error.message}`);
      const errorEmbed = new EmbedBuilder()
        .setTitle('❌ Weather Command Error')
        .setDescription(`${error.message}`)
        .setColor('#E74C3C')
        .setTimestamp();
      await interaction.editReply({ 
        embeds: [errorEmbed], 
        components: [] 
      });
    }
  }
};