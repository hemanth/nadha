/**
 * Nadha - Voice LLM Interface
 * 
 * Talk to Gemma 3 1B and hear responses via Supertonic TTS
 */

import { Wllama } from 'https://cdn.jsdelivr.net/npm/@wllama/wllama@2.2.1/esm/index.js';
import WasmFromCDN from 'https://cdn.jsdelivr.net/npm/@wllama/wllama@2.2.1/esm/wasm-from-cdn.js';

// ============================================================================
// State
// ============================================================================

const state = {
    wllama: null,
    recognition: null,
    synth: window.speechSynthesis,
    isListening: false,
    isProcessing: false,
    isSpeaking: false,
    modelLoaded: false,
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

// ============================================================================
// LLM Initialization
// ============================================================================

async function initLLM() {
    console.log('[Nadha] Initializing Wllama...');

    try {
        state.wllama = new Wllama(WasmFromCDN, {
            parallelDownloads: 3,
        });

        const progressCallback = ({ loaded, total }) => {
            const pct = Math.round((loaded / total) * 100);
            elements.progress.style.width = `${pct}%`;
            elements.progressText.textContent = `${pct}%`;
        };

        // Load SmolLM2 360M Instruct (ungated, ~200MB)
        await state.wllama.loadModelFromHF(
            'HuggingFaceTB/SmolLM2-360M-Instruct-GGUF',
            'smollm2-360m-instruct-q8_0.gguf',
            { progressCallback }
        );

        state.modelLoaded = true;
        elements.loading.classList.add('hidden');
        setStatus('idle', 'Click to speak');
        console.log('[Nadha] Model loaded successfully');
    } catch (err) {
        console.error('[Nadha] Failed to load model:', err);
        elements.progressText.textContent = 'Error loading model';
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
    state.recognition.continuous = false;
    state.recognition.interimResults = true;
    state.recognition.lang = 'en-US';

    state.recognition.onstart = () => {
        state.isListening = true;
        setStatus('listening', 'Listening...');
        elements.userText.textContent = '';
    };

    state.recognition.onresult = (event) => {
        const transcript = Array.from(event.results)
            .map(result => result[0].transcript)
            .join('');
        elements.userText.textContent = `"${transcript}"`;
    };

    state.recognition.onend = () => {
        state.isListening = false;
        const userInput = elements.userText.textContent.replace(/^"|"$/g, '');

        if (userInput.trim()) {
            processWithLLM(userInput);
        } else {
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
        // Format prompt for SmolLM2 Instruct
        const prompt = `<|im_start|>user
${userInput}<|im_end|>
<|im_start|>assistant
`;

        let response = '';

        // Stream the response
        await state.wllama.createCompletion(prompt, {
            nPredict: 256,
            sampling: {
                temp: 0.7,
                top_k: 40,
                top_p: 0.9,
            },
            onNewToken: (token, piece) => {
                response += piece;
                // Clean up any end tokens
                const cleanResponse = response.replace(/<\|im_end\|>.*$/s, '').trim();
                elements.aiText.textContent = cleanResponse;
            },
        });

        // Clean final response
        const finalResponse = response.replace(/<end_of_turn>.*$/s, '').trim();
        elements.aiText.textContent = finalResponse;

        // Speak the response
        speak(finalResponse);
    } catch (err) {
        console.error('[Nadha] LLM error:', err);
        setStatus('idle', 'Click to speak');
    } finally {
        state.isProcessing = false;
    }
}

// ============================================================================
// Text-to-Speech
// ============================================================================

function speak(text) {
    if (!text) {
        setStatus('idle', 'Click to speak');
        return;
    }

    state.isSpeaking = true;
    setStatus('speaking', 'Speaking...');

    // Use Web Speech API for now (Supertonic can be added later)
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    utterance.onend = () => {
        state.isSpeaking = false;
        setStatus('idle', 'Click to speak');
    };

    utterance.onerror = (err) => {
        console.error('[Nadha] TTS error:', err);
        state.isSpeaking = false;
        setStatus('idle', 'Click to speak');
    };

    state.synth.speak(utterance);
}

// ============================================================================
// Voice Toggle
// ============================================================================

window.toggleVoice = function () {
    if (!state.modelLoaded) return;

    if (state.isSpeaking) {
        state.synth.cancel();
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
    initSpeechRecognition();
    await initLLM();
}

init();
