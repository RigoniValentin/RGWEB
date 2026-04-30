import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Modal, Input, Spin, Empty, Tag, Typography, Tooltip, Divider, Alert,
} from 'antd';
import {
  BarcodeOutlined, SearchOutlined, DollarOutlined, DropboxOutlined,
  TagOutlined, AppstoreOutlined, PercentageOutlined, CloseCircleOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { salesApi } from '../../services/sales.api';
import type { ProductoSearch } from '../../types';
import { fmtMoney } from '../../utils/format';

const { Title, Text } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
}

// ── Stock indicator ──────────────────────────────────────────────────────────
function StockIndicator({ stock }: { stock: number }) {
  const isOut = stock <= 0;
  const isLow = stock > 0 && stock < 5;
  const color = isOut ? '#ff4d4f' : isLow ? '#fa8c16' : '#52c41a';
  const bg = isOut ? 'rgba(255,77,79,0.08)' : isLow ? 'rgba(250,140,22,0.08)' : 'rgba(82,196,26,0.08)';
  const label = isOut ? 'Sin stock' : isLow ? 'Stock bajo' : 'Disponible';
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 12px',
      borderRadius: 8,
      background: bg,
      border: `1px solid ${color}33`,
      color,
      fontWeight: 600,
      fontSize: 13,
    }}>
      {isOut ? <CloseCircleOutlined /> : <CheckCircleOutlined />}
      <span>{label}</span>
      <span style={{ opacity: 0.7, fontWeight: 500 }}>· {stock} u.</span>
    </div>
  );
}

// ── Info row ─────────────────────────────────────────────────────────────────
function InfoRow({ icon, label, value, highlight }: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '10px 14px',
      borderRadius: 10,
      background: highlight ? 'rgba(234,189,35,0.08)' : 'rgba(0,0,0,0.02)',
      border: highlight ? '1px solid rgba(234,189,35,0.3)' : '1px solid rgba(0,0,0,0.04)',
      marginBottom: 6,
    }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'rgba(0,0,0,0.55)', fontSize: 13 }}>
        {icon}
        {label}
      </span>
      <span style={{
        fontWeight: highlight ? 700 : 600,
        fontSize: highlight ? 16 : 13.5,
        color: highlight ? '#1E1F22' : 'rgba(0,0,0,0.85)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </span>
    </div>
  );
}

