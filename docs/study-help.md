# Study help: your companion as a personal tutor

Ask for it by voice or text ("help me with my homework", "explain this question", "tutor me"), or
right-click her → *Study help ♡*. It needs screen understanding on (Awareness settings) and macOS
Screen Recording permission, like *Ask about my screen*.

## How it goes

1. **You box the question.** A soft pink tint and a hint appear; drag a box around the question
   (Esc cancels).
2. **She reads it.** That part of the screen is captured after the usual privacy checks (opt-in,
   excluded apps, no password field active), its text and where each line is are read on this Mac
   with Apple's Vision framework (`src-tauri/helpers/ocr-helper.swift`), and the pixels are dropped.
   Nothing is written to disk.
3. **She thinks.** The text goes to your local model (Ollama), which answers with a structured
   lesson (`src-tauri/src/study.rs`).
4. **A little classroom opens beside the question**, and the question gets a pink, bubbly frame
   with floating bubbles and hearts. The lesson is written on the chalkboard in waves
   (`src/study/`): the **answer first** (in pink chalk), then the explanation a line or two at a
   time, so there's never a wall of text. Older lines fade up as new ones are written, with chalk
   dust. *Pause*, *Next*, *Simpler, please* and *Ask Gemini* sit along the floor.

## By kind of question

- **Multiple choice:** the answer, the concepts it tests, the reasoning in short steps, then what
  every option means (the best one starred). A ghost cursor circles the best option on screen and
  points at each option as it's explained. It ends with "Your pick": **you** click the answer.
- **Writing:** ideas to write about, a short outline, the key concepts. She never writes it for
  you. When you've written something, *Read my writing* boxes the same area again and she gives
  feedback on your own words (what works, what to improve), without rewriting them.
- **Drag and drop:** where each item belongs and why, with the ghost cursor carrying a copy of each
  item to its place on screen. You do the real dragging.

## Ghost cursor

A pink heart cursor with a sparkle trail. It's only an animation in her overlay: it never clicks,
types or drags anything in your work.

## Gemini

When a question is hard (or the local model can't help), *Ask Gemini ✨* copies the question to the
clipboard and opens gemini.google.com in your browser; paste it there with ⌘V. The board shows a
"Gemini (external AI) is helping" badge whenever it's been used.

## Her reactions

She cheers you on in her speech bubble ("Homework time!", "Got it! Let's learn it together~",
"Good luck, Master!") with a wave or a hop. The installed voice pack only has hit and knock-out
clips, so these lines are written, not spoken.
