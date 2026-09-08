/**
 * RF-023: estado de pausa/velocidad de una corrida en vivo, compartido
 * entre el handler de mensajes entrantes del WebSocket (server.ts) y el
 * loop generación a generación (live-run.ts). Congela el motor de verdad,
 * no solo el envío: mientras `waitIfPaused()` no se resuelve, el llamador
 * NUNCA invoca `advanceGeneration` — el tiempo real que pase en pausa no
 * consume el PRNG ni avanza el estado de la simulación, así que no puede
 * introducir una fuente de no-determinismo nueva (RNF-003). Ver el test
 * de determinismo en test/api/live-run.test.ts.
 */
export class PlaybackControl {
  msPerGeneration: number;
  private pauseGate: Promise<void> | null = null;
  private releaseGate: (() => void) | null = null;

  constructor(initialMsPerGeneration: number) {
    this.msPerGeneration = initialMsPerGeneration;
  }

  get isPaused(): boolean {
    return this.pauseGate !== null;
  }

  pause(): void {
    if (this.pauseGate) return;
    this.pauseGate = new Promise((resolve) => {
      this.releaseGate = resolve;
    });
  }

  resume(): void {
    this.releaseGate?.();
    this.pauseGate = null;
    this.releaseGate = null;
  }

  setSpeed(msPerGeneration: number): void {
    this.msPerGeneration = msPerGeneration;
  }

  /** Se resuelve de inmediato si no está pausado; si no, espera a `resume()`. */
  async waitIfPaused(): Promise<void> {
    if (this.pauseGate) {
      await this.pauseGate;
    }
  }
}
