/**
 * Backup Scheduler
 * ────────────────
 * Programa backups automáticos según la configuración almacenada en
 * BACKUPS_CONFIG (HORARIO_CRON, ACTIVO).
 *
 * Además, al iniciar el servidor, verifica si quedó pendiente el backup
 * del día (en caso de que el server estuviera apagado a la hora prevista)
 * y lo ejecuta inmediatamente.
 */
import cron, { type ScheduledTask } from 'node-cron';
import { backupService } from './backup.service.js';

let currentTask: ScheduledTask | null = null;
let currentExpression: string | null = null;

async function runScheduled(): Promise<void> {
  try {
    console.log('[backup-scheduler] Ejecutando backup programado...');
    const rec = await backupService.runBackup({ tipo: 'PROGRAMADO' });
    console.log(`[backup-scheduler] OK — ${rec.ARCHIVO_NOMBRE} (${rec.TAMANO_BYTES} bytes)`);
  } catch (err: any) {
    console.error('[backup-scheduler] Error:', err.message);
  }
}

export const backupScheduler = {
  /** Inicializa el scheduler al arrancar el servidor */
  async init(): Promise<void> {
    await this.reload();
    // Backup-on-startup recovery: si hoy no hay backup OK, ejecutar uno
    this.checkMissedBackup().catch(err =>
      console.error('[backup-scheduler] Error verificando backup pendiente:', err.message)
    );
  },

  /** Reprograma el cron en base a la configuración actual */
  async reload(): Promise<void> {
    try {
      const cfg = await backupService.getConfig();

      // Detener tarea anterior si existe
      if (currentTask) {
        currentTask.stop();
        currentTask = null;
        currentExpression = null;
      }

      if (!cfg.ACTIVO) {
        console.log('[backup-scheduler] Backups automáticos DESACTIVADOS');
        return;
      }

      if (!cron.validate(cfg.HORARIO_CRON)) {
        console.error(`[backup-scheduler] Expresión cron inválida: ${cfg.HORARIO_CRON}`);
        return;
      }

      currentTask = cron.schedule(
        cfg.HORARIO_CRON,
        () => { runScheduled(); },
        { timezone: 'America/Argentina/Buenos_Aires' }
      );
      currentExpression = cfg.HORARIO_CRON;
      console.log(`[backup-scheduler] Programado: ${cfg.HORARIO_CRON} (America/Argentina/Buenos_Aires)`);
    } catch (err: any) {
      console.error('[backup-scheduler] Error al programar:', err.message);
    }
  },

  /**
   * Si el último backup OK fue hace más de 24h y la hora actual ya pasó
   * la programada del día, ejecuta uno inmediatamente.
   */
  async checkMissedBackup(): Promise<void> {
    const cfg = await backupService.getConfig();
    if (!cfg.ACTIVO) return;

    const history = await backupService.getHistory(5);
    const lastOk = history.find(r => r.ESTADO === 'OK');
    const ahora = new Date();

    if (!lastOk) {
      console.log('[backup-scheduler] No hay backups previos. Ejecutando inicial...');
      runScheduled();
      return;
    }

    const horasDesdeUltimo = (ahora.getTime() - new Date(lastOk.FECHA_INICIO).getTime()) / 36e5;
    if (horasDesdeUltimo >= 24) {
      console.log(`[backup-scheduler] Último backup hace ${horasDesdeUltimo.toFixed(1)}h. Ejecutando recuperación...`);
      runScheduled();
    }
  },

  /** Estado actual (para diagnóstico) */
  getStatus(): { activo: boolean; expresion: string | null } {
    return { activo: currentTask !== null, expresion: currentExpression };
  },
};
