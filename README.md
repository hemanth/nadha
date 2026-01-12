# Nadha - Voice LLM

Talk to an AI and hear it respond. Runs entirely in your browser.

🎤 **Speak** → 🧠 **Think** → 🔊 **Respond**

## Features

- **On-device LLM:** SmolLM2-360M runs locally via WebAssembly
- **Supertonic TTS:** High-quality text-to-speech via ONNX Runtime (optional)
- **Voice input:** Web Speech API for speech-to-text
- **Privacy first:** No data leaves your browser

## Usage

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Open http://localhost:3000
```

Click the microphone → speak your question → hear the response.

## Supertonic TTS (Optional)

For high-quality on-device TTS, download the models:

```bash
# Requires git-lfs (brew install git-lfs && git lfs install)
git clone https://huggingface.co/Supertone/supertonic-2 assets
```

Without these, the app uses browser's Web Speech API as fallback.

## Tech Stack

| Component | Library |
|-----------|---------|
| LLM | [Wllama](https://github.com/ngxson/wllama) + SmolLM2-360M |
| TTS | [Supertonic-2](https://github.com/supertone-inc/supertonic) (ONNX) |
| STT | Web Speech API |

---

Built with ❤️ by [Hemanth HM](https://h3manth.com)
