import { expect, test, type Page } from "@playwright/test";

/**
 * Backpressure del WebSocket, de punta a punta sobre un enlace REALMENTE
 * limitado (CDP), que es la única forma de ejercitar el camino que causó el
 * incidente: el servidor ofrece más de lo que el enlace entrega, el `ping`
 * del heartbeat queda detrás del atraso en el mismo stream TCP, y el
 * watchdog de 60s del cliente declara muerta una conexión viva.
 *
 * Medido antes del fix, con grilla 40x40 y 2 Mbps: llegaron 428 de 1500
 * snapshots, UNO de los 5 pings, y la pantalla mostró "Conexión perdida".
 */
test.describe("enlace congestionado", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  test.setTimeout(420_000);

  /** Cuenta pings y snapshots instrumentando el WebSocket antes de que cargue la app. */
  async function instrument(page: Page) {
    await page.addInitScript(() => {
      const w = window as any;
      w.__ev = { pings: 0, snaps: 0, ultimaGen: -1, cierres: [] as string[] };
      const Orig = window.WebSocket;
      class Spy extends Orig {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          this.addEventListener("message", (e: MessageEvent) => {
            const d = String((e as any).data);
            if (d.includes('"ping"')) w.__ev.pings += 1;
            else if (d.startsWith('{"type":"snapshot"')) {
              w.__ev.snaps += 1;
              const m = /"generation":(\d+)/.exec(d);
              if (m) w.__ev.ultimaGen = Number(m[1]);
            } else w.__ev.cierres.push(d.slice(0, 40));
          });
        }
      }
      w.WebSocket = Spy;
    });
  }

  async function throttle(page: Page, mbps: number) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 40,
      downloadThroughput: (mbps * 1e6) / 8,
      uploadThroughput: (mbps * 1e6) / 8,
    });
  }

  test("40x40 a 2 Mbps llega a 'finalizada' sin pasar por 'Conexión perdida'", async ({ page }) => {
    await instrument(page);
    await throttle(page, 2);
    await page.goto("/");
    await page.getByLabel(/ancho de grilla/i).fill("40");
    await page.getByLabel(/alto de grilla/i).fill("40");
    await page.getByLabel("Generaciones").fill("1500");
    // Ritmo por defecto (80 ms): el del incidente. A 66 KB por snapshot el
    // servidor ofrece 6,8 Mbps contra los 2 del enlace.
    await page.getByRole("button", { name: /Iniciar corrida/ }).click();

    await expect(page.locator(".status-line")).toContainText("finalizada", { timeout: 360_000 });
    // La aserción que falla sin el fix.
    await expect(page.locator(".error")).toHaveCount(0);

    const ev = await page.evaluate(() => (window as any).__ev);
    // Al menos 2 pings: con el buffer acotado el latido deja de quedar
    // enterrado. Antes del fix llegaba 1 solo en toda la corrida.
    expect(ev.pings).toBeGreaterThanOrEqual(2);
    // Saltear snapshots es el comportamiento correcto: no se exige el total.
    expect(ev.snaps).toBeGreaterThan(0);
    // Pero la última generación NO se saltea nunca.
    expect(ev.ultimaGen).toBe(1499);
  });
});

test.describe("enlace rápido (regresión)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  test.setTimeout(180_000);

  test("20x20 sin limitar no saltea ningún snapshot", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as any;
      w.__ev = { snaps: 0, gens: new Set<number>() };
      const Orig = window.WebSocket;
      class Spy extends Orig {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          this.addEventListener("message", (e: MessageEvent) => {
            const d = String((e as any).data);
            if (d.startsWith('{"type":"snapshot"')) {
              w.__ev.snaps += 1;
              const m = /"generation":(\d+)/.exec(d);
              if (m) w.__ev.gens.add(Number(m[1]));
            }
          });
        }
      }
      w.WebSocket = Spy;
    });

    await page.goto("/");
    await page.getByLabel(/ancho de grilla/i).fill("20");
    await page.getByLabel(/alto de grilla/i).fill("20");
    await page.getByLabel("Generaciones").fill("300");
    await page.getByLabel("Ritmo de reproducción inicial (ms/generación)").fill("0");
    await page.getByRole("button", { name: /Iniciar corrida/ }).click();

    await expect(page.locator(".status-line")).toContainText("finalizada", { timeout: 120_000 });
    await expect(page.locator(".error")).toHaveCount(0);

    const ev = await page.evaluate(() => ({
      snaps: (window as any).__ev.snaps,
      distintas: (window as any).__ev.gens.size,
    }));
    // Las 300, sin huecos: con el buffer siempre bajo el tope el
    // comportamiento es idéntico al de antes del fix.
    expect(ev.snaps).toBe(300);
    expect(ev.distintas).toBe(300);
  });
});
