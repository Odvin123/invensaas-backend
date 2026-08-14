const express = require('express');
const router = express.Router();
const pool = require('../db'); 
const { verifyToken } = require('../middleware/auth'); 

const checkAdminRole = (req, res, next) => {
    const rol = req.usuario.rol;
    if (rol !== 'administrador' && rol !== 'super_admin') {
        return res.status(403).json({ success: false, message: 'Acción no permitida para este rol.' });
    }
    next();
};

router.get('/', verifyToken, async (req, res) => {
    const esSuperAdmin = req.esSuperAdmin;
    const empresaId = req.tenantId; 

    let whereClause = '';
    const queryParams = [];
    
    if (!esSuperAdmin) {
        whereClause = ' WHERE p.empresa_id = $1';
        queryParams.push(empresaId);
    }
    
    try {
        const result = await pool.query(`
            SELECT 
                p.id, 
                p.descripcion, 
                p.stock, 
                p.costo, 
                p.precio,
                c.nombre AS categoria_nombre,
                pr.nombre AS proveedor_nombre,
                p.categoria_id, 
                p.proveedor_id
            FROM productos p
            JOIN categorias c ON p.categoria_id = c.id
            JOIN proveedores pr ON p.proveedor_id = pr.id
            ${whereClause} 
            ORDER BY p.id DESC
        `, queryParams); 
        
        res.status(200).json({ 
            success: true, 
            productos: result.rows 
        });
    } catch (err) {
        console.error('Error al listar productos:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor al obtener productos.' 
        });
    }
});

