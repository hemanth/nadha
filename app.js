/**
 * Nadha - Voice LLM Interface (Simplified)
 * 
 * STT: Web Speech API (Chrome)
 * LLM: SmolLM2-360M via Wllama
 * TTS: Web Speech Synthesis API
 */

import { Wllama } from 'https://cdn.jsdelivr.net/npm/@wllama/wllama@2.2.1/esm/index.js';
import WasmFromCDN from 'https://cdn.jsdelivr.net/npm/@wllama/wllama@2.2.1/esm/wasm-from-cdn.js';

// ============================================================================
// State
// ============================================================================

const state = {
    wllama: null,
    modelLoaded: false,
    recognition: null,
    synth: window.speechSynthesis,
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
    elements.voiceBtn.classList.toggle('active', status === 'listening');
}

function updateProgress(pct, text, label) {
    elements.progress.style.width = `${pct}%`;
    elements.progressText.textContent = text || `${pct}%`;
    if (label && elements.loadingLabel) {
        elements.loadingLabel.textContent = label;
    }
}

// ============================================================================
// LLM Initialization
// ============================================================================

async function initLLM() {
    console.log('[Nadha] Loading LLM...');
    updateProgress(10, 'Initializing...', 'Loading SmolLM2...');

    try {
        state.wllama = new Wllama(WasmFromCDN, { parallelDownloads: 3 });

        await state.wllama.loadModelFromHF(
            'HuggingFaceTB/SmolLM2-360M-Instruct-GGUF',
            'smollm2-360m-instruct-q8_0.gguf',
            {
                progressCallback: ({ loaded, total }) => {
                    const pct = 10 + Math.round((loaded / total) * 80);
                    updateProgress(pct, `${Math.round((loaded / total) * 100)}%`, 'Loading SmolLM2...');
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
// Speech Recognition (STT) - Web Speech API
// ============================================================================

function initSpeechRecognition() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        console.error('[Nadha] Speech recognition not supported');
        return false;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    state.recognition = new SpeechRecognition();
    state.recognition.continuous = true;
    state.recognition.interimResults = true;
    state.recognition.lang = 'en-US';

    state.recognition.onstart = () => {
        console.log('[Nadha] STT started');
        state.isListening = true;
        setStatus('listening', 'Listening...');
        elements.userText.textContent = '';
    };

    state.recognition.onresult = (event) => {
        let finalTranscript = '';
        let interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalTranscript += transcript;
            } else {
                interimTranscript += transcript;
            }
        }

        const displayText = finalTranscript || interimTranscript;
        if (displayText) {
            elements.userText.textContent = `"${displayText}"`;
            console.log('[Nadha] STT:', displayText, 'isFinal:', !!finalTranscript);
        }

        // Process when we get final result
        if (finalTranscript.trim()) {
            state.recognition.stop();
        }
    };

    state.recognition.onend = () => {
        console.log('[Nadha] STT ended');
        state.isListening = false;
        const userInput = elements.userText.textContent.replace(/^"|"$/g, '').trim();

        if (userInput) {
            processWithLLM(userInput);
        } else {
            setStatus('idle', 'Click to speak');
        }
    };

    state.recognition.onerror = (event) => {
        console.error('[Nadha] STT error:', event.error);
        state.isListening = false;

        if (event.error === 'no-speech') {
            setStatus('idle', 'No speech detected');
        } else {
            setStatus('idle', 'Error - try again');
        }
    };

    console.log('[Nadha] Web Speech STT initialized');
    return true;
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
            sampling: { temp: 0.7, top_k: 40, top_p: 0.9 },
            onNewToken: (token, piece) => {
                response += piece;
                const clean = response.replace(/<\|im_end\|>.*$/s, '').trim();
                elements.aiText.textContent = clean;
            },
        });

        const finalResponse = response.replace(/<\|im_end\|>.*$/s, '').trim();
        elements.aiText.textContent = finalResponse;

        // Speak the response
        speak(finalResponse);
    } catch (err) {
        console.error('[Nadha] LLM error:', err);
        setStatus('idle', 'Error - try again');
    } finally {
        state.isProcessing = false;
    }
}

// ============================================================================
// Text-to-Speech (TTS) - Web Speech Synthesis
// ============================================================================

function speak(text) {
    if (!text) {
        setStatus('idle', 'Click to speak');
        return;
    }

    state.isSpeaking = true;
    setStatus('speaking', 'Speaking...');

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

window.toggleVoice = async function () {
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

    // Request mic permission first
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        console.log('[Nadha] Mic permission granted');
        state.recognition.start();
    } catch (err) {
        console.error('[Nadha] Mic permission denied:', err);
        setStatus('idle', 'Mic access denied');
    }
};

// ============================================================================
// Initialize
// ============================================================================

async function init() {
    console.log('[Nadha] Starting...');

    // Init STT
    const sttOk = initSpeechRecognition();
    if (!sttOk) {
        console.warn('[Nadha] STT not supported in this browser');
    }

    // Load LLM
    const llmOk = await initLLM();

    if (llmOk) {
        updateProgress(100, 'Ready!');
        elements.loading.classList.add('hidden');
        setStatus('idle', 'Click to speak');
        console.log('[Nadha] All systems ready');
    } else {
        updateProgress(0, 'Error loading LLM');
    }
}

init();
