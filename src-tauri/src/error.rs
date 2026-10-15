//! Application error type shared by commands and services.
//!
//! Errors are serialized to the frontend as `{ kind, code, message }`. Messages are
//! written for users and never include API keys, request headers or image payloads.

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

use crate::guard::GuardError;
use crate::providers::anthropic::ProviderError;
use crate::providers::pinterest::PinterestError;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Invalid(String),
    #[error(transparent)]
    Guard(#[from] GuardError),
    #[error(transparent)]
    Provider(#[from] ProviderError),
    #[error(transparent)]
    Pinterest(#[from] PinterestError),
    #[error("Secure credential storage error: {0}")]
    Secret(String),
    #[error("{0}")]
    Internal(String),
}

impl AppError {
    pub fn kind(&self) -> &'static str {
        match self {
            AppError::Db(_) => "db",
            AppError::NotFound(_) => "not_found",
            AppError::Invalid(_) => "invalid",
            AppError::Guard(_) => "guard",
            AppError::Provider(_) => "provider",
            AppError::Pinterest(_) => "provider",
            AppError::Secret(_) => "secret",
            AppError::Internal(_) => "internal",
        }
    }

    pub fn code(&self) -> String {
        match self {
            AppError::Guard(g) => g.code().to_string(),
            AppError::Provider(p) => p.code().to_string(),
            AppError::Pinterest(p) => p.code().to_string(),
            other => other.kind().to_string(),
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("AppError", 3)?;
        s.serialize_field("kind", self.kind())?;
        s.serialize_field("code", &self.code())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;
