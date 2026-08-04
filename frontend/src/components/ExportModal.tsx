/**
 * ExportModal — Río Gestión
 *
 * Modal elegante y compacto que permite al usuario elegir cuántos registros
 * exportar antes de generar el PDF o Excel.
 *
 * Opciones disponibles según el contexto:
 *   - Página actual: lo que se ve en pantalla
 *   - Todos los registros disponibles
 *   - Primeros N registros: el usuario define el N manualmente
 */
import { useState, useCallback, useEffect } from 'react';
import {
  Modal,
  Radio,
  InputNumber,
  Space,
  Typography,
  Button,
  Divider,
  Tooltip,
  Spin,
} from 'antd';
import {
  FilePdfOutlined,
  FileExcelOutlined,
  CheckCircleFilled,
  DatabaseOutlined,
  EyeOutlined,
  NumberOutlined,
  ExportOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import { exportToPdf } from '../utils/exportPdf';
import { exportToExcel } from '../utils/exportExcel';
import type { ExportColumn } from './ExportButtons';

const { Text, Title: AntdTitle } = Typography;

export interface ExportModalProps<T = any> {
  /** Visible */
  open: boolean;
  /** Callback al cerrar sin exportar */
  onCancel: () => void;
  /** Datos totales disponibles (para opción "Todos") */
  allData?: T[];
  /** Datos de la página actual (siempre se incluyen como opción) */
  pageData: T[];
  /** Columnas a exportar */
  columns: ExportColumn<T>[];
  /** Título del reporte */
  title: string;
  /** Subtítulo opcional */
  subtitle?: string;
  /** Meta info para el PDF */
  meta?: string;
  /** Totales para el footer */
  footerSummary?: string[][];
  /** Nombre de archivo personalizado */
  fileName?: string;
  /** Nombre de hoja Excel */
  sheetName?: string;
  /** Total de registros en backend (para saber cuántos hay en total) */
  totalCount?: number;
  /** Indica si está cargando los datos completos (allData) */
  loadingAllData?: boolean;
}

type ExportOption = 'page' | 'all' | 'custom';

const formatNumber = (n: number) => n.toLocaleString('es-AR');

export function ExportModal<T = any>(props: ExportModalProps<T>) {
  const {
    open, onCancel,
    allData, pageData, columns,
    title, subtitle, meta, footerSummary,
    fileName, sheetName, totalCount, loadingAllData,
  } = props;

  const [option, setOption] = useState<ExportOption>('page');
  const [customAmount, setCustomAmount] = useState<number>(100);
  const [exporting, setExporting] = useState<'pdf' | 'excel' | null>(null);

  const hasAllData = (allData && allData.length > 0) || (totalCount && totalCount > 0);
  const actualAllCount = totalCount ?? allData?.length ?? pageData.length;
  const pageCount = pageData.length;

  // Reset al abrir/cerrar
  useEffect(() => {
    if (open) {
      setOption('page');
      setCustomAmount(100);
      setExporting(null);
    }
  }, [open]);

  const getDataToExport = useCallback((): T[] => {
    switch (option) {
      case 'page':
        return pageData;
      case 'all':
        return allData ?? pageData;
      case 'custom': {
        const source = allData ?? pageData;
        return source.slice(0, customAmount);
      }
      default:
        return pageData;
    }
  }, [option, allData, pageData, customAmount]);

  const exportCount = getDataToExport().length;

  const handleExport = useCallback(async (type: 'pdf' | 'excel') => {
    if (exportCount === 0) return;
    setExporting(type);
    try {
      const data = getDataToExport();
      // Si los datos exportados NO son los mismos que los que tenían footerSummary,
      // no incluimos los totales (no serían representativos).
      let adjustedFooterSummary = footerSummary;
      if (footerSummary && option !== 'page') {
        adjustedFooterSummary = undefined;
      }

      if (type === 'pdf') {
        exportToPdf({ title, subtitle, meta, columns, data, fileName, footerSummary: adjustedFooterSummary });
      } else {
        exportToExcel({ title, subtitle, columns, data, fileName, sheetName, footerSummary: adjustedFooterSummary });
      }
    } finally {
      // Pequeño delay para que se vea el feedback visual del botón activo
      setTimeout(() => {
        setExporting(null);
        onCancel();
      }, 200);
    }
  }, [exportCount, getDataToExport, option, footerSummary, title, subtitle, meta, columns, fileName, sheetName, onCancel]);

  const handleClose = () => {
    setOption('page');
    setCustomAmount(100);
    onCancel();
  };

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      footer={null}
      width={460}
      destroyOnClose
      closable={false}
      centered
      styles={{
        body: { padding: 0 },
        content: { padding: 0, borderRadius: 12, overflow: 'hidden' },
      }}
      className="rg-export-modal rg-modal"
    >
      {/* ── Header ── */}
      <div
        style={{
          background: 'linear-gradient(135deg, #1e1f22 0%, #2a2c30 100%)',
          padding: '20px 24px',
          color: '#fff',
          position: 'relative',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <ExportOutlined style={{ color: '#EABD23', fontSize: 20 }} />
          <AntdTitle level={4} style={{ color: '#fff', margin: 0, fontSize: 16 }}>
            Exportar datos
          </AntdTitle>
        </div>
        <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>
          {title}
        </Text>
        <Button
          type="text"
          icon={<CloseOutlined style={{ color: '#fff' }} />}
          onClick={handleClose}
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            color: '#fff',
          }}
        />
      </div>

      {/* ── Body ── */}
      <div style={{ padding: '20px 24px' }}>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
          Cantidad a exportar
        </Text>

        <Radio.Group
          value={option}
          onChange={e => setOption(e.target.value)}
          style={{ width: '100%' }}
          disabled={exporting !== null}
        >
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {/* ── Opción: Página actual ── */}
            <div
              className={`rg-export-option ${option === 'page' ? 'rg-export-option-active' : ''}`}
              onClick={() => !exporting && setOption('page')}
              style={{
                border: option === 'page' ? '2px solid #EABD23' : '1px solid #e8e8e8',
                borderRadius: 8,
                padding: '10px 12px',
                cursor: exporting ? 'not-allowed' : 'pointer',
                background: option === 'page' ? 'rgba(234,189,35,0.04)' : '#fff',
                transition: 'all 0.15s',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                opacity: exporting ? 0.6 : 1,
              }}
            >
              <Radio value="page" />
              <EyeOutlined style={{ color: option === 'page' ? '#EABD23' : '#8c8c8c', fontSize: 16 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500, fontSize: 14 }}>Página actual</div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {formatNumber(pageCount)} registro{pageCount === 1 ? '' : 's'} visible{pageCount === 1 ? '' : 's'}
                </Text>
              </div>
            </div>

            {/* ── Opción: Todos los registros ── */}
            {hasAllData && (
              <div
                className={`rg-export-option ${option === 'all' ? 'rg-export-option-active' : ''}`}
                onClick={() => !exporting && !loadingAllData && setOption('all')}
                style={{
                  border: option === 'all' ? '2px solid #EABD23' : '1px solid #e8e8e8',
                  borderRadius: 8,
                  padding: '10px 12px',
                  cursor: (exporting || loadingAllData) ? 'not-allowed' : 'pointer',
                  background: option === 'all' ? 'rgba(234,189,35,0.04)' : '#fff',
                  transition: 'all 0.15s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  opacity: exporting ? 0.6 : 1,
                }}
              >
                <Radio value="all" disabled={loadingAllData} />
                <DatabaseOutlined style={{ color: option === 'all' ? '#EABD23' : '#8c8c8c', fontSize: 16 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, fontSize: 14 }}>
                    Todos los registros disponibles
                    {loadingAllData && <Spin size="small" style={{ marginLeft: 8 }} />}
                  </div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {formatNumber(actualAllCount)} registro{actualAllCount === 1 ? '' : 's'} total{actualAllCount === 1 ? '' : 'es'}
                  </Text>
                </div>
              </div>
            )}

            {/* ── Opción: Primeros N registros ── */}
            <div
              className={`rg-export-option ${option === 'custom' ? 'rg-export-option-active' : ''}`}
              onClick={() => !exporting && setOption('custom')}
              style={{
                border: option === 'custom' ? '2px solid #EABD23' : '1px solid #e8e8e8',
                borderRadius: 8,
                padding: '10px 12px',
                cursor: exporting ? 'not-allowed' : 'pointer',
                background: option === 'custom' ? 'rgba(234,189,35,0.04)' : '#fff',
                transition: 'all 0.15s',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                opacity: exporting ? 0.6 : 1,
              }}
            >
              <Radio value="custom" />
              <NumberOutlined style={{ color: option === 'custom' ? '#EABD23' : '#8c8c8c', fontSize: 16 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 4 }}>
                  Primeros N registros
                </div>
                {option === 'custom' ? (
                  <Space size={6} onClick={e => e.stopPropagation()}>
                    <InputNumber
                      min={1}
                      max={actualAllCount}
                      value={customAmount}
                      onChange={v => setCustomAmount(v ?? 1)}
                      style={{ width: 110 }}
                      size="small"
                      autoFocus
                      disabled={exporting !== null}
                    />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      de {formatNumber(actualAllCount)} dispon.
                    </Text>
                  </Space>
                ) : (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Indicá manualmente cuántos querés
                  </Text>
                )}
              </div>
            </div>
          </Space>
        </Radio.Group>

        {!hasAllData && (
          <div
            style={{
              marginTop: 12,
              padding: '8px 12px',
              background: '#fafafa',
              border: '1px dashed #d9d9d9',
              borderRadius: 6,
              fontSize: 12,
              color: '#8c8c8c',
            }}
          >
            💡 Para habilitar "Todos los registros" la página debe traer todos los datos. Solo se exportará la página actual.
          </div>
        )}
      </div>

      <Divider style={{ margin: 0 }} />

      {/* ── Footer con botones ── */}
      <div
        style={{
          padding: '14px 24px',
          background: '#fafafa',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Space size={4}>
          <CheckCircleFilled style={{ color: '#52c41a', fontSize: 12 }} />
          <Text style={{ fontSize: 13 }}>
            <strong>{formatNumber(exportCount)}</strong> registro{exportCount === 1 ? '' : 's'}
          </Text>
        </Space>

        <Space size={8}>
          <Tooltip title="Exportar a PDF">
            <Button
              type="primary"
              danger
              icon={exporting === 'pdf' ? <Spin size="small" /> : <FilePdfOutlined />}
              onClick={() => handleExport('pdf')}
              loading={exporting === 'pdf'}
              disabled={exporting !== null || exportCount === 0}
              style={{ minWidth: 90 }}
            >
              PDF
            </Button>
          </Tooltip>
          <Tooltip title="Exportar a Excel">
            <Button
              type="primary"
              icon={exporting === 'excel' ? <Spin size="small" /> : <FileExcelOutlined />}
              onClick={() => handleExport('excel')}
              loading={exporting === 'excel'}
              disabled={exporting !== null || exportCount === 0}
              style={{
                minWidth: 90,
                background: '#52c41a',
                borderColor: '#52c41a',
              }}
            >
              Excel
            </Button>
          </Tooltip>
        </Space>
      </div>
    </Modal>
  );
}