export function QuickProductLookupModal({ open, onClose }: Props) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [product, setProduct] = useState<ProductoSearch | null>(null);
  const [matches, setMatches] = useState<ProductoSearch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<any>(null);
  const reqIdRef = useRef(0);

  // Reset on open / focus input
  useEffect(() => {
    if (open) {
      setText('');
      setProduct(null);
      setMatches([]);
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const search = useCallback(async (term: string) => {
    const q = term.trim();
    if (!q) {
      setProduct(null);
      setMatches([]);
      setError(null);
      return;
    }
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const results = await salesApi.searchProducts(q);
      if (reqId !== reqIdRef.current) return;

      if (!results || results.length === 0) {
        setProduct(null);
        setMatches([]);
        setError('No se encontró ningún producto con ese código o nombre');
        return;
      }

      // Prefer exact CODIGOPARTICULAR match
      const exact = results.find(
        p => p.CODIGOPARTICULAR?.toUpperCase() === q.toUpperCase()
      );
      if (exact) {
        setProduct(exact);
        setMatches([]);
      } else if (results.length === 1) {
        setProduct(results[0]!);
        setMatches([]);
      } else {
        setProduct(null);
        setMatches(results.slice(0, 8));
      }
    } catch (err: any) {
      if (reqId !== reqIdRef.current) return;
      setError(err?.response?.data?.error || 'Error al buscar el producto');
      setProduct(null);
      setMatches([]);
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, []);

  const handleEnter = () => {
    search(text);
  };

  const handleSelectMatch = (p: ProductoSearch) => {
    setProduct(p);
    setMatches([]);
    setText(p.CODIGOPARTICULAR ?? '');
    inputRef.current?.focus();
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={620}
      destroyOnHidden
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 36, height: 36, borderRadius: 10,
            background: 'linear-gradient(135deg, #EABD23 0%, #d4a017 100%)',
            color: '#1E1F22', fontSize: 18,
          }}>
            <BarcodeOutlined />
          </span>
          <div>
            <Text strong style={{ fontSize: 16, display: 'block' }}>Búsqueda rápida de producto</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Escaneá un código de barras o ingresá el código/nombre y presioná Enter
            </Text>
          </div>
        </div>
      }
      styles={{
        header: { borderBottom: '1px solid rgba(0,0,0,0.06)', paddingBottom: 12 },
        body: { paddingTop: 18, maxHeight: 'calc(80dvh - 120px)', overflowY: 'auto', paddingRight: 4 },
      }}
    >
      <Input
        ref={inputRef}
        size="large"
        prefix={<SearchOutlined style={{ color: '#999' }} />}
        suffix={loading ? <Spin size="small" /> : null}
        placeholder="Código de barras, código interno o nombre..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPressEnter={handleEnter}
        autoComplete="off"
        style={{
          borderRadius: 10,
          fontSize: 15,
          fontFamily: 'monospace',
          letterSpacing: 0.5,
        }}
      />

      <div style={{ marginTop: 18, minHeight: 220 }}>
        {error && (
          <Alert
            type="warning"
            showIcon
            message={error}
            style={{ borderRadius: 10 }}
          />
        )}

        {!error && !product && matches.length === 0 && !loading && (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Text type="secondary" style={{ fontSize: 13 }}>
                Esperando código…
              </Text>
            }
            style={{ marginTop: 30 }}
          />
        )}

        {/* ── Multiple matches ──────────────────────────────────────── */}
        {matches.length > 0 && (
          <div>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
              {matches.length} resultado(s) — seleccioná uno:
            </Text>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
              {matches.map((p) => (
                <div
                  key={p.PRODUCTO_ID}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSelectMatch(p)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSelectMatch(p); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderRadius: 10,
                    background: 'rgba(0,0,0,0.02)',
                    border: '1px solid rgba(0,0,0,0.06)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(234,189,35,0.08)';
                    e.currentTarget.style.borderColor = 'rgba(234,189,35,0.4)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(0,0,0,0.02)';
                    e.currentTarget.style.borderColor = 'rgba(0,0,0,0.06)';
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Text strong style={{ fontSize: 13.5, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.NOMBRE}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 11.5, fontFamily: 'monospace' }}>
                      {p.CODIGOPARTICULAR}
                    </Text>
                  </div>
                  <div style={{ textAlign: 'right', marginLeft: 12 }}>
                    <div style={{ fontWeight: 700, color: '#EABD23', fontSize: 14 }}>
                      {fmtMoney(p.PRECIO_VENTA)}
                    </div>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      Stock: {p.STOCK}
                    </Text>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Single product detail ─────────────────────────────────── */}
        {product && (
          <div className="animate-fade-up">
            {/* Header with name and code */}
            <div style={{
              padding: '14px 16px',
              borderRadius: 12,
              background: 'linear-gradient(135deg, #1E1F22 0%, #2A2B2F 100%)',
              borderLeft: '4px solid #EABD23',
              marginBottom: 14,
            }}>
              <Title level={4} style={{ color: '#fff', margin: 0, fontSize: 17, lineHeight: 1.3 }}>
                {product.NOMBRE}
              </Title>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                <Tag style={{
                  margin: 0,
                  background: 'rgba(234,189,35,0.15)',
                  border: '1px solid rgba(234,189,35,0.4)',
                  color: '#EABD23',
                  fontFamily: 'monospace',
                  fontWeight: 600,
                }}>
                  {product.CODIGOPARTICULAR || 'Sin código'}
                </Tag>
                {product.ES_SERVICIO && (
                  <Tag color="purple" style={{ margin: 0 }}>SERVICIO</Tag>
                )}
                {product.ES_CONJUNTO && (
                  <Tag color="cyan" style={{ margin: 0 }}>KIT</Tag>
                )}
                <StockIndicator stock={product.STOCK} />
              </div>
            </div>

            {/* Price (highlighted) */}
            <InfoRow
              icon={<DollarOutlined />}
              label="Precio de venta"
              value={fmtMoney(product.PRECIO_VENTA)}
              highlight
            />

            {/* Lists if differ */}
            {(product.LISTA_1 || product.LISTA_2 || product.LISTA_3) ? (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                gap: 6,
                marginBottom: 6,
              }}>
                {[1, 2, 3, 4, 5].map((n) => {
                  const v = (product as any)[`LISTA_${n}`] as number;
                  if (!v) return null;
                  return (
                    <Tooltip key={n} title={`Lista ${n}`}>
                      <div style={{
                        padding: '8px 10px',
                        borderRadius: 8,
                        background: 'rgba(0,0,0,0.02)',
                        border: '1px solid rgba(0,0,0,0.05)',
                        textAlign: 'center',
                      }}>
                        <Text type="secondary" style={{ fontSize: 10.5, display: 'block' }}>
                          Lista {n}
                        </Text>
                        <Text strong style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                          {fmtMoney(v)}
                        </Text>
                      </div>
                    </Tooltip>
                  );
                })}
              </div>
            ) : null}

            <Divider style={{ margin: '10px 0' }} />

            <InfoRow
              icon={<DropboxOutlined />}
              label="Stock total"
              value={`${product.STOCK} ${product.UNIDAD_ABREVIACION || 'u.'}`}
            />

            {product.UNIDAD_NOMBRE && (
              <InfoRow
                icon={<AppstoreOutlined />}
                label="Unidad"
                value={`${product.UNIDAD_NOMBRE}${product.UNIDAD_ABREVIACION ? ` (${product.UNIDAD_ABREVIACION})` : ''}`}
              />
            )}

            <InfoRow
              icon={<PercentageOutlined />}
              label="IVA"
              value={`${product.IVA_PORCENTAJE ?? 0}%`}
            />

            {product.IMP_INT > 0 && (
              <InfoRow
                icon={<TagOutlined />}
                label="Imp. interno"
                value={`${product.IMP_INT}%`}
              />
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
