/**
 * Wrapper de notificaciones sobre `sileo` con API compatible con `antd.message`.
 *
 * Permite migrar las 52 pantallas que hoy usan `message.success / error / warning / info / loading`
 * con un cambio mínimo: solo reemplazar el `import { message } from 'antd'` por
 * `import { notify } from '@/utils/notify'`.
 *
 * Características:
 *  - Default duration = 3000ms (idéntico a antd). Pasos opcionales con `, N` o `, { duration: N }`.
 *  - `notify.loading({ content, key })` mantiene un toast persistente hasta success/error con misma `key`.
 *  - `notify.error(err, 'fallback')` extrae mensajes de error de axios de forma consistente.
 *  - `notify.promise(fn, { loading, success, error })` reemplaza el patrón onMutate/onSuccess/onError
 *    de TanStack Query.
 *  - `notify.handleApiMutation(mutation, { loading, success, error, key })` azucar fina para QueryClient.
 */

import { sileo, type SileoOptions, type SileoState } from 'sileo';

const DEFAULT_DURATION_MS = 3000;

type NotifyInput =
  | string
  | {
      content: string;
      key?: string;
      duration?: number | null;
    };

function normalize(input: NotifyInput | undefined): SileoOptions {
  if (input == null) return {};
  if (typeof input === 'string') {
    return { title: input };
  }
  return {
    title: input.content,
    ...(input.key ? { description: input.key } : {}),
    ...(input.duration !== undefined ? { duration: input.duration } : {}),
  };
}

function toArgs(
  messageOrOptions: NotifyInput | undefined,
  duration?: number,
): SileoOptions {
  const base = normalize(messageOrOptions);
  if (duration !== undefined) {
    return { ...base, duration };
  }
  return base;
}

function emit(state: SileoState, messageOrOptions?: NotifyInput, duration?: number): string {
  const opts = toArgs(messageOrOptions, duration);
  return sileo.show({ type: state, duration: DEFAULT_DURATION_MS, ...opts });
}

/** Extrae un mensaje legible desde un error desconocido (axios, fetch, Error, string). */
export function extractErrorMessage(err: unknown, fallback = 'Ocurrió un error'): string {
  if (err == null) return fallback;
  if (typeof err === 'string') return err;
  if (typeof err === 'object') {
    const e = err as {
      response?: { data?: { error?: string; message?: string } };
      message?: string;
      error?: string;
    };
    return (
      e.response?.data?.error ||
      e.response?.data?.message ||
      e.message ||
      e.error ||
      fallback
    );
  }
  return fallback;
}

type ErrorInput = unknown;

function normalizeError(err: ErrorInput, fallback?: string): SileoOptions {
  const msg = extractErrorMessage(err, fallback);
  return { title: msg };
}

export interface NotifyPromiseOptions<T> {
  loading: NotifyInput | ((...args: unknown[]) => NotifyInput);
  success: NotifyInput | ((data: T) => NotifyInput);
  error: NotifyInput | ((err: unknown) => NotifyInput);
  key?: string;
}

export interface NotifyApiMutationOptions<T> {
  loading?: NotifyInput;
  success?: NotifyInput | ((data: T) => NotifyInput);
  error?: NotifyInput | ((err: unknown) => NotifyInput);
  /** Key opcional para enlazar loading ↔ success/error. */
  key?: string;
  /** Callback invocado luego de un success. Útil para invalidaciones u otras acciones. */
  onSuccess?: (data: T) => void;
  /** Callback invocado luego de un error. */
  onError?: (err: unknown) => void;
}

