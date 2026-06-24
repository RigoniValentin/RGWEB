/**
 * ExportButtons — Río Gestión
 *
 * Set de dos botones (PDF + Excel) pensado para integrarse en el header
 * de cualquier pantalla con listado/grilla. Maneja:
 *   - estado de carga (loading feedback)
 *   - deshabilitado si no hay datos
 *   - feedback de éxito / error vía App.useApp()
 *   - tooltips descriptivos
 *   - variantes: 'compact' (sólo iconos) | 'full' (icono + texto)
 *   - selección de cantidad de registros para exportar (prop opcional)
 *
 * La definición de columnas (`PdfColumn[]` / `ExcelColumn[]`) es la misma que
 * la de `<Table>` de Ant Design: dataIndex, render, align, width. Esto permite
 * mapear la grilla visual a una exportación sin código extra.
 */
import { useState, useCallback } from 'react';
import { Button, Tooltip, App } from 'antd';
import {
  FilePdfOutlined,
  FileExcelOutlined,
  DownOutlined,
  ExportOutlined,
} from '@ant-design/icons';
import { exportToPdf } from '../utils/exportPdf';
import { exportToExcel } from '../utils/exportExcel';
import { ExportModal } from './ExportModal';


/**
 * Una misma forma de columna sirve para PDF y Excel. Es un sub-tipo que
 * contiene los campos comunes que ambas implementaciones entienden. Lo
 * definimos como type alias (intersección flexible) en vez de `&` directa
 * para que TypeScript no sea tan estricto con propiedades opcionales.
 */
export type ExportColumn<T = any> = {
  title: string;
  dataIndex?: string | string[];
  render?: (value: any, record: T, index: number) => string | number | null | undefined;
  align?: 'left' | 'center' | 'right';
  width?: number;
  numeric?: boolean;
  money?: boolean;
};


export interface ExportButtonsProps<T = any> {
  /** Listado de datos de la página actual (visible en pantalla). */
  data: T[];
  /** Datos COMPLETOS disponibles (para opción "exportar todos"). Si no se pasa,
   * se usa `data` como único источник y no se ofrece la opción de elegir cantidad. */
  allData?: T[];
  /** Total de registros en backend (más preciso que allData.length). */
  totalCount?: number;
  /** Columnas a exportar. Misma forma que el `columns` de la `<Table>`. */
  columns: ExportColumn<T>[];
  /** Título del reporte (encabezado + nombre del archivo). */
  title: string;
  /** Subtítulo opcional (debajo del título). */
  subtitle?: string;
  /** Texto meta (ej: "Filtros: Estado=Activo"). */
  meta?: string;
  /** Filas de totales al final. */
  footerSummary?: string[][];
  /** Variante visual. Default: 'compact' */
  variant?: 'compact' | 'full';
  /** Nombre de archivo (sin extensión). Si se omite se genera a partir del título. */
  fileName?: string;
  /** Nombre de la hoja (sólo Excel). */
  sheetName?: string;
  /** Deshabilitar ambos botones. */
  disabled?: boolean;
  /** Etiqueta del botón PDF (default: 'PDF'). */
  pdfLabel?: string;
  /** Etiqueta del botón Excel (default: 'Excel'). */
  excelLabel?: string;
  /** Si true, muestra un selector de cantidad antes de exportar. Default: false */
  showQuantitySelector?: boolean;
}

