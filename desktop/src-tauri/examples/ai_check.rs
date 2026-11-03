//! Developer tool: query the local Ollama through the app's client (text only; never captures
//! the screen). Also exercises cancellation.
//!   cargo run --example ai_check -- "your question"
use desktop_lib::ai::{self, ChatMessage, Curl};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

fn main() {
    let q = std::env::args().nth(1).unwrap_or_else(|| "Give me one short encouraging line.".into());
    let st = ai::status(&Curl, "auto");
    println!("status: available={} model={:?} models={:?} reason={:?}", st.available, st.model, st.models.iter().map(|m| &m.name).collect::<Vec<_>>(), st.reason);
    let t = std::time::Instant::now();
    let hist = vec![ChatMessage { role: "user".into(), content: q }];
    println!("answer ({:?}): {:?}", t.elapsed(), ai::ask(&Curl, "auto", &hist, None, &AtomicBool::new(false)));
    // Cancel after 300 ms.
    let flag = Arc::new(AtomicBool::new(false));
    let f2 = flag.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));
        f2.store(true, std::sync::atomic::Ordering::Relaxed);
    });
    let t = std::time::Instant::now();
    let long = vec![ChatMessage { role: "user".into(), content: "Write a long story about slimes.".into() }];
    println!("cancelled ({:?}): {:?}", t.elapsed(), ai::ask(&Curl, "auto", &long, None, &flag).map(|s| s.len()));
}