export const notify = {
  /**
   * Toast genérico. `state` opcional para forzar tipo (success/error/warning/info/loading/action).
   */
  show(messageOrOptions?: NotifyInput, duration?: number): string {
    return emit('info', messageOrOptions, duration);
  },

  success(messageOrOptions?: NotifyInput, duration?: number): string {
    return emit('success', messageOrOptions, duration);
  },

  error(messageOrOptions?: NotifyInput, duration?: number): string {
    return emit('error', messageOrOptions, duration);
  },

  /** Firma extendida para errores: `notify.error(err, 'fallback?', duration?)`. */
  errorDetail(err: unknown, fallback?: string, duration?: number): string {
    return sileo.show({
      type: 'error',
      duration: duration ?? DEFAULT_DURATION_MS,
      ...normalizeError(err, fallback),
    });
  },

  warning(messageOrOptions?: NotifyInput, duration?: number): string {
    return emit('warning', messageOrOptions, duration);
  },

  info(messageOrOptions?: NotifyInput, duration?: number): string {
    return emit('info', messageOrOptions, duration);
  },

  loading(messageOrOptions?: NotifyInput, duration = 0): string {
    const opts = normalize(messageOrOptions);
    const key = (typeof messageOrOptions === 'object' && messageOrOptions?.key) || undefined;
    return sileo.show({
      type: 'loading',
      duration,
      ...opts,
      ...(key ? { description: key } : {}),
    });
  },

  /**
   * Encadena un toast loading → success/error automáticamente.
   * Devuelve la promesa original para poder encadenar.
   *
   * @example
   *   notify.promise(api.run(payload), {
   *     loading: { content: 'Ejecutando…', key: 'op' },
   *     success: (r) => ({ content: `Listo: ${r.nombre}` }),
   *     error:   (e) => extractErrorMessage(e),
   *   });
   */
  promise<T>(
    promise: Promise<T> | (() => Promise<T>),
    opts: NotifyPromiseOptions<T>,
  ): Promise<T> {
    const loadingInput = typeof opts.loading === 'function' ? opts.loading() : opts.loading;
    const id = notify.loading(loadingInput);

    const dismiss = () => sileo.dismiss(id);

    return Promise.resolve(typeof promise === 'function' ? promise() : promise).then(
      (data) => {
        dismiss();
        const successInput = typeof opts.success === 'function' ? opts.success(data) : opts.success;
        if (successInput !== undefined && successInput !== null) {
          notify.success(successInput);
        }
        return data;
      },
      (err: unknown) => {
        dismiss();
        const errorInput = typeof opts.error === 'function' ? opts.error(err) : opts.error;
        if (typeof errorInput === 'string') {
          notify.error(extractErrorMessage(err, errorInput));
        } else if (errorInput !== undefined && errorInput !== null) {
          notify.error(errorInput);
        } else {
          notify.error(extractErrorMessage(err));
        }
        throw err;
      },
    );
  },

  /**
   * Helper para `useMutation` de TanStack Query. Aplica loading en `onMutate`,
   * success en `onSuccess` y error en `onError`. Reemplaza los ids cuando se
   * provee `key` para que el mismo toast se actualice.
   *
   * @example
   *   const mut = useMutation({
   *     mutationFn: api.save,
   *     ...notify.handleApiMutation(api.save, {
   *       loading: 'Guardando…',
   *       success: 'Guardado',
   *       error: 'No se pudo guardar',
   *       onSuccess: () => qc.invalidateQueries({ queryKey: ['x'] }),
   *     }),
   *   });
   */
  handleApiMutation<T>(
    _mutationFn: (...args: unknown[]) => Promise<T>,
    cfg: NotifyApiMutationOptions<T>,
  ): {
    onMutate: () => void;
    onSuccess: (data: T) => void;
    onError: (err: unknown) => void;
  } {
    return {
      onMutate: () => {
        if (cfg.loading) {
          const id = notify.loading(cfg.loading);
          if (cfg.key) {
            idsByKey.set(cfg.key, id);
          }
        }
      },
      onSuccess: (data: T) => {
        if (cfg.key) {
          const id = idsByKey.get(cfg.key);
          if (id) {
            sileo.dismiss(id);
            idsByKey.delete(cfg.key);
          }
        }
        if (cfg.success) {
          const input = typeof cfg.success === 'function' ? cfg.success(data) : cfg.success;
          if (input !== undefined && input !== null) {
            notify.success(input);
          }
        }
        cfg.onSuccess?.(data);
      },
      onError: (err: unknown) => {
        if (cfg.key) {
          const id = idsByKey.get(cfg.key);
          if (id) {
            sileo.dismiss(id);
            idsByKey.delete(cfg.key);
          }
        }
        if (cfg.error) {
          const input = typeof cfg.error === 'function' ? cfg.error(err) : cfg.error;
          const resolved =
            typeof input === 'string' ? extractErrorMessage(err, input) : input;
          if (resolved !== undefined && resolved !== null) {
            notify.error(resolved);
          }
        } else {
          notify.error(extractErrorMessage(err));
        }
        cfg.onError?.(err);
      },
    };
  },

  /** Cierra un toast específico por id. */
  dismiss(id: string): void {
    sileo.dismiss(id);
  },

  /** Cierra todos los toasts (o los de una posición específica). */
  clear(position?: 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right'): void {
    sileo.clear(position);
  },
};

const idsByKey = new Map<string, string>();

export type { SileoOptions, SileoState };
export default notify;
