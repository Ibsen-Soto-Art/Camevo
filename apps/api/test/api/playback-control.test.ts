import { describe, expect, it } from "vitest";
import { PlaybackControl } from "../../src/api/ws/playback-control";

describe("PlaybackControl (RF-023)", () => {
  it("empieza sin pausa, con la velocidad inicial dada", () => {
    const control = new PlaybackControl(80);
    expect(control.isPaused).toBe(false);
    expect(control.msPerGeneration).toBe(80);
  });

  it("waitIfPaused se resuelve de inmediato si no está pausado", async () => {
    const control = new PlaybackControl(80);
    await expect(control.waitIfPaused()).resolves.toBeUndefined();
  });

  it("pause() bloquea waitIfPaused() hasta que se llama resume()", async () => {
    const control = new PlaybackControl(80);
    control.pause();
    expect(control.isPaused).toBe(true);

    let resolved = false;
    const waiting = control.waitIfPaused().then(() => {
      resolved = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(resolved).toBe(false); // sigue pausado, no debería haberse resuelto

    control.resume();
    await waiting;
    expect(resolved).toBe(true);
    expect(control.isPaused).toBe(false);
  });

  it("pause() es idempotente: llamarlo dos veces no crea dos gates independientes", async () => {
    const control = new PlaybackControl(80);
    control.pause();
    control.pause();

    const waiting = control.waitIfPaused();
    control.resume();
    await expect(waiting).resolves.toBeUndefined();
  });

  it("setSpeed cambia msPerGeneration sin afectar el estado de pausa", () => {
    const control = new PlaybackControl(80);
    control.pause();
    control.setSpeed(20);
    expect(control.msPerGeneration).toBe(20);
    expect(control.isPaused).toBe(true);
  });
});
