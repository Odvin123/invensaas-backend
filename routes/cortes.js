router.get('/resumen', verifyToken, async (req, res) => {
    const empresa_id = req.usuario.empresa_id;
    
    try {
        const hoy = new Date();
        const año = hoy.getFullYear();
        const mes = String(hoy.getMonth() + 1).padStart(2, '0');
        const dia = String(hoy.getDate()).padStart(2, '0');
        
        const fechaInicioHoy = `${año}-${mes}-${dia} 00:00:00`;
        const fechaFinHoy = `${año}-${mes}-${dia} 23:59:59.999`;

        // 2. RESUMEN FINANCIERO (TODOS LOS TIEMPOS)
        const historicoResult = await db.query(`
            SELECT 
                COALESCE(SUM(v.total), 0) as total_ventas_historico,
                COALESCE(SUM(dv.costo_unitario * dv.cantidad), 0) as total_costo_historico
            FROM ventas v
            LEFT JOIN detalle_venta dv ON v.id = dv.venta_id
            WHERE v.empresa_id = $1
        `, [empresa_id]);

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

        const pagosHoy = { efectivo: 0, tarjeta: 0, transferencia: 0, credito: 0 };
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
        const fondoInicialSugerido = ultimoCorte.rows.length > 0 ? parseFloat(ultimoCorte.rows[0].fondo_inicial) : 0;

        const totalVentasHistorico = parseFloat(historicoResult.rows[0].total_ventas_historico);
        const totalCostoHistorico = parseFloat(historicoResult.rows[0].total_costo_historico);
        const gananciaHistorica = totalVentasHistorico - totalCostoHistorico;
        
        const efectivoEsperadoHoy = fondoInicialSugerido + pagosHoy.efectivo;

        res.json({
            success: true,
            datos: {
                total_ventas_historico: totalVentasHistorico,
                total_costo_historico: totalCostoHistorico,
                ganancia_historica: gananciaHistorica,
                
                fecha_inicio_hoy: fechaInicioHoy,
                fecha_fin_hoy: fechaFinHoy,
                pagos_hoy: pagosHoy,
                fondo_inicial_sugerido: fondoInicialSugerido,
                efectivo_esperado_hoy: efectivoEsperadoHoy
            }
        });

    } catch (error) {
        console.error('Error al obtener resumen:', error);
        res.status(500).json({ success: false, message: 'Error interno' });
    }
});