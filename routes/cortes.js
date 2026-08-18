const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('../middleware/auth');

router.get('/resumen', verifyToken, async (req, res) => {
    const empresa_id = req.usuario.empresa_id;
    
    try {
        const ultimoCorte = await db.query(
            'SELECT fecha_cierre FROM cortes_caja WHERE empresa_id = $1 ORDER BY fecha_cierre DESC LIMIT 1',
            [empresa_id]
        );
        
        let fechaInicio = null;
        if (ultimoCorte.rows.length > 0) {
            fechaInicio = ultimoCorte.rows[0].fecha_cierre;
        }
        
        let queryVentas = `
            SELECT 
                COALESCE(SUM(v.total), 0) as total_ventas,
                COALESCE(SUM(dv.costo_unitario * dv.cantidad), 0) as total_costo
            FROM ventas v
            LEFT JOIN detalle_venta dv ON v.id = dv.venta_id
            WHERE v.empresa_id = $1
        `;
        
        let params = [empresa_id];
        
        if (fechaInicio) {
            queryVentas += ' AND v.fecha_venta > $2';
            params.push(fechaInicio);
        }
        
        const ventasResult = await db.query(queryVentas, params);
        
        let queryPagos = `
            SELECT 
                metodo_pago,
                COALESCE(SUM(monto), 0) as total
            FROM pagos_venta pv
            JOIN ventas v ON pv.venta_id = v.id
            WHERE v.empresa_id = $1
        `;
        
        let paramsPagos = [empresa_id];
        
        if (fechaInicio) {
            queryPagos += ' AND v.fecha_venta > $2';
            paramsPagos.push(fechaInicio);
        }
        
        queryPagos += ' GROUP BY metodo_pago';
        
        const pagosResult = await db.query(queryPagos, paramsPagos);
        
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
        
        res.json({
            success: true,
            datos: {
                fecha_inicio: fechaInicio,
                total_ventas: totalVentas,
                total_costo: totalCosto,
                ganancia: ganancia,
                pagos: pagos
            }
        });
        
    } catch (error) {
        console.error('Error al obtener resumen de corte:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});

router.post('/realizar', verifyToken, async (req, res) => {
    const empresa_id = req.usuario.empresa_id;
    const usuario_id = req.usuario.id;
    const { total_ventas, total_costo, ganancia, pagos, efectivo_sistema, efectivo_real, diferencia } = req.body;
    
    const client = await db.getClient();
    
    try {
        await client.query('BEGIN');
        
        await client.query(
            `INSERT INTO cortes_caja 
             (empresa_id, usuario_id, fecha_apertura, fecha_cierre, total_ventas, total_costo, ganancia, 
              efectivo_sistema, efectivo_real, diferencia, total_efectivo, total_tarjeta, 
              total_transferencia, total_credito)
             VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
                empresa_id,
                usuario_id,
                null,
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