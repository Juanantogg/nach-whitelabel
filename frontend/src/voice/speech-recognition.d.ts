/**
 * Tipos ambientales de la Web Speech Recognition API que el `lib.dom` de TS aún
 * NO trae: el recognizer `SpeechRecognition`, su constructor y las propiedades
 * vendor-prefixed en `Window`. Los tipos de eventos/resultados
 * (`SpeechRecognitionEvent`, `SpeechRecognitionErrorEvent`,
 * `SpeechRecognitionResult(List)`, `SpeechRecognitionAlternative`) ya los define
 * `lib.dom.d.ts`, así que NO se redeclaran aquí (evita colisiones).
 *
 * `moduleDetection: force` trata cada archivo como módulo, por eso las
 * declaraciones van dentro de `declare global` y el archivo cierra con `export {}`.
 */

declare global {
  /** Instancia de reconocimiento de voz. */
  interface SpeechRecognition extends EventTarget {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    maxAlternatives: number;

    onstart: ((this: SpeechRecognition, ev: Event) => void) | null;
    onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
    onend: ((this: SpeechRecognition, ev: Event) => void) | null;
    onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null;

    start(): void;
    stop(): void;
    abort(): void;
  }

  /** Constructor de `SpeechRecognition`. */
  interface SpeechRecognitionConstructor {
    new (): SpeechRecognition;
  }

  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export {};