router.post('/', verifyToken, checkAdminRole, async (req, res) => {
    if (!req.tenantId) {
        return res.status(403).json({ success: false, message: 'Acción no permitida para SuperAdmin en esta ruta.' });
    }
    
    const { proveedor_id, categoria_id, descripcion, stock, costo, precio } = req.body;
    const empresaId = req.tenantId; 
    
    if (!proveedor_id || !categoria_id || !descripcion || stock === undefined || costo === undefined || precio === undefined) {
        return res.status(400).json({ success: false, message: 'Faltan campos obligatorios para el producto.' });
    }
    
    const parsedStock = parseInt(stock);
    const parsedCosto = parseFloat(costo);
    const parsedPrecio = parseFloat(precio);

    if (isNaN(parsedStock) || isNaN(parsedCosto) || isNaN(parsedPrecio) || parsedStock < 0 || parsedCosto < 0 || parsedPrecio < 0) {
        return res.status(400).json({ success: false, message: 'Stock, Costo y Precio deben ser números válidos y no negativos.' });
    }

    try {
        const validationQuery = `
            SELECT EXISTS(SELECT 1 FROM categorias WHERE id = $1 AND empresa_id = $3) AS categoria_valida,
                   EXISTS(SELECT 1 FROM proveedores WHERE id = $2 AND empresa_id = $3) AS proveedor_valido
        `;
        const validationResult = await pool.query(validationQuery, [categoria_id, proveedor_id, empresaId]);
        
        if (!validationResult.rows[0].categoria_valida || !validationResult.rows[0].proveedor_valido) {
            return res.status(400).json({ 
                success: false, 
                message: 'El Proveedor o Categoría seleccionado(s) no existen o no pertenecen a su empresa.' 
            });
        }
        
        // Insertar producto
        const result = await pool.query(
            'INSERT INTO productos (proveedor_id, categoria_id, descripcion, stock, costo, precio, empresa_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, descripcion, stock, costo, precio, categoria_id, proveedor_id',
            [proveedor_id, categoria_id, descripcion, parsedStock, parsedCosto, parsedPrecio, empresaId]
        );

        // ✅ REGISTRAR ENTRADA AUTOMÁTICA SI STOCK > 0
        if (parsedStock > 0) {
            await pool.query(
                `INSERT INTO movimientos_inventario 
                 (empresa_id, producto_id, tipo, cantidad, nuevo_stock, usuario_id, referencia, motivo)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [
                    empresaId,
                    result.rows[0].id,
                    'ENTRADA',
                    parsedStock,
                    parsedStock,
                    req.usuario.id,
                    'STOCK-INICIAL',
                    'Stock inicial al crear el producto'
                ]
            );
        }
        
        res.status(201).json({ 
            success: true, 
            message: 'Producto creado exitosamente.',
            producto: result.rows[0]
        });
    } catch (err) {
        if (err.code === '23503') {
            return res.status(400).json({ 
                success: false, 
                message: 'Error al insertar. Proveedor o Categoría inválida. Asegúrese de que existan.' 
            });
        }
        console.error('Error al crear producto:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor al crear producto.' 
        });
    }
});


router.put('/:id', verifyToken, checkAdminRole, async (req, res) => {
    if (!req.tenantId) {
        return res.status(403).json({ success: false, message: 'Acción no permitida para SuperAdmin en esta ruta.' });
    }
    
    const { id } = req.params;
    // ✅ ELIMINAMOS 'stock' de los campos que se pueden actualizar
    const { proveedor_id, categoria_id, descripcion, costo, precio } = req.body;
    const empresaId = req.tenantId;

    // ✅ Validación: stock ya no es obligatorio en la actualización
    if (!proveedor_id || !categoria_id || !descripcion || costo === undefined || precio === undefined) {
        return res.status(400).json({ 
            success: false, 
            message: 'Faltan campos obligatorios para la actualización. (Stock no se puede modificar aquí)' 
        });
    }
    
    const parsedCosto = parseFloat(costo);
    const parsedPrecio = parseFloat(precio);

    if (isNaN(parsedCosto) || isNaN(parsedPrecio) || parsedCosto < 0 || parsedPrecio < 0) {
        return res.status(400).json({ 
            success: false, 
            message: 'Costo y Precio deben ser números válidos y no negativos.' 
        });
    }

    try {
        // Validar proveedor y categoría
        const validationQuery = `
            SELECT EXISTS(SELECT 1 FROM categorias WHERE id = $1 AND empresa_id = $3) AS categoria_valida,
                   EXISTS(SELECT 1 FROM proveedores WHERE id = $2 AND empresa_id = $3) AS proveedor_valido
        `;
        const validationResult = await pool.query(validationQuery, [categoria_id, proveedor_id, empresaId]);
        
        if (!validationResult.rows[0].categoria_valida || !validationResult.rows[0].proveedor_valido) {
            return res.status(400).json({ 
                success: false, 
                message: 'El Proveedor o Categoría seleccionado(s) no existen o no pertenecen a su empresa.' 
            });
        }
        
        // ✅ ACTUALIZAR producto SIN modificar el stock
        const result = await pool.query(
            'UPDATE productos SET proveedor_id = $1, categoria_id = $2, descripcion = $3, costo = $4, precio = $5, updated_at = CURRENT_TIMESTAMP WHERE id = $6 AND empresa_id = $7 RETURNING id',
            [proveedor_id, categoria_id, descripcion, parsedCosto, parsedPrecio, id, empresaId]
        );
        
        if (result.rowCount === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Producto no encontrado o no pertenece a esta empresa.' 
            });
        }
        
        res.status(200).json({ 
            success: true, 
            message: 'Producto actualizado exitosamente. (Stock NO modificado)' 
        });
    } catch (err) {
        if (err.code === '23505' || err.code === '23503') { 
            return res.status(400).json({ 
                success: false, 
                message: 'Error de integridad de datos.' 
            });
        }
        console.error('Error al actualizar producto:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor al actualizar producto.' 
        });
    }
});

router.delete('/:id', verifyToken, checkAdminRole, async (req, res) => {
    if (!req.tenantId) {
        return res.status(403).json({ success: false, message: 'Acción no permitida para SuperAdmin en esta ruta.' });
    }
    
    const { id } = req.params;
    const empresaId = req.tenantId;

    try {
        const result = await pool.query(
            'DELETE FROM productos WHERE id = $1 AND empresa_id = $2',
            [id, empresaId]
        );
        
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Producto no encontrado o no pertenece a esta empresa.' });
        }
        
        res.status(200).json({ success: true, message: 'Producto eliminado exitosamente.' });
    } catch (err) {
        console.error('Error al eliminar producto:', err);
        res.status(500).json({ success: false, message: 'Error interno del servidor al eliminar producto.' });
    }
});

module.exports = router;