/**
 * Nadha - Voice LLM Interface
 * 
 * STT: Whisper via Transformers.js (local models)
 * LLM: SmolLM2-360M via Wllama
 * TTS: Supertonic-2 via ONNX Runtime (local models)
 */

import { Wllama } from 'https://cdn.jsdelivr.net/npm/@wllama/wllama@2.2.1/esm/index.js';
import WasmFromCDN from 'https://cdn.jsdelivr.net/npm/@wllama/wllama@2.2.1/esm/wasm-from-cdn.js';
import { loadTextToSpeech, loadVoiceStyle, writeWavFile } from './helper.js';
import { initWhisperSTT, startContinuousListening, stopContinuousListening, isListening, isWhisperReady } from './whisper-stt.js';

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
    prebakedAudio: [], // Pre-generated acknowledgment sounds
    // STT
    whisperReady: false,
    // UI
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
    waveform: document.getElementById('waveform'),
    loading: document.getElementById('loading'),
    loadingLabel: document.getElementById('loading-label'),
    progress: document.getElementById('progress'),
    progressText: document.getElementById('progress-text'),
    loadingFact: document.getElementById('loading-fact'),
};

// Interesting facts about the models
const modelFacts = [
    "� Llama-3.2-1B is Meta's latest efficient language model",
    "💻 The Whisper model can transcribe 99 different languages",
    "🎵 Supertonic TTS uses neural vocoder technology for natural speech",
    "⚡ All models run 100% in your browser - no data leaves your device",
    "🎤 Whisper was trained on 680,000 hours of audio data",
    "🏠 Everything runs locally using WebAssembly (WASM)",
    "🔒 Your conversations are completely private - no server involved",
    "📊 Llama-3.2-1B has 1 billion parameters in just ~600MB",
    "🎯 The TTS model generates speech at 24kHz sample rate",
    "🚀 Llama-3.2 is optimized for mobile and edge devices",
    "🌐 No internet required after models are cached",
];

let factInterval = null;

function startFactRotation() {
    let factIndex = 0;
    const showFact = () => {
        if (elements.loadingFact) {
            elements.loadingFact.textContent = modelFacts[factIndex];
            factIndex = (factIndex + 1) % modelFacts.length;
        }
    };
    showFact();
    factInterval = setInterval(showFact, 3000);
}

function stopFactRotation() {
    if (factInterval) {
        clearInterval(factInterval);
        factInterval = null;
    }
}

// ============================================================================
// Status Management
// ============================================================================

