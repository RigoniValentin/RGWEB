import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Modal, Input, Table, Button, Space, Checkbox, Tag, Typography,
} from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import type { ProductoSearch } from '../types';
import { fmtMoney } from '../utils/format';

const { Text } = Typography;

export interface ProductSearchParams {
  search?: string;
  marca?: string;
  categoria?: string;
  codigo?: string;
  soloActivos?: boolean;
  soloConStock?: boolean;
  listaId?: number;
  limit?: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (products: ProductoSearch[]) => void;
  initialSearch?: string;
  searchFn: (params: ProductSearchParams) => Promise<ProductoSearch[]>;
  multiSelect?: boolean;
  onBarcodeBalanza?: (code: string) => void;
}

export function ProductSearchModal({
  open, onClose, onSelect, initialSearch = '', searchFn, multiSelect = true,
  onBarcodeBalanza,
}: Props) {
  const [keywords, setKeywords] = useState('');
  const [marca, setMarca] = useState('');
  const [categoria, setCategoria] = useState('');
  const [codigo, setCodigo] = useState('');
  const [soloActivos, setSoloActivos] = useState(true);
  const [soloConStock, setSoloConStock] = useState(false);
  const [results, setResults] = useState<ProductoSearch[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [activeRowIndex, setActiveRowIndex] = useState<number>(-1);

  const keywordsRef = useRef<any>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const searchedOnOpen = useRef(false);
  // Track whether the user has edited keywords since the last search
  const keywordsDirty = useRef(false);
  // Track last clicked row index for Shift+Click range selection
  const lastClickedIndex = useRef<number>(-1);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setKeywords(initialSearch);
      setMarca('');
      setCategoria('');
      setCodigo('');
      setSoloActivos(true);
      setSoloConStock(false);
      setResults([]);
      setSelectedRowKeys([]);
      setActiveRowIndex(-1);
      searchedOnOpen.current = false;
      keywordsDirty.current = false;
    }
  }, [open, initialSearch]);

  // Auto-search when modal opens with initialSearch
  useEffect(() => {
    if (open && initialSearch && !searchedOnOpen.current) {
      searchedOnOpen.current = true;
      const text = initialSearch.trim();
      // If initialSearch looks like a barcode, search by codigo field
      if (/^\d{6,}$/.test(text)) {
        setCodigo(text);
        setKeywords('');
        doSearch('', '', '', text, true, false);
      } else {
        doSearch(initialSearch, '', '', '', true, false);
      }
    }
  }, [open, initialSearch]);

  // Focus keywords input after results load or on open
  useEffect(() => {
    if (open) {
      setTimeout(() => keywordsRef.current?.focus(), 0);
    }
  }, [open]);

  const doSearch = useCallback(async (
    kw?: string, m?: string, cat?: string, cod?: string,
    activos?: boolean, conStock?: boolean,
  ) => {
    setLoading(true);
    setSelectedRowKeys([]);
    setActiveRowIndex(-1);
    try {
      const data = await searchFn({
        search: kw ?? keywords,
        marca: m ?? marca,
        categoria: cat ?? categoria,
        codigo: cod ?? codigo,
        soloActivos: activos ?? soloActivos,
        soloConStock: conStock ?? soloConStock,
        limit: 50,
      });
      setResults(data);
      keywordsDirty.current = false;
      if (data.length > 0) {
        setActiveRowIndex(0);
        setSelectedRowKeys([data[0]!.PRODUCTO_ID]);
      }
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [keywords, marca, categoria, codigo, soloActivos, soloConStock, searchFn]);

  const handleSearchClick = () => doSearch();

  const confirmSelection = useCallback(() => {
    const selected = results.filter(r => selectedRowKeys.includes(r.PRODUCTO_ID));
    if (selected.length > 0) {
      onSelect(selected);
      onClose();
    }
  }, [results, selectedRowKeys, onSelect, onClose]);

  const confirmActiveRow = useCallback(() => {
    const activeProduct = activeRowIndex >= 0 ? results[activeRowIndex] : undefined;
    if (!activeProduct) return false;

    onSelect([activeProduct]);
    onClose();
    return true;
  }, [activeRowIndex, results, onSelect, onClose]);

  // Detect barcode patterns
  const isBalanzaBarcode = (text: string) => /^2\d{12}$/.test(text);
  const isBarcode = (text: string) => /^\d{6,}$/.test(text);

  // Handle Enter on filter inputs: detect barcodes, confirm active row, or search
  const handleFilterKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();

      // Check if keywords field contains a barcode
      const kw = keywords.trim();

      // Barcode balanza: 13 digits starting with "2"
      if (isBalanzaBarcode(kw) && onBarcodeBalanza) {
        onBarcodeBalanza(kw);
        onClose();
        return;
      }

      // Normal barcode: only digits, >= 6 chars → search as exact code
      if (isBarcode(kw)) {
        setKeywords('');
        setCodigo(kw);
        doSearch('', '', '', kw);
        return;
      }

      // If keywords haven't changed since last search, confirm the active row
      if (!keywordsDirty.current) {
        if (confirmActiveRow()) return;
      }

      // Otherwise run the search
      doSearch();
    }
  };

  // Global keyboard handler for the modal
  const handleModalKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return; // Let Modal handle Escape

    // Arrow navigation when results exist
    if (results.length > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setActiveRowIndex(prev => {
        let next: number;
        if (e.key === 'ArrowDown') {
          next = prev < results.length - 1 ? prev + 1 : prev;
        } else {
          next = prev > 0 ? prev - 1 : 0;
        }
        const product = results[next];
        if (product) {
          if (multiSelect) {
            setSelectedRowKeys(keys => {
              if (!keys.includes(product.PRODUCTO_ID)) {
                return [product.PRODUCTO_ID];
              }
              return keys;
            });
          } else {
            setSelectedRowKeys([product.PRODUCTO_ID]);
          }
          // Scroll into view
          const row = tableRef.current?.querySelector(`[data-row-key="${product.PRODUCTO_ID}"]`);
          row?.scrollIntoView({ block: 'nearest' });
        }
        return next;
      });
      return;
    }

    // Enter to confirm selection (only when not in a filter input)
    if (e.key === 'Enter') {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input') return; // Let filter handler handle it
      e.preventDefault();
      if (!confirmActiveRow()) {
        confirmSelection();
      }
    }
  }, [results, multiSelect, confirmSelection, confirmActiveRow]);

  const columns = [
    {
      title: 'Código',
      dataIndex: 'CODIGOPARTICULAR',
      key: 'CODIGOPARTICULAR',
      width: 120,
      ellipsis: true,
    },
    {
      title: 'Nombre',
      dataIndex: 'NOMBRE',
      key: 'NOMBRE',
      ellipsis: true,
    },
    {
      title: 'Marca',
      dataIndex: 'MARCA',
      key: 'MARCA',
      width: 120,
      ellipsis: true,
      render: (v: string) => v || '-',
    },
    {
      title: 'Stock',
      dataIndex: 'STOCK',
      key: 'STOCK',
      width: 100,
      align: 'center' as const,
      render: (stock: number, record: ProductoSearch) => {
        const unit = record.UNIDAD_ABREVIACION || 'u';
        if (stock <= 0) return <Text type="danger">0</Text>;
        if (stock <= 5) return <Text type="warning">{stock} {unit}</Text>;
        return <>{stock} {unit}</>;
      },
    },
    {
      title: 'Precio',
      dataIndex: 'PRECIO_VENTA',
      key: 'PRECIO_VENTA',
      width: 150,
      align: 'center' as const,
      render: (v: number) => <Text strong>{fmtMoney(v)}</Text>,
    },
  ];

  return (
    <Modal
      title="Búsqueda avanzada de productos"
      open={open}
      onCancel={onClose}
      width={1000}
      centered
      destroyOnClose
      focusTriggerAfterClose={false}
      footer={
        <Space>
          <Button onClick={onClose}>Cerrar</Button>
          <Button
            type="primary"
            disabled={selectedRowKeys.length === 0}
            onClick={confirmSelection}
          >
            Seleccionar ({selectedRowKeys.length})
          </Button>
        </Space>
      }
    >
      <div onKeyDown={handleModalKeyDown}>
        {/* Filter row */}
        <Space wrap style={{ width: '100%', marginBottom: 12 }}>
          <Input
            ref={keywordsRef}
            prefix={<SearchOutlined />}
            placeholder="Descripción / palabras clave"
            value={keywords}
            onChange={e => { setKeywords(e.target.value); keywordsDirty.current = true; }}
            onKeyDown={handleFilterKeyDown}
            style={{ width: 260 }}
            allowClear
            autoFocus
          />
          <Input
            placeholder="Marca"
            value={marca}
            onChange={e => setMarca(e.target.value)}
            onKeyDown={handleFilterKeyDown}
            style={{ width: 140 }}
            allowClear
          />
          <Input
            placeholder="Categoría"
            value={categoria}
            onChange={e => setCategoria(e.target.value)}
            onKeyDown={handleFilterKeyDown}
            style={{ width: 140 }}
            allowClear
          />
          <Input
            placeholder="Código / Cod.Barras"
            value={codigo}
            onChange={e => setCodigo(e.target.value)}
            onKeyDown={handleFilterKeyDown}
            style={{ width: 160 }}
            allowClear
          />
          <Button type="primary" icon={<SearchOutlined />} onClick={handleSearchClick} loading={loading}>
            Buscar
          </Button>
        </Space>

        <Space style={{ marginBottom: 12 }}>
          <Checkbox checked={soloActivos} onChange={e => setSoloActivos(e.target.checked)}>
            Solo activos
          </Checkbox>
          <Checkbox checked={soloConStock} onChange={e => setSoloConStock(e.target.checked)}>
            Con stock
          </Checkbox>
          {results.length > 0 && (
            <Tag>{results.length} resultado{results.length !== 1 ? 's' : ''}</Tag>
          )}
        </Space>

        {/* Results table */}
        <div ref={tableRef}>
          <Table
            className="rg-table"
            dataSource={results}
            columns={columns}
            rowKey="PRODUCTO_ID"
            loading={loading}
            size="small"
            pagination={false}
            scroll={{ y: 400 }}
            rowSelection={{
              type: multiSelect ? 'checkbox' : 'radio',
              selectedRowKeys,
              onChange: (keys) => setSelectedRowKeys(keys),
            }}
            onRow={(record, index) => ({
              onClick: (e: React.MouseEvent) => {
                const idx = index ?? -1;
                if (e.shiftKey) {
                  e.preventDefault();
                  window.getSelection()?.removeAllRanges();
                }
                if (multiSelect) {
                  if (e.shiftKey && lastClickedIndex.current >= 0 && idx >= 0) {
                    // Shift+Click: select range from last clicked to current
                    const start = Math.min(lastClickedIndex.current, idx);
                    const end = Math.max(lastClickedIndex.current, idx);
                    const rangeKeys = results.slice(start, end + 1).map(r => r.PRODUCTO_ID);
                    setSelectedRowKeys(prev => {
                      const combined = new Set([...prev, ...rangeKeys]);
                      return Array.from(combined);
                    });
                  } else if (e.ctrlKey || e.metaKey) {
                    // Ctrl+Click: toggle individual item
                    setSelectedRowKeys(prev =>
                      prev.includes(record.PRODUCTO_ID)
                        ? prev.filter(k => k !== record.PRODUCTO_ID)
                        : [...prev, record.PRODUCTO_ID]
                    );
                    lastClickedIndex.current = idx;
                  } else {
                    // Plain click: select only this item
                    setSelectedRowKeys([record.PRODUCTO_ID]);
                    lastClickedIndex.current = idx;
                  }
                } else {
                  setSelectedRowKeys([record.PRODUCTO_ID]);
                  lastClickedIndex.current = idx;
                }
                setActiveRowIndex(idx);
              },
              onDoubleClick: () => {
                setSelectedRowKeys([record.PRODUCTO_ID]);
                // Use timeout to ensure state is set before confirming
                setTimeout(() => {
                  onSelect([record]);
                  onClose();
                }, 0);
              },
              className: index === activeRowIndex ? 'psm-active-row' : '',
            })}
          />
        </div>
      </div>
    </Modal>
  );
}
