const express = require('express');
const router = express.Router();
const pool = require('../db'); // Usando tu pool de conexión
const { verifyToken } = require('../middleware/auth'); 

const DEFAULT_VENDEDOR = 'administrador'; 

router.get('/', verifyToken, async (req, res) => {
    
    const esSuperAdmin = req.esSuperAdmin;
    const empresaId = req.tenantId; 
    
    let queryText = 'SELECT id, nombre FROM vendedores';
    const queryParams = [];
    
    if (!esSuperAdmin) {
        queryText += ' WHERE empresa_id = $1';
        queryParams.push(empresaId);
    }
    
    queryText += ' ORDER BY nombre';

    try {
        const result = await pool.query(queryText, queryParams);
        
        res.status(200).json({ 
            success: true, 
            vendedores: result.rows 
        });
    } catch (err) {
        console.error('Error al listar vendedores:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor al obtener vendedores.' 
        });
    }
});

router.post('/', verifyToken, async (req, res) => {
    if (!req.tenantId) { 
        return res.status(403).json({ success: false, message: 'Acción no permitida para SuperAdmin en esta ruta.' });
    }
    
    const { nombre } = req.body;
    const empresaId = req.tenantId; 
    
    if (!nombre || nombre.trim() === '') {
        return res.status(400).json({ success: false, message: 'El nombre del vendedor es obligatorio.' });
    }

    try {
        // 1. Verificar unicidad dentro de la empresa
        const check = await pool.query(
            'SELECT * FROM vendedores WHERE LOWER(nombre) = LOWER($1) AND empresa_id = $2',
            [nombre, empresaId]
        );

        if (check.rows.length > 0) {
            return res.status(409).json({ success: false, message: `Ya existe un vendedor con el nombre "${nombre}" para su empresa.` });
        }
        
        // 2. Insertar
        const result = await pool.query(
            'INSERT INTO vendedores (nombre, empresa_id) VALUES ($1, $2) RETURNING id, nombre',
            [nombre, empresaId]
        );
        
        res.status(201).json({ 
            success: true, 
            message: 'Vendedor creado exitosamente.',
            vendedor: result.rows[0]
        });
    } catch (err) {
        console.error('Error al crear vendedor:', err);
        res.status(500).json({ success: false, message: 'Error interno del servidor al crear vendedor.' });
    }
});

router.put('/:id', verifyToken, async (req, res) => {
    if (!req.tenantId) {
        return res.status(403).json({ success: false, message: 'Acción no permitida para SuperAdmin en esta ruta.' });
    }

    const { id } = req.params;
    const { nombre } = req.body;
    const empresaId = req.tenantId;

    if (!nombre || nombre.trim() === '') {
        return res.status(400).json({ success: false, message: 'El nombre del vendedor es obligatorio.' });
    }
    
    try {
        // 1. Verificación adicional para el vendedor por defecto ('administrador')
        const checkDefault = await pool.query('SELECT nombre FROM vendedores WHERE id = $1 AND empresa_id = $2', [id, empresaId]);
        if (checkDefault.rows.length > 0 && checkDefault.rows[0].nombre.toLowerCase() === DEFAULT_VENDEDOR) {
            return res.status(403).json({ success: false, message: 'No se puede modificar el vendedor por defecto.' });
        }
        
        // 2. Actualización (aislamiento por id y empresa_id)
        const result = await pool.query(
            'UPDATE vendedores SET nombre = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND empresa_id = $3 RETURNING id, nombre',
            [nombre, id, empresaId]
        );
        
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Vendedor no encontrado o no pertenece a su empresa.' });
        }
        
        res.status(200).json({ 
            success: true, 
            message: 'Vendedor actualizado exitosamente.',
            vendedor: result.rows[0]
        });
    } catch (err) {
        if (err.code === '23505') { 
            return res.status(409).json({ success: false, message: 'Ya existe otro vendedor con ese nombre en esta empresa.' });
        }
        console.error('Error al actualizar vendedor:', err);
        res.status(500).json({ success: false, message: 'Error interno del servidor al actualizar vendedor.' });
    }
});

router.delete('/:id', verifyToken, async (req, res) => {
    if (!req.tenantId) {
        return res.status(403).json({ success: false, message: 'Acción no permitida para SuperAdmin en esta ruta.' });
    }

    const { id } = req.params;
    const empresaId = req.tenantId;

    try {
        // 1. Verificación y prohibición de eliminar el vendedor por defecto
        const checkDefault = await pool.query('SELECT nombre FROM vendedores WHERE id = $1 AND empresa_id = $2', [id, empresaId]);
        
        if (checkDefault.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Vendedor no encontrado o no pertenece a su empresa.' });
        }
        if (checkDefault.rows[0].nombre.toLowerCase() === DEFAULT_VENDEDOR) {
            return res.status(403).json({ success: false, message: 'No se puede eliminar el vendedor por defecto ("administrador").' });
        }
        
        // 2. Eliminación
        const result = await pool.query(
            'DELETE FROM vendedores WHERE id = $1 AND empresa_id = $2',
            [id, empresaId]
        );
        
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Vendedor no encontrado o no pertenece a su empresa.' });
        }
        
        res.status(200).json({ success: true, message: 'Vendedor eliminado exitosamente.' });
    } catch (err) {
        console.error('Error al eliminar vendedor:', err);
        res.status(500).json({ success: false, message: 'Error interno del servidor al eliminar vendedor.' });
    }
});

module.exports = router;