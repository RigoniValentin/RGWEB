import { useEffect, useState } from 'react';
import { Modal, Button, Space, Segmented, Typography } from 'antd';
import { FilePdfOutlined, PrinterOutlined, DownloadOutlined } from '@ant-design/icons';
import type { LabelProduct, LabelConfig } from '../../utils/labelPdf';
import { generateA4PDF, generate80mmPDF } from '../../utils/labelPdf';

const { Text } = Typography;

interface LabelPreviewProps {
  open: boolean;
  onClose: () => void;
  products: LabelProduct[];
  config: LabelConfig;
  type: 'a4' | '80mm';
}

export function LabelPreview({ open, onClose, products, config, type }: LabelPreviewProps) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [currentType, setCurrentType] = useState(type);

  useEffect(() => {
    setCurrentType(type);
  }, [type]);

  useEffect(() => {
    if (!open || products.length === 0) {
      setPdfUrl(null);
      return;
    }

    try {
      const doc = currentType === 'a4'
        ? generateA4PDF(products, config)
        : generate80mmPDF(products, config);

      const blob = doc.output('blob');
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);

      return () => URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error generating preview:', err);
      setPdfUrl(null);
    }
  }, [open, products, config, currentType]);

  const handleDownload = () => {
    if (!pdfUrl) return;
    const a = document.createElement('a');
    a.href = pdfUrl;
    a.download = currentType === 'a4'
      ? `Etiquetas_A4_${new Date().toISOString().slice(0, 10)}.pdf`
      : `Etiquetas_80mm_${new Date().toISOString().slice(0, 10)}.pdf`;
    a.click();
  };

  const handlePrint = () => {
    if (!pdfUrl) return;
    const printWindow = window.open(pdfUrl, '_blank');
    if (printWindow) {
      printWindow.addEventListener('load', () => {
        printWindow.print();
      });
    }
  };

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
            <Button icon={<PrinterOutlined />} onClick={handlePrint} disabled={!pdfUrl}>
              Imprimir
            </Button>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={handleDownload}
              disabled={!pdfUrl}
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
      <div className="etiquetas-preview-container">
        {pdfUrl ? (
          <iframe
            src={`${pdfUrl}#toolbar=0&navpanes=0`}
            title="Vista previa de etiquetas"
            style={{
              width: '100%',
              height: currentType === 'a4' ? 600 : 500,
              border: '1px solid var(--rg-border)',
              borderRadius: 8,
              background: '#f5f5f5',
            }}
          />
        ) : (
          <div style={{
            height: 400,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#fafafa',
            borderRadius: 8,
            border: '1px dashed #d9d9d9',
          }}>
            <Text type="secondary">Generando vista previa...</Text>
          </div>
        )}
      </div>
    </Modal>
  );
}