export function ExportButtons<T = any>(props: ExportButtonsProps<T>) {
  const {
    data, allData, totalCount, columns, title, subtitle, meta, footerSummary,
    variant = 'compact', fileName, sheetName, disabled,
    pdfLabel = 'PDF', excelLabel = 'Excel', showQuantitySelector = false,
  } = props;
  const { message } = App.useApp();
  const [pdfLoading, setPdfLoading] = useState(false);
  const [xlsxLoading, setXlsxLoading] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);

  const hasData = data && data.length > 0;
  const isDisabled = disabled || !hasData;
  
  // Si hay allData con MÁS registros, o showQuantitySelector está activo, mostramos el modal
  const hasQuantityOptions = showQuantitySelector || (allData && allData.length > data.length);
  
  // Determinar el total real de registros disponibles
  const actualTotal = totalCount ?? allData?.length ?? data.length;

  const doExport = useCallback(async (type: 'pdf' | 'excel', exportData: T[]) => {
    try {
      if (type === 'pdf') {
        setPdfLoading(true);
        await new Promise(r => setTimeout(r, 30));
        exportToPdf({ title, subtitle, meta, columns, data: exportData, fileName, footerSummary });
        message.success(`PDF generado (${exportData.length} registro${exportData.length === 1 ? '' : 's'})`);
      } else {
        setXlsxLoading(true);
        await new Promise(r => setTimeout(r, 30));
        exportToExcel({ title, subtitle, columns, data: exportData, fileName, sheetName, footerSummary });
        message.success(`Excel generado (${exportData.length} registro${exportData.length === 1 ? '' : 's'})`);
      }
    } catch (err: any) {
      message.error(err?.message || 'Error al generar exportación');
    } finally {
      setPdfLoading(false);
      setXlsxLoading(false);
    }
  }, [title, subtitle, meta, columns, fileName, sheetName, footerSummary, message]);

  const handlePdf = useCallback(async () => {
    if (isDisabled) return;
    // Si hay opción de elegir cantidad, abrir el modal
    if (hasQuantityOptions) {
      setExportModalOpen(true);
      return;
    }
    // De lo contrario, exportar directamente los datos actuales
    await doExport('pdf', data);
  }, [isDisabled, hasQuantityOptions, doExport, data]);

  const handleExcel = useCallback(async () => {
    if (isDisabled) return;
    // Si hay opción de elegir cantidad, abrir el modal
    if (hasQuantityOptions) {
      setExportModalOpen(true);
      return;
    }
    // De lo contrario, exportar directamente los datos actuales
    await doExport('excel', data);
  }, [isDisabled, hasQuantityOptions, doExport, data]);

  const tooltipPdf = !hasData
    ? 'No hay datos para exportar'
    : hasQuantityOptions
      ? `Exportar (${actualTotal} registros disponibles)`
      : `Exportar a PDF (${data.length} registro${data.length === 1 ? '' : 's'})`;
  const tooltipExcel = !hasData
    ? 'No hay datos para exportar'
    : hasQuantityOptions
      ? `Exportar (${actualTotal} registros disponibles)`
      : `Exportar a Excel (${data.length} registro${data.length === 1 ? '' : 's'})`;

  const isLoading = pdfLoading || xlsxLoading;

  // Renderizado del modal de selección de cantidad
  const renderExportModal = () => (
    <ExportModal
      open={exportModalOpen}
      onCancel={() => setExportModalOpen(false)}
      allData={allData}
      pageData={data}
      columns={columns}
      title={title}
      subtitle={subtitle}
      meta={meta}
      footerSummary={footerSummary}
      fileName={fileName}
      sheetName={sheetName}
      totalCount={totalCount}
    />
  );

  // Si hay opciones de cantidad, mostrar UN solo botón que abre el modal
  if (hasQuantityOptions) {
    if (variant === 'full') {
      return (
        <>
          <Tooltip title={tooltipPdf}>
            <Button
              icon={<ExportOutlined />}
              onClick={() => setExportModalOpen(true)}
              disabled={isDisabled}
              className="rg-export-btn"
            >
              Exportar
            </Button>
          </Tooltip>
          {renderExportModal()}
        </>
      );
    }
    return (
      <>
        <div className="rg-export-buttons">
          <Tooltip title={tooltipPdf} mouseEnterDelay={0.4}>
            <Button
              shape="circle"
              icon={<ExportOutlined />}
              onClick={() => setExportModalOpen(true)}
              disabled={isDisabled}
              loading={isLoading}
              className="rg-export-btn"
              aria-label="Exportar datos"
            />
          </Tooltip>
        </div>
        {renderExportModal()}
      </>
    );
  }

  if (variant === 'full') {
    return (
      <>
        <div className="rg-export-buttons rg-export-buttons-full">
          <Tooltip title={tooltipPdf}>
            <Button
              icon={<FilePdfOutlined />}
              onClick={handlePdf}
              loading={pdfLoading}
              disabled={isDisabled}
              className="rg-export-pdf"
            >
              {pdfLabel}
            </Button>
          </Tooltip>
          <Tooltip title={tooltipExcel}>
            <Button
              icon={<FileExcelOutlined />}
              onClick={handleExcel}
              loading={xlsxLoading}
              disabled={isDisabled}
              className="rg-export-excel"
            >
              {excelLabel}
            </Button>
          </Tooltip>
        </div>
        {renderExportModal()}
      </>
    );
  }

  return (
    <>
      <div className="rg-export-buttons">
        <Tooltip title={tooltipPdf} mouseEnterDelay={0.4}>
          <Button
            shape="circle"
            icon={<FilePdfOutlined />}
            onClick={handlePdf}
            loading={pdfLoading}
            disabled={isDisabled}
            className="rg-export-pdf"
            aria-label="Exportar a PDF"
          />
        </Tooltip>
        <Tooltip title={tooltipExcel} mouseEnterDelay={0.4}>
          <Button
            shape="circle"
            icon={<FileExcelOutlined />}
            onClick={handleExcel}
            loading={xlsxLoading}
            disabled={isDisabled}
            className="rg-export-excel"
            aria-label="Exportar a Excel"
          />
        </Tooltip>
      </div>
      {renderExportModal()}
    </>
  );
}

