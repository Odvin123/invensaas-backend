const express = require('express');
const router = express.Router();
const db = require('../db'); 
const { verifyToken, checkRole } = require('../middleware/auth'); 


router.post('/', verifyToken, checkRole(['administrador', 'super_admin']), async (req, res) => {
    const client = await db.getClient(); 
    
    const { cliente_id = 1, vendedor_id = 1, es_factura, detalles, pagos } = req.body;
    const empresa_id = req.usuario.empresa_id; 

    if (!empresa_id || !detalles || detalles.length === 0 || !pagos || pagos.length === 0) {
        return res.status(400).json({ success: false, message: 'Datos incompletos o inválidos (Empresa, Detalles o Pagos faltantes).' });
    }

    try {
        await client.query('BEGIN');

        const folioResult = await client.query(
            'SELECT ultimo_folio FROM control_folios WHERE empresa_id = $1 FOR UPDATE',
            [empresa_id]
        );
        
        let nuevoFolio;
        if (folioResult.rows.length === 0) {
            await client.query('INSERT INTO control_folios (empresa_id, ultimo_folio) VALUES ($1, 1)', [empresa_id]);
            nuevoFolio = 1;
        } else {
            const ultimoFolio = folioResult.rows[0].ultimo_folio;
            nuevoFolio = ultimoFolio + 1;
            await client.query('UPDATE control_folios SET ultimo_folio = $1 WHERE empresa_id = $2', [nuevoFolio, empresa_id]);
        }

        
        let totalVentaCalculado = 0;
        let subtotalVenta = 0;
        const impuesto = 0; 
        const descuento = 0; 
        const detallesCompletos = [];

        for (const detalle of detalles) {
            const { producto_id, cantidad } = detalle;
            let { precio_unitario } = detalle;
            
            const productoResult = await client.query(
                'SELECT stock, precio, costo FROM productos WHERE id = $1 AND empresa_id = $2 FOR UPDATE',
                [producto_id, empresa_id]
            );

            if (productoResult.rows.length === 0) {
                throw new Error(`Producto ID ${producto_id} no encontrado en la empresa.`);
            }

            const stockActual = productoResult.rows[0].stock;
            const precioActualBD = parseFloat(productoResult.rows[0].precio);
            const costoActualBD = parseFloat(productoResult.rows[0].costo);

            precio_unitario = parseFloat(precio_unitario) || precioActualBD; 

            if (stockActual < cantidad) {
                throw new Error(`Stock insuficiente para Producto ID ${producto_id}. Stock: ${stockActual}, solicitado: ${cantidad}.`);
            }
            
            const subtotalDetalle = cantidad * precio_unitario;
            subtotalVenta += subtotalDetalle;
            
            detallesCompletos.push({ 
                ...detalle, 
                precio_unitario: precio_unitario,
                costo_unitario: costoActualBD, 
                subtotal: subtotalDetalle 
            });
        }
        
        totalVentaCalculado = subtotalVenta + impuesto - descuento;

       
        let totalPagado = 0;
        for (const pago of pagos) {
            totalPagado += parseFloat(pago.monto);
        }
        
        if (totalPagado < totalVentaCalculado) {
             throw new Error(`El total pagado (${totalPagado.toFixed(2)}) es menor que el total de la venta (${totalVentaCalculado.toFixed(2)}).`);
        }
        
        const cambio = totalPagado - totalVentaCalculado;

        // ---------------------------
        // 4. Insertar venta
        // ---------------------------
        const ventaInsertQuery = `
            INSERT INTO ventas (empresa_id, folio, subtotal, impuesto, descuento, total, es_factura, cliente_id, vendedor_id, usuario_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id;
        `;
        const ventaResult = await client.query(ventaInsertQuery, [
            empresa_id, 
            nuevoFolio, 
            subtotalVenta, 
            impuesto, 
            descuento, 
            totalVentaCalculado, 
            es_factura, 
            cliente_id, 
            vendedor_id, 
            req.usuario.id
        ]);
        const venta_id = ventaResult.rows[0].id;

       
        for (const detalle of detallesCompletos) {
            await client.query(
                'INSERT INTO detalle_venta (venta_id, producto_id, cantidad, precio_unitario, costo_unitario, subtotal) VALUES ($1, $2, $3, $4, $5, $6)',
                [venta_id, detalle.producto_id, detalle.cantidad, detalle.precio_unitario, detalle.costo_unitario, detalle.subtotal]
            );

            await client.query(
                'UPDATE productos SET stock = stock - $1 WHERE id = $2 AND empresa_id = $3',
                [detalle.cantidad, detalle.producto_id, empresa_id]
            );
        }
        
        
        for (const pago of pagos) {
            await client.query(
                'INSERT INTO pagos_venta (venta_id, metodo_pago, monto) VALUES ($1, $2, $3)',
                [venta_id, pago.metodo, pago.monto]
            );
        }

        
        for (const detalle of detallesCompletos) {
            const stockResult = await client.query(
                'SELECT stock FROM productos WHERE id = $1 AND empresa_id = $2',
                [detalle.producto_id, empresa_id]
            );
            const nuevoStock = stockResult.rows[0].stock;

            await client.query(
                `INSERT INTO movimientos_inventario 
                 (empresa_id, producto_id, tipo, cantidad, nuevo_stock, usuario_id, referencia, motivo)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [
                    empresa_id,
                    detalle.producto_id,
                    'SALIDA',
                    -detalle.cantidad, 
                    nuevoStock,
                    req.usuario.id,
                    `VENTA-${venta_id}`,
                    'Salida por venta registrada en sistema'
                ]
            );
        }

        await client.query('COMMIT'); 
        
        res.status(201).json({ 
            success: true, 
            message: 'Venta y pago registrados exitosamente.', 
            folio: nuevoFolio,
            cambio: cambio.toFixed(2)
        });

    } catch (error) {
        await client.query('ROLLBACK'); 
        console.error('🔴 Error al registrar la venta:', error.message || error);
        res.status(500).json({ 
            success: false, 
            message: `Error en la transacción: ${error.message || 'Error desconocido.'}` 
        });
        
    } finally {
        client.release();
    }
});


router.get('/folio_actual', verifyToken, async (req, res) => {
    const empresa_id = req.usuario.empresa_id;
    if (!empresa_id) {
        return res.status(401).json({ success: false, message: 'ID de empresa no encontrado.' });
    }

    let client;
    try {
        client = await db.getClient();
        
        const folioResult = await client.query(
            'SELECT ultimo_folio FROM control_folios WHERE empresa_id = $1',
            [empresa_id]
        );
        
        let folioActual;
        if (folioResult.rows.length === 0) {
            folioActual = 1;
        } else {
            folioActual = folioResult.rows[0].ultimo_folio + 1;
        }

        res.json({ success: true, folio: folioActual });

    } catch (error) {
        console.error('Error al obtener el folio actual:', error.message);
        res.status(500).json({ success: false, message: 'Error interno del servidor al obtener el folio.' });
    } finally {
        if (client) client.release();
    }
});

// Productos para PDV (solo de la empresa)
router.get('/productos', verifyToken, async (req, res) => {
    const empresa_id = req.usuario.empresa_id;
    if (!empresa_id) {
        return res.status(401).json({ success: false, message: 'ID de empresa no encontrado.' });
    }

    try {
        const query = `
            SELECT 
                p.id, 
                p.descripcion, 
                p.stock, 
                p.precio,
                c.nombre AS nombre_categoria,
                pr.nombre AS nombre_proveedor
            FROM productos p
            JOIN categorias c ON p.categoria_id = c.id
            JOIN proveedores pr ON p.proveedor_id = pr.id
            WHERE p.empresa_id = $1
            ORDER BY p.descripcion;
        `;
        const result = await db.query(query, [empresa_id]);
        res.json({ success: true, productos: result.rows });
    } catch (error) {
        console.error('Error al obtener productos para PDV:', error);
        res.status(500).json({ success: false, message: 'Error al obtener la lista de productos.' });
    }
});

// Categorías para PDV
router.get('/categorias', verifyToken, async (req, res) => {
    const empresa_id = req.usuario.empresa_id;
    try {
        const query = `SELECT id, nombre FROM categorias WHERE empresa_id = $1 ORDER BY nombre`;
        const result = await db.query(query, [empresa_id]);
        res.json({ success: true, categorias: result.rows });
    } catch (error) {
        console.error('Error al obtener categorías:', error);
        res.status(500).json({ success: false, message: 'Error al obtener la lista de categorías.' });
    }
});

// Proveedores para PDV
router.get('/proveedores', verifyToken, async (req, res) => {
    const empresa_id = req.usuario.empresa_id;
    try {
        const query = `SELECT id, nombre FROM proveedores WHERE empresa_id = $1 ORDER BY nombre`;
        const result = await db.query(query, [empresa_id]);
        res.json({ success: true, proveedores: result.rows });
    } catch (error) {
        console.error('Error al obtener proveedores:', error);
        res.status(500).json({ success: false, message: 'Error al obtener la lista de proveedores.' });
    }
});


router.get('/reportes', verifyToken, async (req, res) => {
    const { inicio, fin } = req.query;
    const empresaId = req.tenantId;

    if (!empresaId) {
        return res.status(403).json({ success: false, message: 'Acceso denegado. Solo usuarios de empresa.' });
    }

    let queryText = `
        SELECT 
            v.id,
            v.folio,
            v.fecha_venta,
            v.subtotal,
            v.impuesto,
            v.descuento,
            v.total,
            v.es_factura,
            COALESCE(c.nombre, 'Público General') AS cliente_nombre,
            COALESCE(ven.nombre, 'Mostrador') AS vendedor_nombre,
            json_agg(
                json_build_object(
                    'descripcion', p.descripcion,
                    'cantidad', dv.cantidad,
                    'precio_unitario', dv.precio_unitario,
                    'subtotal', dv.subtotal
                )
            ) FILTER (WHERE p.id IS NOT NULL) AS detalles
        FROM ventas v
        LEFT JOIN clientes c ON v.cliente_id = c.id
        LEFT JOIN vendedores ven ON v.vendedor_id = ven.id
        LEFT JOIN detalle_venta dv ON v.id = dv.venta_id
        LEFT JOIN productos p ON dv.producto_id = p.id
        WHERE v.empresa_id = $1
    `;

    const params = [empresaId];
    let paramIndex = 2;

    if (inicio && fin) {
        queryText += ` AND v.fecha_venta::date BETWEEN $${paramIndex} AND $${paramIndex + 1}`;
        params.push(inicio, fin);
        paramIndex += 2;
    }

    queryText += `
        GROUP BY v.id, c.nombre, ven.nombre
        ORDER BY v.fecha_venta DESC
    `;

    try {
        const result = await db.query(queryText, params);
        const ventas = result.rows.map(row => ({
            ...row,
            detalles: row.detalles && row.detalles[0] && row.detalles[0].descripcion ? row.detalles : []
        }));

        res.status(200).json({ success: true, ventas });
    } catch (error) {
        console.error('Error al generar reporte de ventas:', error);
        res.status(500).json({ success: false, message: 'Error interno al generar el reporte.' });
    }
});

// Reporte: Productos vendidos (para análisis de margen)
router.get('/productos-vendidos', verifyToken, async (req, res) => {
    const { inicio, fin } = req.query;
    const empresaId = req.tenantId;

    if (!empresaId) {
        return res.status(403).json({ success: false, message: 'Acceso denegado.' });
    }

    let queryText = `
        SELECT 
            v.fecha_venta,
            p.id AS clave,
            p.descripcion,
            dv.cantidad,
            dv.subtotal AS venta,
            dv.precio_unitario,
            dv.costo_unitario * dv.cantidad AS costo
        FROM ventas v
        INNER JOIN detalle_venta dv ON v.id = dv.venta_id
        INNER JOIN productos p ON dv.producto_id = p.id
        WHERE v.empresa_id = $1
    `;

    const params = [empresaId];
    let paramIndex = 2;

    if (inicio && fin) {
        queryText += ` AND v.fecha_venta::date BETWEEN $${paramIndex} AND $${paramIndex + 1}`;
        params.push(inicio, fin);
        paramIndex += 2;
    }

    queryText += ` ORDER BY v.fecha_venta DESC`;

    try {
        const result = await db.query(queryText, params);
        res.status(200).json({ success: true, productos: result.rows });
    } catch (error) {
        console.error('Error en reporte productos vendidos:', error);
        res.status(500).json({ success: false, message: 'Error al generar el reporte.' });
    }
});

module.exports = router;