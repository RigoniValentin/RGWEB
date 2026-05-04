import { Select, Spin } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { bancosApi } from '../../services/bancos.api';
import type { Banco } from '../../types';

interface BancoSelectProps {
  value?: number | null;
  onChange?: (id: number | null, banco: Banco | null) => void;
  disabled?: boolean;
  placeholder?: string;
  size?: 'small' | 'middle' | 'large';
  allowClear?: boolean;
}

export default function BancoSelect({
  value,
  onChange,
  disabled,
  placeholder = 'Seleccionar banco…',
  size,
  allowClear = true,
}: BancoSelectProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['bancos', 'activos'],
    queryFn: () => bancosApi.getAll({ activo: true }),
    staleTime: 5 * 60 * 1000,
  });

  const options = useMemo(
    () =>
      (data ?? []).map(b => ({
        value: b.BANCO_ID,
        label: b.CODIGO_BCRA ? `${b.NOMBRE} (${b.CODIGO_BCRA})` : b.NOMBRE,
        banco: b,
      })),
    [data]
  );

  return (
    <Select
      showSearch
      allowClear={allowClear}
      disabled={disabled}
      placeholder={placeholder}
      size={size}
      value={value ?? undefined}
      loading={isLoading}
      notFoundContent={isLoading ? <Spin size="small" /> : 'Sin resultados'}
      optionFilterProp="label"
      filterOption={(input, option) => {
        const txt = (option?.label as string) || '';
        return txt.toLowerCase().includes(input.toLowerCase());
      }}
      options={options}
      onChange={(v, opt: any) => {
        onChange?.(v ?? null, opt?.banco ?? null);
      }}
      style={{ width: '100%' }}
    />
  );
}
