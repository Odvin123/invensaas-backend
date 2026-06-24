const express = require('express');
const router = express.Router();
const pool = require('../db'); 
const { verifyToken } = require('../middleware/auth'); 

// Listar todas las Categorías de la empresa (o global si es SuperAdmin)
router.get('/', verifyToken, async (req, res) => {
    
    const esSuperAdmin = req.esSuperAdmin;
    const empresaId = req.tenantId; 
    
    let queryText = 'SELECT id, nombre FROM categorias';
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
            categorias: result.rows 
        });
    } catch (err) {
        console.error('Error al listar categorías:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor al obtener categorías.' 
        });
    }
});

// Crear una nueva Categoría 
router.post('/', verifyToken, async (req, res) => {
    if (!req.tenantId) {
        return res.status(403).json({ success: false, message: 'Acción no permitida para SuperAdmin en esta ruta.' });
    }
    

    const { nombre } = req.body;
    const empresaId = req.tenantId; 
    
    if (!nombre || nombre.trim() === '') {
        return res.status(400).json({ 
            success: false, 
            message: 'El nombre de la categoría es obligatorio.' 
        });
    }

    try {

        const check = await pool.query(
            'SELECT * FROM categorias WHERE LOWER(nombre) = LOWER($1) AND empresa_id = $2',
            [nombre, empresaId]
        );

        if (check.rows.length > 0) {
            return res.status(409).json({ 
                success: false, 
                message: `Ya existe una categoría con el nombre "${nombre}" para su empresa.` 
            });
        }
        
        const result = await pool.query(
            'INSERT INTO categorias (nombre, empresa_id) VALUES ($1, $2) RETURNING id, nombre',
            [nombre, empresaId]
        );
        
        res.status(201).json({ 
            success: true, 
            message: 'Categoría creada exitosamente.',
            categoria: result.rows[0]
        });
    } catch (err) {
        console.error('Error al crear categoría:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor al crear categoría.' 
        });
    }
});

// ACTUALIZAR una Categoría 
router.put('/:id', verifyToken, async (req, res) => {
    if (!req.tenantId) {
        return res.status(403).json({ success: false, message: 'Acción no permitida para SuperAdmin en esta ruta.' });
    }

    const { id } = req.params;
    const { nombre } = req.body;
    const empresaId = req.tenantId;

    if (!nombre || nombre.trim() === '') {
        return res.status(400).json({ 
            success: false, 
            message: 'El nombre de la categoría es obligatorio.' 
        });
    }
    
    try {
        const result = await pool.query(
            'UPDATE categorias SET nombre = $1 WHERE id = $2 AND empresa_id = $3 RETURNING id, nombre',
            [nombre, id, empresaId]
        );
        
        if (result.rowCount === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Categoría no encontrada o no pertenece a su empresa.' 
            });
        }
        
        res.status(200).json({ 
            success: true, 
            message: 'Categoría actualizada exitosamente.',
            categoria: result.rows[0]
        });
    } catch (err) {
        console.error('Error al actualizar categoría:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor al actualizar categoría.' 
        });
    }
});

// Eliminar una Categoría 
router.delete('/:id', verifyToken, async (req, res) => {
    if (!req.tenantId) {
        return res.status(403).json({ success: false, message: 'Acción no permitida para SuperAdmin en esta ruta.' });
    }

    const { id } = req.params;
    const empresaId = req.tenantId;

    try {
        const result = await pool.query(
            'DELETE FROM categorias WHERE id = $1 AND empresa_id = $2',
            [id, empresaId]
        );
        
        if (result.rowCount === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Categoría no encontrada o no pertenece a su empresa.' 
            });
        }
        
        res.status(200).json({ 
            success: true, 
            message: 'Categoría eliminada exitosamente.' 
        });
    } catch (err) {
        console.error('Error al eliminar categoría:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Error interno del servidor al eliminar categoría.' 
        });
    }
});

module.exports = router;