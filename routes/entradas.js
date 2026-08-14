const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verifyToken } = require('../middleware/auth');


router.post('/', verifyToken, async (req, res) => {
    if (!req.tenantId) {
        return res.status(403).json({ success: false, message: 'Acción no permitida para SuperAdmin.' });
    }

    const { productos, referencia, motivo } = req.body;
    const empresaId = req.tenantId;
    const usuarioId = req.usuario.id;

    // Validaciones
    if (!Array.isArray(productos) || productos.length === 0) {
        return res.status(400).json({ success: false, message: 'Debe incluir al menos un producto.' });
    }

    for (const item of productos) {
        if (!item.producto_id || !item.cantidad || item.cantidad <= 0) {
            return res.status(400).json({ success: false, message: 'Cada producto debe tener ID y cantidad positiva.' });
        }
    }

    const client = await pool.getClient();
    try {
        await client.query('BEGIN');

        for (const item of productos) {
            const { producto_id, cantidad } = item;

            const productoRes = await client.query(
                'SELECT id, stock FROM productos WHERE id = $1 AND empresa_id = $2 FOR UPDATE',
                [producto_id, empresaId]
            );

            if (productoRes.rows.length === 0) {
                throw new Error(`Producto ID ${producto_id} no encontrado o no pertenece a su empresa.`);
            }

            const stockActual = productoRes.rows[0].stock;
            const nuevoStock = stockActual + cantidad;

            // Actualizar stock
            await client.query(
                'UPDATE productos SET stock = $1 WHERE id = $2',
                [nuevoStock, producto_id]
            );

            // Registrar movimiento
            await client.query(
                `INSERT INTO movimientos_inventario 
                 (empresa_id, producto_id, tipo, cantidad, nuevo_stock, usuario_id, referencia, motivo)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [
                    empresaId,
                    producto_id,
                    'ENTRADA',
                    cantidad,
                    nuevoStock,
                    usuarioId,
                    referencia || 'COMPRA-MANUAL',
                    motivo || null
                ]
            );
        }

        await client.query('COMMIT');

        res.status(201).json({
            success: true,
            message: `Entrada registrada exitosamente con ${productos.length} producto(s).`
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error en entrada de inventario:', error);
        res.status(500).json({ success: false, message: `Error: ${error.message || 'Falló la transacción.'}` });
    } finally {
        client.release();
    }
});


router.get('/', verifyToken, async (req, res) => {
    let { tipo, inicio, fin } = req.query;
    tipo = (tipo || 'TODOS').toUpperCase(); 
    const empresaId = req.tenantId;

    if (!empresaId) {
        return res.status(403).json({ success: false, message: 'Acceso denegado.' });
    }

    if (!['ENTRADA', 'SALIDA', 'AJUSTE', 'TODOS'].includes(tipo)) {
        return res.status(400).json({ success: false, message: 'Tipo inválido. Use: ENTRADA, SALIDA, AJUSTE o TODOS.' });
    }

    let queryText = `
        SELECT 
            m.id,
            m.fecha,
            p.descripcion AS producto,
            p.id AS producto_id,
            m.tipo,
            m.cantidad,
            m.nuevo_stock,
            u.nombre AS usuario,
            m.referencia,
            m.motivo
        FROM movimientos_inventario m
        JOIN productos p ON m.producto_id = p.id
        LEFT JOIN usuarios u ON m.usuario_id = u.id
        WHERE m.empresa_id = $1
    `;

    const params = [empresaId];
    let idx = 2;

    if (tipo !== 'TODOS') {
        queryText += ` AND m.tipo = $${idx}`;
        params.push(tipo);
        idx++;
    }

    if (inicio && fin) {
        queryText += ` AND m.fecha::date BETWEEN $${idx} AND $${idx + 1}`;
        params.push(inicio, fin);
        idx += 2;
    }

    queryText += ` ORDER BY m.fecha DESC`;

    try {
        const result = await pool.query(queryText, params);
        res.status(200).json({ success: true, movimientos: result.rows });
    } catch (error) {
        console.error('Error al listar movimientos:', error);
        res.status(500).json({ success: false, message: 'Error al cargar movimientos.' });
    }
});

module.exports = router;