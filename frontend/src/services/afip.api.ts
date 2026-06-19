import api from './api';

export interface ArcaComprobanteConsulta {
  FeCabResp?: {
    Cuit?: string;
    PtoVta?: number;
    CbteTipo?: number;
    FchProceso?: string;
    CantReg?: number;
    Resultado?: string;
  };
  FeDetResp?: any;
  Errors?: { Code?: string; Msg?: string }[] | { Code?: string; Msg?: string };
  Events?: { Code?: string; Msg?: string }[] | { Code?: string; Msg?: string };
  [key: string]: any;
}

export interface CuitLookupResult {
  /** Razón social or Apellido, Nombre (title case, normalized from AFIP all-caps) */
  razonSocial: string;
  /** Our system's IVA condition string, or null when noAlcanzado */
  condicionIva: string | null;
  /** True = CUIT exists but has no IVA/Monotributo registration — let user choose manually */
  noAlcanzado: boolean;
  domicilio: string | null;
  ciudad: string | null;
  provincia: string | null;
  codigoPostal: string | null;
  rubro: string | null;
  fechaNacimiento: string | null;
  tipoPersona: string | null;
  estadoClave: string;
}

export const afipApi = {
  consultarComprobante: (cbteTipo: number, ptoVta: number, cbteNro: number) =>
    api.get<ArcaComprobanteConsulta>('/afip/comprobante', { params: { cbteTipo, ptoVta, cbteNro } }).then(r => r.data),

  /**
   * Consult ARCA Padrón for a CUIT. Accepts with or without dashes.
   * Backend caches the WSAA Token de Acceso — no extra login per query.
   */
  lookupCuit: (cuit: string) =>
    api.get<CuitLookupResult>(`/afip/cuit/${cuit.replace(/-/g, '')}`).then(r => r.data),
};
