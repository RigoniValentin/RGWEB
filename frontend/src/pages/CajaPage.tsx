import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, ColorPicker, DatePicker, Drawer, Dropdown, Form, Input, InputNumber, Modal, Popover, Radio, Segmented, Select, Space, Spin, Table, Tag, Tooltip, Typography, message, Alert, Descriptions } from 'antd';
import { ShopOutlined, PlusOutlined, EditOutlined, EyeOutlined, SwapOutlined, PrinterOutlined, ArrowUpOutlined, ArrowDownOutlined, LockOutlined, ExportOutlined, InboxOutlined, WalletOutlined, ImportOutlined, InfoCircleOutlined, StopOutlined, CheckCircleOutlined, RightOutlined, BankOutlined, TeamOutlined, HistoryOutlined, ClockCircleOutlined, ThunderboltFilled, DownOutlined, MoreOutlined, UserOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs, { Dayjs } from 'dayjs';
import { cajaApi } from '../services/caja.api';
import { puntoVentaApi } from '../services/puntoVenta.api';
import { usuariosApi } from '../services/usuarios.api';
import { useAuthStore } from '../store/authStore';
import TransferenciaCajaModal from '../components/TransferenciaCajaModal';
import { printCajaDetail } from '../utils/printCajaDetail';
import { RGCajaModalHeader } from '../components/RGCajaModalHeader';
import { rgIcon } from '../components/rg-icons';
import { useCajaColor, getColorForCaja, setColorForCaja, CAJA_COLOR_PRESETS } from '../utils/cajaColores';
import type { Caja, CajaSesion, AbrirCajaInput, CerrarCajaInput, CajaItem, DesgloseMetodo } from '../types';

const { RangePicker } = DatePicker;
const { Text, Title } = Typography;

function fmtMoney(n: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(n);
}

const ORIGEN_TIPO_LABELS: Record<string, { label: string; color: string }> = {
  VENTA: { label: 'Venta', color: 'green' },
  INGRESO: { label: 'Ingreso', color: 'blue' },
  EGRESO: { label: 'Egreso', color: 'red' },
  APERTURA: { label: 'Apertura', color: 'orange' },
  TRANSFERENCIA_CC: { label: 'Trf CC', color: 'purple' },
  DEPOSITO_CIERRE: { label: 'Dep. Cierre', color: 'gold' },
  RETENCION_CIERRE: { label: 'Ret. Cierre', color: 'cyan' },
  COBRANZA: { label: 'Cobranza', color: 'green' },
  ORDEN_PAGO: { label: 'OP', color: 'red' },
  COMPRA: { label: 'Compra', color: 'red' },
  NC_COMPRA: { label: 'NC Compra', color: 'orange' },
  NC_VENTA: { label: 'NC Venta', color: 'orange' },
  ND_COMPRA: { label: 'ND Compra', color: 'volcano' },
  ND_VENTA: { label: 'ND Venta', color: 'volcano' },
};

export default function CajaPage() {
  const user = useAuthStore((s: any) => s.user);
  const permisos = useAuthStore((s: any) => s.permisos);
  const puntoVentaActivo = useAuthStore((s: any) => s.puntoVentaActivo);
  const hasPermiso = (key: string) => permisos?.includes(key) || permisos?.includes('caja.administrar');

  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Estado del grid de cajas (foco principal)
  const [cajaDrawerActiva, setCajaDrawerActiva] = useState<Caja | null>(null);

  // Estado ABM
  const [abmModalOpen, setAbmModalOpen] = useState(false);
  const [editingCaja, setEditingCaja] = useState<Caja | null>(null);
  const [usuariosModalOpen, setUsuariosModalOpen] = useState(false);
  const [cajaParaUsuarios, setCajaParaUsuarios] = useState<Caja | null>(null);
  const [usuariosSeleccionados, setUsuariosSeleccionados] = useState<number[]>([]);

  // Estado sesiones (modales siguen igual, los dispara el grid o el drawer)
  const [abrirModalOpen, setAbrirModalOpen] = useState(false);
  const [cerrarModalOpen, setCerrarModalOpen] = useState(false);
  const [sesionParaCerrar, setSesionParaCerrar] = useState<CajaSesion | null>(null);
  const [transferirModalOpen, setTransferirModalOpen] = useState(false);
  const [ingresoEgresoModalOpen, setIngresoEgresoModalOpen] = useState(false);
  const [sesionParaIE, setSesionParaIE] = useState<CajaSesion | null>(null);
  const [sesionActivaDetalle, setSesionActivaDetalle] = useState<CajaSesion | null>(null);

  // Desglose de método de pago (compartido entre SesionDetalleDrawer y CajaDetalleDrawer)
  const [desgloseOpen, setDesgloseOpen] = useState(false);
  const [desgloseTitulo, setDesgloseTitulo] = useState('');
  const [desgloseData, setDesgloseData] = useState<DesgloseMetodo[]>([]);
  const [desgloseLoading, setDesgloseLoading] = useState(false);
  const handleDesgloseItem = async (item: CajaItem, campo: 'EFECTIVO' | 'DIGITAL') => {
    if (!item.ORIGEN_ID || !item.ORIGEN_TIPO) return;
    setDesgloseLoading(true);
    setDesgloseOpen(true);
    const label = campo === 'EFECTIVO' ? 'Efectivo' : 'Digital';
    setDesgloseTitulo(`Desglose — ${label} (${item.ORIGEN_TIPO} #${item.ORIGEN_ID})`);
    try {
      const data = await cajaApi.getDesgloseItem(item.ORIGEN_TIPO, item.ORIGEN_ID, campo);
      setDesgloseData(data);
    } catch {
      setDesgloseData([]);
    } finally {
      setDesgloseLoading(false);
    }
  };
  const handleDesgloseTotal = async (sesionId: number) => {
    setDesgloseLoading(true);
    setDesgloseOpen(true);
    setDesgloseTitulo('Desglose total por método de pago');
    try {
      const data = await cajaApi.getDesgloseMetodos(sesionId);
      setDesgloseData(data);
    } catch {
      setDesgloseData([]);
    } finally {
      setDesgloseLoading(false);
    }
  };

  // Apertura
  const [cajaSeleccionadaAbrir, setCajaSeleccionadaAbrir] = useState<number | null>(null);
  const [fuenteApertura, setFuenteApertura] = useState<'USAR_RETENIDO' | 'APORTE_CC' | 'MIXTO' | 'NINGUNO'>('APORTE_CC');
  const [montoApertura, setMontoApertura] = useState<number>(0);
  const [obsApertura, setObsApertura] = useState('');

  // Cierre
  const [depositoTipo, setDepositoTipo] = useState<'TOTAL' | 'PARCIAL' | 'NINGUNO'>('TOTAL');
  const [montoRetenido, setMontoRetenido] = useState<number>(0);
  const [obsCierre, setObsCierre] = useState('');

  // IE
  const [ieTipo, setIeTipo] = useState<'INGRESO' | 'EGRESO'>('INGRESO');
  const [ieMonto, setIeMonto] = useState<number>(0);
  const [ieDesc, setIeDesc] = useState('');

  // ═══════════════ QUERIES ═══════════════

  const { data: misCajas = [], isLoading: misCajasLoading } = useQuery({
    queryKey: ['mis-cajas', user?.USUARIO_ID],
    queryFn: () => cajaApi.getMisCajas(),
  });

  const { data: miSesionActiva, refetch: refetchMiSesion } = useQuery({
    queryKey: ['mi-sesion-activa', user?.USUARIO_ID],
    queryFn: () => cajaApi.getMiSesionActiva(),
  });

  const { data: cajasList = [], isLoading: cajasListLoading } = useQuery({
    queryKey: ['cajas-list', puntoVentaActivo],
    queryFn: () => cajaApi.listarCajas({ puntoVentaIds: puntoVentaActivo ? [puntoVentaActivo] : undefined }),
  });

  // Sincronizar cajaDrawerActiva con la versión fresca de cajasList.
  // Sin esto, al cerrar/abrir una sesión el drawer seguía mostrando
  // SESION_ACTIVA_ID stale (verde) hasta refrescar manualmente.
  useEffect(() => {
    if (!cajaDrawerActiva) return;
    const fresh = cajasList.find(c => c.CAJA_ID === cajaDrawerActiva.CAJA_ID);
    if (!fresh) return;
    // Comparación superficial: sólo reseteamos si cambiaron los campos que
    // el drawer consume (SESION_ACTIVA_ID, TOTAL_SESIONES, USUARIOS_ASIGNADOS, ACTIVA).
    const changed =
      fresh.SESION_ACTIVA_ID !== cajaDrawerActiva.SESION_ACTIVA_ID ||
      fresh.TOTAL_SESIONES !== cajaDrawerActiva.TOTAL_SESIONES ||
      fresh.ACTIVA !== cajaDrawerActiva.ACTIVA ||
      (fresh.USUARIOS_ASIGNADOS?.length ?? 0) !== (cajaDrawerActiva.USUARIOS_ASIGNADOS?.length ?? 0);
    if (changed) setCajaDrawerActiva(fresh);
  }, [cajasList, cajaDrawerActiva]);

  const { data: ccEfectivo } = useQuery({
    queryKey: ['cc-efectivo', puntoVentaActivo],
    queryFn: () => cajaApi.getEfectivoCajaCentral(puntoVentaActivo || undefined),
  });

  // Mapa reactivo de colores personalizados por caja (localStorage)
  const [accentColors, setAccentColors] = useState<Record<number, string>>({});
  useEffect(() => {
    const sync = () => {
      const map: Record<number, string> = {};
      cajasList.forEach(c => {
        const color = getColorForCaja(c.CAJA_ID);
        if (color) map[c.CAJA_ID] = color;
      });
      setAccentColors(map);
    };
    sync();
    const handler = (e: StorageEvent) => {
      if (e.key === null || e.key === 'rg-caja-colores') sync();
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [cajasList]);
  const accentColorsByCaja = accentColors;

  // Catálogos para ABM de Cajas (modal "Nueva Caja" + "Asignar usuarios")
  const { data: pvSelector = [], isFetching: pvSelectorLoading } = useQuery({
    queryKey: ['puntos-venta-selector-caja'],
    queryFn: () => puntoVentaApi.getSelector(),
    enabled: abmModalOpen || usuariosModalOpen,
    staleTime: 5 * 60_000,
  });

  const { data: usuariosAll = [], isFetching: usuariosLoading } = useQuery({
    queryKey: ['usuarios-activos-caja'],
    queryFn: () => usuariosApi.getAll({ activo: true }),
    enabled: abmModalOpen || usuariosModalOpen,
    staleTime: 5 * 60_000,
  });

  const pvOptions = useMemo(
    () =>
      pvSelector.map(pv => ({
        value: pv.PUNTO_VENTA_ID,
        label: pv.ACTIVO ? pv.NOMBRE : `${pv.NOMBRE} (inactivo)`,
      })),
    [pvSelector],
  );

  const usuariosOptions = useMemo(
    () =>
      usuariosAll.map(u => ({
        value: u.USUARIO_ID,
        label: u.NOMBRE_COMPLETO || u.NOMBRE,
      })),
    [usuariosAll],
  );

  // ═══════════════ MUTATIONS ═══════════════

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['mis-cajas'] });
    queryClient.invalidateQueries({ queryKey: ['mi-sesion-activa'] });
    queryClient.invalidateQueries({ queryKey: ['caja-sesiones'] });
    queryClient.invalidateQueries({ queryKey: ['caja-sesiones-detalle'] });
    queryClient.invalidateQueries({ queryKey: ['cajas-list'] });
    queryClient.invalidateQueries({ queryKey: ['caja-sesion'] });
    queryClient.invalidateQueries({ queryKey: ['cc-efectivo'] });
    queryClient.invalidateQueries({ queryKey: ['caja-central-mov'] });
    queryClient.invalidateQueries({ queryKey: ['caja-central-totales'] });
  };

  const abrirMutation = useMutation({
    mutationFn: (data: AbrirCajaInput) => cajaApi.abrirSesion(data),
    onSuccess: (data) => {
      message.success(`Sesión #${data.NRO_SESION} abierta`);
      setAbrirModalOpen(false);
      setCajaSeleccionadaAbrir(null);
      setFuenteApertura('APORTE_CC');
      setMontoApertura(0);
      setObsApertura('');
      invalidateAll();
      refetchMiSesion();
    },
    onError: (e: any) => message.error(e?.response?.data?.error || 'Error al abrir sesión'),
  });

  const cerrarMutation = useMutation({
    mutationFn: ({ sesionId, data }: { sesionId: number; data: CerrarCajaInput }) =>
      cajaApi.cerrarSesion(sesionId, data),
    onSuccess: () => {
      message.success('Sesión cerrada');
      setCerrarModalOpen(false);
      setSesionParaCerrar(null);
      setMontoRetenido(0);
      setObsCierre('');
      invalidateAll();
      refetchMiSesion();
    },
    onError: (e: any) => message.error(e?.response?.data?.error || 'Error al cerrar sesión'),
  });

  const ieMutation = useMutation({
    mutationFn: ({ sesionId, data }: { sesionId: number; data: { tipo: 'INGRESO' | 'EGRESO'; monto: number; descripcion: string } }) =>
      cajaApi.addIngresoEgreso(sesionId, data),
    onSuccess: () => {
      message.success(`${ieTipo} registrado`);
      setIngresoEgresoModalOpen(false);
      setIeMonto(0);
      setIeDesc('');
      invalidateAll();
    },
    onError: (e: any) => message.error(e?.response?.data?.error || 'Error al registrar'),
  });

  const crearCajaMutation = useMutation({
    mutationFn: cajaApi.crearCaja,
    onSuccess: () => {
      message.success('Caja creada');
      setAbmModalOpen(false);
      setEditingCaja(null);
      invalidateAll();
    },
    onError: (e: any) => message.error(e?.response?.data?.error || 'Error'),
  });

  const editarCajaMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { nombre?: string; activa?: boolean } }) =>
      cajaApi.editarCaja(id, data),
    onSuccess: () => {
      message.success('Caja actualizada');
      setAbmModalOpen(false);
      setEditingCaja(null);
      invalidateAll();
    },
    onError: (e: any) => message.error(e?.response?.data?.error || 'Error'),
  });

  const asignarUsuariosMutation = useMutation({
    mutationFn: ({ id, usuariosIds }: { id: number; usuariosIds: number[] }) =>
      cajaApi.asignarUsuarios(id, usuariosIds),
    onSuccess: () => {
      message.success('Usuarios asignados');
      setUsuariosModalOpen(false);
      setCajaParaUsuarios(null);
      invalidateAll();
    },
    onError: (e: any) => message.error(e?.response?.data?.error || 'Error'),
  });

  // ═══════════════ HANDLERS ═══════════════

  const handleAbrir = () => {
    if (!cajaSeleccionadaAbrir) {
      message.warning('Seleccione una caja');
      return;
    }
    abrirMutation.mutate({
      cajaId: cajaSeleccionadaAbrir,
      fuente: fuenteApertura,
      montoApertura,
      obs: obsApertura || undefined,
    });
  };

  const handleCerrar = () => {
    if (!sesionParaCerrar) return;
    const disp = sesionParaCerrar.EFECTIVO_DISPONIBLE || 0;
    const retenidoCalc = depositoTipo === 'TOTAL'
      ? 0
      : depositoTipo === 'PARCIAL'
        ? Math.min(Math.max(montoRetenido, 0), disp)
        : disp;
    const depositoCalc = Math.max(disp - retenidoCalc, 0);
    cerrarMutation.mutate({
      sesionId: sesionParaCerrar.SESION_ID,
      data: {
        saldoRetenido: retenidoCalc,
        deposito: depositoTipo,
        depositoMonto: depositoTipo === 'PARCIAL' ? depositoCalc : undefined,
        obs: obsCierre || undefined,
      },
    });
  };

  useEffect(() => {
    if (cerrarModalOpen) {
      setDepositoTipo('TOTAL');
      setMontoRetenido(0);
      setObsCierre('');
    }
  }, [cerrarModalOpen]);

  const cierreDisponible = sesionParaCerrar?.EFECTIVO_DISPONIBLE || 0;
  const cierreRetenido = depositoTipo === 'TOTAL'
    ? 0
    : depositoTipo === 'PARCIAL'
      ? Math.min(Math.max(montoRetenido, 0), cierreDisponible)
      : cierreDisponible;
  const cierreDeposito = Math.max(cierreDisponible - cierreRetenido, 0);
  const cierreInvalido = depositoTipo === 'PARCIAL' && (montoRetenido <= 0 || montoRetenido > cierreDisponible);

  const handleIE = () => {
    if (!sesionParaIE || ieMonto <= 0 || !ieDesc) {
      message.warning('Complete todos los campos');
      return;
    }
    ieMutation.mutate({
      sesionId: sesionParaIE.SESION_ID,
      data: { tipo: ieTipo, monto: ieMonto, descripcion: ieDesc },
    });
  };

  const handleCrearCaja = (values: any) => {
    if (editingCaja) {
      editarCajaMutation.mutate({ id: editingCaja.CAJA_ID, data: { nombre: values.nombre, activa: values.activa } });
      // Persistir color personalizado en localStorage
      setColorForCaja(editingCaja.CAJA_ID, colorTemporalABM);
    } else {
      crearCajaMutation.mutate({
        nombre: values.nombre,
        puntoVentaId: values.puntoVentaId,
        usuariosIds: values.usuariosIds || [],
      });
    }
  };

  // Color temporal del modal ABM (se persiste en onFinish para edición)
  const [colorTemporalABM, setColorTemporalABM] = useState<string | null>(null);
  // Cuando se abre el modal ABM, precargar el color actual de la caja
  useEffect(() => {
    if (abmModalOpen && editingCaja) {
      setColorTemporalABM(getColorForCaja(editingCaja.CAJA_ID));
    } else if (abmModalOpen && !editingCaja) {
      setColorTemporalABM(null);
    }
  }, [abmModalOpen, editingCaja]);

  // ═══════════════ CÁLCULOS PARA MODALES ═══════════════

  const cajaParaAbrir = misCajas.find(c => c.CAJA_ID === cajaSeleccionadaAbrir);
  const maxAporteCC = ccEfectivo?.efectivo ?? 0;
  const retenidoDisponible = cajaParaAbrir?.SALDO_RETENIDO ?? 0;
  const totalDisponible = maxAporteCC + retenidoDisponible;

  const fuenteOpciones = useMemo(() => {
    if (!cajaParaAbrir) return [];
    const hasRetenido = retenidoDisponible > 0;
    return [
      {
        value: 'APORTE_CC' as const,
        icon: <ImportOutlined style={{ color: '#1677ff', fontSize: 20 }} />,
        title: 'Aporte desde Caja Central',
        desc: hasRetenido
          ? `No disponible: la caja tiene ${fmtMoney(retenidoDisponible)} retenido que debe incluirse en la apertura.`
          : maxAporteCC > 0
            ? `Tomar todo el efectivo de CC. Máximo: ${fmtMoney(maxAporteCC)}.`
            : 'No hay efectivo disponible en Caja Central.',
        disabled: hasRetenido || maxAporteCC === 0,
        montoMax: maxAporteCC,
      },
      {
        value: 'USAR_RETENIDO' as const,
        icon: <LockOutlined style={{ color: '#722ed1', fontSize: 20 }} />,
        title: 'Usar saldo retenido',
        desc: retenidoDisponible > 0
          ? `Tomar la totalidad del efectivo que quedó retenido en esta caja.`
          : 'Esta caja no tiene saldo retenido.',
        disabled: retenidoDisponible === 0,
        montoMax: retenidoDisponible,
      },
      {
        value: 'MIXTO' as const,
        icon: <SwapOutlined style={{ color: '#52c41a', fontSize: 20 }} />,
        title: 'Mixto (retenido + Caja Central)',
        desc: hasRetenido
          ? `Toma los ${fmtMoney(retenidoDisponible)} retenidos y suma desde CC. Máximo total: ${fmtMoney(totalDisponible)}.`
          : totalDisponible > 0
            ? `Primero se usa el retenido, después CC. Máximo: ${fmtMoney(totalDisponible)}.`
            : 'No hay efectivo disponible (ni retenido ni en CC).',
        disabled: totalDisponible === 0 || (retenidoDisponible === 0 || maxAporteCC === 0),
        montoMax: totalDisponible,
      },
      {
        value: 'NINGUNO' as const,
        icon: <StopOutlined style={{ color: '#8c8c8c', fontSize: 20 }} />,
        title: 'Sin aporte inicial',
        desc: hasRetenido
          ? `No disponible: la caja tiene ${fmtMoney(retenidoDisponible)} retenido que debe incluirse en la apertura.`
          : 'Abrir la caja con $0. El efectivo puede ingresarse después como Ingreso de caja desde la sesión activa.',
        disabled: hasRetenido,
        montoMax: 0,
      },
    ];
  }, [cajaParaAbrir, maxAporteCC, retenidoDisponible, totalDisponible]);

  useEffect(() => {
    if (!cajaParaAbrir) return;
    const current = fuenteOpciones.find(o => o.value === fuenteApertura);
    if (current?.disabled) {
      const firstValid = fuenteOpciones.find(o => !o.disabled);
      if (firstValid && firstValid.value !== fuenteApertura) {
        setFuenteApertura(firstValid.value);
        setMontoApertura(retenidoDisponible > 0 ? retenidoDisponible : 0);
      }
    }
  }, [cajaParaAbrir, fuenteOpciones, fuenteApertura, retenidoDisponible]);

  useEffect(() => {
    if (abrirModalOpen) {
      setFuenteApertura('APORTE_CC');
      setMontoApertura(0);
      setObsApertura('');
    }
  }, [abrirModalOpen]);

  const fuenteActual = fuenteOpciones.find(o => o.value === fuenteApertura);
  const montoMaximoApertura = fuenteActual?.montoMax ?? 0;
  const montoMinimoApertura = retenidoDisponible > 0 ? retenidoDisponible : 0;
  const aperturaInvalida = !cajaSeleccionadaAbrir
    || (fuenteActual?.disabled ?? true)
    || montoApertura > montoMaximoApertura
    || (retenidoDisponible > 0 && montoApertura < retenidoDisponible);
  const aperturaFromRetenido = fuenteApertura === 'APORTE_CC'
    ? 0
    : Math.min(retenidoDisponible, montoApertura);
  const aperturaFromCC = fuenteApertura === 'USAR_RETENIDO'
    ? 0
    : Math.max(0, montoApertura - retenidoDisponible);

  // ═══════════════ COLUMNAS ═══════════════
  // (Las columnas de sesiones ahora viven dentro de CajaDetalleDrawer
  //  porque cada caja muestra su propio historial filtrado por cajaId.)

  // ═══════════════ DEEP-LINK (state + query) ═══════════════
  // Permite que /sales, /cashcentral, etc. abran directamente el drawer de una caja.
  useEffect(() => {
    const st = (location.state || {}) as { openCajaId?: number; autoAbrirCaja?: boolean };
    const sesionQS = searchParams.get('sesion');

    // Si llegamos por deep-link, forzar refetch de las queries que vamos a usar.
    // Esto es defensivo: si la invalidación previa (ej. al crear una venta)
    // usó `refetchType: 'all'`, los datos ya están frescos; si por algún motivo
    // no se ejecutó, este refetch garantiza datos actualizados.
    const wantsDeepLink =
      typeof st.openCajaId === 'number' ||
      !!st.autoAbrirCaja ||
      !!sesionQS;
    if (wantsDeepLink) {
      queryClient.refetchQueries({ queryKey: ['cajas-list'], type: 'all' });
      queryClient.refetchQueries({ queryKey: ['mi-sesion-activa'], type: 'all' });
      queryClient.refetchQueries({ queryKey: ['mis-cajas'], type: 'all' });
    }

    if (!cajasList || cajasList.length === 0) return;

    // 1) state.openCajaId → abrir el drawer de esa caja
    if (typeof st.openCajaId === 'number') {
      const caja = cajasList.find(c => c.CAJA_ID === st.openCajaId);
      if (caja) {
        setCajaDrawerActiva(caja);
        navigate(location.pathname, { replace: true, state: {} });
      }
      return;
    }

    // 2) state.autoAbrirCaja → drawer + modal "Abrir sesión" preseleccionado
    if (st.autoAbrirCaja) {
      const first = misCajas[0] || cajasList[0];
      if (first) {
        setCajaDrawerActiva(first);
        setCajaSeleccionadaAbrir(first.CAJA_ID);
        setAbrirModalOpen(true);
        navigate(location.pathname, { replace: true, state: {} });
      }
      return;
    }

    // 3) ?sesion=CAJA_ID (compatibilidad con deep-links legacy)
    if (sesionQS) {
      const cajaId = Number(sesionQS);
      if (!Number.isNaN(cajaId)) {
        const caja = cajasList.find(c => c.CAJA_ID === cajaId);
        if (caja) {
          setCajaDrawerActiva(caja);
          setSearchParams({}, { replace: true });
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, searchParams, cajasList, misCajas]);

  return (
    <div className="rg-cajas-page">
      <div className="page-header">
        <div>
          <Title level={3} style={{ margin: 0 }}>Cajas</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            Seleccioná una caja para ver el detalle y su historial de sesiones
          </Text>
        </div>
        <Space wrap>
          {miSesionActiva ? (
            <Tag
              color="green"
              icon={<CheckCircleOutlined />}
              style={{ fontSize: 13, padding: '4px 12px', borderRadius: 999 }}
            >
              Mi sesión #{miSesionActiva.NRO_SESION} activa — {fmtMoney(miSesionActiva.EFECTIVO_DISPONIBLE || 0)}
            </Tag>
          ) : hasPermiso('caja.abrir') && misCajas.length > 0 ? (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                const first = misCajas[0];
                if (first) {
                  setCajaSeleccionadaAbrir(first.CAJA_ID);
                  setAbrirModalOpen(true);
                }
              }}
            >
              Abrir mi sesión
            </Button>
          ) : null}
          <Button icon={<SwapOutlined />} onClick={() => setTransferirModalOpen(true)}>
            Transferir
          </Button>
          {hasPermiso('caja.administrar') && (
            <Button
              type="primary"
              ghost
              icon={<PlusOutlined />}
              onClick={() => { setEditingCaja(null); setAbmModalOpen(true); }}
            >
              Nueva Caja
            </Button>
          )}
        </Space>
      </div>

      <div className="rg-cajas-page__intro">
        <InfoCircleOutlined />
        <span>
          Las cajas son puntos físicos donde se opera efectivo. Cada caja puede tener una sesión activa a la vez.
          Hacé clic en una caja para ver su historial y operar sobre ella.
        </span>
      </div>

      {cajasListLoading && cajasList.length === 0 ? (
        <div className="rg-cajas-empty">
          <BankOutlined />
          <div className="rg-cajas-empty__title">Cargando cajas…</div>
        </div>
      ) : cajasList.length === 0 ? (
        <div className="rg-cajas-empty">
          <BankOutlined />
          <div className="rg-cajas-empty__title">No hay cajas configuradas</div>
          <div>
            {hasPermiso('caja.administrar')
              ? 'Creá la primera caja con el botón "Nueva Caja".'
              : 'Pedile a un administrador que configure las cajas del sistema.'}
          </div>
        </div>
      ) : (
        <div className="rg-cajas-grid stagger">
          {cajasList
            .slice()
            .sort((a, b) => {
              const rank = (c: Caja) => {
                if (c.SESION_ACTIVA_ID && miSesionActiva && c.CAJA_ID === miSesionActiva.CAJA_ID) return 0;
                if (c.SESION_ACTIVA_ID) return 1;
                return 2;
              };
              return rank(a) - rank(b);
            })
            .map(caja => (
              <CajaCard
                key={caja.CAJA_ID}
                caja={caja}
                miSesionActiva={miSesionActiva}
                accentColor={accentColorsByCaja[caja.CAJA_ID] ?? null}
                onClick={() => setCajaDrawerActiva(caja)}
              />
            ))}
        </div>
      )}

      <CajaDetalleDrawer
        caja={cajaDrawerActiva}
        onClose={() => setCajaDrawerActiva(null)}
        onVerSesion={(s) => setSesionActivaDetalle(s)}
        onAbrirSesion={(c) => {
          setCajaSeleccionadaAbrir(c.CAJA_ID);
          setAbrirModalOpen(true);
        }}
        onIngreso={(s) => { setSesionParaIE(s); setIeTipo('INGRESO'); setIngresoEgresoModalOpen(true); }}
        onEgreso={(s) => { setSesionParaIE(s); setIeTipo('EGRESO'); setIngresoEgresoModalOpen(true); }}
        onCerrar={(s) => { setSesionParaCerrar(s); setCerrarModalOpen(true); }}
        onTransferir={() => setTransferirModalOpen(true)}
        onEditar={(c) => { setEditingCaja(c); setAbmModalOpen(true); }}
        onAsignarUsuarios={(c) => {
          setCajaParaUsuarios(c);
          setUsuariosSeleccionados(c.USUARIOS_ASIGNADOS?.map(u => u.USUARIO_ID) || []);
          setUsuariosModalOpen(true);
        }}
        onDesgloseItem={handleDesgloseItem}
        onDesgloseTotal={handleDesgloseTotal}
        currentUserId={user?.USUARIO_ID}
        canAbrir={hasPermiso('caja.abrir')}
        canIngreso={hasPermiso('caja.ingreso')}
        canEgreso={hasPermiso('caja.egreso')}
        canCerrar={hasPermiso('caja.cerrar')}
        canAdministrar={hasPermiso('caja.administrar')}
      />

      {/* Modal Abrir Sesión */}
      <Modal
        title={
          <RGCajaModalHeader
            icon={<ShopOutlined />}
            title="Abrir sesión de caja"
            subtitle="Configurá el efectivo inicial para comenzar a operar"
          />
        }
        open={abrirModalOpen}
        onCancel={() => setAbrirModalOpen(false)}
        onOk={handleAbrir}
        confirmLoading={abrirMutation.isPending}
        okText="Abrir sesión"
        cancelText="Cancelar"
        okButtonProps={{ disabled: aperturaInvalida }}
        width={920}
        className="rg-modal rg-modal-abrir-sesion"
        destroyOnClose
      >
        <div className="rg-abrir-sesion">
          {/* TOP STRIP: Caja + Stats */}
          <div className="rg-abrir-sesion__top">
            <div className="rg-abrir-sesion__caja">
              <div className="rg-field-label">
                <ShopOutlined /> Caja
              </div>
              <Select
                placeholder="Seleccione una caja"
                value={cajaSeleccionadaAbrir || undefined}
                onChange={setCajaSeleccionadaAbrir}
                loading={misCajasLoading}
                showSearch
                optionFilterProp="label"
                size="large"
                style={{ width: '100%' }}
                options={misCajas.map(c => ({
                  value: c.CAJA_ID,
                  label: `${c.NOMBRE || `Caja #${c.CAJA_ID}`} — ${c.PUNTO_VENTA_NOMBRE} · Retenido: ${fmtMoney(c.SALDO_RETENIDO)}${c.SESION_ACTIVA_ID ? ' · Sesión activa' : ''}`,
                  disabled: c.SESION_ACTIVA_ID != null,
                }))}
              />
            </div>

            {cajaParaAbrir && (
              <div className="rg-abrir-sesion__stats">
                <div className="rg-mini-stat" style={{ borderLeftColor: '#722ed1' }}>
                  <LockOutlined className="rg-mini-stat__icon" style={{ color: '#722ed1' }} />
                  <div>
                    <div className="rg-mini-stat__label">Saldo retenido</div>
                    <div className="rg-mini-stat__value" style={{ color: retenidoDisponible > 0 ? '#722ed1' : '#999' }}>
                      {fmtMoney(retenidoDisponible)}
                    </div>
                  </div>
                </div>
                <div className="rg-mini-stat" style={{ borderLeftColor: '#1677ff' }}>
                  <ImportOutlined className="rg-mini-stat__icon" style={{ color: '#1677ff' }} />
                  <div>
                    <div className="rg-mini-stat__label">Efectivo CC</div>
                    <div className="rg-mini-stat__value" style={{ color: maxAporteCC > 0 ? '#1677ff' : '#999' }}>
                      {fmtMoney(maxAporteCC)}
                    </div>
                  </div>
                </div>
                <div className="rg-mini-stat" style={{ borderLeftColor: '#52c41a' }}>
                  <WalletOutlined className="rg-mini-stat__icon" style={{ color: '#52c41a' }} />
                  <div>
                    <div className="rg-mini-stat__label">Total disponible</div>
                    <div className="rg-mini-stat__value" style={{ color: totalDisponible > 0 ? '#52c41a' : '#cf1322' }}>
                      {fmtMoney(totalDisponible)}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {cajaParaAbrir ? (
            <div className="rg-abrir-sesion__main">
              {/* LEFT COLUMN: Fuente del efectivo + Monto */}
              <div className="rg-abrir-sesion__col rg-abrir-sesion__col--left">
                <div className="rg-section-title">
                  <ImportOutlined style={{ color: 'var(--rg-gold-dark)' }} />
                  <span>Fuente del efectivo inicial</span>
                </div>

                <div className="rg-abrir-sesion__options">
                  {fuenteOpciones.map(opt => {
                    const selected = fuenteApertura === opt.value;
                    return (
                      <div
                        key={opt.value}
                        className={`rg-fuente-card ${selected ? 'is-selected' : ''} ${opt.disabled ? 'is-disabled' : ''}`}
                        onClick={() => {
                          if (opt.disabled) return;
                          setFuenteApertura(opt.value);
                          setMontoApertura(retenidoDisponible > 0 ? retenidoDisponible : 0);
                        }}
                      >
                        <Radio value={opt.value} checked={selected} disabled={opt.disabled} onClick={(e) => e.stopPropagation()} />
                        <div className="rg-fuente-card__icon">{opt.icon}</div>
                        <div className="rg-fuente-card__body">
                          <div className="rg-fuente-card__title">
                            {opt.title}
                            {opt.disabled && <Tag color="default" style={{ marginLeft: 6, fontSize: 10, lineHeight: '16px', padding: '0 6px' }}>Sin saldo</Tag>}
                          </div>
                          <div className="rg-fuente-card__desc">{opt.desc}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {fuenteApertura === 'NINGUNO' ? (
                  <Alert
                    type="info"
                    showIcon
                    icon={<InfoCircleOutlined />}
                    style={{ marginTop: 10 }}
                    message="La caja se abrirá con $0"
                    description="Una vez iniciada la sesión, podés registrar ingresos de efectivo desde el detalle de la sesión activa."
                  />
                ) : (
                  <div className="rg-monto-block">
                    <div className="rg-field-label">
                      Monto de apertura <span style={{ color: '#ff4d4f' }}>*</span>
                    </div>
                    <InputNumber
                      value={montoApertura}
                      onChange={v => setMontoApertura(Math.min(Math.max(Number(v) || 0, montoMinimoApertura), montoMaximoApertura))}
                      min={montoMinimoApertura}
                      max={montoMaximoApertura}
                      style={{ width: '100%' }}
                      size="large"
                      status={aperturaInvalida && (montoApertura > montoMaximoApertura || (retenidoDisponible > 0 && montoApertura < retenidoDisponible)) ? 'error' : ''}
                      formatter={value => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}
                      parser={value => Number((value || '').replace(/[$\s.]/g, '')) || 0}
                      addonAfter={
                        fuenteActual && !fuenteActual.disabled && montoMaximoApertura > 0 ? (
                          <Button
                            size="small"
                            type="link"
                            onClick={() => setMontoApertura(montoMaximoApertura)}
                            style={{ padding: '0 8px' }}
                          >
                            Todo
                          </Button>
                        ) : null
                      }
                    />
                    <div className={`rg-field-help ${aperturaInvalida && (montoApertura > montoMaximoApertura || (retenidoDisponible > 0 && montoApertura < retenidoDisponible)) ? 'is-error' : ''}`}>
                      {aperturaInvalida && montoApertura > montoMaximoApertura
                        ? `El monto no puede superar ${fmtMoney(montoMaximoApertura)}`
                        : aperturaInvalida && retenidoDisponible > 0 && montoApertura < retenidoDisponible
                          ? `El monto debe ser al menos ${fmtMoney(retenidoDisponible)} para tomar el saldo retenido`
                          : retenidoDisponible > 0
                            ? `Mínimo: ${fmtMoney(retenidoDisponible)} (saldo retenido) · Máximo: ${fmtMoney(montoMaximoApertura)}`
                            : `Máximo: ${fmtMoney(montoMaximoApertura)}`}
                    </div>
                  </div>
                )}
              </div>

              {/* RIGHT COLUMN: Alertas + Composición + Observaciones */}
              <div className="rg-abrir-sesion__col rg-abrir-sesion__col--right">
                {retenidoDisponible > 0 && (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 10 }}
                    message={
                      <span style={{ fontSize: 12 }}>
                        Esta caja tiene <Text strong>{fmtMoney(retenidoDisponible)}</Text> retenido. Debe incluirse obligatoriamente en la apertura.
                      </span>
                    }
                  />
                )}

                <div className="rg-composicion-card">
                  <div className="rg-composicion-card__title">Composición de la apertura</div>
                  <div className="rg-composicion-card__row">
                    <span className="rg-composicion-card__dot" style={{ background: '#722ed1' }} />
                    <LockOutlined style={{ color: '#722ed1' }} />
                    <span className="rg-composicion-card__label">Del retenido</span>
                    <span className="rg-composicion-card__value">{fmtMoney(aperturaFromRetenido)}</span>
                  </div>
                  <div className="rg-composicion-card__row">
                    <span className="rg-composicion-card__dot" style={{ background: '#1677ff' }} />
                    <ImportOutlined style={{ color: '#1677ff' }} />
                    <span className="rg-composicion-card__label">De Caja Central</span>
                    <span className="rg-composicion-card__value">{fmtMoney(aperturaFromCC)}</span>
                  </div>
                  <div className="rg-composicion-card__row rg-composicion-card__row--total">
                    <span className="rg-composicion-card__dot" style={{ background: '#52c41a' }} />
                    <WalletOutlined style={{ color: '#52c41a' }} />
                    <span className="rg-composicion-card__label"><Text strong>Total apertura</Text></span>
                    <span className="rg-composicion-card__value"><Text strong style={{ color: 'var(--rg-gold-dark)' }}>{fmtMoney(montoApertura)}</Text></span>
                  </div>
                </div>

                <div className="rg-field-label" style={{ marginTop: 12 }}>Observaciones (opcional)</div>
                <Input.TextArea
                  value={obsApertura}
                  onChange={e => setObsApertura(e.target.value)}
                  rows={2}
                  placeholder="Ej: Diferencia por centavos, faltante, etc."
                />
              </div>
            </div>
          ) : (
            <div className="rg-abrir-sesion__empty">
              <div className="rg-abrir-sesion__empty-icon">
                <ShopOutlined />
              </div>
              <div className="rg-abrir-sesion__empty-title">Seleccioná una caja</div>
              <div className="rg-abrir-sesion__empty-desc">
                Elegí la caja en la que vas a operar para ver el saldo disponible y configurar la apertura.
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Modal Cerrar Sesión */}
      <Modal
        title={
          sesionParaCerrar ? (
            <RGCajaModalHeader
              icon={<CheckCircleOutlined />}
              title="Cerrar caja"
              subtitle={`Sesión #${sesionParaCerrar.NRO_SESION} · ${sesionParaCerrar.CAJA_NOMBRE || `Caja #${sesionParaCerrar.CAJA_ID}`}`}
              tag={`#${sesionParaCerrar.NRO_SESION}`}
            />
          ) : (
            <RGCajaModalHeader icon={<CheckCircleOutlined />} title="Cerrar caja" />
          )
        }
        open={cerrarModalOpen}
        onCancel={() => setCerrarModalOpen(false)}
        onOk={handleCerrar}
        confirmLoading={cerrarMutation.isPending}
        okText="Cerrar caja"
        cancelText="Cancelar"
        okButtonProps={{ disabled: cierreInvalido }}
        width={920}
        className="rg-modal rg-modal-cerrar-sesion"
        destroyOnClose
      >
        {sesionParaCerrar && (
          <div className="rg-abrir-sesion">
            {/* TOP STRIP: Sesión info + Stats */}
            <div className="rg-abrir-sesion__top">
              <div className="rg-sesion-info">
                <div className="rg-field-label">
                  <ShopOutlined /> Sesión
                </div>
                <div className="rg-sesion-info__card">
                  <div className="rg-sesion-info__row">
                    <span className="rg-sesion-info__label">Caja</span>
                    <span className="rg-sesion-info__value">{sesionParaCerrar.CAJA_NOMBRE || `#${sesionParaCerrar.CAJA_ID}`}</span>
                  </div>
                  {sesionParaCerrar.PUNTO_VENTA_NOMBRE && (
                    <div className="rg-sesion-info__row">
                      <span className="rg-sesion-info__label">Punto de venta</span>
                      <span className="rg-sesion-info__value">{sesionParaCerrar.PUNTO_VENTA_NOMBRE}</span>
                    </div>
                  )}
                  <div className="rg-sesion-info__row">
                    <span className="rg-sesion-info__label">Usuario</span>
                    <span className="rg-sesion-info__value">{sesionParaCerrar.USUARIO_NOMBRE || '—'}</span>
                  </div>
                  <div className="rg-sesion-info__row">
                    <span className="rg-sesion-info__label">Apertura</span>
                    <span className="rg-sesion-info__value">{dayjs(sesionParaCerrar.FECHA_APERTURA).format('DD/MM/YY HH:mm')}</span>
                  </div>
                </div>
              </div>

              <div className="rg-abrir-sesion__stats">
                {(() => {
                  const retenidoUsado = Number(sesionParaCerrar.RETENIDO_USADO) || 0;
                  const aporteCC = Number(sesionParaCerrar.APORTE_CC) || 0;
                  const tieneComponentes = retenidoUsado > 0 || aporteCC > 0;
                  const aperturaNode = (
                    <div className="rg-mini-stat" style={{ borderLeftColor: '#1677ff' }}>
                      <ImportOutlined className="rg-mini-stat__icon" style={{ color: '#1677ff' }} />
                      <div>
                        <div className="rg-mini-stat__label">
                          Apertura
                          {tieneComponentes && <InfoCircleOutlined style={{ fontSize: 10, marginLeft: 4, color: '#1677ff' }} />}
                        </div>
                        <div className="rg-mini-stat__value" style={{ color: '#1677ff' }}>
                          {fmtMoney(sesionParaCerrar.MONTO_APERTURA)}
                        </div>
                      </div>
                    </div>
                  );
                  if (!tieneComponentes) return aperturaNode;
                  return (
                    <Popover
                      trigger="hover"
                      placement="bottom"
                      arrow={{ pointAtCenter: true }}
                      overlayInnerStyle={{ borderRadius: 8, padding: '12px 14px' }}
                      content={
                        <div style={{ minWidth: 220 }}>
                          <div
                            style={{
                              fontSize: 10,
                              color: '#999',
                              textTransform: 'uppercase',
                              letterSpacing: 0.6,
                              marginBottom: 10,
                              fontWeight: 600,
                            }}
                          >
                            Composición de la apertura
                          </div>
                          {retenidoUsado > 0 && (
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '6px 0',
                                borderBottom: aporteCC > 0 ? '1px dashed #f0f0f0' : 'none',
                              }}
                            >
                              <Space size={6}>
                                <LockOutlined style={{ color: '#722ed1' }} />
                                <Text style={{ color: '#722ed1' }}>Del retenido</Text>
                              </Space>
                              <Text strong>{fmtMoney(retenidoUsado)}</Text>
                            </div>
                          )}
                          {aporteCC > 0 && (
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '6px 0',
                              }}
                            >
                              <Space size={6}>
                                <ImportOutlined style={{ color: '#1677ff' }} />
                                <Text style={{ color: '#1677ff' }}>Aporte CC</Text>
                              </Space>
                              <Text strong>{fmtMoney(aporteCC)}</Text>
                            </div>
                          )}
                        </div>
                      }
                    >
                      <div style={{ cursor: 'help' }}>{aperturaNode}</div>
                    </Popover>
                  );
                })()}

                <div className="rg-mini-stat" style={{ borderLeftColor: '#52c41a' }}>
                  <WalletOutlined className="rg-mini-stat__icon" style={{ color: '#52c41a' }} />
                  <div>
                    <div className="rg-mini-stat__label">Efectivo disponible</div>
                    <div className="rg-mini-stat__value" style={{ color: '#52c41a' }}>
                      {fmtMoney(cierreDisponible)}
                    </div>
                  </div>
                </div>

                {(Number(sesionParaCerrar.VENTA_EFECTIVO) || 0) > 0 && (
                  <div className="rg-mini-stat" style={{ borderLeftColor: '#fa8c16' }}>
                    <ArrowUpOutlined className="rg-mini-stat__icon" style={{ color: '#fa8c16' }} />
                    <div>
                      <div className="rg-mini-stat__label">Venta efectivo</div>
                      <div className="rg-mini-stat__value" style={{ color: '#fa8c16' }}>
                        {fmtMoney(Number(sesionParaCerrar.VENTA_EFECTIVO) || 0)}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* MAIN 2 COLUMNS */}
            <div className="rg-abrir-sesion__main">
              {/* LEFT: Opción de depósito + monto */}
              <div className="rg-abrir-sesion__col rg-abrir-sesion__col--left">
                <div className="rg-section-title">
                  <ExportOutlined style={{ color: 'var(--rg-gold-dark)' }} />
                  <span>¿Qué hacés con el efectivo disponible?</span>
                </div>

                <div className="rg-abrir-sesion__options rg-abrir-sesion__options--vertical">
                  {[
                    {
                      value: 'TOTAL' as const,
                      icon: <ExportOutlined style={{ color: '#1677ff', fontSize: 20 }} />,
                      title: 'Depositar todo a Caja Central',
                      desc: 'Todo el efectivo vuelve a CC. La caja queda en $0 para la próxima apertura.',
                    },
                    {
                      value: 'PARCIAL' as const,
                      icon: <WalletOutlined style={{ color: '#722ed1', fontSize: 20 }} />,
                      title: 'Retener una parte y el resto a Caja Central',
                      desc: 'Indicá cuánto querés dejar en la caja. El resto va a CC.',
                    },
                    {
                      value: 'NINGUNO' as const,
                      icon: <InboxOutlined style={{ color: '#52c41a', fontSize: 20 }} />,
                      title: 'Dejar todo en la caja (no depositar)',
                      desc: 'Todo el efectivo queda retenido como saldo para la próxima apertura.',
                    },
                  ].map(opt => {
                    const selected = depositoTipo === opt.value;
                    return (
                      <div
                        key={opt.value}
                        className={`rg-fuente-card ${selected ? 'is-selected' : ''}`}
                        onClick={() => {
                          setDepositoTipo(opt.value);
                          if (opt.value !== 'PARCIAL') setMontoRetenido(0);
                        }}
                      >
                        <Radio value={opt.value} checked={selected} onClick={(e) => e.stopPropagation()} />
                        <div className="rg-fuente-card__icon">{opt.icon}</div>
                        <div className="rg-fuente-card__body">
                          <div className="rg-fuente-card__title">{opt.title}</div>
                          <div className="rg-fuente-card__desc">{opt.desc}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {depositoTipo === 'PARCIAL' && (
                  <div className="rg-monto-block">
                    <div className="rg-field-label">
                      <LockOutlined /> Monto a retener en la caja <span style={{ color: '#ff4d4f' }}>*</span>
                    </div>
                    <InputNumber
                      value={montoRetenido}
                      onChange={v => setMontoRetenido(Number(v) || 0)}
                      min={0}
                      max={cierreDisponible}
                      style={{ width: '100%' }}
                      size="large"
                      status={cierreInvalido ? 'error' : ''}
                      formatter={value => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}
                      parser={value => Number((value || '').replace(/[$\s.]/g, '')) || 0}
                      addonAfter={
                        <Button
                          size="small"
                          type="link"
                          onClick={() => setMontoRetenido(cierreDisponible)}
                          style={{ padding: '0 8px' }}
                        >
                          Todo
                        </Button>
                      }
                    />
                    <div className={`rg-field-help ${cierreInvalido ? 'is-error' : ''}`}>
                      {cierreInvalido
                        ? `El monto debe ser mayor a $0 y no superar ${fmtMoney(cierreDisponible)}`
                        : `Máximo: ${fmtMoney(cierreDisponible)}`}
                    </div>
                  </div>
                )}
              </div>

              {/* RIGHT: Resumen + alertas + observaciones */}
              <div className="rg-abrir-sesion__col rg-abrir-sesion__col--right">
                <div className="rg-composicion-card">
                  <div className="rg-composicion-card__title">Resumen del cierre</div>
                  <div className="rg-composicion-card__row">
                    <span className="rg-composicion-card__dot" style={{ background: '#fa8c16' }} />
                    <WalletOutlined style={{ color: '#fa8c16' }} />
                    <span className="rg-composicion-card__label">Efectivo a rendir</span>
                    <span className="rg-composicion-card__value">{fmtMoney(cierreDisponible)}</span>
                  </div>
                  <div className="rg-composicion-card__row">
                    <span className="rg-composicion-card__dot" style={{ background: '#1677ff' }} />
                    <ExportOutlined style={{ color: '#1677ff' }} />
                    <span className="rg-composicion-card__label">A Caja Central</span>
                    <span className="rg-composicion-card__value" style={{ color: '#1677ff' }}>{fmtMoney(cierreDeposito)}</span>
                  </div>
                  <div className="rg-composicion-card__row">
                    <span className="rg-composicion-card__dot" style={{ background: '#52c41a' }} />
                    <LockOutlined style={{ color: '#52c41a' }} />
                    <span className="rg-composicion-card__label">Queda en caja (retenido)</span>
                    <span className="rg-composicion-card__value" style={{ color: '#52c41a' }}>{fmtMoney(cierreRetenido)}</span>
                  </div>
                </div>

                {(Number(sesionParaCerrar.DIGITAL_DISPONIBLE) || 0) > 0 && (
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginTop: 10 }}
                    message={
                      <span style={{ fontSize: 12 }}>
                        <Text strong style={{ color: '#1677ff' }}>{fmtMoney(Number(sesionParaCerrar.DIGITAL_DISPONIBLE) || 0)}</Text>{' '}
                        de cobros digitales se imputará a Caja Central al cerrar la sesión.
                      </span>
                    }
                  />
                )}

                {cierreRetenido > 0 && (Number(sesionParaCerrar.VENTA_EFECTIVO) || 0) > 0 && (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginTop: 10 }}
                    message={
                      <div style={{ fontSize: 12, lineHeight: 1.4 }}>
                        Estás reteniendo <Text strong>{fmtMoney(cierreRetenido)}</Text> en la caja. Las ventas en efectivo (<Text strong style={{ color: '#52c41a' }}>{fmtMoney(Number(sesionParaCerrar.VENTA_EFECTIVO) || 0)}</Text>) se imputan igual a Caja Central. La trazabilidad del físico queda en el retenido.
                      </div>
                    }
                  />
                )}

                <div className="rg-field-label" style={{ marginTop: 12 }}>Observaciones (opcional)</div>
                <Input.TextArea
                  value={obsCierre}
                  onChange={e => setObsCierre(e.target.value)}
                  rows={2}
                  placeholder="Ej: Diferencia por centavos, faltante, etc."
                />
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal Ingreso/Egreso */}
      <Modal
        title={
          <RGCajaModalHeader
            icon={ieTipo === 'INGRESO' ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
            title={`${ieTipo === 'INGRESO' ? 'Ingreso' : 'Egreso'} manual de caja`}
            subtitle={
              sesionParaIE
                ? `Sesión #${sesionParaIE.NRO_SESION} · ${sesionParaIE.CAJA_NOMBRE || `Caja #${sesionParaIE.CAJA_ID}`}`
                : undefined
            }
            tag={ieTipo === 'INGRESO' ? '+ INGRESO' : '− EGRESO'}
          />
        }
        open={ingresoEgresoModalOpen}
        onCancel={() => setIngresoEgresoModalOpen(false)}
        onOk={handleIE}
        confirmLoading={ieMutation.isPending}
        okText="Registrar"
        cancelText="Cancelar"
        okButtonProps={{ disabled: ieMonto <= 0 || !ieDesc }}
        width={680}
        className="rg-modal rg-modal-ie"
        destroyOnClose
      >
        <div className="rg-abrir-sesion">
          {/* TOP STRIP: Sesión + Saldo actual */}
          {sesionParaIE && (
            <div className="rg-abrir-sesion__top rg-abrir-sesion__top--solo-stats">
              <div className="rg-mini-stat" style={{ borderLeftColor: '#722ed1', minWidth: 200 }}>
                <ShopOutlined className="rg-mini-stat__icon" style={{ color: '#722ed1' }} />
                <div>
                  <div className="rg-mini-stat__label">Caja · Sesión #{sesionParaIE.NRO_SESION}</div>
                  <div className="rg-mini-stat__value" style={{ color: 'var(--rg-black)', fontSize: 13 }}>
                    {sesionParaIE.CAJA_NOMBRE || `Caja #${sesionParaIE.CAJA_ID}`}
                    {sesionParaIE.PUNTO_VENTA_NOMBRE && (
                      <span style={{ color: 'var(--rg-text-light)', fontWeight: 400, fontSize: 11, marginLeft: 6 }}>
                        · {sesionParaIE.PUNTO_VENTA_NOMBRE}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="rg-mini-stat" style={{ borderLeftColor: '#52c41a' }}>
                <WalletOutlined className="rg-mini-stat__icon" style={{ color: '#52c41a' }} />
                <div>
                  <div className="rg-mini-stat__label">Efectivo disponible</div>
                  <div className="rg-mini-stat__value" style={{ color: '#52c41a' }}>
                    {fmtMoney(Number(sesionParaIE.EFECTIVO_DISPONIBLE) || 0)}
                  </div>
                </div>
              </div>
              {sesionParaIE.USUARIO_NOMBRE && (
                <div className="rg-mini-stat" style={{ borderLeftColor: 'var(--rg-gold-dark)' }}>
                  <div>
                    <div className="rg-mini-stat__label">Operador</div>
                    <div className="rg-mini-stat__value" style={{ color: 'var(--rg-black)', fontSize: 13 }}>
                      {sesionParaIE.USUARIO_NOMBRE}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* MAIN 2 COLS: Form + Resumen */}
          <div className="rg-abrir-sesion__main">
            {/* LEFT: Form fields */}
            <div className="rg-abrir-sesion__col rg-abrir-sesion__col--left">
              <div className="rg-section-title">
                {ieTipo === 'INGRESO' ? <ArrowUpOutlined style={{ color: '#52c41a' }} /> : <ArrowDownOutlined style={{ color: '#cf1322' }} />}
                <span>Datos del movimiento</span>
              </div>

              <div className="rg-field-label">
                Monto <span style={{ color: '#ff4d4f' }}>*</span>
              </div>
              <InputNumber
                value={ieMonto}
                onChange={v => setIeMonto(Number(v) || 0)}
                min={0}
                style={{ width: '100%' }}
                size="large"
                status={ieMonto <= 0 ? 'error' : ''}
                formatter={value => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}
                parser={value => Number((value || '').replace(/[$\s.]/g, '')) || 0}
                autoFocus
              />
              <div className={`rg-field-help ${ieMonto <= 0 ? 'is-error' : ''}`}>
                {ieTipo === 'EGRESO'
                  ? `El egreso no puede superar el efectivo disponible (${fmtMoney(Number(sesionParaIE?.EFECTIVO_DISPONIBLE) || 0)}).`
                  : 'Ingresá el monto en efectivo que entra a la caja.'}
              </div>

              <div className="rg-field-label" style={{ marginTop: 10 }}>
                Descripción / motivo <span style={{ color: '#ff4d4f' }}>*</span>
              </div>
              <Input.TextArea
                value={ieDesc}
                onChange={e => setIeDesc(e.target.value)}
                rows={3}
                placeholder={ieTipo === 'INGRESO' ? 'Ej: Ingreso de cambio desde Caja Central' : 'Ej: Pago de proveedor, gasto menor, etc.'}
                status={!ieDesc ? 'error' : ''}
              />
              <div className={`rg-field-help ${!ieDesc ? 'is-error' : ''}`}>
                {ieDesc ? `${ieDesc.length} caracteres` : 'La descripción es obligatoria para auditoría.'}
              </div>
            </div>

            {/* RIGHT: Resumen del movimiento */}
            <div className="rg-abrir-sesion__col rg-abrir-sesion__col--right">
              <div className="rg-composicion-card">
                <div className="rg-composicion-card__title">Resumen del movimiento</div>
                <div className="rg-composicion-card__row">
                  <span className="rg-composicion-card__dot" style={{ background: ieTipo === 'INGRESO' ? '#52c41a' : '#cf1322' }} />
                  {ieTipo === 'INGRESO' ? <ArrowUpOutlined style={{ color: '#52c41a' }} /> : <ArrowDownOutlined style={{ color: '#cf1322' }} />}
                  <span className="rg-composicion-card__label">Tipo</span>
                  <span className="rg-composicion-card__value" style={{ color: ieTipo === 'INGRESO' ? '#52c41a' : '#cf1322' }}>
                    {ieTipo === 'INGRESO' ? 'Ingreso' : 'Egreso'}
                  </span>
                </div>
                <div className="rg-composicion-card__row">
                  <span className="rg-composicion-card__dot" style={{ background: ieTipo === 'INGRESO' ? '#52c41a' : '#cf1322' }} />
                  <WalletOutlined style={{ color: 'var(--rg-gold-dark)' }} />
                  <span className="rg-composicion-card__label">Monto</span>
                  <span className="rg-composicion-card__value" style={{ color: ieTipo === 'INGRESO' ? '#52c41a' : '#cf1322' }}>
                    {ieTipo === 'INGRESO' ? '+' : '−'} {fmtMoney(ieMonto)}
                  </span>
                </div>
                <div className="rg-composicion-card__row rg-composicion-card__row--total">
                  <span className="rg-composicion-card__dot" style={{ background: '#52c41a' }} />
                  <WalletOutlined style={{ color: '#52c41a' }} />
                  <span className="rg-composicion-card__label"><Text strong>Efectivo post-movimiento</Text></span>
                  <span className="rg-composicion-card__value"><Text strong style={{ color: 'var(--rg-gold-dark)' }}>
                    {fmtMoney(
                      (Number(sesionParaIE?.EFECTIVO_DISPONIBLE) || 0) + (ieTipo === 'INGRESO' ? ieMonto : -ieMonto)
                    )}
                  </Text></span>
                </div>
              </div>

              <Alert
                type={ieTipo === 'INGRESO' ? 'success' : 'warning'}
                showIcon
                style={{ marginTop: 10 }}
                message={
                  <span style={{ fontSize: 12 }}>
                    {ieTipo === 'INGRESO'
                      ? 'El movimiento quedará registrado en el historial de la sesión y como ingreso a la caja.'
                      : 'El egreso se descuenta del efectivo disponible y queda en el historial de la sesión.'}
                  </span>
                }
              />
            </div>
          </div>
        </div>
      </Modal>

      {/* Modal ABM Caja */}
      <Modal
        title={
          <RGCajaModalHeader
            icon={rgIcon(editingCaja ? 'caja' : 'caja')}
            title={editingCaja ? `Editar Caja #${editingCaja.CAJA_ID}` : 'Nueva Caja'}
            subtitle={editingCaja ? 'Modificá los datos de la caja' : 'Configurá una nueva caja y asigná usuarios'}
          />
        }
        open={abmModalOpen}
        onCancel={() => { setAbmModalOpen(false); setEditingCaja(null); }}
        onOk={() => {
          const formEl = document.getElementById('abm-form') as HTMLFormElement;
          formEl?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        }}
        confirmLoading={crearCajaMutation.isPending || editarCajaMutation.isPending}
        okText={editingCaja ? 'Guardar' : 'Crear'}
        cancelText="Cancelar"
        className="rg-modal"
        width={560}
        destroyOnClose
      >
        <Form
          id="abm-form"
          layout="vertical"
          initialValues={editingCaja ? { nombre: editingCaja.NOMBRE, activa: editingCaja.ACTIVA } : { activa: true }}
          onFinish={handleCrearCaja}
        >
          <Form.Item label="Nombre" name="nombre">
            <Input placeholder="Ej: Caja Mostrador 1" />
          </Form.Item>

          {/* Color de énfasis: persistido en localStorage por CAJA_ID */}
          <Form.Item
            label="Color de énfasis"
            tooltip="Define el color de la barra superior, ícono y valor principal de esta caja en el grid."
          >
            <div className="rg-abm-color-row">
              <ColorPicker
                value={colorTemporalABM || '#EABD23'}
                onChange={(c) => setColorTemporalABM(typeof c === 'string' ? c : (c as any)?.toHexString?.() ?? null)}
                presets={[
                  {
                    label: 'Predefinidos',
                    colors: CAJA_COLOR_PRESETS.map(p => p.value),
                  },
                ]}
                showText
                disabledAlpha
                format="hex"
              />
              <div className="rg-abm-color-presets">
                {CAJA_COLOR_PRESETS.map(p => (
                  <button
                    key={p.value}
                    type="button"
                    className={`rg-color-preset-chip ${colorTemporalABM === p.value ? 'is-selected' : ''}`}
                    style={{ background: p.value }}
                    onClick={() => setColorTemporalABM(p.value)}
                    title={p.label}
                  />
                ))}
                <Tooltip title="Restablecer al dorado por defecto">
                  <button
                    type="button"
                    className="rg-color-preset-chip is-reset"
                    onClick={() => setColorTemporalABM(null)}
                  >
                    <StopOutlined />
                  </button>
                </Tooltip>
              </div>
            </div>
          </Form.Item>

          {!editingCaja && (
            <>
              <Form.Item
                label="Punto de Venta"
                name="puntoVentaId"
                rules={[{ required: true, message: 'Seleccione un punto de venta' }]}
              >
                <Select
                  placeholder="Seleccione un punto de venta"
                  options={pvOptions}
                  showSearch
                  optionFilterProp="label"
                  loading={pvSelectorLoading}
                  notFoundContent={pvSelectorLoading ? 'Cargando...' : 'No hay puntos de venta disponibles'}
                />
              </Form.Item>
              <Form.Item label="Usuarios asignados" name="usuariosIds" tooltip="Usuarios que podrán abrir sesiones en esta caja">
                <Select
                  mode="multiple"
                  placeholder="Seleccione usuarios"
                  options={usuariosOptions}
                  showSearch
                  optionFilterProp="label"
                  loading={usuariosLoading}
                  notFoundContent={usuariosLoading ? 'Cargando...' : 'No hay usuarios activos'}
                  allowClear
                />
              </Form.Item>
            </>
          )}
          {editingCaja && (
            <Form.Item label="Activa" name="activa" valuePropName="checked">
              <input type="checkbox" />
            </Form.Item>
          )}
        </Form>
      </Modal>

      {/* Modal Asignar Usuarios */}
      <Modal
        title={
          <RGCajaModalHeader
            icon={rgIcon('caja')}
            title="Asignar usuarios"
            subtitle={cajaParaUsuarios ? `Caja: ${cajaParaUsuarios.NOMBRE || `#${cajaParaUsuarios.CAJA_ID}`}` : undefined}
          />
        }
        open={usuariosModalOpen}
        onCancel={() => setUsuariosModalOpen(false)}
        onOk={() => cajaParaUsuarios && asignarUsuariosMutation.mutate({ id: cajaParaUsuarios.CAJA_ID, usuariosIds: usuariosSeleccionados })}
        confirmLoading={asignarUsuariosMutation.isPending}
        okText="Asignar"
        cancelText="Cancelar"
        className="rg-modal"
        width={560}
        destroyOnClose
      >
        <Alert type="info" message="Seleccione los usuarios que podrán operar esta caja." style={{ marginBottom: 12 }} />
        <Select
          mode="multiple"
          style={{ width: '100%' }}
          value={usuariosSeleccionados}
          onChange={setUsuariosSeleccionados}
          placeholder="Seleccione usuarios"
          options={usuariosOptions}
          showSearch
          optionFilterProp="label"
          loading={usuariosLoading}
          notFoundContent={usuariosLoading ? 'Cargando...' : 'No hay usuarios activos'}
          allowClear
        />
      </Modal>

      {/* Modal Transferencia */}
      <TransferenciaCajaModal
        open={transferirModalOpen}
        onClose={() => setTransferirModalOpen(false)}
        preselectedCajaId={miSesionActiva ? miSesionActiva.SESION_ID : undefined}
      />

      {/* Modal Desglose de método de pago (compartido SesionDetalleDrawer + CajaDetalleDrawer) */}
      <Modal
        title={
          <RGCajaModalHeader
            icon={rgIcon('caja-desglose')}
            title="Desglose por método de pago"
            subtitle={desgloseTitulo}
          />
        }
        open={desgloseOpen}
        onCancel={() => setDesgloseOpen(false)}
        footer={<Button onClick={() => setDesgloseOpen(false)}>Cerrar</Button>}
        width={460}
        destroyOnClose
        className="rg-modal"
        centered
      >
        {desgloseLoading && <div>Cargando...</div>}
        {!desgloseLoading && desgloseData.length === 0 && (
          <Text type="secondary">No hay desglose disponible para este ítem.</Text>
        )}
        {!desgloseLoading && desgloseData.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {desgloseData.map(m => (
              <div
                key={m.METODO_PAGO_ID}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 12px', borderRadius: 8,
                  background: m.CATEGORIA === 'EFECTIVO' ? 'rgba(82,196,26,0.06)' : m.CATEGORIA === 'CHEQUES' ? 'rgba(250,140,22,0.07)' : 'rgba(22,119,255,0.06)',
                  border: m.CATEGORIA === 'EFECTIVO' ? '1px solid #b7eb8f' : m.CATEGORIA === 'CHEQUES' ? '1px solid #ffd591' : '1px solid #91caff',
                }}
              >
                <Space>
                  {m.IMAGEN_BASE64 && (
                    <img src={m.IMAGEN_BASE64} alt={m.NOMBRE} style={{ width: 22, height: 22, objectFit: 'contain', borderRadius: 3 }} />
                  )}
                  <Text strong>{m.NOMBRE}</Text>
                  <Tag color={m.CATEGORIA === 'EFECTIVO' ? 'green' : m.CATEGORIA === 'CHEQUES' ? 'orange' : 'blue'} style={{ fontSize: 10 }}>
                    {m.CATEGORIA}
                  </Tag>
                </Space>
                <Text strong>{fmtMoney(m.TOTAL)}</Text>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* Drawer Detalle de Sesión */}
      <SesionDetalleDrawer
        sesion={sesionActivaDetalle}
        onClose={() => setSesionActivaDetalle(null)}
        onIngreso={(s) => { setSesionActivaDetalle(null); setSesionParaIE(s); setIeTipo('INGRESO'); setIngresoEgresoModalOpen(true); }}
        onEgreso={(s) => { setSesionActivaDetalle(null); setSesionParaIE(s); setIeTipo('EGRESO'); setIngresoEgresoModalOpen(true); }}
        onCerrar={(s) => { setSesionActivaDetalle(null); setSesionParaCerrar(s); setCerrarModalOpen(true); }}
        onTransferir={() => { setSesionActivaDetalle(null); setTransferirModalOpen(true); }}
        onDesgloseItem={handleDesgloseItem}
        onDesgloseTotal={handleDesgloseTotal}
        currentUserId={user?.USUARIO_ID}
        canIngreso={hasPermiso('caja.ingreso')}
        canEgreso={hasPermiso('caja.egreso')}
        canCerrar={hasPermiso('caja.cerrar')}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  Drawer de detalle de sesión (con stats, tabla y desglose)
// ═══════════════════════════════════════════════════════════

interface SesionDetalleDrawerProps {
  sesion: CajaSesion | null;
  onClose: () => void;
  onIngreso?: (s: CajaSesion) => void;
  onEgreso?: (s: CajaSesion) => void;
  onCerrar?: (s: CajaSesion) => void;
  onTransferir?: () => void;
  onDesgloseItem?: (item: CajaItem, campo: 'EFECTIVO' | 'DIGITAL') => void;
  onDesgloseTotal?: (sesionId: number) => void;
  currentUserId?: number;
  canIngreso?: boolean;
  canEgreso?: boolean;
  canCerrar?: boolean;
}

function SesionDetalleDrawer({ sesion, onClose, onIngreso, onEgreso, onCerrar, onDesgloseItem, onDesgloseTotal, currentUserId, canIngreso, canEgreso, canCerrar }: SesionDetalleDrawerProps) {
  return (
    <>
      <Drawer
        className="rg-drawer"
        title={
          <RGCajaModalHeader
            icon={rgIcon('caja-sesion')}
            title={`Detalle de sesión #${sesion?.SESION_ID}`}
          />
        }
        open={!!sesion}
        onClose={onClose}
        width={1000}
      >
        <SesionDetalleContent
          sesion={sesion}
          currentUserId={currentUserId}
          canIngreso={canIngreso}
          canEgreso={canEgreso}
          canCerrar={canCerrar}
          onIngreso={onIngreso}
          onEgreso={onEgreso}
          onCerrar={onCerrar}
          onDesgloseItem={onDesgloseItem}
          onDesgloseTotal={onDesgloseTotal}
        />
      </Drawer>
    </>
  );
}

// ═══════════════════════════════════════════════════════════
//  SesionDetalleContent: cuerpo reutilizable (Descriptions, Stats, Items)
//  Sin wrapper de Drawer para poder embeberlo dentro de otro contenedor.
// ═══════════════════════════════════════════════════════════

interface SesionDetalleContentProps {
  sesion: CajaSesion | null;
  currentUserId?: number;
  canIngreso?: boolean;
  canEgreso?: boolean;
  canCerrar?: boolean;
  onImprimir?: () => void;
  onIngreso?: (s: CajaSesion) => void;
  onEgreso?: (s: CajaSesion) => void;
  onCerrar?: (s: CajaSesion) => void;
  onDesgloseItem?: (item: CajaItem, campo: 'EFECTIVO' | 'DIGITAL') => void;
  onDesgloseTotal?: (sesionId: number) => void;
}

function SesionDetalleContent({
  sesion, currentUserId, canIngreso, canEgreso, canCerrar,
  onImprimir, onIngreso, onEgreso, onCerrar, onDesgloseItem, onDesgloseTotal,
}: SesionDetalleContentProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['caja-sesion', sesion?.SESION_ID],
    queryFn: () => cajaApi.getSesionById(sesion!.SESION_ID),
    enabled: !!sesion,
  });

  const esMia = data?.USUARIO_ID === currentUserId;
  const esActiva = data?.ESTADO === 'ACTIVA';
  const mostrarAcciones = esMia && esActiva;

  const handleImprimir = () => {
    if (!data) return;
    printCajaDetail({
      cajaId: data.SESION_ID,
      estado: data.ESTADO,
      usuarioNombre: data.USUARIO_NOMBRE ?? '',
      puntoVentaNombre: data.PUNTO_VENTA_NOMBRE ?? '',
      fechaApertura: data.FECHA_APERTURA,
      fechaCierre: data.FECHA_CIERRE ?? null,
      montoApertura: data.MONTO_APERTURA,
      montoCierre: data.MONTO_CIERRE ?? null,
      observaciones: data.OBS_CIERRE ?? null,
      totales: data.totales,
      items: (data.items || []).map((i: CajaItem) => ({
        FECHA: i.FECHA,
        ORIGEN_TIPO: i.ORIGEN_TIPO,
        DESCRIPCION: i.DESCRIPCION ?? null,
        MONTO_EFECTIVO: i.MONTO_EFECTIVO ?? 0,
        MONTO_DIGITAL: i.MONTO_DIGITAL ?? 0,
      })),
    });
    onImprimir?.();
  };

  const showStandaloneActions = !!(onIngreso || onEgreso || onCerrar);

  return (
    <div className="rg-sesion-detalle">
      {isLoading && <div style={{ padding: 32, textAlign: 'center' }}><Spin /></div>}
      {data && (
        <>
          {/* Acciones inline (sólo si se pasaron handlers / SesionDetalleDrawer standalone) */}
          {showStandaloneActions && (
            <div className="rg-sesion-actions">
              {(canIngreso || canEgreso) && (
                <Dropdown
                  trigger={['click']}
                  menu={{
                    items: [
                      canIngreso && mostrarAcciones && {
                        key: 'ingreso',
                        icon: <ArrowUpOutlined style={{ color: '#52c41a' }} />,
                        label: 'Registrar Ingreso',
                        onClick: () => onIngreso?.(data),
                      },
                      canEgreso && mostrarAcciones && {
                        key: 'egreso',
                        icon: <ArrowDownOutlined style={{ color: '#cf1322' }} />,
                        label: 'Registrar Egreso',
                        danger: true,
                        onClick: () => onEgreso?.(data),
                      },
                    ].filter(Boolean) as any,
                  }}
                >
                  <Button
                    size="small"
                    icon={<SwapOutlined />}
                    disabled={!mostrarAcciones || (!canIngreso && !canEgreso)}
                  >
                    Movimiento <DownOutlined style={{ fontSize: 10, marginLeft: 2 }} />
                  </Button>
                </Dropdown>
              )}
              {canCerrar && (
                <Button
                  size="small"
                  danger
                  icon={<LockOutlined />}
                  disabled={!mostrarAcciones || !canCerrar}
                  onClick={() => onCerrar?.(data)}
                >
                  Cerrar caja
                </Button>
              )}
              {onImprimir && (
                <Button size="small" type="text" icon={<PrinterOutlined />} onClick={handleImprimir}>
                  Imprimir
                </Button>
              )}
            </div>
          )}

          {/* Resumen de la sesión: pills a la izquierda + Detalles a la derecha */}
          <div className="rg-sesion-summary">
            <div className="rg-info-pills">
              <span className="rg-info-pill">
                <Tag color={data.ESTADO === 'ACTIVA' ? 'green' : 'default'} style={{ margin: 0 }}>
                  {data.ESTADO}
                </Tag>
              </span>
              <span className="rg-info-pill">
                <UserOutlined style={{ color: '#722ed1' }} />
                <Text strong>{data.USUARIO_NOMBRE}</Text>
              </span>
              <span className="rg-info-pill">
                <ClockCircleOutlined style={{ color: '#1677ff' }} />
                <Text type="secondary">Apertura</Text>
                <Text strong>{dayjs(data.FECHA_APERTURA).format('DD/MM HH:mm')}</Text>
                {data.FECHA_CIERRE && (
                  <>
                    <Text type="secondary">→</Text>
                    <Text strong>{dayjs(data.FECHA_CIERRE).format('DD/MM HH:mm')}</Text>
                  </>
                )}
              </span>
              <span className="rg-info-pill">
                <WalletOutlined style={{ color: 'var(--rg-gold-dark)' }} />
                <Text strong>{fmtMoney(data.MONTO_APERTURA)}</Text>
                {data.MONTO_CIERRE != null && (
                  <>
                    <Text type="secondary">→</Text>
                    <Text strong>{fmtMoney(data.MONTO_CIERRE)}</Text>
                  </>
                )}
              </span>
            </div>
            <Popover
              trigger="click"
              placement="bottomRight"
              content={
                <Descriptions size="small" column={1} bordered style={{ minWidth: 340 }}>
                  <Descriptions.Item label="Estado">
                    <Tag color={data.ESTADO === 'ACTIVA' ? 'green' : 'default'}>{data.ESTADO}</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="Usuario">{data.USUARIO_NOMBRE}</Descriptions.Item>
                  <Descriptions.Item label="Punto de Venta">{data.PUNTO_VENTA_NOMBRE || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Caja">{data.CAJA_NOMBRE || `#${data.CAJA_ID}`}</Descriptions.Item>
                  <Descriptions.Item label="Apertura">
                    {dayjs(data.FECHA_APERTURA).format('DD/MM/YYYY HH:mm')}
                  </Descriptions.Item>
                  <Descriptions.Item label="Cierre">
                    {data.FECHA_CIERRE ? dayjs(data.FECHA_CIERRE).format('DD/MM/YYYY HH:mm') : '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="Monto Apertura">{fmtMoney(data.MONTO_APERTURA)}</Descriptions.Item>
                  <Descriptions.Item label="Monto Cierre">
                    {data.MONTO_CIERRE != null ? fmtMoney(data.MONTO_CIERRE) : '—'}
                  </Descriptions.Item>
                  {data.OBS_APERTURA && <Descriptions.Item label="Obs. apertura">{data.OBS_APERTURA}</Descriptions.Item>}
                  {data.OBS_CIERRE && <Descriptions.Item label="Obs. cierre">{data.OBS_CIERRE}</Descriptions.Item>}
                </Descriptions>
              }
            >
              <Button size="small" type="text" icon={<InfoCircleOutlined />}>
                Detalles
              </Button>
            </Popover>
          </div>

          {/* Stats compactos como pills (sin cards pesados) */}
          <div className="rg-sesion-stats-inline">
            <span className="rg-stat-pill is-ingresos">
              <span className="rg-stat-pill__label">Ingresos</span>
              <span className="rg-stat-pill__value">{fmtMoney(data.totales?.ingresos ?? 0)}</span>
            </span>
            <span className="rg-stat-pill is-egresos">
              <span className="rg-stat-pill__label">Egresos</span>
              <span className="rg-stat-pill__value">{fmtMoney(data.totales?.egresos ?? 0)}</span>
            </span>
            <span
              className="rg-stat-pill is-total"
              onClick={() => onDesgloseTotal?.(data.SESION_ID)}
              style={{ cursor: onDesgloseTotal ? 'pointer' : 'default' }}
            >
              <span className="rg-stat-pill__label">Total{onDesgloseTotal ? ' ▸' : ''}</span>
              <span className="rg-stat-pill__value">{fmtMoney((data.totales?.ingresos ?? 0) - (data.totales?.egresos ?? 0))}</span>
            </span>
            <span className="rg-stat-pill is-efectivo">
              <span className="rg-stat-pill__label">Efectivo a rendir</span>
              <span className="rg-stat-pill__value">{fmtMoney(data.EFECTIVO_DISPONIBLE ?? 0)}</span>
            </span>
          </div>

          {/* Tabla de movimientos — contenido prioritario */}
          <div className="rg-sesion-movimientos">
            <div className="rg-sesion-movimientos__header">
              <UnorderedListOutlined />
              <Text strong style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Movimientos
              </Text>
              <Tag color="blue" style={{ marginLeft: 4 }}>{data.items?.length ?? 0}</Tag>
            </div>
            <Table
              className="rg-sesion-movimientos__table"
              size="small"
              rowKey="ITEM_ID"
              dataSource={data.items || []}
              pagination={false}
              scroll={{ x: 600 }}
              columns={[
                {
                  title: 'Fecha', dataIndex: 'FECHA', width: 130,
                  render: (v: string) => dayjs(v).format('DD/MM/YY HH:mm'),
                },
                {
                  title: 'Tipo', dataIndex: 'ORIGEN_TIPO', width: 90,
                  render: (v: string) => <Tag color={ORIGEN_TIPO_LABELS[v]?.color || 'default'}>{ORIGEN_TIPO_LABELS[v]?.label || v}</Tag>,
                },
                {
                  title: 'Descripción', dataIndex: 'DESCRIPCION',
                  render: (v: string) => v || '—',
                },
                {
                  title: 'Efectivo', dataIndex: 'MONTO_EFECTIVO', width: 120, align: 'right' as const,
                  render: (v: number, r: CajaItem) => (
                    <Text
                      style={{ color: v < 0 ? '#cf1322' : '#3f8600', cursor: r.ORIGEN_ID && onDesgloseItem ? 'pointer' : 'default' }}
                      onClick={() => r.ORIGEN_ID && onDesgloseItem?.(r, 'EFECTIVO')}
                    >
                      {fmtMoney(v)}
                    </Text>
                  ),
                },
                {
                  title: 'Digital', dataIndex: 'MONTO_DIGITAL', width: 120, align: 'right' as const,
                  render: (v: number, r: CajaItem) => (
                    <Text
                      style={{ color: v < 0 ? '#cf1322' : '#1677ff', cursor: r.ORIGEN_ID && onDesgloseItem ? 'pointer' : 'default' }}
                      onClick={() => r.ORIGEN_ID && onDesgloseItem?.(r, 'DIGITAL')}
                    >
                      {fmtMoney(v)}
                    </Text>
                  ),
                },
                {
                  title: 'Total', width: 120, align: 'right' as const,
                  render: (_: any, r: CajaItem) => {
                    const total = (r.MONTO_EFECTIVO ?? 0) + (r.MONTO_DIGITAL ?? 0);
                    return <Text style={{ color: total < 0 ? '#cf1322' : '#000000' }}>{fmtMoney(total)}</Text>;
                  },
                },
              ]}
            />
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  CajaCard: tarjeta visual de una caja en el grid principal
// ═══════════════════════════════════════════════════════════

interface CajaCardProps {
  caja: Caja;
  miSesionActiva?: CajaSesion | null;
  accentColor?: string | null;
  onClick: () => void;
}

function CajaCard({ caja, miSesionActiva, accentColor, onClick }: CajaCardProps) {
  const esMiSesion = !!(caja.SESION_ACTIVA_ID && miSesionActiva && caja.CAJA_ID === miSesionActiva.CAJA_ID);
  const tieneSesionAjena = !!(caja.SESION_ACTIVA_ID && !esMiSesion);
  const libre = !caja.SESION_ACTIVA_ID;
  const inactiva = !caja.ACTIVA;

  // Aplicar color de énfasis via CSS variable (consumida en .rg-caja-card::before y demás)
  const accentStyle = accentColor
    ? ({ ['--caja-accent' as any]: accentColor } as React.CSSProperties)
    : undefined;

  let variantClass = 'is-libre';
  let statusTag: { className: string; icon: React.ReactNode; label: string } = {
    className: 'is-libre',
    icon: <CheckCircleOutlined />,
    label: 'Libre',
  };

  if (inactiva) {
    variantClass = 'is-inactiva';
    statusTag = { className: 'is-inactiva', icon: <StopOutlined />, label: 'Inactiva' };
  } else if (esMiSesion) {
    variantClass = 'is-mi-sesion is-pulse';
    statusTag = {
      className: 'is-mi-sesion',
      icon: <CheckCircleOutlined />,
      label: `Mi sesión #${miSesionActiva!.NRO_SESION}`,
    };
  } else if (tieneSesionAjena) {
    variantClass = 'is-otra-sesion';
    statusTag = {
      className: 'is-otra-sesion',
      icon: <ClockCircleOutlined />,
      label: 'Sesión en curso',
    };
  }

  const usuariosCount = caja.USUARIOS_ASIGNADOS?.length ?? 0;
  const sesionesCount = caja.TOTAL_SESIONES ?? 0;
  const saldoRetenido = caja.SALDO_RETENIDO ?? 0;

  // Valor primario: efectivo disponible si es mi sesión; si no, saldo retenido
  let primaryLabel = 'Saldo retenido';
  let primaryValue = saldoRetenido;
  let primaryValueClass = saldoRetenido > 0 ? 'is-retenido' : 'is-zero';
  if (esMiSesion && miSesionActiva) {
    primaryLabel = 'Efectivo en caja';
    primaryValue = miSesionActiva.EFECTIVO_DISPONIBLE ?? 0;
    primaryValueClass = primaryValue > 0 ? 'is-mi' : 'is-zero';
  } else if (libre && saldoRetenido === 0) {
    primaryLabel = 'Efectivo';
    primaryValueClass = 'is-zero';
  }

  const usuariosNombres = caja.USUARIOS_ASIGNADOS?.map(u => u.USUARIO_NOMBRE).filter(Boolean).slice(0, 2);
  const usuariosExtra = usuariosCount > 2 ? usuariosCount - 2 : 0;

  return (
    <div className={`rg-caja-card animate-fade-up ${variantClass} ${accentColor ? 'has-accent' : ''}`} style={accentStyle} onClick={onClick} role="button" tabIndex={0}>
      <div className="rg-caja-card__body">
        <div className="rg-caja-card__header">
          <div className="rg-caja-card__icon">
            {esMiSesion ? <WalletOutlined /> : <BankOutlined />}
            {accentColor && <span className="rg-caja-card__accent-dot" style={{ background: accentColor }} />}
          </div>
          <div className="rg-caja-card__name">
            <div className="rg-caja-card__name-text">
              {caja.NOMBRE || `Caja #${caja.CAJA_ID}`}
            </div>
            <div className="rg-caja-card__name-sub">
              {caja.PUNTO_VENTA_NOMBRE || `PV #${caja.PUNTO_VENTA_ID}`}
            </div>
          </div>
          <RightOutlined className="rg-caja-card__chevron" />
        </div>

        <div className="rg-caja-card__status-row">
          <span className={`rg-caja-card__status-tag ${statusTag.className}`}>
            {statusTag.icon}
            {statusTag.label}
          </span>
          {!inactiva && esMiSesion && miSesionActiva && (
            <span className={`rg-caja-card__status-tag is-mi-sesion`}>
              {fmtMoney(miSesionActiva.EFECTIVO_DISPONIBLE || 0)}
            </span>
          )}
          {!inactiva && libre && saldoRetenido > 0 && (
            <span className="rg-caja-card__status-tag is-libre">
              <LockOutlined style={{ fontSize: 11 }} />
              Retenido
            </span>
          )}
          {inactiva && (
            <span className="rg-caja-card__status-tag is-inactiva">#{caja.CAJA_ID}</span>
          )}
        </div>

        <div className="rg-caja-card__primary">
          <div className="rg-caja-card__primary-label">{primaryLabel}</div>
          <div className={`rg-caja-card__primary-value ${primaryValueClass}`}>
            {fmtMoney(primaryValue)}
          </div>
        </div>

        <div className="rg-caja-card__stats">
          <div className="rg-caja-card__stat">
            <div className="rg-caja-card__stat-label">
              <HistoryOutlined /> Sesiones
            </div>
            <div className="rg-caja-card__stat-value">{sesionesCount}</div>
          </div>
          <div className="rg-caja-card__stat">
            <div className="rg-caja-card__stat-label">
              <TeamOutlined /> Usuarios
            </div>
            <div className="rg-caja-card__stat-value">{usuariosCount}</div>
          </div>
        </div>

        {(usuariosNombres && usuariosNombres.length > 0) || inactiva ? (
          <div className="rg-caja-card__footer">
            <span className="rg-caja-card__footer-meta">
              {inactiva
                ? 'Caja deshabilitada del sistema'
                : usuariosNombres && usuariosNombres.length > 0
                  ? `${usuariosNombres.join(', ')}${usuariosExtra > 0 ? ` +${usuariosExtra}` : ''}`
                  : 'Sin usuarios asignados'}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  CajaDetalleDrawer: panel lateral con detalle + sesiones
// ═══════════════════════════════════════════════════════════

interface CajaDetalleDrawerProps {
  caja: Caja | null;
  onClose: () => void;
  onVerSesion: (s: CajaSesion) => void;
  onAbrirSesion: (c: Caja) => void;
  onIngreso: (s: CajaSesion) => void;
  onEgreso: (s: CajaSesion) => void;
  onCerrar: (s: CajaSesion) => void;
  onTransferir: () => void;
  onEditar: (c: Caja) => void;
  onAsignarUsuarios: (c: Caja) => void;
  onDesgloseItem?: (item: CajaItem, campo: 'EFECTIVO' | 'DIGITAL') => void;
  onDesgloseTotal?: (sesionId: number) => void;
  currentUserId?: number;
  canAbrir?: boolean;
  canIngreso?: boolean;
  canEgreso?: boolean;
  canCerrar?: boolean;
  canAdministrar?: boolean;
}

function CajaDetalleDrawer({
  caja, onClose, onVerSesion, onAbrirSesion, onIngreso, onEgreso, onCerrar, onTransferir,
  onEditar, onAsignarUsuarios, onDesgloseItem, onDesgloseTotal,
  currentUserId, canAbrir, canIngreso, canEgreso, canCerrar, canAdministrar,
}: CajaDetalleDrawerProps) {
  const [rangoFechas, setRangoFechas] = useState<[Dayjs, Dayjs] | null>(null);
  const [estadoFiltro, setEstadoFiltro] = useState<string | undefined>(undefined);
  const [tabActiva, setTabActiva] = useState<'sesion' | 'info'>('info');

  const cajaId = caja?.CAJA_ID;
  const accentColor = useCajaColor(cajaId);

  const { data: sesionesData, isLoading: sesionesLoading } = useQuery({
    queryKey: ['caja-sesiones-detalle', cajaId, rangoFechas, estadoFiltro],
    queryFn: () => cajaApi.getSesiones({
      cajaId,
      fechaDesde: rangoFechas?.[0].format('YYYY-MM-DD'),
      fechaHasta: rangoFechas?.[1].format('YYYY-MM-DD'),
      estado: estadoFiltro,
      pageSize: 100,
    }),
    enabled: !!cajaId,
  });

  // Determinar sesión activa: si hay SESION_ACTIVA_ID y la encontramos en el listado,
  // usamos esa. Si no, buscamos la primera ACTIVA en el historial.
  const sesionesList = sesionesData?.data || [];
  const sesionActivaDeEstaCaja = useMemo(() => {
    if (!caja?.SESION_ACTIVA_ID) return null;
    const found = sesionesList.find(s => s.SESION_ID === caja.SESION_ACTIVA_ID && s.ESTADO === 'ACTIVA');
    return found || sesionesList.find(s => s.ESTADO === 'ACTIVA') || null;
  }, [sesionesList, caja?.SESION_ACTIVA_ID]);

  // Al cambiar de caja: reset filtros + decidir tab inicial
  useEffect(() => {
    setRangoFechas(null);
    setEstadoFiltro(undefined);
    setTabActiva(caja?.SESION_ACTIVA_ID ? 'sesion' : 'info');
  }, [cajaId, caja?.SESION_ACTIVA_ID]);

  // Reset filtros al cambiar de caja
  useEffect(() => {
    setRangoFechas(null);
    setEstadoFiltro(undefined);
  }, [cajaId]);

  if (!caja) return null;

  const sesionesCount = caja.TOTAL_SESIONES ?? sesionesData?.total ?? 0;
  const usuariosCount = caja.USUARIOS_ASIGNADOS?.length ?? 0;
  const saldoRetenido = caja.SALDO_RETENIDO ?? 0;

  const sesionesColumns = [
    { title: '#', dataIndex: 'NRO_SESION', key: 'NRO_SESION', width: 60 },
    { title: 'Usuario', dataIndex: 'USUARIO_NOMBRE', key: 'USUARIO_NOMBRE' },
    { title: 'Apertura', dataIndex: 'FECHA_APERTURA', key: 'FECHA_APERTURA', render: (v: string) => dayjs(v).format('DD/MM/YY HH:mm') },
    { title: 'Cierre', dataIndex: 'FECHA_CIERRE', key: 'FECHA_CIERRE', render: (v: string | null) => v ? dayjs(v).format('DD/MM/YY HH:mm') : '-' },
    { title: 'Apertura $', dataIndex: 'MONTO_APERTURA', key: 'MONTO_APERTURA', render: (v: number) => fmtMoney(v), align: 'right' as const },
    { title: 'Cierre $', dataIndex: 'MONTO_CIERRE', key: 'MONTO_CIERRE', render: (v: number | null) => v != null ? fmtMoney(v) : '-', align: 'right' as const },
    { title: 'Retenido', dataIndex: 'SALDO_RETENIDO_FIN', key: 'SALDO_RETENIDO_FIN', render: (v: number) => fmtMoney(v), align: 'right' as const },
    {
      title: 'Estado', dataIndex: 'ESTADO', key: 'ESTADO',
      render: (v: string) => v === 'ACTIVA' ? <Tag color="green">Activa</Tag> : <Tag>Cerrada</Tag>,
    },
    {
      title: 'Acciones', key: 'acciones', width: 70, render: (_: any, r: CajaSesion) => (
        <Tooltip title="Ver detalle">
          <Button size="small" icon={<EyeOutlined />} onClick={() => onVerSesion(r)} />
        </Tooltip>
      ),
    },
  ];

  const esMiSesionActiva = !!(sesionActivaDeEstaCaja && sesionActivaDeEstaCaja.USUARIO_ID === currentUserId);
  const accentStyle = accentColor
    ? ({ ['--caja-accent' as any]: accentColor } as React.CSSProperties)
    : undefined;

  return (
    <Drawer
      className="rg-drawer"
      open={!!caja}
      onClose={onClose}
      width={920}
      title={
        <RGCajaModalHeader
          icon={rgIcon('caja')}
          title={caja.NOMBRE || `Caja #${caja.CAJA_ID}`}
          subtitle={
            caja.PUNTO_VENTA_NOMBRE
              ? `${caja.PUNTO_VENTA_NOMBRE} · Caja #${caja.CAJA_ID}${caja.ACTIVA ? '' : ' · Inactiva'}`
              : undefined
          }
        />
      }
    >
      <div className="rg-caja-detalle" style={accentStyle}>
        {/* TABS (compacto) */}
        <div className="rg-caja-detalle__tabs">
          <Segmented
            value={tabActiva}
            onChange={(v) => setTabActiva(v as 'sesion' | 'info')}
            size="middle"
            block
            options={[
              {
                value: 'sesion',
                label: (
                  <span className="rg-caja-detalle__tab-label">
                    <ThunderboltFilled style={{ color: sesionActivaDeEstaCaja ? (esMiSesionActiva ? '#52c41a' : '#faad14') : '#bfbfbf' }} />
                    Sesión activa
                    {sesionActivaDeEstaCaja && (
                      <Tag color={esMiSesionActiva ? 'green' : 'gold'} style={{ marginLeft: 6, marginRight: 0 }}>
                        #{sesionActivaDeEstaCaja.NRO_SESION}
                      </Tag>
                    )}
                  </span>
                ),
                disabled: !sesionActivaDeEstaCaja,
              },
              {
                value: 'info',
                label: (
                  <span className="rg-caja-detalle__tab-label">
                    <InfoCircleOutlined />
                    Información de la caja
                  </span>
                ),
              },
            ]}
          />
        </div>

        {/* TAB: Sesión activa */}
        {tabActiva === 'sesion' && sesionActivaDeEstaCaja && (
          <div className="rg-caja-detalle__tab-pane">
            <SesionDetalleContent
              sesion={sesionActivaDeEstaCaja}
              currentUserId={currentUserId}
              canIngreso={canIngreso}
              canEgreso={canEgreso}
              canCerrar={canCerrar}
              onIngreso={onIngreso}
              onEgreso={onEgreso}
              onCerrar={onCerrar}
              onDesgloseItem={onDesgloseItem}
              onDesgloseTotal={onDesgloseTotal}
            />
          </div>
        )}

        {/* TAB: Información de la caja */}
        {tabActiva === 'info' && (
          <div className="rg-caja-detalle__tab-pane">
            {/* Hero card con personalidad Rio Gestión */}
            <div className="rg-caja-info-hero" style={accentStyle}>
              <div className="rg-caja-info-hero__main">
                <div className="rg-caja-info-hero__icon">
                  <BankOutlined />
                </div>
                <div className="rg-caja-info-hero__text">
                  <div className="rg-caja-info-hero__name">
                    {caja.NOMBRE || `Caja #${caja.CAJA_ID}`}
                  </div>
                  <div className="rg-caja-info-hero__sub">
                    {caja.PUNTO_VENTA_NOMBRE || `PV #${caja.PUNTO_VENTA_ID}`} · Caja #{caja.CAJA_ID}
                  </div>
                  <div className="rg-caja-info-hero__tags">
                    <Tag color={caja.ACTIVA ? 'green' : 'default'} style={{ margin: 0 }}>
                      {caja.ACTIVA ? 'Activa' : 'Inactiva'}
                    </Tag>
                    {accentColor && (
                      <Tooltip title={`Color de énfasis #${accentColor.replace('#', '')}`}>
                        <span
                          className="rg-caja-info-hero__color-dot"
                          style={{ background: accentColor }}
                        />
                      </Tooltip>
                    )}
                  </div>
                </div>
              </div>
              <div className="rg-caja-info-hero__actions">
                {!sesionActivaDeEstaCaja && caja.ACTIVA && canAbrir && (
                  <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => onAbrirSesion(caja)}>
                    Abrir sesión
                  </Button>
                )}
                <Button size="small" type="text" icon={<SwapOutlined />} onClick={onTransferir}>
                  Transferir
                </Button>
                {canAdministrar && (
                  <Dropdown
                    trigger={['click']}
                    menu={{
                      items: [
                        { key: 'editar', icon: <EditOutlined />, label: 'Editar caja', onClick: () => onEditar(caja) },
                        { key: 'usuarios', icon: <TeamOutlined />, label: 'Asignar usuarios', onClick: () => onAsignarUsuarios(caja) },
                      ],
                    }}
                  >
                    <Button size="small" type="text" icon={<MoreOutlined />}>
                      Administrar
                    </Button>
                  </Dropdown>
                )}
              </div>
            </div>

            {/* Stats cells con estilo kpi-card (gold top border) */}
            <div className="rg-caja-info-cells">
              <div className="rg-caja-info-cell kpi-card">
                <div className="rg-caja-info-cell__label">Saldo retenido</div>
                <div
                  className="rg-caja-info-cell__value"
                  style={{ color: saldoRetenido > 0 ? 'var(--rg-gold-dark)' : '#bfbfbf' }}
                >
                  {fmtMoney(saldoRetenido)}
                </div>
              </div>
              <div className="rg-caja-info-cell kpi-card">
                <div className="rg-caja-info-cell__label">Sesiones</div>
                <div className="rg-caja-info-cell__value">{sesionesCount}</div>
              </div>
              <div className="rg-caja-info-cell kpi-card">
                <div className="rg-caja-info-cell__label">Usuarios asignados</div>
                <div className="rg-caja-info-cell__value">{usuariosCount}</div>
              </div>
              <div className="rg-caja-info-cell kpi-card">
                <div className="rg-caja-info-cell__label">Creada</div>
                <div className="rg-caja-info-cell__value">
                  {dayjs(caja.CREADA_EN).format('DD/MM/YYYY')}
                </div>
              </div>
            </div>

            {/* HISTORIAL DE SESIONES — título con personalidad Rio Gestión */}
            <div className="rg-caja-detalle__section">
              <div className="rg-caja-detalle__section-title-rg">
                <HistoryOutlined />
                <span>Historial de sesiones</span>
                <Tag style={{ marginLeft: 6 }}>{sesionesData?.total ?? sesionesCount}</Tag>
              </div>
              <div className="rg-caja-detalle__filters" style={{ marginBottom: 10 }}>
                <RangePicker
                  value={rangoFechas}
                  onChange={(v) => setRangoFechas(v as any)}
                  size="small"
                  placeholder={['Desde', 'Hasta']}
                />
                <Select
                  placeholder="Estado"
                  value={estadoFiltro}
                  onChange={setEstadoFiltro}
                  allowClear
                  size="small"
                  style={{ width: 130 }}
                  options={[{ value: 'ACTIVA', label: 'Activa' }, { value: 'CERRADA', label: 'Cerrada' }]}
                />
              </div>
              <Table
                rowKey="SESION_ID"
                dataSource={sesionesData?.data || []}
                columns={sesionesColumns}
                loading={sesionesLoading}
                size="small"
                pagination={{
                  current: sesionesData?.page,
                  pageSize: sesionesData?.pageSize,
                  total: sesionesData?.total,
                  showSizeChanger: false,
                  size: 'small',
                }}
              />
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}
