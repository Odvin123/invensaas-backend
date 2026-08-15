// routes/movimientos.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('../middleware/auth');

router.get('/', verifyToken, async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const esSuperAdmin = req.esSuperAdmin;

        console.log('📊 ===== OBTENIENDO MOVIMIENTOS =====');
        console.log('   Tenant ID:', tenantId);
        console.log('   Es SuperAdmin:', esSuperAdmin);

        // 🔥 SI ES SUPERADMIN, VER TODOS LOS MOVIMIENTOS
        // SI NO ES SUPERADMIN, FILTRAR POR SU EMPRESA
        if (esSuperAdmin) {
            // SUPERADMIN: Ve todos los movimientos
            console.log('   🔥 SUPERADMIN: Viendo TODOS los movimientos');
            
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
                    e.tenant_id AS empresa_tenant,
                    e.nombre_empresa AS empresa_nombre
                FROM movimientos_inventario m
                LEFT JOIN productos p ON m.producto_id = p.id
                LEFT JOIN usuarios u ON m.usuario_id = u.id
                LEFT JOIN empresas e ON m.empresa_id = e.id
                ORDER BY m.fecha DESC
            `;

            const result = await db.query(query);
            
            // Calcular stock_antes
            const movimientos = result.rows.map(m => {
                const stockAntes = Number(m.nuevo_stock) - Number(m.cantidad);
                return {
                    ...m,
                    stock_antes: stockAntes,
                    stock_despues: m.nuevo_stock
                };
            });

            console.log(`✅ ${movimientos.length} movimientos encontrados (SUPERADMIN)`);

            return res.json({
                success: true,
                movimientos: movimientos
            });
        }

        // 🔥 ADMINISTRADOR / VENDEDOR: Filtrar por su empresa
        if (!tenantId) {
            console.log('⚠️ No hay tenant_id, devolviendo vacío');
            return res.json({ success: true, movimientos: [] });
        }

        // Obtener el ID de la empresa
        const empresaResult = await db.query(
            'SELECT id FROM empresas WHERE tenant_id = $1',
            [tenantId]
        );

        if (empresaResult.rowCount === 0) {
            console.log('❌ Empresa no encontrada para tenant:', tenantId);
            return res.json({ success: true, movimientos: [] });
        }

        const empresaId = empresaResult.rows[0].id;
        console.log('   🔍 Filtrando por empresa ID:', empresaId);

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
                u.nombre AS usuario_nombre
            FROM movimientos_inventario m
            LEFT JOIN productos p ON m.producto_id = p.id
            LEFT JOIN usuarios u ON m.usuario_id = u.id
            WHERE m.empresa_id = $1
            ORDER BY m.fecha DESC
        `;

        const result = await db.query(query, [empresaId]);

        // Calcular stock_antes
        const movimientos = result.rows.map(m => {
            const stockAntes = Number(m.nuevo_stock) - Number(m.cantidad);
            return {
                ...m,
                stock_antes: stockAntes,
                stock_despues: m.nuevo_stock
            };
        });

        console.log(`✅ ${movimientos.length} movimientos encontrados para empresa ${empresaId}`);

        res.json({
            success: true,
            movimientos: movimientos
        });

    } catch (error) {
        console.error('❌ Error al obtener movimientos:', error);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

module.exports = router;