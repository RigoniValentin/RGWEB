import { spawn, ChildProcess, execSync } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { config } from '../config/index.js';

// ═══════════════════════════════════════════════════
//  TunnelManager
//
//  Singleton que envuelve cloudflared.exe para exponer
//  el backend RG WEB a internet vía Cloudflare Quick Tunnel.
//  El operador lo arranca/detiene desde la UI de Integraciones.
//  Sin auto-start: el operador decide cuándo.
// ═══════════════════════════════════════════════════

export type TunnelStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface TunnelInfo {
  status: TunnelStatus;
  publicUrl: string | null;
  startedAt: string | null;
  pid: number | null;
  backendPort: number;
  cloudflaredPath: string;
  uptimeSec: number | null;
  lastError: string | null;
}

export interface TunnelStartOptions {
  /** Puerto del backend RG WEB al que apunta el túnel. Default: config.port */
  backendPort?: number;
  /** Ruta al binario cloudflared. Default: process.env.CLOUDFLARED_PATH o la ubicación típica en Windows. */
  cloudflaredPath?: string;
}

const URL_REGEX = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
// Elimina secuencias ANSI (colores, OSC) que pueden envolver la URL
const ANSI_REGEX = /\x1b\][^\x07]*\x07|\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const LOG_TAIL = 100;
const START_TIMEOUT_MS = 30_000;
const QUICK_TUNNEL_HINT = /Your quick Tunnel has been created/i;

class TunnelManager extends EventEmitter {
  private proc: ChildProcess | null = null;
  private status: TunnelStatus = 'stopped';
  private publicUrl: string | null = null;
  private startedAt: Date | null = null;
  private pid: number | null = null;
  private logs: string[] = [];
  private lastError: string | null = null;
  private backendPort: number;
  private cloudflaredPath: string;
  private pendingStart: { resolve: (info: TunnelInfo) => void; reject: (err: Error) => void; timer: NodeJS.Timeout } | null = null;
  /** Remanente de chunk partido entre lecturas (por stream). */
  private bufferRemainder: { stdout: string; stderr: string } = { stdout: '', stderr: '' };
  /** Detectamos la frase "Your quick Tunnel has been created" — si la vimos,
   *  el siguiente chunk casi seguro trae la URL. Permite dar margen extra. */
  private quickTunnelSeen = false;

  constructor() {
    super();
    this.backendPort = config.port;
    this.cloudflaredPath = process.env.CLOUDFLARED_PATH || this.defaultCloudflaredPath();
  }

