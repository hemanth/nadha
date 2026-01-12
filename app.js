/**
 * Nadha - Voice LLM Interface
 * 
 * STT: Whisper.cpp via @remotion/whisper-web
 * LLM: SmolLM2-360M via Wllama
 * TTS: Supertonic-2 via ONNX Runtime
 */

import { Wllama } from 'https://cdn.jsdelivr.net/npm/@wllama/wllama@2.2.1/esm/index.js';
import WasmFromCDN from 'https://cdn.jsdelivr.net/npm/@wllama/wllama@2.2.1/esm/wasm-from-cdn.js';
import { loadTextToSpeech, loadVoiceStyle, writeWavFile } from './helper.js';

// ============================================================================
// State
// ============================================================================

const state = {
    // LLM
    wllama: null,
    modelLoaded: false,

    // TTS
    tts: null,
    ttsStyle: null,
    ttsReady: false,

    // STT (using Web Speech API for now, can swap for whisper.wasm)
    recognition: null,

    // UI state
    isListening: false,
    isProcessing: false,
    isSpeaking: false,
};

// ============================================================================
// DOM Elements
// ============================================================================

const elements = {
    status: document.getElementById('status'),
    statusText: document.getElementById('status-text'),
    userText: document.getElementById('user-text'),
    aiText: document.getElementById('ai-text'),
    voiceBtn: document.getElementById('voice-btn'),
    loading: document.getElementById('loading'),
    loadingLabel: document.getElementById('loading-label'),
    progress: document.getElementById('progress'),
    progressText: document.getElementById('progress-text'),
};

// ============================================================================
// Status Management
// ============================================================================

function setStatus(status, text) {
    elements.status.className = `status ${status}`;
    elements.statusText.textContent = text;

    if (status === 'listening') {
        elements.voiceBtn.classList.add('active');
    } else {
        elements.voiceBtn.classList.remove('active');
    }
}

function updateProgress(pct, text, label) {
    elements.progress.style.width = `${pct}%`;
    elements.progressText.textContent = text || `${pct}%`;
    if (label && elements.loadingLabel) {
        elements.loadingLabel.textContent = label;
    }
}

// ============================================================================
// TTS Initialization (Supertonic-2)
// ============================================================================

async function initTTS() {
    console.log('[Nadha] Loading Supertonic TTS...');
    updateProgress(0, 'Initializing...', 'Loading Supertonic TTS...');

    try {
        // Load from HuggingFace Spaces CDN (no git-lfs needed)
        const HF_SPACE_URL = 'https://huggingface.co/spaces/Supertone/supertonic-2/resolve/main';
        const onnxDir = `${HF_SPACE_URL}/assets/onnx`;
        const voiceStylePath = `${HF_SPACE_URL}/assets/voice_styles/M1.json`;

        const result = await loadTextToSpeech(onnxDir, {
            executionProviders: ['wasm'],
            graphOptimizationLevel: 'all'
        }, (modelName, current, total) => {
            const pct = Math.round((current / total) * 25); // TTS = 25% of loading
            updateProgress(pct, `${current}/${total}: ${modelName}`, 'Loading Supertonic TTS...');
        });

        state.tts = result.textToSpeech;

        // Load default voice style
        state.ttsStyle = await loadVoiceStyle([voiceStylePath]);
        state.ttsReady = true;

        console.log('[Nadha] TTS loaded successfully');
        return true;
    } catch (err) {
        console.error('[Nadha] TTS load failed:', err);
        return false;
    }
}

// ============================================================================
// LLM Initialization (Wllama + SmolLM2)
// ============================================================================

async function initLLM() {
    console.log('[Nadha] Loading LLM...');
    updateProgress(30, 'Initializing...', 'Loading SmolLM2 LLM...');

    try {
        state.wllama = new Wllama(WasmFromCDN, {
            parallelDownloads: 3,
        });

        await state.wllama.loadModelFromHF(
            'HuggingFaceTB/SmolLM2-360M-Instruct-GGUF',
            'smollm2-360m-instruct-q8_0.gguf',
            {
                progressCallback: ({ loaded, total }) => {
                    const pct = 30 + Math.round((loaded / total) * 60); // LLM = 30-90% of loading
                    updateProgress(pct, `${Math.round((loaded / total) * 100)}%`, 'Loading SmolLM2 LLM...');
                }
            }
        );

        state.modelLoaded = true;
        console.log('[Nadha] LLM loaded successfully');
        return true;
    } catch (err) {
        console.error('[Nadha] LLM load failed:', err);
        return false;
    }
}

// ============================================================================
// Speech Recognition (STT)
// ============================================================================