/**
 * ExportDropdown — variante agrupada (un solo botón con menú desplegable).
 * Útil cuando hay poco espacio horizontal.
 */
export interface ExportDropdownProps<T = any> extends ExportButtonsProps<T> {
  label?: string;
}

export function ExportDropdown<T = any>(props: ExportDropdownProps<T>) {
  const {
    data, allData, totalCount, columns, title, subtitle, meta, footerSummary,
    fileName, sheetName, disabled, label = 'Exportar',
    pdfLabel = 'PDF', excelLabel = 'Excel', showQuantitySelector = false,
  } = props;
  const { message } = App.useApp();
  const [pdfLoading, setPdfLoading] = useState(false);
  const [xlsxLoading, setXlsxLoading] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);

  const hasData = data && data.length > 0;
  const isDisabled = disabled || !hasData;
  const hasQuantityOptions = showQuantitySelector || (allData && allData.length > data.length);
  const actualTotal = totalCount ?? allData?.length ?? data.length;

  const doExport = useCallback(async (type: 'pdf' | 'excel', exportData: T[]) => {
    try {
      if (type === 'pdf') {
        setPdfLoading(true);
        await new Promise(r => setTimeout(r, 30));
        exportToPdf({ title, subtitle, meta, columns, data: exportData, fileName, footerSummary });
        message.success(`PDF generado (${exportData.length} registro${exportData.length === 1 ? '' : 's'})`);
      } else {
        setXlsxLoading(true);
        await new Promise(r => setTimeout(r, 30));
        exportToExcel({ title, subtitle, columns, data: exportData, fileName, sheetName, footerSummary });
        message.success(`Excel generado (${exportData.length} registro${exportData.length === 1 ? '' : 's'})`);
      }
    } catch (err: any) {
      message.error(err?.message || 'Error al generar exportación');
    } finally {
      setPdfLoading(false);
      setXlsxLoading(false);
    }
  }, [title, subtitle, meta, columns, fileName, sheetName, footerSummary, message]);

  const handlePdf = useCallback(async () => {
    if (isDisabled) return;
    if (hasQuantityOptions) {
      setExportModalOpen(true);
      return;
    }
    await doExport('pdf', data);
  }, [isDisabled, hasQuantityOptions, doExport, data]);

  const handleExcel = useCallback(async () => {
    if (isDisabled) return;
    if (hasQuantityOptions) {
      setExportModalOpen(true);
      return;
    }
    await doExport('excel', data);
  }, [isDisabled, hasQuantityOptions, doExport, data]);

  return (
    <>
      <div className="rg-export-buttons rg-export-buttons-grouped">
        <Button.Group>
          <Tooltip title={isDisabled ? 'No hay datos para exportar' : hasQuantityOptions ? `Exportar a PDF (${actualTotal} registros)` : `Exportar a PDF (${data.length})`}>
            <Button
              icon={hasQuantityOptions ? <ExportOutlined /> : <FilePdfOutlined />}
              onClick={handlePdf}
              loading={pdfLoading}
              disabled={isDisabled}
              className="rg-export-pdf"
            >
              {pdfLabel}
            </Button>
          </Tooltip>
          <Tooltip title={isDisabled ? 'No hay datos para exportar' : hasQuantityOptions ? `Exportar a Excel (${actualTotal} registros)` : `Exportar a Excel (${data.length})`}>
            <Button
              icon={hasQuantityOptions ? <ExportOutlined /> : <FileExcelOutlined />}
              onClick={handleExcel}
              loading={xlsxLoading}
              disabled={isDisabled}
              className="rg-export-excel"
            >
              {excelLabel}
            </Button>
          </Tooltip>
          <Button
            icon={<DownOutlined />}
            disabled
            style={{ pointerEvents: 'none', opacity: 0.6, paddingInline: 8 }}
            aria-label={label}
          />
        </Button.Group>
      </div>
      <ExportModal
        open={exportModalOpen}
        onCancel={() => setExportModalOpen(false)}
        allData={allData}
        pageData={data}
        columns={columns}
        title={title}
        subtitle={subtitle}
        meta={meta}
        footerSummary={footerSummary}
        fileName={fileName}
        sheetName={sheetName}
        totalCount={totalCount}
      />
    </>
  );
}