  private defaultCloudflaredPath(): string {
    if (process.platform === 'win32') {
      return path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'cloudflared', 'cloudflared.exe');
    }
    return '/usr/local/bin/cloudflared';
  }

  /** Resuelve la ruta al binario. Verifica que exista. */
  resolveBinary(customPath?: string): { ok: true; path: string } | { ok: false; error: string; tried: string[] } {
    const candidates = [
      customPath,
      process.env.CLOUDFLARED_PATH,
      this.cloudflaredPath,
    ].filter(Boolean) as string[];

    const tried: string[] = [];
    for (const p of candidates) {
      tried.push(p);
      try {
        if (fs.existsSync(p)) return { ok: true, path: p };
      } catch {
        // ignore
      }
    }
    return { ok: false, error: 'cloudflared.exe no encontrado. Instalalo desde https://github.com/cloudflare/cloudflared/releases', tried };
  }

  getInfo(): TunnelInfo {
    const uptimeSec = this.startedAt ? Math.floor((Date.now() - this.startedAt.getTime()) / 1000) : null;
    return {
      status: this.status,
      publicUrl: this.publicUrl,
      startedAt: this.startedAt ? this.startedAt.toISOString() : null,
      pid: this.pid,
      backendPort: this.backendPort,
      cloudflaredPath: this.cloudflaredPath,
      uptimeSec,
      lastError: this.lastError,
    };
  }

  getLogs(tail = 50): string[] {
    const n = Math.max(1, Math.min(tail, LOG_TAIL));
    return this.logs.slice(-n);
  }

  private pushLog(line: string): void {
    // No logueamos la URL completa en logs persistentes — sólo el host.
    const sanitized = line.replace(URL_REGEX, (m) => {
      try {
        const u = new URL(m);
        return `${u.protocol}//${u.hostname}`;
      } catch {
        return '<tunnel-url>';
      }
    });
    this.logs.push(`[${new Date().toISOString()}] ${sanitized}`);
    if (this.logs.length > LOG_TAIL) this.logs.splice(0, this.logs.length - LOG_TAIL);
    this.emit('log', sanitized);
  }

  /**
   * Procesa un chunk de stdout o stderr. Sanea ANSI, busca la URL pública
   * y resuelve el pendingStart si la encuentra.
   * cloudflared 2025.x escribe la URL del quick tunnel en STDERR con este
   * formato:
   *   INF |  https://xxxx-yyyy.trycloudflare.com                                      |
   */
  private handleChunk(chunk: Buffer, source: 'stdout' | 'stderr'): void {
    const raw = chunk.toString('utf8');
    // Junta el remanente del chunk anterior si la URL cae partida entre
    // dos chunks. Línea-típica empieza con timestamp ISO + "INF".
    const text = (this.bufferRemainder[source] + raw).replace(/\r/g, '');
    const lines = text.split('\n');

    // La última entrada puede ser incompleta → guardamos para el próximo chunk
    this.bufferRemainder[source] = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Sanear ANSI antes de loguear y matchear
      const clean = trimmed.replace(ANSI_REGEX, '');
      this.pushLog(source === 'stderr' ? `[stderr] ${clean}` : clean);

      if (this.publicUrl) continue; // ya tenemos URL

      // 1) Match directo por regex (URL completa)
      const directMatch = clean.match(URL_REGEX);
      // 2) Match por la frase "Your quick Tunnel has been created"
      //    → si la encontramos, el siguiente chunk seguro trae la URL.
      //    Pero como en 2025.8.1 ya viene en la misma línea adyacente,
      //    la regex directa cubre el 99% de los casos.
      if (directMatch) {
        this.captureUrl(directMatch[0]);
        continue;
      }
      if (QUICK_TUNNEL_HINT.test(clean)) {
        this.quickTunnelSeen = true;
        // Si la URL cae en este mismo chunk partido, podría no matchear ahora
        // pero el handler se vuelve a llamar con los siguientes chunks.
      }
    }
  }

  private captureUrl(url: string): void {
    if (this.publicUrl) return;
    this.publicUrl = url;
    this.status = 'running';
    this.startedAt = new Date();
    if (this.pendingStart) {
      clearTimeout(this.pendingStart.timer);
      this.pendingStart.resolve(this.getInfo());
      this.pendingStart = null;
    }
    this.emit('running', this.getInfo());
  }

  async start(opts: TunnelStartOptions = {}): Promise<TunnelInfo> {
    if (this.status === 'running' || this.status === 'starting') {
      throw new Error(`El túnel ya está ${this.status === 'running' ? 'activo' : 'iniciando'} (${this.publicUrl ?? 'sin URL aún'})`);
    }

    const backendPort = opts.backendPort ?? this.backendPort;
    const resolved = this.resolveBinary(opts.cloudflaredPath);
    if (!resolved.ok) {
      this.status = 'error';
      this.lastError = resolved.error;
      throw new Error(resolved.error);
    }
    this.cloudflaredPath = resolved.path;
    this.backendPort = backendPort;

    // Limpia estado previo
    this.publicUrl = null;
    this.startedAt = null;
    this.pid = null;
    this.lastError = null;
    this.logs = [];
    this.bufferRemainder = { stdout: '', stderr: '' };
    this.quickTunnelSeen = false;

    this.status = 'starting';

    return new Promise<TunnelInfo>((resolve, reject) => {
      const args = ['tunnel', '--url', `http://localhost:${backendPort}`, '--no-autoupdate'];
      this.pushLog(`> spawn: "${resolved.path}" ${args.join(' ')}`);

      const proc = spawn(resolved.path, args, {
        windowsHide: true,
        env: { ...process.env, CLOUDFLARED_NO_AUTOUPDATE: 'true' },
      });
      this.proc = proc;
      this.pid = proc.pid ?? null;

      // Si vimos la frase "Tunnel has been created" pero aún no la URL,
      // la URL cae en el siguiente chunk — extendemos el timeout 15s más.
      const checkAndScheduleTimeout = () => {
        if (!this.pendingStart) return;
        if (this.quickTunnelSeen && !this.publicUrl) {
          const extended = setTimeout(() => {
            if (this.pendingStart) {
              this.pendingStart = null;
              this.killProc();
              this.status = 'error';
              this.lastError = `Timeout: cloudflared emitió "Tunnel created" pero no se pudo extraer la URL pública en ${START_TIMEOUT_MS / 1000 + 15}s`;
              this.pushLog(`!! ${this.lastError}`);
              reject(new Error(this.lastError));
            }
          }, 15_000);
          this.pendingStart.timer = extended;
        }
      };

      const timer = setTimeout(() => {
        if (this.pendingStart) {
          checkAndScheduleTimeout();
          if (this.pendingStart && !this.quickTunnelSeen) {
            this.pendingStart = null;
            this.killProc();
            this.status = 'error';
            this.lastError = `Timeout: cloudflared no emitió URL pública en ${START_TIMEOUT_MS / 1000}s`;
            this.pushLog(`!! ${this.lastError}`);
            reject(new Error(this.lastError));
          }
        }
      }, START_TIMEOUT_MS);

      this.pendingStart = { resolve, reject, timer };

      proc.stdout?.on('data', (chunk: Buffer) => this.handleChunk(chunk, 'stdout'));
      proc.stderr?.on('data', (chunk: Buffer) => this.handleChunk(chunk, 'stderr'));

      proc.on('error', (err) => {
        this.pushLog(`!! error: ${err.message}`);
        this.status = 'error';
        this.lastError = err.message;
        if (this.pendingStart) {
          clearTimeout(this.pendingStart.timer);
          this.pendingStart.reject(err);
          this.pendingStart = null;
        }
        this.emit('error', err);
      });

      proc.on('exit', (code, signal) => {
        const wasRunning = this.status === 'running';
        this.pushLog(`<< exit code=${code} signal=${signal}`);
        this.proc = null;
        this.pid = null;
        this.publicUrl = null;
        if (!wasRunning && this.pendingStart) {
          // Falló durante el start
          clearTimeout(this.pendingStart.timer);
          this.pendingStart.reject(new Error(this.lastError || `cloudflared salió con código ${code} antes de establecer la URL`));
          this.pendingStart = null;
          this.status = 'error';
        } else if (wasRunning) {
          this.status = 'stopped';
          this.startedAt = null;
          this.emit('stopped');
        }
      });
    });
  }

  async stop(): Promise<void> {
    if (this.status === 'stopped' || !this.proc) {
      this.status = 'stopped';
      this.proc = null;
      this.pid = null;
      this.publicUrl = null;
      this.startedAt = null;
      return;
    }

    if (this.pendingStart) {
      clearTimeout(this.pendingStart.timer);
      this.pendingStart = null;
    }

    this.killProc();

    // Esperar un toque a que el evento 'exit' corra
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 2000);
      const onExit = () => {
        clearTimeout(t);
        resolve();
      };
      this.once('stopped', onExit);
      if (!this.proc) {
        clearTimeout(t);
        this.off('stopped', onExit);
        resolve();
      }
    });

    this.status = 'stopped';
    this.proc = null;
    this.pid = null;
    this.publicUrl = null;
    this.startedAt = null;
    this.bufferRemainder = { stdout: '', stderr: '' };
    this.quickTunnelSeen = false;
  }

  private killProc(): void {
    if (!this.proc) return;
    const proc = this.proc;
    const pid = proc.pid;
    try {
      if (process.platform === 'win32' && pid) {
        // taskkill mata el árbol completo de procesos hijos
        execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore', windowsHide: true });
        this.pushLog(`>> taskkill /pid ${pid} /T /F`);
      } else {
        proc.kill('SIGTERM');
      }
    } catch (e) {
      this.pushLog(`!! kill error: ${(e as Error).message}`);
      try {
        proc.kill('SIGKILL');
      } catch {
        // ignore
      }
    }
  }

  /** Ping a la URL pública para verificar que el túnel responde. */
  async checkReachability(timeoutMs = 5000): Promise<{ ok: boolean; latencyMs: number | null; error: string | null }> {
    if (!this.publicUrl) {
      return { ok: false, latencyMs: null, error: 'El túnel no está activo' };
    }
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(`${this.publicUrl}/api/health`, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timer);
      return { ok: res.ok, latencyMs: Date.now() - start, error: res.ok ? null : `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, latencyMs: null, error: (e as Error).message };
    }
  }
}

export const tunnelManager = new TunnelManager();
