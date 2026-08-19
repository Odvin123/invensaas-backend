// routes/movimientos.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('../middleware/auth');

router.get('/', verifyToken, async (req, res) => {
    try {
        const usuario = req.usuario;
        const tenantId = usuario?.tenant_id;
        const rol = usuario?.rol;
        const empresaId = usuario?.empresa_id;

        const esSuperAdmin = rol === 'super_admin';

        console.log('📊 ===== OBTENIENDO MOVIMIENTOS =====');
        console.log('   Usuario ID:', usuario?.id);
        console.log('   Rol:', rol);
        console.log('   Tenant ID:', tenantId);
        console.log('   Empresa ID:', empresaId);
        console.log('   Es SuperAdmin:', esSuperAdmin);

        if (esSuperAdmin) {
            console.log('   🔥 SUPERADMIN: Viendo TODOS los movimientos');
            
            const query = `
                SELECT 
                    m.id,
                    m.tipo,
                    m.cantidad,
                    m.stock_antes,
                    m.stock_despues,
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
            
            const movimientos = result.rows.map(m => {
                if (m.stock_antes !== undefined && m.stock_antes !== null) {
                    return {
                        ...m,
                        stock_antes: Number(m.stock_antes),
                        stock_despues: Number(m.stock_despues)
                    };
                } else {
                    const cantidad = Number(m.cantidad) || 0;
                    const nuevoStock = Number(m.nuevo_stock) || 0;
                    return {
                        ...m,
                        stock_antes: nuevoStock - cantidad,
                        stock_despues: nuevoStock
                    };
                }
            });

            console.log(`✅ ${movimientos.length} movimientos encontrados (SUPERADMIN)`);

            return res.json({
                success: true,
                movimientos: movimientos
            });
        }

        if (!empresaId && !tenantId) {
            console.log('⚠️ No hay empresa_id ni tenant_id, devolviendo vacío');
            return res.json({ success: true, movimientos: [] });
        }

        let empresaIdReal = empresaId;

        if (!empresaIdReal && tenantId) {
            const empresaResult = await db.query(
                'SELECT id FROM empresas WHERE tenant_id = $1',
                [tenantId]
            );
            if (empresaResult.rowCount > 0) {
                empresaIdReal = empresaResult.rows[0].id;
            }
        }

        if (!empresaIdReal) {
            console.log('❌ No se encontró empresa para el usuario');
            return res.json({ success: true, movimientos: [] });
        }

        console.log('   🔍 Filtrando por empresa ID:', empresaIdReal);

        const query = `
            SELECT 
                m.id,
                m.tipo,
                m.cantidad,
                m.stock_antes,
                m.stock_despues,
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

        const result = await db.query(query, [empresaIdReal]);

        const movimientos = result.rows.map(m => {
            if (m.stock_antes !== undefined && m.stock_antes !== null) {
                return {
                    ...m,
                    stock_antes: Number(m.stock_antes),
                    stock_despues: Number(m.stock_despues)
                };
            } else {
                const cantidad = Number(m.cantidad) || 0;
                const nuevoStock = Number(m.nuevo_stock) || 0;
                return {
                    ...m,
                    stock_antes: nuevoStock - cantidad,
                    stock_despues: nuevoStock
                };
            }
        });

        console.log(`✅ ${movimientos.length} movimientos encontrados para empresa ${empresaIdReal}`);

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