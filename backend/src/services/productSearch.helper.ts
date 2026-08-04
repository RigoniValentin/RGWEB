import { sql } from '../database/connection.js';

export interface AdvancedProductSearchOptions {
  search?: string;
  marca?: string;
  categoria?: string;
  codigo?: string;
  busquedaMultiEntidad?: boolean;
}

export interface AdvancedProductSearchState {
  /** Condiciones que se combinan con AND entre sí. */
  conditions: string[];
  /** Condiciones que se combinan con OR entre sí (multi-entidad por token). */
  orConditions: string[];
  joinMarca: boolean;
  joinCategoria: boolean;
  joinCodBarras: boolean;
}

export function buildAdvancedProductSearch(
  req: any,
  params: AdvancedProductSearchOptions,
): AdvancedProductSearchState {
  const conditions: string[] = [];
  const orConditions: string[] = [];
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
          // OR entre entidades para CADA token. Los tokens se siguen
          // AND-eando entre sí. De este modo "samsung" matchea productos
          // cuya MARCA se llama "Samsung" aunque el NOMBRE no la contenga,
          // y "leche nutricia" matchea productos cuya MARCA contiene
          // "nutricia" Y el NOMBRE (o cualquier otra entidad) contiene "leche".
          //
          // Subqueries sobre MARCAS/CATEGORIAS (chicas) en vez de LEFT JOIN +
          // LIKE '%x%' sobre columnas unidas: evita multiplicación de filas
          // y permite que SQL Server aplique semi-join optimizations.
          // CODIGO_BARRAS sí queda como join porque tiene índice dedicado
          // y necesitamos el LEFT JOIN para el resto del query.
          joinCodBarras = true;
          orConditions.push(`(
            p.NOMBRE LIKE @${paramName}
            OR p.CODIGOPARTICULAR LIKE @${paramName}
            OR cb.CODIGO_BARRAS LIKE @${paramName}
            OR p.MARCA_ID IN (SELECT MARCA_ID FROM MARCAS WHERE NOMBRE LIKE @${paramName})
            OR p.CATEGORIA_ID IN (SELECT CATEGORIA_ID FROM CATEGORIAS WHERE NOMBRE LIKE @${paramName})
          )`);
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

  return { conditions, orConditions, joinMarca, joinCategoria, joinCodBarras };
}