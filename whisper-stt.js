/**
 * Whisper STT using ONNX Runtime Web directly
 * Loads local model files from /models/whisper/
 */

import * as ort from 'onnxruntime-web';

let encoder = null;
let decoder = null;
let tokenizer = null;
let config = null;
let isModelLoading = false;
let isReady = false;

/**
 * Initialize the Whisper model
 */
export async function initWhisperSTT(onProgress) {
    if (isReady) return true;
    if (isModelLoading) return false;

    isModelLoading = true;
    console.log('[Whisper] Loading ONNX models from local files...');

    try {
        if (onProgress) onProgress(10, 'config.json');
        const configResp = await fetch('/models/whisper/config.json');
        config = await configResp.json();
        console.log('[Whisper] Loaded config');

        if (onProgress) onProgress(20, 'tokenizer.json');
        const tokenizerResp = await fetch('/models/whisper/tokenizer.json');
        tokenizer = await tokenizerResp.json();
        console.log('[Whisper] Loaded tokenizer');

        if (onProgress) onProgress(40, 'encoder_model.onnx');
        console.log('[Whisper] Loading encoder...');
        encoder = await ort.InferenceSession.create('/models/whisper/encoder_model.onnx', {
            executionProviders: ['wasm'],
            graphOptimizationLevel: 'all'
        });
        console.log('[Whisper] Encoder loaded');

        if (onProgress) onProgress(80, 'decoder_model_merged.onnx');
        console.log('[Whisper] Loading decoder...');
        decoder = await ort.InferenceSession.create('/models/whisper/decoder_model_merged.onnx', {
            executionProviders: ['wasm'],
            graphOptimizationLevel: 'all'
        });
        console.log('[Whisper] Decoder loaded');

        if (onProgress) onProgress(100, 'done');
        isReady = true;
        console.log('[Whisper] All models loaded successfully');
        return true;
    } catch (err) {
        console.error('[Whisper] Failed to load models:', err);
        throw err;
    } finally {
        isModelLoading = false;
    }
}

// Continuous recognition instance
let continuousRecognition = null;
let isListeningContinuous = false;

/**
 * Start continuous listening with streaming callbacks
 */
export function startContinuousListening({ onInterim, onFinal, onError }) {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        if (onError) onError(new Error('Speech recognition not supported'));
        return;
    }

    if (isListeningContinuous) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    continuousRecognition = new SpeechRecognition();
    continuousRecognition.continuous = true;
    continuousRecognition.interimResults = true;
    continuousRecognition.lang = 'en-US';

    let lastInterim = '';

    continuousRecognition.onresult = (event) => {
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

        // Stream interim results
        if (interimTranscript && interimTranscript !== lastInterim) {
            lastInterim = interimTranscript;
            if (onInterim) onInterim(interimTranscript);
        }

        // Send final results
        if (finalTranscript.trim()) {
            lastInterim = '';
            if (onFinal) onFinal(finalTranscript.trim());
        }
    };

    continuousRecognition.onerror = (event) => {
        console.error('[Whisper] Continuous error:', event.error);
        if (event.error === 'no-speech' || event.error === 'aborted') {
            // Restart on no-speech
            if (isListeningContinuous) {
                setTimeout(() => {
                    if (isListeningContinuous && continuousRecognition) {
                        try { continuousRecognition.start(); } catch (e) { }
                    }
                }, 100);
            }
        } else if (onError) {
            onError(new Error(event.error));
        }
    };

    continuousRecognition.onend = () => {
        // Auto-restart for always-on mode
        if (isListeningContinuous && continuousRecognition) {
            setTimeout(() => {
                try { continuousRecognition.start(); } catch (e) { }
            }, 100);
        }
    };

    isListeningContinuous = true;
    continuousRecognition.start();
    console.log('[Whisper] Continuous listening started');
}

/**
 * Stop continuous listening
 */
export function stopContinuousListening() {
    isListeningContinuous = false;
    if (continuousRecognition) {
        continuousRecognition.stop();
        continuousRecognition = null;
    }
    console.log('[Whisper] Continuous listening stopped');
}

/**
 * Check if currently listening
 */
export function isListening() {
    return isListeningContinuous;
}

export function isWhisperReady() {
    return isReady;
}