function initSpeechRecognition() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        console.error('[Nadha] Speech recognition not supported');
        return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    state.recognition = new SpeechRecognition();
    state.recognition.continuous = true;  // Keep listening
    state.recognition.interimResults = true;
    state.recognition.lang = 'en-US';
    state.recognition.maxAlternatives = 1;

    state.recognition.onstart = () => {
        console.log('[Nadha] STT started');
        state.isListening = true;
        setStatus('listening', 'Listening...');
        elements.userText.textContent = '';
    };

    state.recognition.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalTranscript += transcript;
            } else {
                interimTranscript += transcript;
            }
        }

        const displayText = finalTranscript || interimTranscript;
        console.log('[Nadha] STT result:', displayText, 'isFinal:', !!finalTranscript);
        elements.userText.textContent = `"${displayText}"`;

        // If we got a final result, stop listening and process
        if (finalTranscript.trim()) {
            state.recognition.stop();
        }
    };

    state.recognition.onend = () => {
        console.log('[Nadha] STT ended');
        state.isListening = false;
        const userInput = elements.userText.textContent.replace(/^"|"$/g, '');
        console.log('[Nadha] User input:', userInput);

        if (userInput.trim()) {
            processWithLLM(userInput);
        } else {
            console.log('[Nadha] No input detected');
            setStatus('idle', 'Click to speak');
        }
    };

    state.recognition.onerror = (event) => {
        console.error('[Nadha] Speech recognition error:', event.error);
        state.isListening = false;
        setStatus('idle', 'Click to speak');
    };
}

// ============================================================================
// LLM Processing
// ============================================================================

async function processWithLLM(userInput) {
    if (!state.modelLoaded || state.isProcessing) return;

    state.isProcessing = true;
    setStatus('thinking', 'Thinking...');
    elements.aiText.textContent = '';

    try {
        const prompt = `<|im_start|>user
${userInput}<|im_end|>
<|im_start|>assistant
`;

        let response = '';

        await state.wllama.createCompletion(prompt, {
            nPredict: 256,
            sampling: {
                temp: 0.7,
                top_k: 40,
                top_p: 0.9,
            },
            onNewToken: (token, piece) => {
                response += piece;
                const cleanResponse = response.replace(/<\|im_end\|>.*$/s, '').trim();
                elements.aiText.textContent = cleanResponse;
            },
        });

        const finalResponse = response.replace(/<\|im_end\|>.*$/s, '').trim();
        elements.aiText.textContent = finalResponse;

        // Speak the response with Supertonic TTS
        await speak(finalResponse);
    } catch (err) {
        console.error('[Nadha] LLM error:', err);
        setStatus('idle', 'Click to speak');
    } finally {
        state.isProcessing = false;
    }
}

// ============================================================================
// Text-to-Speech (Supertonic-2)
// ============================================================================

async function speak(text) {
    if (!text || !state.ttsReady) {
        // Fallback to Web Speech API
        fallbackSpeak(text);
        return;
    }

    state.isSpeaking = true;
    setStatus('speaking', 'Speaking...');

    try {
        const { wav, duration } = await state.tts.call(
            text,
            'en',
            state.ttsStyle,
            4, // totalStep (lower = faster, 4-8 recommended)
            1.0, // speed
            0.3 // silence duration between chunks
        );

        // Create audio and play
        const wavLen = Math.floor(state.tts.sampleRate * duration[0]);
        const wavOut = wav.slice(0, wavLen);
        const wavBuffer = writeWavFile(wavOut, state.tts.sampleRate);
        const blob = new Blob([wavBuffer], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);

        const audio = new Audio(url);
        audio.onended = () => {
            state.isSpeaking = false;
            setStatus('idle', 'Click to speak');
            URL.revokeObjectURL(url);
        };
        audio.onerror = () => {
            state.isSpeaking = false;
            setStatus('idle', 'Click to speak');
        };
        audio.play();
    } catch (err) {
        console.error('[Nadha] TTS error:', err);
        // Fallback to Web Speech API
        fallbackSpeak(text);
    }
}

function fallbackSpeak(text) {
    if (!text) {
        setStatus('idle', 'Click to speak');
        return;
    }

    state.isSpeaking = true;
    setStatus('speaking', 'Speaking...');

    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    utterance.onend = () => {
        state.isSpeaking = false;
        setStatus('idle', 'Click to speak');
    };

    utterance.onerror = () => {
        state.isSpeaking = false;
        setStatus('idle', 'Click to speak');
    };

    synth.speak(utterance);
}

// ============================================================================
// Voice Toggle
// ============================================================================

window.toggleVoice = function () {
    if (!state.modelLoaded) return;

    if (state.isSpeaking) {
        window.speechSynthesis.cancel();
        state.isSpeaking = false;
        setStatus('idle', 'Click to speak');
        return;
    }

    if (state.isListening) {
        state.recognition.stop();
        return;
    }

    if (state.isProcessing) return;

    state.recognition.start();
};

// ============================================================================
// Initialize
// ============================================================================

async function init() {
    console.log('[Nadha] Starting...');

    // Initialize STT
    initSpeechRecognition();

    // Load TTS models
    const ttsOk = await initTTS();
    if (!ttsOk) {
        console.warn('[Nadha] TTS failed, will use fallback');
    }

    // Load LLM
    const llmOk = await initLLM();

    if (llmOk) {
        updateProgress(100, 'Ready!');
        elements.loading.classList.add('hidden');
        setStatus('idle', 'Click to speak');
        console.log('[Nadha] All systems ready');
    } else {
        updateProgress(0, 'Error loading models');
    }
}

init();
