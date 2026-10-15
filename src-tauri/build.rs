fn main() {
    // Re-embed the Windows executable icon when the icon files change.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