function setStatus(status, text) {
    elements.status.className = `status ${status}`;
    elements.statusText.textContent = text;

    // Update voice button state
    elements.voiceBtn.className = `voice-btn ${status}`;

    // Update waveform visibility
    if (elements.waveform) {
        elements.waveform.classList.toggle('active', status === 'listening' || status === 'speaking');
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
// TTS Initialization (Supertonic-2 from local models)
// ============================================================================

async function initTTS() {
    console.log('[Nadha] Loading Supertonic TTS...');
    updateProgress(0, 'Initializing...', 'Loading TTS...');

    try {
        // Load from local models
        const onnxDir = '/models/supertonic';
        const voiceStylePath = '/models/supertonic/M1.json';

        // Try WebGPU first (much faster), then fall back to WASM
        const result = await loadTextToSpeech(onnxDir, {
            executionProviders: ['webgpu', 'wasm'],
            graphOptimizationLevel: 'all'
        }, (modelName, current, total) => {
            const pct = Math.round((current / total) * 25);
            updateProgress(pct, `${current}/${total}: ${modelName}`, 'Loading TTS...');
        });

        state.tts = result.textToSpeech;
        state.ttsStyle = await loadVoiceStyle([voiceStylePath]);
        state.ttsReady = true;

        console.log('[Nadha] TTS loaded successfully');
        return true;
    } catch (err) {
        console.error('[Nadha] TTS load failed:', err);
        return false;
    }
}

// Pre-generate acknowledgment sounds for instant playback
const acknowledgmentPhrases = [
    "Hmm, let me think about that for a moment...",
    "Okay, let me work on that for you...",
    "Sure thing, give me just a second here...",
    "Let me see what I can come up with...",
    "Alright, processing that now...",
    "One moment please, thinking...",
];

async function prebakeAcknowledgments() {
    if (!state.ttsReady || !state.tts) return;

    console.log('[Nadha] Pre-generating acknowledgment sounds...');

    for (const phrase of acknowledgmentPhrases) {
        try {
            const { wav, duration } = await state.tts.call(
                phrase, 'en', state.ttsStyle, 2, 1.2, 0.05
            );
            const wavLen = Math.floor(state.tts.sampleRate * duration[0]);
            const wavOut = wav.slice(0, wavLen);
            const wavBuffer = writeWavFile(wavOut, state.tts.sampleRate);
            const blob = new Blob([wavBuffer], { type: 'audio/wav' });
            const url = URL.createObjectURL(blob);
            state.prebakedAudio.push({ phrase, url });
        } catch (err) {
            console.error('[Nadha] Failed to prebake:', phrase, err);
        }
    }

    console.log('[Nadha] Pre-baked', state.prebakedAudio.length, 'acknowledgments');
}

// Play a random acknowledgment instantly
function playAcknowledgment() {
    if (state.prebakedAudio.length === 0) return null;

    const idx = Math.floor(Math.random() * state.prebakedAudio.length);
    const { url, phrase } = state.prebakedAudio[idx];
    console.log('[Nadha] Playing acknowledgment:', phrase);

    const audio = new Audio(url);
    audio.play().catch(e => {
        // Ignore autoplay restriction error
        console.log('[Nadha] Autoplay blocked, will play after interaction');
    });
    return audio;
}

// ============================================================================
// LLM Initialization
// ============================================================================

async function initLLM() {
    console.log('[Nadha] Loading LLM...');
    updateProgress(60, 'Initializing...', 'Loading SmolLM2...');

    try {
        state.wllama = new Wllama(WasmFromCDN, { parallelDownloads: 3 });

        await state.wllama.loadModelFromHF(
            'HuggingFaceTB/SmolLM2-360M-Instruct-GGUF',
            'smollm2-360m-instruct-q8_0.gguf', // ~350MB, fastest
            {
                progressCallback: ({ loaded, total }) => {
                    const pct = 60 + Math.round((loaded / total) * 35);
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

// Pre-warm LLM with a short inference to reduce first response latency
async function prewarmLLM() {
    if (!state.modelLoaded) return;
    console.log('[Nadha] Pre-warming LLM...');
    try {
        await state.wllama.createCompletion('<|im_start|>user\nHi<|im_end|>\n<|im_start|>assistant\n', {
            nPredict: 5,
            sampling: { temp: 0.1 }
        });
        console.log('[Nadha] LLM pre-warmed');
    } catch (e) {
        // Ignore errors
    }
}

// ============================================================================
// LLM Processing
// ============================================================================

async function processWithLLM(userInput) {
    if (!state.modelLoaded || state.isProcessing) return;

    state.isProcessing = true;
    setStatus('thinking', 'Thinking...');
    elements.aiText.textContent = '';

    // Play instant acknowledgment while LLM generates
    const ackAudio = playAcknowledgment();

    try {
        // Comprehensive system prompt to maximize SmolLM2 intelligence
        const systemPrompt = `You are Nadha, an intelligent and charming voice assistant. You speak naturally like a helpful friend.

PERSONALITY:
- Warm, witty, and genuinely helpful
- Confident but humble - admit when you don't know something
- Curious and engaging - ask follow-up questions when appropriate
- Use natural conversational speech patterns

RESPONSE GUIDELINES:
- Keep responses concise (1-3 sentences) since you're a voice assistant
- Speak in complete, natural sentences - avoid bullet points or lists
- When telling jokes, include the full setup and punchline
- For factual questions, give accurate, direct answers
- For complex topics, summarize the key point clearly
- If asked about yourself, you're Nadha, running entirely in the browser on-device

KNOWLEDGE:
- You have broad knowledge about science, technology, history, culture, and everyday topics
- For current events, acknowledge your knowledge may be limited
- When uncertain, say so honestly rather than making things up

VOICE OPTIMIZATION:
- Avoid using asterisks, markdown, emojis, or special formatting
- Don't say "Here's" or "Sure!" at the start - just answer naturally
- End responses with a complete thought, not trailing off`;

        const prompt = `<|im_start|>system
${systemPrompt}<|im_end|>
<|im_start|>user
${userInput}<|im_end|>
<|im_start|>assistant
`;

        let tokens = [];
        let fullText = '';
        let tokenBatch = 0;

        await state.wllama.createCompletion(prompt, {
            nPredict: 100,
            sampling: { temp: 0.8, top_k: 40, top_p: 0.9, repeatPenalty: 1.2 },
            onNewToken: async (token, piece) => {
                tokens.push(token);
                tokenBatch++;

                // Only update display every 5 tokens (reduce overhead)
                if (tokenBatch % 5 !== 0) return;

                const decoded = await state.wllama.detokenize(tokens);
                fullText = new TextDecoder().decode(decoded).replace(/<\|im_end\|>.*$/s, '').trim();
                elements.aiText.textContent = fullText;
            },
        });

        // Final decode
        const decoded = await state.wllama.detokenize(tokens);
        fullText = new TextDecoder().decode(decoded).replace(/<\|im_end\|>.*$/s, '').trim();
        elements.aiText.textContent = fullText;

        // Generate TTS in background while acknowledgment may still be playing
        if (fullText && fullText.length > 2) {
            setStatus('speaking', 'Preparing response...');

            // Generate TTS audio (don't play yet)
            const ttsPromise = generateTTSAudio(fullText);

            // Wait for acknowledgment to finish (if still playing)
            if (ackAudio && !ackAudio.ended) {
                await new Promise(resolve => {
                    ackAudio.onended = resolve;
                    // Safety timeout
                    setTimeout(resolve, 5000);
                });
            }

            // Now play the generated TTS
            const audioData = await ttsPromise;
            if (audioData) {
                setStatus('speaking', 'Speaking...');
                await playGeneratedAudio(audioData);
            }
        }

        console.log('[Nadha] LLM response:', fullText);
        state.isProcessing = false;
        waitForSpeechEnd();
    } catch (err) {
        console.error('[Nadha] LLM error:', err);
        state.isProcessing = false;
        setStatus('idle', 'Click to speak');
    }
}

// ============================================================================
// Text-to-Speech (Supertonic)
// ============================================================================

let currentAudio = null;

// Generate TTS audio data without playing (for parallel generation)
async function generateTTSAudio(text) {
    if (!text.trim() || !state.ttsReady || !state.tts) return null;

    console.log('[TTS] Generating audio for:', text.substring(0, 40) + '...');

    try {
        const { wav, duration } = await state.tts.call(
            text, 'en', state.ttsStyle, 2, 1.0, 0.1
        );

        const wavLen = Math.floor(state.tts.sampleRate * duration[0]);
        const wavOut = wav.slice(0, wavLen);
        const wavBuffer = writeWavFile(wavOut, state.tts.sampleRate);
        const blob = new Blob([wavBuffer], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);

        console.log('[TTS] Audio generated successfully');
        return { url, duration: duration[0] };
    } catch (err) {
        console.error('[TTS] Generation error:', err);
        return null;
    }
}

// Play pre-generated audio
async function playGeneratedAudio(audioData) {
    if (!audioData) return;

    // Stop listening to prevent feedback
    if (isListening()) {
        stopContinuousListening();
        state.isListening = false;
    }

    state.isSpeaking = true;

    return new Promise((resolve) => {
        currentAudio = new Audio(audioData.url);
        currentAudio.onended = () => {
            URL.revokeObjectURL(audioData.url);
            state.isSpeaking = false;
            console.log('[TTS] Playback finished');
            resolve();
        };
        currentAudio.onerror = () => {
            URL.revokeObjectURL(audioData.url);
            state.isSpeaking = false;
            resolve();
        };
        currentAudio.play().catch(() => {
            state.isSpeaking = false;
            resolve();
        });
    });
}

// Speak full response as one continuous audio (no choppiness)
async function speakFullResponse(text) {
    if (!text.trim()) return;

    // Stop listening to prevent feedback
    if (isListening()) {
        stopContinuousListening();
        state.isListening = false;
    }

    state.isSpeaking = true;
    console.log('[TTS] Speaking full response:', text.substring(0, 50) + '...');

    try {
        if (state.ttsReady && state.tts) {
            const { wav, duration } = await state.tts.call(
                text, 'en', state.ttsStyle, 2, 1.0, 0.1
            );

            const wavLen = Math.floor(state.tts.sampleRate * duration[0]);
            const wavOut = wav.slice(0, wavLen);
            const wavBuffer = writeWavFile(wavOut, state.tts.sampleRate);
            const blob = new Blob([wavBuffer], { type: 'audio/wav' });
            const url = URL.createObjectURL(blob);

            return new Promise((resolve) => {
                currentAudio = new Audio(url);
                currentAudio.onended = () => {
                    URL.revokeObjectURL(url);
                    state.isSpeaking = false;
                    console.log('[TTS] Finished speaking');
                    resolve();
                };
                currentAudio.onerror = () => {
                    URL.revokeObjectURL(url);
                    state.isSpeaking = false;
                    resolve();
                };
                currentAudio.play().catch(() => {
                    state.isSpeaking = false;
                    resolve();
                });
            });
        }
    } catch (err) {
        console.error('[TTS] Error:', err);
        state.isSpeaking = false;
    }
}

// Queue for streaming (kept for acknowledgments)
const speechQueue = [];
let isSpeakingQueue = false;

// Speak a single sentence using Supertonic TTS (queued)
function speakSentence(text) {
    if (!text.trim()) return;

    // STOP LISTENING to prevent feedback loop
    if (isListening()) {
        stopContinuousListening();
        state.isListening = false;
        console.log('[TTS] Stopped listening to prevent feedback');
    }

    console.log('[TTS] Queueing:', text);
    speechQueue.push(text);
    if (!isSpeakingQueue) {
        processQueue();
    }
}

// Process speech queue using Supertonic TTS
async function processQueue() {
    if (speechQueue.length === 0) {
        console.log('[TTS] Queue empty');
        isSpeakingQueue = false;
        return;
    }

    isSpeakingQueue = true;
    state.isSpeaking = true;
    setStatus('speaking', 'Speaking...');

    const text = speechQueue.shift();
    console.log('[TTS] Speaking:', text);

    try {
        if (state.ttsReady && state.tts) {
            // Use Supertonic TTS model
            const { wav, duration } = await state.tts.call(
                text,
                'en',
                state.ttsStyle,
                4,   // totalStep
                1.0, // speed
                0.1  // shorter silence for streaming
            );

            const wavLen = Math.floor(state.tts.sampleRate * duration[0]);
            const wavOut = wav.slice(0, wavLen);
            const wavBuffer = writeWavFile(wavOut, state.tts.sampleRate);
            const blob = new Blob([wavBuffer], { type: 'audio/wav' });
            const url = URL.createObjectURL(blob);

            currentAudio = new Audio(url);
            currentAudio.onended = () => {
                URL.revokeObjectURL(url);
                console.log('[TTS] Finished:', text.substring(0, 20) + '...');
                processQueue();
            };
            currentAudio.onerror = () => {
                URL.revokeObjectURL(url);
                console.error('[TTS] Playback error');
                processQueue();
            };
            currentAudio.play();
        } else {
            console.error('[TTS] Model not ready!');
            processQueue();
        }
    } catch (err) {
        console.error('[TTS] Error:', err);
        processQueue();
    }
}

// Wait for all speech to finish then resume listening
function waitForSpeechEnd() {
    const checkSpeech = () => {
        const isPlaying = currentAudio && !currentAudio.ended && !currentAudio.paused;
        if (speechQueue.length > 0 || isSpeakingQueue || isPlaying) {
            setTimeout(checkSpeech, 100);
        } else {
            state.isSpeaking = false;
            setStatus('listening', 'Listening...');
            setTimeout(() => startAlwaysOnListening(), 500);
        }
    };
    checkSpeech();
}


async function speak(text) {
    if (!text) {
        setStatus('idle', 'Click to speak');
        return;
    }

    if (!state.ttsReady) {
        // Fallback to Web Speech
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
            4,   // totalStep
            1.0, // speed
            0.3  // silence duration
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
// Voice Toggle (Always-On Mode)
// ============================================================================

function startAlwaysOnListening() {
    if (!state.whisperReady) {
        console.error('[Nadha] Whisper not ready');
        return;
    }

    state.isListening = true;
    setStatus('listening', 'Listening...');
    elements.userText.textContent = '';

    startContinuousListening({
        onInterim: (text) => {
            // Stream interim results to screen as user speaks
            elements.userText.textContent = `"${text}..."`;
            setStatus('listening', 'Listening...');
        },
        onFinal: async (text) => {
            console.log('[Nadha] Final transcript:', text);
            elements.userText.textContent = `"${text}"`;

            if (text.trim() && !state.isProcessing) {
                // Stop listening while processing
                stopContinuousListening();
                state.isListening = false;

                // Process with LLM
                await processWithLLM(text);

                // Resume listening after response
                if (state.modelLoaded && !state.isSpeaking) {
                    setTimeout(() => startAlwaysOnListening(), 500);
                }
            }
        },
        onError: (err) => {
            console.error('[Nadha] STT error:', err);
        }
    });
}

window.toggleVoice = async function () {
    if (!state.modelLoaded) return;

    // Hide hint on first interaction
    const hint = document.getElementById('hint');
    if (hint) hint.classList.add('hidden');

    // Stop TTS if speaking
    if (state.isSpeaking || isSpeakingQueue) {
        console.log('[Nadha] Stopping TTS...');

        // Stop current audio
        if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
        }

        // Clear the queue
        speechQueue.length = 0;
        isSpeakingQueue = false;

        // Also cancel Web Speech fallback
        window.speechSynthesis.cancel();

        state.isSpeaking = false;
        setStatus('idle', 'Click to speak');
        return;
    }

    if (isListening()) {
        // Stop listening
        stopContinuousListening();
        state.isListening = false;
        setStatus('idle', 'Click to speak');
        console.log('[Nadha] Stopped listening');
    } else if (!state.isProcessing) {
        // Start always-on listening
        startAlwaysOnListening();
        console.log('[Nadha] Started always-on listening');
    }
};

// ============================================================================
// Initialize
// ============================================================================

async function init() {
    console.log('[Nadha] Starting...');

    // Start showing interesting facts
    startFactRotation();

    // Load TTS first
    const ttsOk = await initTTS();
    if (!ttsOk) {
        console.warn('[Nadha] TTS failed, will use fallback');
    } else {
        // Pre-generate acknowledgment sounds for instant playback
        prebakeAcknowledgments();
    }

    // Load Whisper STT
    try {
        updateProgress(30, 'Initializing...', 'Loading Whisper STT...');
        await initWhisperSTT((pct, file) => {
            updateProgress(30 + Math.round(pct * 0.25), `${pct}%`, 'Loading Whisper STT...');
        });
        state.whisperReady = true;
        console.log('[Nadha] Whisper STT ready');
    } catch (err) {
        console.error('[Nadha] Whisper failed:', err);
    }

    // Load LLM
    const llmOk = await initLLM();

    // Pre-warm LLM for faster first response
    if (llmOk) {
        await prewarmLLM();
    }

    // Stop showing facts
    stopFactRotation();

    if (llmOk) {
        updateProgress(100, 'Ready!');
        elements.loading.classList.add('hidden');
        setStatus('idle', 'Click to start');
        console.log('[Nadha] All systems ready');

        // Auto-start listening after load
        if (state.whisperReady) {
            setTimeout(() => {
                startAlwaysOnListening();
                console.log('[Nadha] Auto-started always-on listening');
            }, 1000);
        }
    } else {
        updateProgress(0, 'Error loading models');
    }
}

init();
