//! Remote provider adapters that need secrets (and therefore live in the backend).
//!
//! Search providers that need no credentials (mock, Openverse) live in the frontend
//! under `src/features/search/providers/`. Pinterest needs an access token, so its
//! HTTP call lives here and the frontend only normalizes the returned JSON.

pub mod anthropic;
pub mod pinterest;
