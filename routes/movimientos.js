// routes/movimientos.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('../middleware/auth');

router.get('/', verifyToken, async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const esSuperAdmin = req.esSuperAdmin;

        let query = `
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
                p.stock AS stock_antes
            FROM movimientos_inventario m
            LEFT JOIN productos p ON m.producto_id = p.id
            LEFT JOIN usuarios u ON m.usuario_id = u.id
        `;

        const params = [];

        if (!esSuperAdmin && tenantId) {
            query += ` WHERE m.empresa_id = (SELECT id FROM empresas WHERE tenant_id = $1)`;
            params.push(tenantId);
        }

        query += ` ORDER BY m.fecha DESC`;

        const result = await db.query(query, params);

        // 🔥 Calcular stock_antes para cada movimiento
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
        console.error('Error al obtener movimientos:', error);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

module.exports = router;