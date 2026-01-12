# Nadha - Voice LLM

Talk to an AI and hear it respond. Runs entirely in your browser.

🎤 **Speak** → 🧠 **Think** → 🔊 **Respond**

## Features

- **On-device LLM:** Gemma 3 1B runs locally via WebAssembly
- **Voice input:** Web Speech API for speech-to-text
- **Voice output:** Text-to-speech for AI responses
- **Privacy first:** No data leaves your browser

## Usage

```bash
# Install dependencies
npm install

# Start local server
npx serve .

# Open http://localhost:3000
```

Click the microphone → speak your question → hear the response.

## Tech Stack

- [Wllama](https://github.com/ngxson/wllama) - WebAssembly LLM inference
- [Gemma 3 1B](https://huggingface.co/google/gemma-3-1b-it-qat-q4_0-gguf) - Google's efficient LLM
- Web Speech API - Native browser STT/TTS

---

Built with ❤️ by [Hemanth HM](https://h3manth.com)
