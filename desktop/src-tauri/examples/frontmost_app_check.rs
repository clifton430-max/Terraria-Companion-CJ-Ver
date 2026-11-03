//! Developer tool: print the frontmost app, the running regular apps and the secure-input state.
//! Reads only bundle ids and names (no window titles or contents).
//!   cargo run --example frontmost_app_check
fn main() {
    println!("frontmost: {:?}", desktop_lib::apps::frontmost());
    println!("secure input: {}", desktop_lib::apps::secure_input_enabled());
    for a in desktop_lib::apps::running_apps() {
        println!("  {:<40} {}", a.bundle_id, a.name);
    }
}
