//! Secret storage (API keys and access tokens).
//!
//! The desktop app stores secrets in the OS credential store (Windows Credential
//! Manager via the `keyring` crate). Secrets are write-only from the frontend's point
//! of view: the UI can set or remove them and ask whether one is stored, but they are
//! never returned to the webview, logged, or serialized.

use std::collections::HashMap;
use std::fmt;
use std::sync::Mutex;

use crate::error::{AppError, AppResult};

const SERVICE: &str = "com.findmyrefs.app";

/// Which secret to read or write. Each kind is a separate credential entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SecretKind {
    /// Optional, paid: Anthropic API key.
    AnthropicApiKey,
    /// Optional, free: Pinterest API access token.
    PinterestToken,
}

impl SecretKind {
    fn account(self) -> &'static str {
        match self {
            SecretKind::AnthropicApiKey => "anthropic-api-key",
            SecretKind::PinterestToken => "pinterest-access-token",
        }
    }
}

/// A secret that cannot be printed by accident.
#[derive(Clone)]
pub struct ApiKey(String);

impl ApiKey {
    pub fn new(raw: &str) -> AppResult<Self> {
        let key = raw.trim();
        if key.is_empty() {
            return Err(AppError::Invalid("The key must not be empty".into()));
        }
        if key.len() > 4096 || key.chars().any(|c| c.is_whitespace() || c.is_control()) {
            return Err(AppError::Invalid("The key format looks invalid".into()));
        }
        Ok(Self(key.to_string()))
    }

    /// The raw secret. Only HTTP transports should call this.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for ApiKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ApiKey(<redacted>)")
    }
}

impl fmt::Display for ApiKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("<redacted>")
    }
}

pub trait SecretStore: Send + Sync {
    fn get(&self, kind: SecretKind) -> AppResult<Option<ApiKey>>;
    fn set(&self, kind: SecretKind, key: ApiKey) -> AppResult<()>;
    fn clear(&self, kind: SecretKind) -> AppResult<()>;
    /// Human-readable storage description shown in Settings.
    fn description(&self) -> &'static str;
}

/// OS credential store (Windows Credential Manager on Windows).
pub struct KeyringStore;

impl KeyringStore {
    fn entry(kind: SecretKind) -> AppResult<keyring::Entry> {
        // keyring errors never contain the secret itself.
        keyring::Entry::new(SERVICE, kind.account()).map_err(|e| AppError::Secret(e.to_string()))
    }
}

impl SecretStore for KeyringStore {
    fn get(&self, kind: SecretKind) -> AppResult<Option<ApiKey>> {
        match Self::entry(kind)?.get_password() {
            Ok(raw) => ApiKey::new(&raw).map(Some),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(AppError::Secret(e.to_string())),
        }
    }

    fn set(&self, kind: SecretKind, key: ApiKey) -> AppResult<()> {
        Self::entry(kind)?
            .set_password(key.expose())
            .map_err(|e| AppError::Secret(e.to_string()))
    }

    fn clear(&self, kind: SecretKind) -> AppResult<()> {
        match Self::entry(kind)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(AppError::Secret(e.to_string())),
        }
    }

    fn description(&self) -> &'static str {
        if cfg!(windows) {
            "Windows Credential Manager"
        } else if cfg!(target_os = "macos") {
            "macOS Keychain"
        } else {
            "System Secret Service"
        }
    }
}

/// In-memory store used by tests.
#[derive(Default)]
pub struct MemorySecretStore(Mutex<HashMap<SecretKind, ApiKey>>);

impl SecretStore for MemorySecretStore {
    fn get(&self, kind: SecretKind) -> AppResult<Option<ApiKey>> {
        Ok(self.0.lock().expect("secret lock").get(&kind).cloned())
    }
    fn set(&self, kind: SecretKind, key: ApiKey) -> AppResult<()> {
        self.0.lock().expect("secret lock").insert(kind, key);
        Ok(())
    }
    fn clear(&self, kind: SecretKind) -> AppResult<()> {
        self.0.lock().expect("secret lock").remove(&kind);
        Ok(())
    }
    fn description(&self) -> &'static str {
        "In-memory (tests only)"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_key_is_redacted_in_debug_and_display() {
        let key = ApiKey::new("sk-ant-test-SECRET123").unwrap();
        assert!(!format!("{key:?}").contains("SECRET123"));
        assert!(!format!("{key}").contains("SECRET123"));
        assert_eq!(key.expose(), "sk-ant-test-SECRET123");
    }

    #[test]
    fn api_key_validation() {
        assert!(ApiKey::new("   ").is_err());
        assert!(ApiKey::new("sk-ant abc").is_err());
        assert_eq!(ApiKey::new("  sk-ant-x  ").unwrap().expose(), "sk-ant-x");
    }

    #[test]
    fn memory_store_keeps_kinds_separate() {
        let store = MemorySecretStore::default();
        assert!(store.get(SecretKind::AnthropicApiKey).unwrap().is_none());
        store
            .set(SecretKind::PinterestToken, ApiKey::new("pina_1").unwrap())
            .unwrap();
        assert!(store.get(SecretKind::AnthropicApiKey).unwrap().is_none());
        assert!(store.get(SecretKind::PinterestToken).unwrap().is_some());
        store.clear(SecretKind::PinterestToken).unwrap();
        assert!(store.get(SecretKind::PinterestToken).unwrap().is_none());
    }

    #[test]
    fn credential_entries_are_distinct() {
        assert_ne!(
            SecretKind::AnthropicApiKey.account(),
            SecretKind::PinterestToken.account()
        );
    }
}
