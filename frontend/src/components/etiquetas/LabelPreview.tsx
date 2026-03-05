import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Button, Space, Segmented, Typography } from 'antd';
import { FilePdfOutlined, PrinterOutlined, DownloadOutlined } from '@ant-design/icons';
import type { LabelProduct, LabelConfig, LabelFormat } from '../../utils/labelPdf';
import { generateA4PDF, generate80mmPDF } from '../../utils/labelPdf';
import JsBarcode from 'jsbarcode';

const { Text } = Typography;

// ── Layout configs matching the PDF generator ──
interface LayoutConfig {
  columns: number;
  labelW: number;   // px (scaled from mm)
  labelH: number;
  codeFontSize: number;
  nameFontSize: number;
  priceFontSize: number;
  maxNameLines: number;
  barcodeH: number;
  gap: number;
  pageW: number;     // px — virtual "page" width
}

function getLayoutConfig(format: LabelFormat, showBarcode: boolean, is80mm: boolean): LayoutConfig {
  if (is80mm) {
    const labelH = showBarcode ? 140 : 110;
    return {
      columns: 1,
      labelW: 260,
      labelH,
      codeFontSize: 10,
      nameFontSize: showBarcode ? 13 : 15,
      priceFontSize: 20,
      maxNameLines: showBarcode ? 2 : 3,
      barcodeH: 42,
      gap: 8,
      pageW: 290,
    };
  }
  switch (format) {
    case 'compacto':
      return {
        columns: 4,
        labelW: 140,
        labelH: showBarcode ? 145 : 115,
        codeFontSize: 9,
        nameFontSize: showBarcode ? 11 : 12,
        priceFontSize: 15,
        maxNameLines: showBarcode ? 2 : 3,
        barcodeH: 40,
        gap: 6,
        pageW: 600,
      };
    case 'grande':
      return {
        columns: 2,
        labelW: 280,
        labelH: showBarcode ? 165 : 135,
        codeFontSize: 10,
        nameFontSize: showBarcode ? 14 : 16,
        priceFontSize: 20,
        maxNameLines: showBarcode ? 2 : 3,
        barcodeH: 50,
        gap: 10,
        pageW: 600,
      };
    default: // estandar
      return {
        columns: 3,
        labelW: 190,
        labelH: showBarcode ? 155 : 125,
        codeFontSize: 9.5,
        nameFontSize: showBarcode ? 12 : 14,
        priceFontSize: 18,
        maxNameLines: showBarcode ? 2 : 3,
        barcodeH: 45,
        gap: 8,
        pageW: 600,
      };
  }
}

function getPrice(product: LabelProduct, lista: number): number {
  switch (lista) {
    case 1: return product.LISTA_1;
    case 2: return product.LISTA_2;
    case 3: return product.LISTA_3;
    case 4: return product.LISTA_4;
    case 5: return product.LISTA_5;
    default: return product.LISTA_1;
  }
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value);
}

// ── Barcode component ──
function BarcodeImage({ value, height }: { value: string; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !value) return;
    try {
      JsBarcode(canvasRef.current, value, {
        format: 'CODE128', width: 1.5, height,
        displayValue: true, fontSize: 10, margin: 2,
        background: '#FFFFFF', lineColor: '#000000',
      });
    } catch { /* invalid barcode */ }
  }, [value, height]);

  return <canvas ref={canvasRef} style={{ maxWidth: '85%', height: 'auto' }} />;
}

