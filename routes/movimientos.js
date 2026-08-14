const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('../middleware/auth');

router.get('/', verifyToken, async (req, res) => {
    try {
        console.log('📊 ===== OBTENIENDO MOVIMIENTOS =====');

        const query = `
            SELECT 
                m.id,
                m.tipo,
                m.cantidad,
                m.nuevo_stock,
                m.referencia,
                m.motivo,
                m.fecha,
                p.descripcion AS producto_nombre,
                u.nombre AS usuario_nombre,
                e.tenant_id AS empresa_tenant
            FROM movimientos_inventario m
            LEFT JOIN productos p ON m.producto_id = p.id
            LEFT JOIN usuarios u ON m.usuario_id = u.id
            LEFT JOIN empresas e ON m.empresa_id = e.id
            ORDER BY m.fecha DESC
        `;

        console.log('📝 Ejecutando query...');
        const result = await db.query(query);

        console.log(`✅ ${result.rows.length} movimientos encontrados`);

        // Mostrar el primer movimiento para depurar
        if (result.rows.length > 0) {
            console.log('📋 Primer movimiento:', result.rows[0]);
        }

        // Calcular stock_antes
        const movimientos = result.rows.map(m => {
            const stockAntes = Number(m.nuevo_stock) - Number(m.cantidad);
            return {
                ...m,
                stock_antes: stockAntes,
                stock_despues: m.nuevo_stock
            };
        });

        res.json({
            success: true,
            movimientos: movimientos
        });

    } catch (error) {
        console.error('❌ Error al obtener movimientos:', error);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor: ' + error.message
        });
    }
});

module.exports = router;