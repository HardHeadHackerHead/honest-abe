//! API keys live in the OS keychain (Windows Credential Manager, macOS
//! Keychain, Secret Service on Linux), one entry per provider. Keys are only
//! ever read here, in Rust; no command returns a key to the webview.

use super::error::{EngineError, EngineResult};
use super::provider::ProviderId;
use std::fmt;

const SERVICE: &str = "io.quadslab.abe";

/// An API key. Debug output never shows the value.
#[derive(Clone)]
pub struct ApiKey(String);

impl ApiKey {
    #[cfg(test)]
    pub fn new(key: impl Into<String>) -> Self {
        Self(key.into())
    }

    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for ApiKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ApiKey([redacted])")
    }
}

fn entry(provider: ProviderId) -> EngineResult<keyring::Entry> {
    keyring::Entry::new(SERVICE, provider.as_str()).map_err(keychain_error)
}

fn keychain_error(err: keyring::Error) -> EngineError {
    // keyring errors describe the backend, never the secret
    EngineError::unknown(format!("Couldn't access the system keychain: {err}"))
}

pub fn set(provider: ProviderId, key: &str) -> EngineResult<()> {
    let key = key.trim();
    if key.is_empty() {
        return Err(EngineError::unknown("The API key is empty."));
    }
    if key.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(EngineError::unknown("The API key contains spaces or line breaks. Paste just the key."));
    }
    entry(provider)?.set_password(key).map_err(keychain_error)
}

pub fn get(provider: ProviderId) -> EngineResult<Option<ApiKey>> {
    match entry(provider)?.get_password() {
        Ok(key) if !key.is_empty() => Ok(Some(ApiKey(key))),
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(keychain_error(err)),
    }
}

pub fn has(provider: ProviderId) -> bool {
    matches!(get(provider), Ok(Some(_)))
}

pub fn delete(provider: ProviderId) -> EngineResult<()> {
    match entry(provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(keychain_error(err)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_never_shows_the_key() {
        let key = ApiKey::new("sk-secret-value");
        assert_eq!(format!("{key:?}"), "ApiKey([redacted])");
        assert_eq!(key.expose(), "sk-secret-value");
    }

    #[test]
    fn rejects_malformed_keys_before_touching_the_keychain() {
        assert!(set(ProviderId::Groq, "   ").is_err());
        assert!(set(ProviderId::Groq, "gsk_abc def").is_err());
    }
}
