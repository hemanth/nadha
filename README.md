# Nadha

A fully on-device voice agent that runs entirely in your browser. No servers, no API calls, complete privacy.

**Speak → Think → Respond**

## What is Nadha?

Nadha is a voice agent that listens to your speech, processes it through a local language model, and responds with natural-sounding synthesized speech. Everything runs client-side using WebAssembly and ONNX Runtime, ensuring your conversations never leave your device.

## Features

- **On-Device LLM** - SmolLM2-360M runs locally via WebAssembly (Wllama)
- **Neural TTS** - Supertonic-2 provides high-quality text-to-speech via ONNX Runtime
- **Whisper STT** - Local speech recognition using Whisper ONNX models
- **Complete Privacy** - No data transmitted to external servers
- **WebGPU Acceleration** - Uses GPU when available for faster inference

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Open http://localhost:3000
```

Tap the microphone, speak your question, and hear Nadha respond.

## Model Setup

### Supertonic TTS Models

For high-quality on-device TTS, download the models to `public/models/supertonic/`:

```bash
# Requires git-lfs
brew install git-lfs && git lfs install

# Clone models
git clone https://huggingface.co/nickmuchi/supertonic-onnx public/models/supertonic
```

### Whisper STT Models

Download Whisper ONNX models to `public/models/whisper/` for local speech recognition.

## Architecture

| Component | Technology |
|-----------|------------|
| LLM | Wllama + SmolLM2-360M-Instruct |
| TTS | Supertonic-2 (ONNX Runtime) |
| STT | Whisper (ONNX Runtime) |
| Runtime | WebAssembly / WebGPU |

## How It Works

1. **Speech Input** - Whisper ONNX transcribes your voice to text
2. **LLM Processing** - SmolLM2 generates a response using Wllama
3. **Speech Output** - Supertonic synthesizes natural speech from the response

All processing happens in your browser. Models are cached after first download.

---

Built by [Hemanth HM](https://h3manth.com)
