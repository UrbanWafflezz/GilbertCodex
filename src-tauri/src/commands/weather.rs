use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const WEATHER_CONNECT_TIMEOUT_SECS: u64 = 5;
const WEATHER_CLIENT_TIMEOUT_SECS: u64 = 18;
const MAX_WEATHER_RESPONSE_BYTES: usize = 16 * 1024 * 1024;
const WEATHER_USER_AGENT: &str = "GilbertCodex/0.8.5 (https://gilbertcodex.com)";
const ALLOWED_WEATHER_HOSTS: &[&str] = &[
    "api.open-meteo.com",
    "geocoding-api.open-meteo.com",
    "noaa.gov",
    "weather.gov",
    "api.weather.gov",
    "digital.weather.gov",
    "forecast.weather.gov",
    "mapservices.weather.noaa.gov",
    "www.ncei.noaa.gov",
    "www.nws.noaa.gov",
    "opengeo.ncep.noaa.gov",
    "mrms.ncep.noaa.gov",
    "nomads.ncep.noaa.gov",
    "radar.weather.gov",
    "water.noaa.gov",
    "api.water.noaa.gov",
    "api.tidesandcurrents.noaa.gov",
    "aviationweather.gov",
    "www.aviationweather.gov",
    "www.nhc.noaa.gov",
    "www.spc.noaa.gov",
    "www.cpc.ncep.noaa.gov",
    "www.swpc.noaa.gov",
    "api.weather.gc.ca",
    "dd.weather.gc.ca",
    "weather.gc.ca",
    "dwd.de",
    "opendata.dwd.de",
    "maps.dwd.de",
    "api.meteoalarm.org",
    "feeds.meteoalarm.org",
    "meteoalarm.org",
    "api.met.no",
    "thredds.met.no",
    "met.no",
    "bom.gov.au",
    "reg.bom.gov.au",
    "sws-data.sws.bom.gov.au",
    "cma.gov.cn",
    "data.cma.cn",
    "smn.conagua.gob.mx",
    "conagua.gob.mx",
    "www.gob.mx",
    "alertingauthority.wmo.int",
    "worldweather.wmo.int",
    "severeweather.wmo.int",
    "wmo.int",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherFetchJsonRequest {
    pub token: Option<String>,
    pub url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherFetchJsonResponse {
    pub content_type: Option<String>,
    pub payload: serde_json::Value,
    pub status: u16,
    pub url: String,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn weather_fetch_json(
    request: WeatherFetchJsonRequest,
) -> Result<WeatherFetchJsonResponse, String> {
    let url = validate_weather_url(&request.url)?;
    let client = reqwest::Client::builder()
        .user_agent(WEATHER_USER_AGENT)
        .connect_timeout(Duration::from_secs(WEATHER_CONNECT_TIMEOUT_SECS))
        .timeout(Duration::from_secs(WEATHER_CLIENT_TIMEOUT_SECS))
        .build()
        .map_err(|error| format!("Could not create weather client: {error}"))?;
    let mut builder = client
        .get(url.clone())
        .header(
            "Accept",
            "application/geo+json, application/ld+json, application/json, text/csv, text/plain;q=0.8, */*;q=0.5",
        )
        .header("Cache-Control", "no-cache")
        .header("Pragma", "no-cache")
        .header("Accept-Language", "en-US,en;q=0.9");

    if should_attach_cdo_token(&url) {
        if let Some(token) = request
            .token
            .as_deref()
            .map(str::trim)
            .filter(|token| !token.is_empty())
        {
            builder = builder.header("token", token);
        }
    }

    let response = builder
        .send()
        .await
        .map_err(|error| format!("Weather request failed: {error}"))?;
    let status = response.status();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);

    if let Some(length) = response.content_length() {
        if length > MAX_WEATHER_RESPONSE_BYTES as u64 {
            return Err(format!(
                "Weather response is too large ({length} bytes). Narrow the date range, station list, or endpoint."
            ));
        }
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Could not read weather response: {error}"))?;

    if bytes.len() > MAX_WEATHER_RESPONSE_BYTES {
        return Err(format!(
            "Weather response is too large ({} bytes). Narrow the request before retrying.",
            bytes.len()
        ));
    }

    let payload = serde_json::from_slice::<serde_json::Value>(&bytes).unwrap_or_else(|_| {
        serde_json::json!({
            "text": String::from_utf8_lossy(&bytes).to_string(),
        })
    });

    if !status.is_success() {
        return Err(format!(
            "Weather request failed with HTTP {}: {}",
            status.as_u16(),
            summarize_weather_error_payload(&payload)
        ));
    }

    Ok(WeatherFetchJsonResponse {
        content_type,
        payload,
        status: status.as_u16(),
        url: url.to_string(),
    })
}

fn validate_weather_url(raw_url: &str) -> Result<Url, String> {
    let url =
        Url::parse(raw_url.trim()).map_err(|error| format!("Invalid weather URL: {error}"))?;

    if url.scheme() != "https" {
        return Err("Weather requests must use https URLs.".to_string());
    }

    let host = url
        .host_str()
        .map(|host| host.to_ascii_lowercase())
        .ok_or_else(|| "Weather URL must include a host.".to_string())?;

    if !ALLOWED_WEATHER_HOSTS
        .iter()
        .any(|allowed| host == *allowed || host.ends_with(&format!(".{allowed}")))
    {
        return Err(format!(
            "Weather requests are limited to registered weather provider hosts. Blocked host: {host}"
        ));
    }

    Ok(url)
}

fn should_attach_cdo_token(url: &Url) -> bool {
    url.host_str()
        .is_some_and(|host| host.eq_ignore_ascii_case("www.ncei.noaa.gov"))
        && url.path().starts_with("/cdo-web/")
}

fn summarize_weather_error_payload(payload: &serde_json::Value) -> String {
    if let Some(message) = payload.get("detail").and_then(serde_json::Value::as_str) {
        return message.to_string();
    }

    if let Some(message) = payload.get("message").and_then(serde_json::Value::as_str) {
        return message.to_string();
    }

    if let Some(message) = payload
        .get("errorMessage")
        .and_then(serde_json::Value::as_str)
    {
        return message.to_string();
    }

    if let Some(text) = payload.get("text").and_then(serde_json::Value::as_str) {
        return text.to_string();
    }

    serde_json::to_string(payload).unwrap_or_else(|_| "No readable error body.".to_string())
}
