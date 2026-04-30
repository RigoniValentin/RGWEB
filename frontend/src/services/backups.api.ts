import api from './api';

export interface BackupRecord {
  BACKUP_ID: number;
  FECHA_INICIO: string;
  FECHA_FIN: string | null;
  DURACION_MS: number | null;
  ARCHIVO_NOMBRE: string;
  ARCHIVO_RUTA: string;
  TAMANO_BYTES: number | null;
  HASH_SHA256: string | null;
  ESTADO: 'EN_PROGRESO' | 'OK' | 'ERROR';
  VERIFICADO: boolean;
  TIPO: 'MANUAL' | 'PROGRAMADO';
  ERROR_MENSAJE: string | null;
  USUARIO_ID: number | null;
  USUARIO_NOMBRE: string | null;
  DB_NOMBRE: string;
}

export interface BackupConfig {
  ACTIVO: boolean;
  HORARIO_CRON: string;
  DESTINO_PATH: string | null;
  RETENCION_DIAS: number;
  RETENCION_MIN_KEEP: number;
  VERIFICAR_BACKUP: boolean;
  COPY_ONLY: boolean;
  COMPRESION: boolean;
  ULTIMA_EJECUCION: string | null;
  ULTIMO_ESTADO: string | null;
}

export interface RestoreRecord {
  RESTORE_ID: number;
  FECHA_INICIO: string;
  FECHA_FIN: string | null;
  DURACION_MS: number | null;
  ARCHIVO_RUTA: string;
  ARCHIVO_NOMBRE: string;
  ORIGEN: 'HISTORIAL' | 'UPLOAD';
  BACKUP_ID: number | null;
  ESTADO: 'EN_PROGRESO' | 'OK' | 'ERROR';
  ERROR_MENSAJE: string | null;
  USUARIO_ID: number | null;
  USUARIO_NOMBRE: string | null;
  DB_NOMBRE: string;
}

export interface BackupFileInspection {
  files: Array<{ logicalName: string; physicalName: string; type: string; size: number }>;
  header: { databaseName: string; serverName: string; backupStartDate: string | null; backupSize: number | null };
}

export const backupsApi = {
  list: (limit = 100) =>
    api.get<BackupRecord[]>('/backups', { params: { limit } }).then(r => r.data),

  getConfig: () =>
    api.get<BackupConfig>('/backups/config').then(r => r.data),

  updateConfig: (data: Partial<BackupConfig>) =>
    api.put<BackupConfig>('/backups/config', data).then(r => r.data),

  run: () =>
    api.post<BackupRecord>('/backups/run').then(r => r.data),

  delete: (id: number) =>
    api.delete(`/backups/${id}`).then(r => r.data),

  applyRetention: () =>
    api.post<{ eliminados: number }>('/backups/retention').then(r => r.data),

  checkIntegrity: (id: number) =>
    api.get<{ existe: boolean; hashOk: boolean | null }>(`/backups/${id}/integrity`).then(r => r.data),

  downloadUrl: (id: number) => `/api/backups/${id}/download`,

  download: async (id: number, filename: string) => {
    const res = await api.get(`/backups/${id}/download`, { responseType: 'blob' });
    const url = window.URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },

  // ── Restore ───────────────────────────────────────────────────────
  listRestores: () =>
    api.get<RestoreRecord[]>('/backups/restores').then(r => r.data),

  restoreFromHistorial: (backupId: number, confirm: string) =>
    api.post<RestoreRecord>(`/backups/${backupId}/restore`, { confirm }, {
      timeout: 4 * 60 * 60 * 1000,
    }).then(r => r.data),

  restoreFromUpload: async (file: File, confirm: string, onProgress?: (pct: number) => void) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('confirm', confirm);
    // El default global de axios fuerza application/json. Lo anulamos a undefined
    // para que axios detecte FormData y agregue multipart/form-data con boundary.
    const res = await api.post<RestoreRecord>('/backups/restore-upload', fd, {
      headers: { 'Content-Type': undefined as any },
      timeout: 4 * 60 * 60 * 1000,
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
      },
    });
    return res.data;
  },

  inspectUpload: async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await api.post<BackupFileInspection>('/backups/inspect-upload', fd, {
      headers: { 'Content-Type': undefined as any },
      timeout: 60 * 1000,
    });
    return res.data;
  },
};