// ── Single label card ──
function LabelCard({ product, config, layout }: {
  product: LabelProduct;
  config: LabelConfig;
  layout: LayoutConfig;
}) {
  const price = getPrice(product, config.listaPrecios);

  return (
    <div style={{
      width: layout.labelW,
      height: layout.labelH,
      border: '1px solid #000',
      borderRadius: 4,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      background: '#fff',
      flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{
        background: '#f0f0f0',
        borderBottom: '1px solid #b4b4b4',
        textAlign: 'center',
        padding: '3px 4px',
        fontSize: layout.codeFontSize,
        color: '#646464',
        lineHeight: 1.2,
        flexShrink: 0,
      }}>
        CÓD: {product.CODIGOPARTICULAR || 'S/C'}
      </div>

      {/* Name */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '2px 6px',
        fontSize: layout.nameFontSize,
        fontWeight: 700,
        color: '#1e1f23',
        lineHeight: 1.25,
        overflow: 'hidden',
        wordBreak: 'break-word',
        minHeight: 0,
      }}>
        <span style={{
          display: '-webkit-box',
          WebkitLineClamp: layout.maxNameLines,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {product.NOMBRE}
        </span>
      </div>

      {/* Barcode */}
      {config.showBarcode && product.CODIGO_BARRAS && (
        <div style={{
          textAlign: 'center',
          padding: '0 4px',
          flexShrink: 0,
        }}>
          <BarcodeImage value={product.CODIGO_BARRAS} height={layout.barcodeH} />
        </div>
      )}

      {/* Price */}
      <div style={{
        margin: '4px 6px 6px',
        border: '2px solid #000',
        borderRadius: 3,
        textAlign: 'center',
        padding: '3px 4px',
        flexShrink: 0,
      }}>
        <div style={{
          border: '1px solid #000',
          borderRadius: 2,
          padding: '2px 4px',
          fontSize: layout.priceFontSize,
          fontWeight: 700,
          color: '#000',
          lineHeight: 1.2,
        }}>
          {formatCurrency(price)}
        </div>
      </div>
    </div>
  );
}

// ── Main Preview Component ──
interface LabelPreviewProps {
  open: boolean;
  onClose: () => void;
  products: LabelProduct[];
  config: LabelConfig;
  type: 'a4' | '80mm';
}

export function LabelPreview({ open, onClose, products, config, type }: LabelPreviewProps) {
  const [currentType, setCurrentType] = useState(type);

  useEffect(() => { setCurrentType(type); }, [type]);

  const layout = useMemo(
    () => getLayoutConfig(config.format, config.showBarcode, currentType === '80mm'),
    [config.format, config.showBarcode, currentType],
  );

  const handleDownload = useCallback(() => {
    if (products.length === 0) return;
    const doc = currentType === 'a4'
      ? generateA4PDF(products, config)
      : generate80mmPDF(products, config);
    const suffix = currentType === 'a4' ? 'A4' : '80mm';
    doc.save(`Etiquetas_${suffix}_${new Date().toISOString().slice(0, 10)}.pdf`);
  }, [products, config, currentType]);

  const handlePrint = useCallback(() => {
    if (products.length === 0) return;
    const doc = currentType === 'a4'
      ? generateA4PDF(products, config)
      : generate80mmPDF(products, config);
    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    const printWindow = window.open(url, '_blank');
    if (printWindow) {
      printWindow.addEventListener('load', () => {
        printWindow.print();
        URL.revokeObjectURL(url);
      });
    } else {
      URL.revokeObjectURL(url);
    }
  }, [products, config, currentType]);

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <FilePdfOutlined style={{ color: 'var(--rg-gold)' }} />
          <span>Vista Previa de Etiquetas</span>
        </div>
      }
      open={open}
      onCancel={onClose}
      width={currentType === 'a4' ? 850 : 500}
      centered
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {products.length} etiqueta{products.length !== 1 ? 's' : ''} · Formato {currentType.toUpperCase()}
          </Text>
          <Space>
            <Button onClick={onClose}>Cerrar</Button>
            <Button icon={<PrinterOutlined />} onClick={handlePrint} disabled={products.length === 0}>
              Imprimir
            </Button>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={handleDownload}
              disabled={products.length === 0}
              className="btn-gold"
            >
              Descargar PDF
            </Button>
          </Space>
        </div>
      }
      className="etiquetas-preview-modal"
    >
      <div style={{ marginBottom: 12, textAlign: 'center' }}>
        <Segmented
          value={currentType}
          onChange={(v) => setCurrentType(v as 'a4' | '80mm')}
          options={[
            { value: 'a4', label: 'A4 (PDF)' },
            { value: '80mm', label: '80mm (Térmica)' },
          ]}
        />
      </div>
      <div className="etiquetas-preview-container" style={{
        maxHeight: currentType === 'a4' ? 600 : 500,
        overflowY: 'auto',
        border: '1px solid var(--rg-border)',
        borderRadius: 8,
        background: '#e8e8e8',
        padding: 16,
      }}>
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: layout.gap,
          justifyContent: 'center',
          maxWidth: layout.pageW,
          margin: '0 auto',
        }}>
          {products.map((p) => (
            <LabelCard key={p.PRODUCTO_ID} product={p} config={config} layout={layout} />
          ))}
        </div>
      </div>
    </Modal>
  );
}
