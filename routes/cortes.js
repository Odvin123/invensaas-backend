const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('../middleware/auth');

router.get('/resumen', verifyToken, async (req, res) => {
    const empresa_id = req.usuario.empresa_id;
    
    try {
        // 1. OBTENER FECHA DE HOY
        const hoy = new Date();
        const año = hoy.getFullYear();
        const mes = String(hoy.getMonth() + 1).padStart(2, '0');
        const dia = String(hoy.getDate()).padStart(2, '0');
        
        const fechaInicioHoy = `${año}-${mes}-${dia} 00:00:00`;
        const fechaFinHoy = `${año}-${mes}-${dia} 23:59:59.999`;
        
        console.log('🔍 BUSCANDO VENTAS DEL DÍA:', fechaInicioHoy, 'a', fechaFinHoy);
        console.log('🏢 Empresa ID:', empresa_id);
        
        // 2. DIAGNÓSTICO - Ver TODAS las ventas del día
        const ventasDelDia = await db.query(`
            SELECT 
                v.id,
                v.folio,
                v.total,
                v.fecha_venta
            FROM ventas v
            WHERE v.empresa_id = $1 
            AND v.fecha_venta >= $2::timestamp
            AND v.fecha_venta <= $3::timestamp
            ORDER BY v.id ASC
        `, [empresa_id, fechaInicioHoy, fechaFinHoy]);
        
        console.log(`📦 Total ventas encontradas: ${ventasDelDia.rows.length}`);
        ventasDelDia.rows.forEach(v => {
            console.log(`   - Factura #${v.folio}: C$${v.total}`);
        });
        
        const totalVentasHoy = ventasDelDia.rows.reduce((sum, v) => sum + parseFloat(v.total), 0);
        console.log('💵 Suma total de ventas del día:', totalVentasHoy);
        
        // 3. DIAGNÓSTICO - Ver TODOS los pagos del día
        const pagosDelDia = await db.query(`
            SELECT 
                pv.id,
                pv.venta_id,
                pv.metodo_pago,
                pv.monto,
                v.folio
            FROM pagos_venta pv
            INNER JOIN ventas v ON pv.venta_id = v.id
            WHERE v.empresa_id = $1
            AND v.fecha_venta >= $2::timestamp
            AND v.fecha_venta <= $3::timestamp
            ORDER BY pv.id ASC
        `, [empresa_id, fechaInicioHoy, fechaFinHoy]);
        
        console.log(`💰 Total pagos encontrados: ${pagosDelDia.rows.length}`);
        pagosDelDia.rows.forEach(p => {
            console.log(`   - Pago ID ${p.id} (Venta #${p.folio}): ${p.metodo_pago} = C$${p.monto}`);
        });
        
        // 4. CALCULAR SUMA DE EFECTIVO - CONSULTA CORREGIDA
        const efectivoResult = await db.query(`
            SELECT 
                COALESCE(SUM(pv.monto), 0) as total_efectivo
            FROM pagos_venta pv
            INNER JOIN ventas v ON pv.venta_id = v.id
            WHERE v.empresa_id = $1
            AND v.fecha_venta >= $2::timestamp
            AND v.fecha_venta <= $3::timestamp
            AND LOWER(TRIM(pv.metodo_pago)) = 'efectivo'
        `, [empresa_id, fechaInicioHoy, fechaFinHoy]);
        
        const efectivoTotal = parseFloat(efectivoResult.rows[0].total_efectivo);
        console.log('✅ TOTAL EFECTIVO CALCULADO:', efectivoTotal);
        
        // 5. CALCULAR OTROS MÉTODOS DE PAGO
        const tarjetaResult = await db.query(`
            SELECT COALESCE(SUM(pv.monto), 0) as total
            FROM pagos_venta pv
            INNER JOIN ventas v ON pv.venta_id = v.id
            WHERE v.empresa_id = $1
            AND v.fecha_venta >= $2::timestamp
            AND v.fecha_venta <= $3::timestamp
            AND LOWER(TRIM(pv.metodo_pago)) = 'tarjeta'
        `, [empresa_id, fechaInicioHoy, fechaFinHoy]);
        
        const transferenciaResult = await db.query(`
            SELECT COALESCE(SUM(pv.monto), 0) as total
            FROM pagos_venta pv
            INNER JOIN ventas v ON pv.venta_id = v.id
            WHERE v.empresa_id = $1
            AND v.fecha_venta >= $2::timestamp
            AND v.fecha_venta <= $3::timestamp
            AND LOWER(TRIM(pv.metodo_pago)) = 'transferencia'
        `, [empresa_id, fechaInicioHoy, fechaFinHoy]);
        
        const creditoResult = await db.query(`
            SELECT COALESCE(SUM(pv.monto), 0) as total
            FROM pagos_venta pv
            INNER JOIN ventas v ON pv.venta_id = v.id
            WHERE v.empresa_id = $1
            AND v.fecha_venta >= $2::timestamp
            AND v.fecha_venta <= $3::timestamp
            AND (LOWER(TRIM(pv.metodo_pago)) = 'credito' OR LOWER(TRIM(pv.metodo_pago)) = 'crédito')
        `, [empresa_id, fechaInicioHoy, fechaFinHoy]);
        
        const pagos = {
            efectivo: efectivoTotal,
            tarjeta: parseFloat(tarjetaResult.rows[0].total),
            transferencia: parseFloat(transferenciaResult.rows[0].total),
            credito: parseFloat(creditoResult.rows[0].total)
        };
        
        console.log('💳 Pagos totales:', pagos);
        
        // 6. OBTENER FONDO INICIAL
        const ultimoCorte = await db.query(
            'SELECT fondo_inicial FROM cortes_caja WHERE empresa_id = $1 ORDER BY fecha_cierre DESC LIMIT 1',
            [empresa_id]
        );
        
        const fondoInicialSugerido = ultimoCorte.rows.length > 0 
            ? parseFloat(ultimoCorte.rows[0].fondo_inicial) 
            : 0;
        
        const efectivoEsperado = fondoInicialSugerido + efectivoTotal;
        
        // 7. ENVIAR RESPUESTA
        res.json({
            success: true,
            datos: {
                fecha_inicio_hoy: fechaInicioHoy,
                fecha_fin_hoy: fechaFinHoy,
                total_ventas_hoy: totalVentasHoy,
                cantidad_ventas_hoy: ventasDelDia.rows.length,
                pagos: pagos,
                fondo_inicial_sugerido: fondoInicialSugerido,
                efectivo_esperado: efectivoEsperado
            }
        });
        
    } catch (error) {
        console.error('❌ Error:', error);
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