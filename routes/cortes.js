const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('../middleware/auth');

router.get('/resumen', verifyToken, async (req, res) => {
    const empresa_id = req.usuario.empresa_id;
    const { fecha } = req.query; 
    
    try {
        let fechaInicio, fechaFin;
        
        if (fecha) {
            fechaInicio = `${fecha} 00:00:00`;
            fechaFin = `${fecha} 23:59:59`;
        } else {
            const hoy = new Date().toISOString().split('T')[0];
            fechaInicio = `${hoy} 00:00:00`;
            fechaFin = `${hoy} 23:59:59`;
        }
        
        const ultimoCorte = await db.query(
            'SELECT fondo_inicial FROM cortes_caja WHERE empresa_id = $1 ORDER BY fecha_cierre DESC LIMIT 1',
            [empresa_id]
        );
        
        const fondoInicialSugerido = ultimoCorte.rows.length > 0 
            ? parseFloat(ultimoCorte.rows[0].fondo_inicial) 
            : 0;
        
        const ventasResult = await db.query(`
            SELECT 
                COALESCE(SUM(v.total), 0) as total_ventas,
                COALESCE(SUM(dv.costo_unitario * dv.cantidad), 0) as total_costo
            FROM ventas v
            LEFT JOIN detalle_venta dv ON v.id = dv.venta_id
            WHERE v.empresa_id = $1 
            AND v.fecha_venta >= $2 
            AND v.fecha_venta <= $3
        `, [empresa_id, fechaInicio, fechaFin]);
        
        const pagosResult = await db.query(`
            SELECT 
                metodo_pago,
                COALESCE(SUM(pv.monto), 0) as total
            FROM pagos_venta pv
            JOIN ventas v ON pv.venta_id = v.id
            WHERE v.empresa_id = $1
            AND v.fecha_venta >= $2 
            AND v.fecha_venta <= $3
            GROUP BY metodo_pago
        `, [empresa_id, fechaInicio, fechaFin]);
        
        const pagos = {
            efectivo: 0,
            tarjeta: 0,
            transferencia: 0,
            credito: 0
        };
        
        pagosResult.rows.forEach(pago => {
            const metodo = pago.metodo_pago.toLowerCase();
            if (metodo === 'efectivo') pagos.efectivo = parseFloat(pago.total);
            else if (metodo === 'tarjeta') pagos.tarjeta = parseFloat(pago.total);
            else if (metodo === 'transferencia') pagos.transferencia = parseFloat(pago.total);
            else if (metodo === 'credito') pagos.credito = parseFloat(pago.total);
        });
        
        const totalVentas = parseFloat(ventasResult.rows[0].total_ventas);
        const totalCosto = parseFloat(ventasResult.rows[0].total_costo);
        const ganancia = totalVentas - totalCosto;
        
        const efectivoEsperado = fondoInicialSugerido + pagos.efectivo;
        
        res.json({
            success: true,
            datos: {
                fecha_inicio: fechaInicio,
                fecha_fin: fechaFin,
                total_ventas: totalVentas,
                total_costo: totalCosto,
                ganancia: ganancia,
                pagos: pagos,
                fondo_inicial_sugerido: fondoInicialSugerido,
                efectivo_esperado: efectivoEsperado
            }
        });
        
    } catch (error) {
        console.error('Error al obtener resumen de corte:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});

router.get('/historial', verifyToken, async (req, res) => {
    const empresa_id = req.usuario.empresa_id;
    const { inicio, fin } = req.query;
    
    try {
        let queryText = `
            SELECT 
                c.*,
                u.nombre AS usuario_nombre
            FROM cortes_caja c
            LEFT JOIN usuarios u ON c.usuario_id = u.id
            WHERE c.empresa_id = $1
        `;
        
        const params = [empresa_id];
        let paramIndex = 2;
        
        if (inicio && fin) {
            queryText += ` AND DATE(c.fecha_cierre) BETWEEN $${paramIndex} AND $${paramIndex + 1}`;
            params.push(inicio, fin);
        } else if (inicio) {
            queryText += ` AND DATE(c.fecha_cierre) >= $${paramIndex}`;
            params.push(inicio);
            paramIndex++;
        } else if (fin) {
            queryText += ` AND DATE(c.fecha_cierre) <= $${paramIndex}`;
            params.push(fin);
            paramIndex++;
        }
        
        queryText += ` ORDER BY c.fecha_cierre DESC`;
        
        const result = await db.query(queryText, params);
        
        res.json({
            success: true,
            cortes: result.rows
        });
        
    } catch (error) {
        console.error('Error al obtener historial de cortes:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});
router.post('/realizar', verifyToken, async (req, res) => {
    const empresa_id = req.usuario.empresa_id;
    const usuario_id = req.usuario.id;
    const { 
        total_ventas, 
        total_costo, 
        ganancia, 
        pagos, 
        efectivo_sistema, 
        efectivo_real, 
        diferencia,
        fondo_inicial,
        efectivo_esperado
    } = req.body;
    
    const client = await db.getClient();
    
    try {
        await client.query('BEGIN');
        
        await client.query(
            `INSERT INTO cortes_caja 
             (empresa_id, usuario_id, fecha_apertura, fecha_cierre, fondo_inicial, efectivo_esperado,
              total_ventas, total_costo, ganancia, 
              efectivo_sistema, efectivo_real, diferencia, 
              total_efectivo, total_tarjeta, total_transferencia, total_credito)
             VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
            [
                empresa_id,
                usuario_id,
                null,
                fondo_inicial || 0,
                efectivo_esperado || 0,
                total_ventas,
                total_costo,
                ganancia,
                efectivo_sistema,
                efectivo_real,
                diferencia,
                pagos.efectivo,
                pagos.tarjeta,
                pagos.transferencia,
                pagos.credito
            ]
        );
        
        await client.query('COMMIT');
        
        res.json({ success: true, message: 'Corte de caja realizado exitosamente' });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error al realizar corte de caja:', error);
        res.status(500).json({ success: false, message: 'Error al realizar el corte' });
    } finally {
        client.release();
    }
});
module.exports = router;