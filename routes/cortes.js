const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('../middleware/auth');

router.get('/resumen', verifyToken, async (req, res) => {
    const empresa_id = req.usuario.empresa_id;
    
    try {
        const hoy = new Date();
        const año = hoy.getFullYear();
        const mes = String(hoy.getMonth() + 1).padStart(2, '0');
        const dia = String(hoy.getDate()).padStart(2, '0');
        
        const fechaInicioHoy = `${año}-${mes}-${dia} 00:00:00`;
        const fechaFinHoy = `${año}-${mes}-${dia} 23:59:59.999`;
        
        console.log('📅 Fecha de hoy:', `${año}-${mes}-${dia}`);
        console.log('🕐 Período:', fechaInicioHoy, 'a', fechaFinHoy);
        
        const historicoResult = await db.query(`
            SELECT 
                COALESCE(SUM(v.total), 0) as total_ventas_historico,
                COALESCE(SUM(dv.costo_unitario * dv.cantidad), 0) as total_costo_historico
            FROM ventas v
            LEFT JOIN detalle_venta dv ON v.id = dv.venta_id
            WHERE v.empresa_id = $1
        `, [empresa_id]);
        
        const ventasHoyResult = await db.query(`
            SELECT 
                COALESCE(SUM(v.total), 0) as total_ventas_hoy
            FROM ventas v
            WHERE v.empresa_id = $1 
            AND v.fecha_venta >= $2::timestamp
            AND v.fecha_venta <= $3::timestamp
        `, [empresa_id, fechaInicioHoy, fechaFinHoy]);
        
        const pagosHoyResult = await db.query(`
            SELECT 
                metodo_pago,
                COALESCE(SUM(pv.monto), 0) as total
            FROM pagos_venta pv
            JOIN ventas v ON pv.venta_id = v.id
            WHERE v.empresa_id = $1
            AND v.fecha_venta >= $2::timestamp
            AND v.fecha_venta <= $3::timestamp
            GROUP BY metodo_pago
        `, [empresa_id, fechaInicioHoy, fechaFinHoy]);
        
        const pagosHoy = {
            efectivo: 0,
            tarjeta: 0,
            transferencia: 0,
            credito: 0
        };
        
        pagosHoyResult.rows.forEach(pago => {
            const metodo = pago.metodo_pago.toLowerCase();
            if (pagosHoy.hasOwnProperty(metodo)) {
                pagosHoy[metodo] = parseFloat(pago.total);
            }
        });
        
        const ultimoCorte = await db.query(
            'SELECT fondo_inicial FROM cortes_caja WHERE empresa_id = $1 ORDER BY fecha_cierre DESC LIMIT 1',
            [empresa_id]
        );
        
        const fondoInicialSugerido = ultimoCorte.rows.length > 0 
            ? parseFloat(ultimoCorte.rows[0].fondo_inicial) 
            : 0;
        
        // 5. CALCULAR VALORES FINALES
        const totalVentasHistorico = parseFloat(historicoResult.rows[0].total_ventas_historico);
        const totalCostoHistorico = parseFloat(historicoResult.rows[0].total_costo_historico);
        const gananciaHistorica = totalVentasHistorico - totalCostoHistorico;
        
        const totalVentasHoy = parseFloat(ventasHoyResult.rows[0].total_ventas_hoy);
        
        const efectivoEsperadoHoy = fondoInicialSugerido + pagosHoy.efectivo;
        
        console.log('✅ Resultados:');
        console.log('   Ventas históricas:', totalVentasHistorico);
        console.log('   Ventas hoy:', totalVentasHoy);
        console.log('   Efectivo hoy:', pagosHoy.efectivo);
        console.log('   Fondo inicial sugerido:', fondoInicialSugerido);
        console.log('   Efectivo esperado:', efectivoEsperadoHoy);
        
        res.json({
            success: true,
            datos: {
                total_ventas_historico: totalVentasHistorico,
                total_costo_historico: totalCostoHistorico,
                ganancia_historica: gananciaHistorica,
                
                fecha_inicio_hoy: fechaInicioHoy,
                fecha_fin_hoy: fechaFinHoy,
                total_ventas_hoy: totalVentasHoy,
                pagos_hoy: pagosHoy,
                fondo_inicial_sugerido: fondoInicialSugerido,
                efectivo_esperado_hoy: efectivoEsperadoHoy
            }
        });
        
    } catch (error) {
        console.error('❌ Error al obtener resumen de corte:', error);
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