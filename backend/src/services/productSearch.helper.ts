import { sql } from '../database/connection.js';

export interface AdvancedProductSearchOptions {
  search?: string;
  marca?: string;
  categoria?: string;
  codigo?: string;
  busquedaMultiEntidad?: boolean;
}

export interface AdvancedProductSearchState {
  conditions: string[];
  joinMarca: boolean;
  joinCategoria: boolean;
  joinCodBarras: boolean;
}

export function buildAdvancedProductSearch(req: any, params: AdvancedProductSearchOptions): AdvancedProductSearchState {
  const conditions: string[] = [];
  let joinMarca = false;
  let joinCategoria = false;
  let joinCodBarras = false;
  const multiEntidad = params.busquedaMultiEntidad === true;

  if (params.search) {
    const searchTrim = params.search.trim();
    if (/^\d{6,}$/.test(searchTrim)) {
      joinCodBarras = true;
      conditions.push('(p.CODIGOPARTICULAR = @searchCode OR cb.CODIGO_BARRAS = @searchCode)');
      req.input('searchCode', sql.NVarChar, searchTrim);
    } else {
      const tokens = searchTrim.split(/\s+/).filter(token => token.length > 0);
      tokens.forEach((token, index) => {
        const paramName = `t${index}`;
        req.input(paramName, sql.NVarChar, `%${token}%`);
        if (multiEntidad) {
          conditions.push(`(p.NOMBRE LIKE @${paramName} OR p.CODIGOPARTICULAR LIKE @${paramName} OR cb.CODIGO_BARRAS LIKE @${paramName} OR m.NOMBRE LIKE @${paramName} OR c.NOMBRE LIKE @${paramName})`);
          joinMarca = true;
          joinCategoria = true;
          joinCodBarras = true;
        } else {
          conditions.push(`p.NOMBRE LIKE @${paramName}`);
        }
      });
    }
  }

  if (params.marca && params.marca.trim()) {
    joinMarca = true;
    conditions.push('m.NOMBRE LIKE @marca');
    req.input('marca', sql.NVarChar, `%${params.marca.trim()}%`);
  }

  if (params.categoria && params.categoria.trim()) {
    joinCategoria = true;
    conditions.push('c.NOMBRE LIKE @categoria');
    req.input('categoria', sql.NVarChar, `%${params.categoria.trim()}%`);
  }

  if (params.codigo) {
    const codigo = params.codigo.trim();
    if (/^\d{6,}$/.test(codigo)) {
      joinCodBarras = true;
      conditions.push('(p.CODIGOPARTICULAR = @codExact OR cb.CODIGO_BARRAS = @codExact)');
      req.input('codExact', sql.NVarChar, codigo);
    } else {
      joinCodBarras = true;
      conditions.push('(p.CODIGOPARTICULAR LIKE @cod OR cb.CODIGO_BARRAS LIKE @cod)');
      req.input('cod', sql.NVarChar, `%${codigo}%`);
    }
  }

  return { conditions, joinMarca, joinCategoria, joinCodBarras };
}