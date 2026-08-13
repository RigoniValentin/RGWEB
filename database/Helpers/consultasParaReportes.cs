using System;
using System.Collections.Generic;
using System.Data;
using Microsoft.Data.SqlClient;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Reeper_ERP.Informes.clases
{
    public static class consultasParaReportes
    {
        public static DataTable ObtenerCategorias(DateTime fechaInicio, DateTime fechaFin)
        {
            ConexionDB conexionDB = new ConexionDB();

            DataTable dataTable = new DataTable();

            using (SqlConnection connection = conexionDB.ObtenerConexion())
            {
                string query = @"SELECT 
                                    C.CODIGOPARTICULAR,
                                    C.NOMBRE,
                                    SUM(VI.PRECIO_UNITARIO_DTO) AS TOTALVENTAS
                                FROM 
                                    VENTAS_ITEMS VI
                                INNER JOIN 
                                    PRODUCTOS P ON VI.PRODUCTO_ID = P.PRODUCTO_ID
                                INNER JOIN 
                                    CATEGORIAS C ON P.CATEGORIA_ID = C.CATEGORIA_ID
                                INNER JOIN 
                                    VENTAS V ON VI.VENTA_ID = V.VENTA_ID
                                WHERE 
                                    V.FECHA_VENTA BETWEEN @FechaInicio AND @FechaFin
                                GROUP BY 
                                    C.CODIGOPARTICULAR, C.NOMBRE
                                ORDER BY 
                                    C.CODIGOPARTICULAR;
            ";

                using (SqlCommand command = new SqlCommand(query, connection))
                {
                    // Agregar parámetros
                    command.Parameters.AddWithValue("@FechaInicio", fechaInicio);
                    command.Parameters.AddWithValue("@FechaFin", fechaFin);

                    // Crear adaptador de datos
                    SqlDataAdapter adapter = new SqlDataAdapter(command);

                    try
                    {
                        // Abrir conexión, ejecutar el comando y llenar el DataTable
                        connection.Open();
                        adapter.Fill(dataTable);
                    }
                    catch (Exception ex)
                    {
                        // Manejar excepciones, registrarlas, etc.
                        MessageBox.Show("Error al ejecutar la consulta SQL: " + ex.Message);
                    }
                }
            }
            return dataTable;
        }

        public static byte[] ObtenerLogoCliente()
        {
            ConexionDB conexionDB = new ConexionDB();
            byte[] logoBytes = null;

            using (SqlConnection connection = conexionDB.ObtenerConexion())
            {
                string query = "SELECT LOGO FROM EMPRESA_CLIENTE WHERE EMPRESA_ID = 1;";

                using (SqlCommand command = new SqlCommand(query, connection))
                {
                    try
                    {
                        connection.Open();
                        var result = command.ExecuteScalar();
                        if (result != DBNull.Value)
                        {
                            logoBytes = (byte[])result;
                        }
                    }
                    catch (Exception ex)
                    {
                        MessageBox.Show("Error al ejecutar la consulta SQL: " + ex.Message);
                    }
                }
            }

            return logoBytes;
        }


        #region Analisis de ingresos

        public static DataTable AnalisisDeIngresosPorProductos(DateTime fechaInicio, DateTime fechaFin)
        {
            ConexionDB conexionDB = new ConexionDB();
            DataTable dataTable = new DataTable();

            using (SqlConnection connection = conexionDB.ObtenerConexion())
            {
                string query = @"
                                SELECT
                                    P.CODIGOPARTICULAR,
                                    P.NOMBRE AS PRODUCTO,
                                    SUM(VI.PRECIO_UNITARIO_DTO) AS TOTALVENTAS,
                                    SUM(VI.PRECIO_UNITARIO_DTO) / (
                                        SELECT SUM(VI2.PRECIO_UNITARIO_DTO)
                                        FROM VENTAS V2
                                        INNER JOIN VENTAS_ITEMS VI2 ON V2.VENTA_ID = VI2.VENTA_ID
                                        WHERE V2.FECHA_VENTA BETWEEN @FechaInicio AND @FechaFin
                                    ) * 100 AS PORCENTAJE_INGRESOS,
                                    (SELECT LOGO FROM EMPRESA_CLIENTE) AS LOGO
                                FROM
                                    PRODUCTOS P
                                INNER JOIN
                                    VENTAS_ITEMS VI ON P.PRODUCTO_ID = VI.PRODUCTO_ID
                                INNER JOIN
                                    VENTAS V ON VI.VENTA_ID = V.VENTA_ID
                                WHERE
                                    V.FECHA_VENTA BETWEEN @FechaInicio AND @FechaFin
                                GROUP BY
                                    P.CODIGOPARTICULAR,
                                    P.NOMBRE
                                ORDER BY
                                    PORCENTAJE_INGRESOS DESC; -- Ordenar de mayor a menor porcentaje de ingresos
                                ";

                using (SqlCommand command = new SqlCommand(query, connection))
                {
                    // Agregar parámetros
                    command.Parameters.AddWithValue("@FechaInicio", fechaInicio);
                    command.Parameters.AddWithValue("@FechaFin", fechaFin);

                    // Crear adaptador de datos
                    SqlDataAdapter adapter = new SqlDataAdapter(command);

                    try
                    {
                        // Abrir conexión, ejecutar el comando y llenar el DataTable
                        connection.Open();
                        adapter.Fill(dataTable);
                    }
                    catch (Exception ex)
                    {
                        // Manejar excepciones, registrarlas, etc.
                        MessageBox.Show("Error al ejecutar la consulta SQL: " + ex.Message);
                    }
                }
            }
            return dataTable;
        }

        public static DataTable AnalisisDeIngresosPorCategorias(DateTime fechaInicio, DateTime fechaFin)
        {
            ConexionDB conexionDB = new ConexionDB();
            DataTable dataTable = new DataTable();

            using (SqlConnection connection = conexionDB.ObtenerConexion())
            {
                string query = @"
                                SELECT
                                    C.CODIGOPARTICULAR AS CODIGOPARTICULAR,
                                    C.NOMBRE AS CATEGORIA,
                                    SUM(VI.PRECIO_UNITARIO_DTO) AS TOTALVENTAS,
                                    SUM(VI.PRECIO_UNITARIO_DTO) / (
                                        SELECT SUM(VI2.PRECIO_UNITARIO_DTO)
                                        FROM VENTAS V2
                                        INNER JOIN VENTAS_ITEMS VI2 ON V2.VENTA_ID = VI2.VENTA_ID
                                        WHERE V2.FECHA_VENTA BETWEEN @FechaInicio AND @FechaFin
                                    ) * 100 AS PORCENTAJE_INGRESOS
                                FROM
                                    CATEGORIAS C
	                                INNER JOIN
                                    PRODUCTOS P ON C.CATEGORIA_ID = P.CATEGORIA_ID
                                INNER JOIN
                                    VENTAS_ITEMS VI ON P.PRODUCTO_ID = VI.PRODUCTO_ID
                                INNER JOIN
                                    VENTAS V ON VI.VENTA_ID = V.VENTA_ID
                                WHERE
                                    V.FECHA_VENTA BETWEEN @FechaInicio AND @FechaFin
                                GROUP BY
                                    C.CODIGOPARTICULAR,
                                    C.NOMBRE
                                ORDER BY
                                    PORCENTAJE_INGRESOS DESC;
                            ";


                using (SqlCommand command = new SqlCommand(query, connection))
                {
                    // Agregar parámetros
                    command.Parameters.AddWithValue("@FechaInicio", fechaInicio);
                    command.Parameters.AddWithValue("@FechaFin", fechaFin);

                    // Crear adaptador de datos
                    SqlDataAdapter adapter = new SqlDataAdapter(command);

                    try
                    {
                        // Abrir conexión, ejecutar el comando y llenar el DataTable
                        connection.Open();
                        adapter.Fill(dataTable);
                    }
                    catch (Exception ex)
                    {
                        // Manejar excepciones, registrarlas, etc.
                        MessageBox.Show("Error al ejecutar la consulta SQL: " + ex.Message);
                    }
                }
            }
            return dataTable;
        }

        public static DataTable AnalisisDeIngresosPorMarcas(DateTime fechaInicio, DateTime fechaFin)
        {
            ConexionDB conexionDB = new ConexionDB();
            DataTable dataTable = new DataTable();

            using (SqlConnection connection = conexionDB.ObtenerConexion())
            {
                string query = @"
                                SELECT
                                    M.CODIGOPARTICULAR AS CODIGOPARTICULAR,
                                    M.NOMBRE AS MARCA,
                                    SUM(VI.PRECIO_UNITARIO_DTO) AS TOTALVENTAS,
                                    SUM(VI.PRECIO_UNITARIO_DTO) / (
                                        SELECT SUM(VI2.PRECIO_UNITARIO_DTO)
                                        FROM VENTAS V2
                                        INNER JOIN VENTAS_ITEMS VI2 ON V2.VENTA_ID = VI2.VENTA_ID
                                        WHERE V2.FECHA_VENTA BETWEEN @FechaInicio AND @FechaFin
                                    ) * 100 AS PORCENTAJE_INGRESOS
                                FROM
                                    MARCAS M
                                INNER JOIN
                                    PRODUCTOS P ON M.MARCA_ID = P.MARCA_ID
                                INNER JOIN
                                    VENTAS_ITEMS VI ON P.PRODUCTO_ID = VI.PRODUCTO_ID
                                INNER JOIN
                                    VENTAS V ON VI.VENTA_ID = V.VENTA_ID
                                WHERE
                                    V.FECHA_VENTA BETWEEN @FechaInicio AND @FechaFin
                                GROUP BY
                                    M.CODIGOPARTICULAR,
                                    M.NOMBRE
                                ORDER BY
                                    PORCENTAJE_INGRESOS DESC;
                            ";


                using (SqlCommand command = new SqlCommand(query, connection))
                {
                    // Agregar parámetros
                    command.Parameters.AddWithValue("@FechaInicio", fechaInicio);
                    command.Parameters.AddWithValue("@FechaFin", fechaFin);

                    // Crear adaptador de datos
                    SqlDataAdapter adapter = new SqlDataAdapter(command);

                    try
                    {
                        // Abrir conexión, ejecutar el comando y llenar el DataTable
                        connection.Open();
                        adapter.Fill(dataTable);
                    }
                    catch (Exception ex)
                    {
                        // Manejar excepciones, registrarlas, etc.
                        MessageBox.Show("Error al ejecutar la consulta SQL: " + ex.Message);
                    }
                }
            }
            return dataTable;
        }

        public static DataTable AnalisisDeIngresosPorProveedores(DateTime fechaInicio, DateTime fechaFin)
        {
            ConexionDB conexionDB = new ConexionDB();
            DataTable dataTable = new DataTable();

            using (SqlConnection connection = conexionDB.ObtenerConexion())
            {
                string query = @"
                                SELECT
                                    PR.CODIGOPARTICULAR AS CODIGOPARTICULAR,
                                    PR.NOMBRE AS PROVEEDOR,
                                    SUM(VI.PRECIO_UNITARIO_DTO) AS TOTALVENTAS,
                                    SUM(VI.PRECIO_UNITARIO_DTO) / (
                                        SELECT SUM(VI2.PRECIO_UNITARIO_DTO)
                                        FROM VENTAS V2
                                        INNER JOIN VENTAS_ITEMS VI2 ON V2.VENTA_ID = VI2.VENTA_ID
                                        WHERE V2.FECHA_VENTA BETWEEN @FechaInicio AND @FechaFin
                                    ) * 100 AS PORCENTAJE_INGRESOS
                                FROM
                                    PROVEEDORES PR
                                INNER JOIN
                                    PRODUCTOS P ON PR.PROVEEDOR_ID = P.PROVEEDOR_ID
                                INNER JOIN
                                    VENTAS_ITEMS VI ON P.PRODUCTO_ID = VI.PRODUCTO_ID
                                INNER JOIN
                                    VENTAS V ON VI.VENTA_ID = V.VENTA_ID
                                WHERE
                                    V.FECHA_VENTA BETWEEN @FechaInicio AND @FechaFin
                                GROUP BY
                                    PR.CODIGOPARTICULAR,
                                    PR.NOMBRE
                                ORDER BY
                                    PORCENTAJE_INGRESOS DESC;
                            ";


                using (SqlCommand command = new SqlCommand(query, connection))
                {
                    // Agregar parámetros
                    command.Parameters.AddWithValue("@FechaInicio", fechaInicio);
                    command.Parameters.AddWithValue("@FechaFin", fechaFin);

                    // Crear adaptador de datos
                    SqlDataAdapter adapter = new SqlDataAdapter(command);

                    try
                    {
                        // Abrir conexión, ejecutar el comando y llenar el DataTable
                        connection.Open();
                        adapter.Fill(dataTable);
                    }
                    catch (Exception ex)
                    {
                        // Manejar excepciones, registrarlas, etc.
                        MessageBox.Show("Error al ejecutar la consulta SQL: " + ex.Message);
                    }
                }
            }
            return dataTable;
        }
        #endregion

        public static DataTable ReporteVentasPorProducto(DateTime FechaDesde, DateTime FechaHasta)
        {
            ConexionDB conexionDB = new ConexionDB();
            DataTable dataTable = new DataTable();

            using (SqlConnection connection = conexionDB.ObtenerConexion())
            {
                string query = @"
                                SELECT 
                                        p.CODIGOPARTICULAR,
                                        p.NOMBRE,
                                        SUM(iv.CANTIDAD) AS CANTIDAD_VENDIDA,
	                                    COUNT(DISTINCT v.VENTA_ID) AS VENTAS_REALIZADAS,
                                        SUM(iv.CANTIDAD * iv.PRECIO_UNITARIO) AS TOTAL_INGRESOS
                                    FROM VENTAS v
                                    INNER JOIN VENTAS_ITEMS iv ON v.VENTA_ID = iv.VENTA_ID
                                    INNER JOIN PRODUCTOS p ON iv.PRODUCTO_ID = p.PRODUCTO_ID
                                    WHERE v.FECHA_VENTA BETWEEN @FechaDesde AND @FechaHasta
                                    GROUP BY p.PRODUCTO_ID, p.CODIGOPARTICULAR, p.NOMBRE
                                    ORDER BY TOTAL_INGRESOS DESC;
                            ";

                using (SqlCommand command = new SqlCommand(query, connection))
                {
                    command.Parameters.AddWithValue("@FechaDesde", FechaDesde);
                    command.Parameters.AddWithValue("@FechaHasta", FechaHasta);

                    SqlDataAdapter adapter = new SqlDataAdapter(command);

                    try
                    {
                        connection.Open();
                        adapter.Fill(dataTable);
                    }
                    catch (Exception ex)
                    {
                        MessageBox.Show("Error al ejecutar la consulta SQL: " + ex.Message);
                    }
                }
            }
            return dataTable;
        }

        public static DataTable ObtenerVentasPorCliente(DateTime fechaInicio, DateTime fechaFin)
        {
            ConexionDB conexionDB = new ConexionDB();
            DataTable dataTable = new DataTable();

            using (SqlConnection connection = conexionDB.ObtenerConexion())
            {
                string query = @"
                SELECT
                    C.CODIGOPARTICULAR,
                    C.NOMBRE AS CLIENTE,
                    SUM(VI.PRECIO_UNITARIO_DTO) AS TOTALVENTAS
                FROM
                    VENTAS V
                INNER JOIN
                    CLIENTES C ON V.CLIENTE_ID = C.CLIENTE_ID
                INNER JOIN
                    VENTAS_ITEMS VI ON V.VENTA_ID = VI.VENTA_ID
                WHERE
                    V.FECHA_VENTA BETWEEN @FechaInicio AND @FechaFin
                GROUP BY
                    C.CODIGOPARTICULAR,
                    C.NOMBRE
                ORDER BY
                    C.CODIGOPARTICULAR;
                ";

                using (SqlCommand command = new SqlCommand(query, connection))
                {
                    // Agregar parámetros
                    command.Parameters.AddWithValue("@FechaInicio", fechaInicio);
                    command.Parameters.AddWithValue("@FechaFin", fechaFin);

                    // Crear adaptador de datos
                    SqlDataAdapter adapter = new SqlDataAdapter(command);

                    try
                    {
                        // Abrir conexión, ejecutar el comando y llenar el DataTable
                        connection.Open();
                        adapter.Fill(dataTable);
                    }
                    catch (Exception ex)
                    {
                        // Manejar excepciones, registrarlas, etc.
                        MessageBox.Show("Error al ejecutar la consulta SQL: " + ex.Message);
                    }
                }
            }
            return dataTable;
        }

        public static DataTable ObtenerListadoClientes()
        {
            ConexionDB conexionDB = new ConexionDB();
            DataTable dataTable = new DataTable();

            using (SqlConnection connection = conexionDB.ObtenerConexion())
            {
                string query = @"
                SELECT
                    CODIGOPARTICULAR,
                    NOMBRE AS CLIENTE,
                    EMAIL,
                    TELEFONO 
                FROM
                    CLIENTES
                ORDER BY
                    CODIGOPARTICULAR; ";

                using (SqlCommand command = new SqlCommand(query, connection))
                {
                    // Crear adaptador de datos
                    SqlDataAdapter adapter = new SqlDataAdapter(command);
                    try
                    {
                        // Abrir conexión, ejecutar el comando y llenar el DataTable
                        connection.Open();
                        adapter.Fill(dataTable);
                    }
                    catch (Exception ex)
                    {
                        // Manejar excepciones, registrarlas, etc.
                        MessageBox.Show("Error al ejecutar la consulta SQL: " + ex.Message);
                    }
                }
            }
            return dataTable;
        }

        public static DataTable ObtenerListadoProductos()
        {
            ConexionDB conexionDB = new ConexionDB();
            DataTable dataTable = new DataTable();

            using (SqlConnection connection = conexionDB.ObtenerConexion())
            {
                string query = @"
                SELECT 
                    P.NOMBRE AS NOMBRE,
                    P.CANTIDAD,
                    P.LISTA_1,
                    P.LISTA_2,
                    P.LISTA_3,
                    P.LISTA_4,
                    P.LISTA_5
                FROM 
                    PRODUCTOS P
                GROUP BY 
                    P.CODIGOPARTICULAR,
                    P.NOMBRE,
                    P.LISTA_1,
                    P.LISTA_2,
                    P.LISTA_3,
                    P.LISTA_4,
                    P.LISTA_5,
                    P.CANTIDAD
                ORDER BY 
                    P.NOMBRE;";

                using (SqlCommand command = new SqlCommand(query, connection))
                {
                    // Crear adaptador de datos
                    SqlDataAdapter adapter = new SqlDataAdapter(command);
                    try
                    {
                        // Abrir conexión, ejecutar el comando y llenar el DataTable
                        connection.Open();
                        adapter.Fill(dataTable);
                    }
                    catch (Exception ex)
                    {
                        // Manejar excepciones, registrarlas, etc.
                        MessageBox.Show("Error al ejecutar la consulta SQL: " + ex.Message);
                    }
                }
            }
            return dataTable;
        }

        public static DataTable ObtenerReporteVentasGeneral(DateTime fechaInicio, DateTime fechaFin)
        {
            ConexionDB conexionDB = new ConexionDB();
            DataTable dataTable = new DataTable();
        
            using (SqlConnection connection = conexionDB.ObtenerConexion())
            {
                string query = @"
                                SELECT  
                                V.VENTA_ID, 
                                V.FECHA_VENTA,
                                C.NOMBRE AS CLIENTE, 
                                PRODUCTOS = STUFF((
                                                    SELECT ' - ' + 'x' + CONVERT(VARCHAR(10), oi2.CANTIDAD) + ' ' + P.NOMBRE 
                                                    FROM VENTAS_ITEMS oi2
                                                    INNER JOIN PRODUCTOS P ON P.PRODUCTO_ID = oi2.PRODUCTO_ID 
                                                    WHERE oi2.VENTA_ID = V.VENTA_ID
                                                    FOR XML PATH('')
                                                    ), 1, 2, ''),
                                V.TOTAL,
                                V.GANANCIAS AS GANANCIA,
                                V.MONTO_EFECTIVO,
                                V.MONTO_DIGITAL 
                            FROM 
                                VENTAS V
                            INNER JOIN 
                                CLIENTES C ON C.CLIENTE_ID = V.CLIENTE_ID 
                            INNER JOIN 
                                VENTAS_ITEMS oi1 ON oi1.VENTA_ID = V.VENTA_ID 
                            INNER JOIN 
                                PRODUCTOS P ON P.PRODUCTO_ID = oi1.PRODUCTO_ID  
                            WHERE 
                                V.FECHA_VENTA BETWEEN @FechaInicio AND @FechaFin
                            GROUP BY 
                                V.VENTA_ID, V.FECHA_VENTA, C.NOMBRE, V.TOTAL, V.GANANCIAS, V.MONTO_EFECTIVO, V.MONTO_DIGITAL
                            ORDER BY 
                                V.VENTA_ID ASC";

                using (SqlCommand command = new SqlCommand(query, connection))
                {
                    // Agregar parámetros
                    command.Parameters.AddWithValue("@FechaInicio", fechaInicio);
                    command.Parameters.AddWithValue("@FechaFin", fechaFin);

                    // Crear adaptador de datos
                    SqlDataAdapter adapter = new SqlDataAdapter(command);
                    try
                    {
                        // Abrir conexión, ejecutar el comando y llenar el DataTable
                        connection.Open();
                        adapter.Fill(dataTable);
                    }
                    catch (Exception ex)
                    {
                        // Manejar excepciones, registrarlas, etc.
                        MessageBox.Show("Error al ejecutar la consulta SQL: " + ex.Message);
                    }
                }
            }
            return dataTable;
        }

        public static DataTable ObtenerReporteComprasGeneral(DateTime fechaInicio, DateTime fechaFin)
        {
            ConexionDB conexionDB = new ConexionDB();
            DataTable dataTable = new DataTable();

            using (SqlConnection connection = conexionDB.ObtenerConexion())
            {
                string query = @"
                                SELECT  
                                V.COMPRA_ID, 
                                V.FECHA_COMPRA,
                                C.NOMBRE AS PROVEEDOR, 
                                PRODUCTOS = STUFF((
                                                    SELECT ' - ' + 'x' + CONVERT(VARCHAR(10), oi2.CANTIDAD) + ' ' + P.NOMBRE 
                                                    FROM COMPRAS_ITEMS oi2
                                                    INNER JOIN PRODUCTOS P ON P.PRODUCTO_ID = oi2.PRODUCTO_ID 
                                                    WHERE oi2.COMPRA_ID = oi1.COMPRA_ID
                                                    FOR XML PATH('')
                                                    ), 1, 2, ''),
                                    SUM((oi1.CANTIDAD * P.PRECIO_COMPRA)) AS TOTAL
                                FROM 
                                    COMPRAS V
                                INNER JOIN 
                                    PROVEEDORES C ON C.PROVEEDOR_ID = V.PROVEEDOR_ID 
                                INNER JOIN 
                                    COMPRAS_ITEMS oi1 ON oi1.COMPRA_ID = V.COMPRA_ID 
                                INNER JOIN 
                                    PRODUCTOS P ON P.PRODUCTO_ID = oi1.PRODUCTO_ID  
                                WHERE 
                                    V.FECHA_COMPRA BETWEEN @FechaInicio AND @FechaFin
                                GROUP BY 
                                    V.COMPRA_ID, oi1.COMPRA_ID, V.FECHA_COMPRA, C.NOMBRE
                                ORDER BY 
                                    V.COMPRA_ID ASC";

                using (SqlCommand command = new SqlCommand(query, connection))
                {
                    // Agregar parámetros
                    command.Parameters.AddWithValue("@FechaInicio", fechaInicio);
                    command.Parameters.AddWithValue("@FechaFin", fechaFin);

                    // Crear adaptador de datos
                    SqlDataAdapter adapter = new SqlDataAdapter(command);
                    try
                    {
                        // Abrir conexión, ejecutar el comando y llenar el DataTable
                        connection.Open();
                        adapter.Fill(dataTable);
                    }
                    catch (Exception ex)
                    {
                        // Manejar excepciones, registrarlas, etc.
                        MessageBox.Show("Error al ejecutar la consulta SQL: " + ex.Message);
                    }
                }
            }
            return dataTable;
        }

    }
}
